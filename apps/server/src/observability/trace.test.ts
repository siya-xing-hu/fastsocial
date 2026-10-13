import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { ExecutionLogger, formatTrace, requestCurl, trace, type TraceEntry } from './trace.ts';
import { XRequestQueue } from '../adapters/x/request-queue.ts';
import { OpenAICompatibleClient } from '../ai/openai-compatible-client.ts';

function capture() {
  const entries: TraceEntry[] = [];
  const logger = new ExecutionLogger(entry => entries.push(structuredClone(entry)));
  return { entries, logger };
}

test('curl preserves exact headers, query and JSON through POSIX shell quoting without running any network command', () => {
  const url = 'https://fixture.invalid/CreateTweet?variables=%7B%22x%22%3A1%7D';
  const body = JSON.stringify({ tweet_text: "中文 'quoted' \"double\" $HOME $(echo executed) `echo executed`\\\nsecond paragraph", reply: { in_reply_to_tweet_id: '123' } });
  const headers = new Headers({ cookie: "auth_token=fake; ct0=it's-fake", authorization: 'Bearer fake-key', 'content-type': 'application/json' });
  const curl = requestCurl(url, 'POST', headers, body, 'error');
  const shell = spawnSync('/bin/sh', ['-c', `curl() { printf '%s\\0' "$@"; }; ${curl}`], { encoding: 'utf8' });
  assert.equal(shell.status, 0, shell.stderr);
  const args = shell.stdout.split('\0');
  assert.equal(args[args.indexOf('--data-raw') + 1], body);
  assert.equal(args[args.indexOf('--url') + 1], url);
  assert.ok(args.includes("cookie: auth_token=fake; ct0=it's-fake"));
  assert.ok(args.includes('authorization: Bearer fake-key')); assert.ok(!args.includes('--retry')); assert.ok(!args.includes('--location'));
  const line = formatTrace({ time: '', event: 'http.request', message: '', context: {}, data: { curl, body } });
  assert.equal(line.split('\n')[1], curl); // Copyable command, not JSON-escaped curl.
});

test('outbound diagnostics preserve the request and complete raw error response, with isolated concurrent contexts', async () => {
  const { logger, entries } = capture();
  const inputs: RequestInit[] = [];
  const fetchImpl = logger.fetch('X', async (_url, init) => {
    inputs.push(init!);
    await new Promise(resolve => setImmediate(resolve));
    return Response.json({ errors: [{ code: 226, message: 'not accepted' }], raw: 'x'.repeat(2000) });
  });
  await Promise.all(['one', 'two'].map(runId => logger.run({ runId, traceId: runId }, async () => {
    const init = { method: 'POST', headers: { cookie: `auth_token=fake-${runId}` }, body: JSON.stringify({ runId, text: 'first\nsecond' }, null, 2) };
    const response = await fetchImpl('https://fixture.invalid/CreateTweet', init);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).errors[0].code, 226);
    assert.ok(inputs.includes(init)); // The wrapper sends the original request options unchanged.
  })));
  for (const runId of ['one', 'two']) {
    const events = entries.filter(e => e.context.runId === runId);
    assert.deepEqual(events.map(e => e.event), ['http.request', 'http.response']);
    assert.equal(new Set(events.map(e => e.context.requestId)).size, 1);
    assert.match(String(events[0]!.data.curl), new RegExp(`fake-${runId}`));
    assert.equal(JSON.parse(String(events[1]!.data.responseBody)).raw.length, 2000);
    const requestLog = formatTrace(events[0]!);
    assert.match(requestLog, /回复 Post：curl/);
    assert.equal(requestLog.slice(requestLog.indexOf('\n') + 1), `${events[0]!.data.curl}\n`);
    const responseLog = formatTrace(events[1]!);
    assert.equal(responseLog.trimEnd().split('\n').length, 1);
    const exchange = JSON.parse(responseLog).data;
    assert.equal(exchange.url, 'https://fixture.invalid/CreateTweet');
    assert.equal(exchange.method, 'POST'); assert.equal(exchange.status, 200);
    assert.equal(exchange.requestHeaders.cookie, `auth_token=fake-${runId}`);
    assert.equal(exchange.requestBody, inputs.find(input => String(input.body).includes(runId))!.body);
    assert.equal(exchange.responseHeaders['content-type'], 'application/json');
    assert.equal(exchange.responseBody, events[1]!.data.responseBody);
  }
  assert.equal(new Set(entries.filter(e => e.event === 'http.request').map(e => e.context.requestId)).size, 2);
});

