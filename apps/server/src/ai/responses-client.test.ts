import assert from 'node:assert/strict';
import test from 'node:test';
import { AIOutputTruncatedError, OpenAICompatibleClient } from './openai-compatible-client.ts';

const service = {
  id: 'responses',
  name: 'Responses AI',
  endpoint: 'https://ai.example/custom/v1/responses?api-version=test',
  apiKey: 'test-responses-key',
  apiFormat: 'responses' as const,
  models: [{ name: 'reasoning-model' }],
  enabled: true,
};
const input = {
  service,
  model: service.models[0]!,
  messages: [
    { role: 'system' as const, content: 'Follow the instructions.' },
    { role: 'user' as const, content: 'First question' },
    { role: 'assistant' as const, content: 'Previous answer' },
    { role: 'user' as const, content: '继续回答。' },
  ],
};

function event(type: string, fields: Record<string, unknown> = {}) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
}
function sse(raw: string) {
  return new Response(raw, { headers: { 'content-type': 'text/event-stream' } });
}
function completed(text = 'Answer', outputTokens?: number) {
  return sse(event('response.output_text.delta', { delta: text })
    + event('response.completed', { response: {
      status: 'completed',
      ...(outputTokens === undefined ? {} : { usage: { output_tokens: outputTokens } }),
    } }));
}
function incomplete(text = 'Partial', reason = 'max_output_tokens', outputTokens?: number) {
  return sse(event('response.output_text.delta', { delta: text })
    + event('response.incomplete', { response: {
      status: 'incomplete',
      incomplete_details: { reason },
      ...(outputTokens === undefined ? {} : { usage: { output_tokens: outputTokens } }),
    } }));
}

test('Responses requests preserve the configured endpoint and conversation with reasoning-compatible parameters', async () => {
  const bodies: Record<string, unknown>[] = [];
  const client = new OpenAICompatibleClient(async (url, init) => {
    assert.equal(url, service.endpoint);
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-responses-key');
    assert.equal(headers.get('accept'), 'text/event-stream');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('anthropic-version'), null);
    assert.equal(headers.get('x-api-key'), null);
    bodies.push(JSON.parse(String(init?.body)));
    return completed();
  });
  assert.equal(await client.complete({ ...input, model: { ...input.model, thinking: { type: 'enabled' } }, maxOutputTokens: 6000 }), 'Answer');
  assert.equal(await client.complete(input), 'Answer');
  assert.deepEqual(bodies, [
    { model: input.model.name, input: input.messages, stream: true, store: false, max_output_tokens: 6000 },
    { model: input.model.name, input: input.messages, stream: true, store: false },
  ]);
});

test('Responses text deltas stream immediately and done/completed snapshots do not duplicate the answer', async () => {
  const raw = event('response.created', { response: { status: 'in_progress' } })
    + event('response.reasoning_summary_text.delta', { delta: 'Private reasoning' })
    + event('response.function_call_arguments.delta', { delta: '{"secret":"argument"}' })
    + event('response.output_text.delta', { delta: '你好' })
    + event('response.output_text.delta', { delta: ' 🌍' })
    + event('response.output_text.done', { text: '你好 🌍' })
    + event('response.content_part.done', { part: { type: 'output_text', text: '你好 🌍' } })
    + event('response.completed', { response: { status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: '你好 🌍' }] },
    ] } });
  const chunks: string[] = [];
  const client = new OpenAICompatibleClient(async () => sse(raw));
  await client.stream(input, chunk => { chunks.push(chunk); });
  assert.deepEqual(chunks, ['你好', ' 🌍']);
  assert.equal(await client.complete(input), '你好 🌍');
});