test('network and body errors are logged without retrying; unavailable sinks do not change success', async () => {
  const { logger, entries } = capture(); let calls = 0;
  const failing = logger.fetch('AI', async () => { calls++; throw new Error('network broken'); });
  await assert.rejects(failing('https://fixture.invalid/messages'), /network broken/);
  assert.equal(calls, 1); assert.equal(entries.at(-1)?.event, 'http.error');
  const ok = new ExecutionLogger(() => { throw new Error('log unavailable'); }).fetch('AI', async () => Response.json({ ok: true }));
  assert.deepEqual(await (await ok('https://fixture.invalid/messages')).json(), { ok: true });
  const broken = logger.fetch('AI', async () => new Response(new ReadableStream({ start(c) { c.error(new Error('body broken')); } })));
  await assert.rejects(broken('https://fixture.invalid/messages'), /body broken/);
  assert.equal(entries.at(-1)?.event, 'http.error');
});

test('stream responses are delivered incrementally, logged in order and cancellable', async () => {
  const { logger, entries } = capture();
  let source!: ReadableStreamDefaultController<Uint8Array>, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { source = c; }, cancel() { cancelled = true; } });
  const fetchImpl = logger.fetch('AI', async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  const response = await fetchImpl('https://fixture.invalid/messages');
  const reader = response.body!.getReader(), first = reader.read();
  const chunk = new TextEncoder().encode('data: {"text":"中文"}\n\n');
  source.enqueue(chunk);
  assert.deepEqual((await first).value, chunk);
  assert.equal(entries.length, 1); // Forward chunks immediately; log one exchange on completion/cancel.
  await reader.cancel('test stop');
  assert.ok(cancelled); assert.equal(entries.at(-1)?.event, 'http.cancelled');
  assert.equal(entries.at(-1)?.data.responseBody, new TextDecoder().decode(chunk));
  assert.equal(formatTrace(entries.at(-1)!).trimEnd().split('\n').length, 1);
});