test('Responses live output reaches its consumer before the upstream finishes', { timeout: 1000 }, async () => {
  let upstream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finished = false;
  const encode = (raw: string) => new TextEncoder().encode(raw);
  const client = new OpenAICompatibleClient(async () => new Response(new ReadableStream({
    start(controller) {
      upstream = controller;
      controller.enqueue(encode(event('response.output_text.delta', { delta: 'First' })));
    },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const chunks: string[] = [];
  await client.stream(input, chunk => {
    assert.equal(finished, false);
    chunks.push(chunk);
    finished = true;
    upstream!.enqueue(encode(event('response.completed', { response: { status: 'completed' } })));
    upstream!.close();
  });
  assert.deepEqual(chunks, ['First']);
  assert.equal(finished, true);
});

test('Responses parsing handles UTF-8, CRLF, multiline data and SSE frames split at every byte', async () => {
  const answer = '第一段：你好🌍\n\n第二段：完整保留。';
  const raw = ': keepalive\r\nid: 1\r\nevent: response.output_text.delta\r\ndata: {\r\n'
    + `data: "type":"response.output_text.delta","delta":${JSON.stringify(answer)}}\r\n\r\n`
    + 'event: response.completed\r\ndata: {"type":"response.completed","response":{"status":"completed"}}';
  const bytes = new TextEncoder().encode(raw);
  let offset = 0;
  const client = new OpenAICompatibleClient(async () => new Response(new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
      else controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  assert.equal(await client.complete(input), answer);
});

test('Responses completions retry max_output_tokens once, preserve input and discard the first partial answer', async () => {
  const bodies: Record<string, unknown>[] = [];
  const client = new OpenAICompatibleClient(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1 ? incomplete('{"partial":', 'max_output_tokens', 6000) : completed('{"matches":[]}');
  });
  assert.equal(await client.complete({ ...input, maxOutputTokens: 6000 }), '{"matches":[]}');
  assert.deepEqual(bodies.map(body => body.max_output_tokens), [6000, 12000]);
  assert.deepEqual(bodies[0]?.input, input.messages);
  assert.deepEqual(bodies[1]?.input, input.messages);
  assert.ok(bodies.every(body => body.stream === true && body.store === false && !('max_tokens' in body)));
});

test('Responses truncation uses nested output token usage when the provider selected the first budget', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient(async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    if (calls === 1) {
      assert.equal(body.max_output_tokens, undefined);
      return incomplete('', 'max_output_tokens', 8192);
    }
    assert.equal(body.max_output_tokens, 16384);
    return completed('Complete');
  });
  assert.equal(await client.complete(input), 'Complete');
  assert.equal(calls, 2);
});

test('Responses truncation retries stay bounded and live streams never replay emitted text', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient(async () => { calls++; return incomplete(); });
  await assert.rejects(client.complete(input), AIOutputTruncatedError);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(client.complete({ ...input, maxOutputTokens: 32768 }), AIOutputTruncatedError);
  assert.equal(calls, 1);
  calls = 0;
  const chunks: string[] = [];
  await assert.rejects(client.stream(input, chunk => { chunks.push(chunk); }), AIOutputTruncatedError);
  assert.deepEqual(chunks, ['Partial']);
  assert.equal(calls, 1);
});

test('Responses truncation retry shares the original total timeout budget', async t => {
  let now = 0, calls = 0;
  const budgets: number[] = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { budgets.push(ms); return new AbortController().signal; });
  const client = new OpenAICompatibleClient(async () => {
    calls++;
    now = 75;
    return calls === 1 ? incomplete() : completed('Complete');
  });
  assert.equal(await client.complete({ ...input, timeoutMs: 100 }), 'Complete');
  assert.deepEqual(budgets, [100, 25]);
});

test('Responses rejects failed, cancelled and incomplete non-token terminal states without retrying', async () => {
  for (const terminal of [
    event('response.incomplete', { response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } } }),
    event('response.incomplete', { response: { status: 'incomplete' } }),
    event('response.failed', { response: { status: 'failed', error: { message: 'Provider failed' } } }),
    event('response.completed', { response: { status: 'failed' } }),
    event('response.completed', { response: { status: 'cancelled' } }),
    event('response.completed', { response: {} }),
    event('error', { error: { message: 'Provider error' } }),
  ]) {
    let calls = 0;
    const client = new OpenAICompatibleClient(async () => {
      calls++;
      return sse(event('response.output_text.delta', { delta: '{"matches":[]}' }) + terminal);
    });
    await assert.rejects(client.complete(input), error => {
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof AIOutputTruncatedError));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('Responses requires its own completed event and refuses broken frames after apparently valid JSON', async () => {
  for (const suffix of [
    '',
    'data: [DONE]\n\n',
    event('response.output_text.done', { text: '{"matches":[]}' }),
    event('response.output_item.done', { item: { type: 'message', status: 'completed' } }),
    'data: {invalid}\n\n',
  ]) {
    let calls = 0;
    const client = new OpenAICompatibleClient(async () => {
      calls++;
      return sse(event('response.output_text.delta', { delta: '{"matches":[]}' }) + suffix);
    });
    await assert.rejects(client.complete(input));
    assert.equal(calls, 1);
  }
});

test('Responses errors cancel an unfinished response body', async () => {
  let cancelled = false;
  const client = new OpenAICompatibleClient(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {invalid}\n\n')); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(client.complete(input), /无效 JSON/);
  assert.equal(cancelled, true);
});

test('Responses JSON gateway fallback reads only message output text once with no second request', async () => {
  let calls = 0;
  const chunks: string[] = [];
  const client = new OpenAICompatibleClient(async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).stream, true);
    return Response.json({
      status: 'completed',
      output_text: 'SDK convenience text must not be duplicated',
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Private' }] },
        { type: 'function_call', arguments: '{"private":true}' },
        { type: 'message', content: [
          { type: 'output_text', text: 'First ' },
          { type: 'refusal', refusal: 'Not answer text' },
          { type: 'output_text', text: 'answer' },
        ] },
        { type: 'message', content: [{ type: 'output_text', text: '\nSecond answer' }] },
      ],
    });
  });
  await client.stream(input, chunk => { chunks.push(chunk); });
  assert.equal(chunks.join(''), 'First answer\nSecond answer');
  assert.equal(calls, 1);
});