test('AI streaming keeps its parsed output and logs complete raw chunks plus its finish event', async () => {
  const { logger, entries } = capture(); const chunks: string[] = [];
  const client = new OpenAICompatibleClient(logger.fetch('AI', async () => new Response(
    'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })));
  await logger.run({ traceId: 'stream-test' }, () => client.stream({
    service: { id: 'fake', name: 'Fake', endpoint: 'https://fixture.invalid/messages', apiKey: 'fake', enabled: true, models: [{ name: 'model' }] },
    model: { name: 'model' }, messages: [{ role: 'user', content: 'test' }],
  }, chunk => { chunks.push(chunk); }));
  assert.deepEqual(chunks, ['hello']); assert.ok(entries.some(e => e.event === 'http.response' && e.data.streamed));
  assert.ok(entries.filter(e => e.context.requestId).every(e => e.context.traceId === 'stream-test'));
});

test('X queue logs waiting and blocked requests without emitting a curl or consuming quota for unsent work', async () => {
  const { logger, entries } = capture(); let now = 0, sends = 0, consumed = 0;
  const queue = new XRequestQueue({ now: () => now, wait: async ms => { now += ms; } });
  const fetchImpl = logger.fetch('X', async () => { sends++; return Response.json({ ok: true }); });
  await logger.run({ traceId: 'queued' }, async () => {
    await queue.run(() => fetchImpl('https://fixture.invalid/HomeTimeline'));
    assert.deepEqual(entries.map(e => e.event), ['http.request', 'http.response']);
    await assert.rejects(queue.run(() => fetchImpl('https://fixture.invalid/CreateTweet'), () => { throw new Error('cancelled'); }), /cancelled/);
    await queue.run(() => fetchImpl('https://fixture.invalid/HomeTimeline'), () => { consumed++; });
    trace('test.done', 'complete');
  });
  assert.equal(sends, 2); assert.equal(consumed, 1);
  assert.equal(entries.filter(e => e.event === 'http.request').length, 2);
  assert.ok(entries.some(e => e.event === 'x.wait' && e.data.waitMs === 10000));
  assert.ok(entries.some(e => e.event === 'x.blocked'));
  queue.stop();
});

test('AI and local work run while X is waiting; elapsed AI time counts toward the next X interval', async () => {
  const { logger, entries } = capture(); let now = 0, release!: () => void;
  const waitGate = new Promise<void>(resolve => { release = resolve; });
  const queue = new XRequestQueue({ now: () => now, wait: async () => waitGate });
  const x = logger.fetch('X', async () => Response.json({ ok: true }));
  const ai = logger.fetch('AI', async () => { now += 15_000; return Response.json({ decisions: [] }); });
  try {
    await logger.run({ runId: 'not-a-request-queue' }, async () => {
      await queue.run(() => x('https://fixture.invalid/HomeTimeline'));
      const waiting = queue.run(() => x('https://fixture.invalid/CreateTweet'));
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(entries.some(entry => entry.event === 'x.wait'));
      await ai('https://fixture.invalid/chat/completions');
      trace('local.done', '本地处理完成');
      assert.equal(entries.filter(e => e.event === 'http.request' && e.context.system === 'X').length, 1);
      assert.ok(entries.some(e => e.event === 'http.response' && e.context.system === 'AI'));
      now += 15_000; release(); await waiting;
      await ai('https://fixture.invalid/chat/completions');
      await ai('https://fixture.invalid/chat/completions');
      const afterAI = entries.length;
      await queue.run(() => x('https://fixture.invalid/HomeTimeline'));
      assert.ok(entries.slice(afterAI).every(e => !e.event.startsWith('x.')));
      assert.ok(entries.filter(e => e.context.system === 'AI').every(e => !e.context.xRequestId));
    });
  } finally { release(); queue.stop(); }
});


test('buffered AI calls still receive live streams and log one complete exchange with an unbuffered curl', async () => {
  const {logger, entries} = capture();
  const raw = 'data: {"choices":[{"delta":{"content":"中文"}}]}\n\n'
    + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const client = new OpenAICompatibleClient(logger.fetch('AI', async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).stream, true);
    return new Response(raw, {headers: {'content-type': 'text/event-stream'}});
  }));
  const output = await logger.run({traceId: 'buffered-stream'}, () => client.complete({
    service: {id: 'fake', name: 'Fake', endpoint: 'https://fixture.invalid/chat', apiKey: 'fake', enabled: true, models: [{name: 'model'}]},
    model: {name: 'model'}, messages: [{role: 'user', content: 'test'}],
  }));
  assert.equal(output, '中文');
  const request = entries.find(e => e.event === 'http.request')!;
  assert.match(String(request.data.curl), /--no-buffer/); assert.match(String(request.data.curl), /"stream":true/);
  const responses = entries.filter(e => e.event === 'http.response'); assert.equal(responses.length, 1);
  const response = responses[0]!; assert.equal(response.data.responseBody, raw);
  assert.equal(formatTrace(response).trimEnd().split('\n').length, 1);
  assert.equal(JSON.parse(String(response.data.requestBody)).stream, true);
  assert.deepEqual(entries.filter(e => e.event.startsWith('ai.stream')).map(e => e.event), ['ai.stream.started', 'ai.stream.first_text']);
  assert.ok(entries.every(e => e.context.traceId === 'buffered-stream'));
});