test('Responses JSON fallback requires completed status and real message output', async () => {
  for (const payload of [
    { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }] },
    { status: 'in_progress', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial' }] }] },
    { status: 'failed', error: { message: 'Gateway failure' } },
    { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] },
    { status: 'completed', output_text: 'Convenience field alone' },
    { status: 'completed', output: [{ type: 'function_call', content: [{ type: 'output_text', text: 'Tool data' }] }] },
  ]) {
    let calls = 0;
    const client = new OpenAICompatibleClient(async () => { calls++; return Response.json(payload); });
    await assert.rejects(client.complete(input));
    assert.equal(calls, 1);
  }
});

test('Responses JSON max-output truncation retries with its output usage and drops the partial snapshot', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient(async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { output_tokens: 8192 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial' }] }],
    });
    assert.equal(JSON.parse(String(init?.body)).max_output_tokens, 16384);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Complete' }] }] });
  });
  assert.equal(await client.complete(input), 'Complete');
  assert.equal(calls, 2);
});

test('Responses completed-only snapshots supply text once after status validation', async () => {
  const snapshot = event('response.completed', { response: {
    status: 'completed',
    output: [
      { type: 'reasoning', content: [{ type: 'output_text', text: 'Private reasoning' }] },
      { type: 'function_call', arguments: '{"text":"Tool data"}' },
      { type: 'message', content: [
        { type: 'output_text', text: '  First\n' },
        { type: 'refusal', text: 'Non-text metadata' },
        { type: 'output_text', text: 'Second  ' },
      ] },
    ],
  } });
  let calls = 0;
  const client = new OpenAICompatibleClient(async () => { calls++; return sse(snapshot); });
  assert.equal(await client.complete(input), '  First\nSecond  ');
  const chunks: string[] = [];
  await client.stream(input, chunk => { chunks.push(chunk); });
  assert.deepEqual(chunks, ['  First\n', 'Second  ']);
  assert.equal(calls, 2);
});

test('Responses snapshots cannot replace partial deltas or rescue missing and failed completion', async () => {
  const output = [{ type: 'message', content: [{ type: 'output_text', text: 'Complete snapshot' }] }];
  const partialClient = new OpenAICompatibleClient(async () => sse(
    event('response.output_text.delta', { delta: 'Partial delta' })
    + event('response.completed', { response: { status: 'completed', output } }),
  ));
  assert.equal(await partialClient.complete(input), 'Partial delta');
  for (const raw of [
    event('response.output_text.done', { text: 'Complete snapshot' }),
    event('response.content_part.done', { part: { type: 'output_text', text: 'Complete snapshot' } }),
    event('response.failed', { response: { status: 'failed', output, error: { message: 'Provider failed' } } }),
    event('response.completed', { response: { status: 'failed', output } }),
    event('response.completed', { response: { output } }),
    event('response.output_text.delta', { delta: 'Partial delta' })
      + event('response.output_text.done', { text: 'Complete snapshot' }),
  ]) {
    let calls = 0;
    const chunks: string[] = [];
    const client = new OpenAICompatibleClient(async () => { calls++; return sse(raw); });
    await assert.rejects(client.complete(input));
    await assert.rejects(client.stream(input, chunk => { chunks.push(chunk); }));
    assert.ok(chunks.every(chunk => chunk === 'Partial delta'));
    assert.equal(calls, 2);
  }
});

test('Responses complete and stream reject whitespace-only text in deltas and complete snapshots', async () => {
  for (const transport of ['delta', 'snapshot', 'json'] as const) {
    let calls = 0;
    const client = new OpenAICompatibleClient(async () => {
      calls++;
      const snapshot = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: ' \n\t ' }] }] };
      if (transport === 'json') return Response.json(snapshot);
      if (transport === 'snapshot') return sse(event('response.completed', { response: snapshot }));
      return completed(' \n\t ');
    });
    await assert.rejects(client.complete(input), /空内容/);
    await assert.rejects(client.stream(input, () => {}), /空内容/);
    assert.equal(calls, 2);
  }
});
