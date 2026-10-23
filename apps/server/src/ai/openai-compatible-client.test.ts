import assert from "node:assert/strict";
import test from "node:test";
import { AIOutputTruncatedError, OpenAICompatibleClient } from "./openai-compatible-client.ts";

const service = {
  id: "ai",
  name: "AI",
  endpoint: "https://ai.example/chat/completions",
  apiKey: "secret",
  models: [{ name: "model" }],
  enabled: true,
};
const input = {
  service,
  model: service.models[0]!,
  messages: [{ role: "user" as const, content: "hello" }],
};

const sse = (events: string) => new Response(events, {headers: {'content-type': 'text/event-stream'}});
function openAIStream(text: string, reason = 'stop', tokens?: number) {
  return sse([
    `data: ${JSON.stringify({choices: [{index: 0, delta: {content: text}}]})}`,
    `data: ${JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: reason}]})}`,
    ...(tokens ? [`data: ${JSON.stringify({choices: [], usage: {completion_tokens: tokens}})}`] : []),
    'data: [DONE]', '',
  ].join('\n\n'));
}
function anthropicStream(text: string, reason = 'end_turn', tokens?: number) {
  return sse([
    `event: content_block_delta\ndata: ${JSON.stringify({type: 'content_block_delta', delta: {type: 'text_delta', text}})}`,
    `event: message_delta\ndata: ${JSON.stringify({type: 'message_delta', delta: {stop_reason: reason}, usage: {output_tokens: tokens}})}`,
    'event: message_stop\ndata: {"type":"message_stop"}', '',
  ].join('\n\n'));
}

test("OpenAI client sends a compatible completion request", async () => {
  let body: Record<string, unknown> | undefined;
  const client = new OpenAICompatibleClient(async (_url, init) => {
    body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer secret");
    assert.equal(headers.get("anthropic-version"), null);
    assert.equal(headers.get("accept"), "text/event-stream");
    return openAIStream("world");
  });
  assert.equal(await client.complete(input), "world");
  assert.equal(body?.model, "model");
  assert.equal(body?.stream, true);
  assert.deepEqual(body?.messages, input.messages);
});

test("OpenAI client parses SSE chunks and surfaces upstream errors", async () => {
  const streamClient = new OpenAICompatibleClient(async () => new Response(
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\ndata: [DONE]\n',
  ));
  let content = "";
  await streamClient.stream(input, (chunk) => { content += chunk; });
  assert.equal(content, "ab");

  const errorClient = new OpenAICompatibleClient(async () => new Response(
    'data: {"error":{"message":"upstream failed"}}\n',
  ));
  await assert.rejects(() => errorClient.stream(input, () => {}), /upstream failed/);
});

test("Anthropic client lifts system messages and parses content blocks", async () => {
  let body: Record<string, unknown> | undefined;
  const anthropicInput = {
    ...input,
    service: { ...service, apiFormat: "anthropic" as const },
    messages: [
      { role: "system" as const, content: "Follow the rules." },
      { role: "user" as const, content: "hello" },
      { role: "system" as const, content: "Be concise." },
    ],
  };
  const client = new OpenAICompatibleClient(async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer secret");
    assert.equal(headers.get("x-api-key"), "secret");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    body = JSON.parse(String(init?.body));
    return anthropicStream('hello world');
  });

  assert.equal(await client.complete(anthropicInput), "hello world");
  assert.equal(body?.model, "model");
  assert.equal(body?.max_tokens, 1024);
  assert.equal(body?.stream, true);
  assert.equal(body?.system, "Follow the rules.\n\nBe concise.");
  assert.deepEqual(body?.messages, [{ role: "user", content: "hello" }]);
});

test("Anthropic client parses text deltas and surfaces stream errors", async () => {
  const anthropicInput = {
    ...input,
    service: { ...service, apiFormat: "anthropic" as const },
  };
  const streamClient = new OpenAICompatibleClient(async () => new Response([
    "event: content_block_start",
    'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}',
    "",
    "event: content_block_delta",
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"a"}}',
    "",
    "event: content_block_delta",
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"b"}}',
    "",
    "event: message_stop",
    'data: {"type":"message_stop"}',
    "",
  ].join("\n")));
  let content = "";
  await streamClient.stream(anthropicInput, (chunk) => { content += chunk; });
  assert.equal(content, "ab");

  const errorClient = new OpenAICompatibleClient(async () => new Response(
    'event: error\ndata: {"type":"error","error":{"message":"anthropic failed"}}\n',
  ));
  await assert.rejects(
    () => errorClient.stream(anthropicInput, () => {}),
    /anthropic failed/,
  );
});

test("AI client explains how Docker reaches a host-local endpoint", async () => {
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const localInput = {
      ...input,
      service: {
        ...service,
        endpoint: `http://${hostname}:3000/v1/messages`,
      },
    };
    const client = new OpenAICompatibleClient(async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      () => client.complete(localInput),
      (error: unknown) => {
        assert.match(String(error), /fetch failed/);
        assert.match(String(error), /host\.docker\.internal/);
        return true;
      },
    );
  }
});

test('completion refuses truncated output instead of treating it as a completed analysis', async () => {
  const client = new OpenAICompatibleClient(async () => openAIStream('{"partial":true}', 'length'));
  await assert.rejects(client.complete({ service: { id: 's', name: 's', endpoint: 'https://example.com/chat', apiKey: 'test', enabled: true, models: [] }, model: { name: 'test' }, messages: [] }), /截断/);
});

test('Kimi 2.6 uses its required temperature without changing other models', async () => {
  for (const [model, temperature] of [['kimi-2.6', 1], ['glm-5.3', 0.2]] as const) {
    const client = new OpenAICompatibleClient(async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).temperature, temperature);
      return openAIStream('OK');
    });
    assert.equal(await client.complete({ ...input, model: { name: model } }), 'OK');
  }
});

test('truncated completions retry once with a larger budget and discard the partial answer', async () => {
  for (const apiFormat of ['openai', 'anthropic'] as const) {
    const bodies: any[] = [];
    const client = new OpenAICompatibleClient(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) return apiFormat === 'openai'
        ? openAIStream('partial', 'length', 6000) : anthropicStream('partial', 'max_tokens', 6000);
      return apiFormat === 'openai' ? openAIStream('complete') : anthropicStream('complete');
    });
    assert.equal(await client.complete({ ...input, service: { ...service, apiFormat }, maxOutputTokens: 6000 }), 'complete');
    assert.deepEqual(bodies.map(body => body.max_tokens), [6000, 12000]);
    assert.deepEqual(bodies[0].messages, bodies[1].messages);
  }
});

test('truncation retry is bounded and does not report monitor progress in generic AI errors', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient(async () => {
    calls++;
    return openAIStream('partial', 'length');
  });
  await assert.rejects(client.complete(input), (error: unknown) => {
    assert.ok(error instanceof AIOutputTruncatedError);
    assert.doesNotMatch(error.message, /监听|偏移量/);
    return true;
  });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(client.complete({ ...input, maxOutputTokens: 32768 }), AIOutputTruncatedError);
  assert.equal(calls, 1);
});

test('provider-default truncation uses reported token usage when increasing the output budget', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient(async (_url, init) => {
    calls++;
    if (calls === 1) return openAIStream('', 'length', 8192);
    assert.equal(JSON.parse(String(init?.body)).max_tokens, 16384);
    return openAIStream('OK');
  });
  assert.equal(await client.complete(input), 'OK');
});

test('stream truncation is surfaced without replaying partial text', async () => {
  for (const apiFormat of ['openai', 'anthropic'] as const) {
    let calls = 0;
    const client = new OpenAICompatibleClient(async () => {
      calls++;
      return new Response(apiFormat === 'openai'
        ? 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"choices":[{"finish_reason":"length","delta":{}}]}\n'
        : 'data: {"type":"content_block_delta","delta":{"text":"partial"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n');
    });
    let text = '';
    await assert.rejects(client.stream({ ...input, service: { ...service, apiFormat } }, chunk => { text += chunk; }), AIOutputTruncatedError);
    assert.equal(text, 'partial');
    assert.equal(calls, 1);
  }
});


test('streamed completion joins UTF-8 and SSE frames split across arbitrary byte boundaries', async () => {
  const text = '第一段：你好🌍\n\n第二段：原样保留。';
  const raw = ': keepalive\r\nevent: message\r\nid: 1\r\ndata: {\r\ndata: "choices": [{"index":0,"delta":{"content":'+JSON.stringify(text)+'}}]}\r\n\r\n'
    + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]';
  const bytes = new TextEncoder().encode(raw);
  let offset = 0;
  const client = new OpenAICompatibleClient(async () => new Response(new ReadableStream({
    pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); else controller.close(); },
  }), {headers: {'content-type': 'text/event-stream'}}));
  assert.equal(await client.complete(input), text);
});

test('a syntactically complete answer is rejected when the stream ends without a completion marker', async () => {
  for (const raw of [
    'data: {"choices":[{"delta":{"content":"{\\"matches\\":[]}"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"prefix"}}]}\n\ndata: {invalid}\n\n',
    'data: {"choices":[{"delta":{"content":"prefix"}}]}\n\ndata: {"error":{"message":"upstream disconnected"}}\n\n',
  ]) {
    let calls = 0;
    const client = new OpenAICompatibleClient(async () => { calls++; return sse(raw); });
    await assert.rejects(client.complete(input), /未完整结束|无效 JSON|upstream disconnected/);
    assert.equal(calls, 1);
  }
});

test('stream parsers ignore reasoning and non-text Anthropic deltas, but refuse non-success finish reasons', async () => {
  const client = new OpenAICompatibleClient(async () => sse('data: {"choices":[{"delta":{"reasoning_content":"private thinking"}}]}\n\n'
    + 'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  assert.equal(await client.complete(input), 'answer');
  const anthropic = new OpenAICompatibleClient(async () => sse('data: {"type":"content_block_start","content_block":{"type":"text","text":"hello"}}\n\n'
    + 'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"private"}}\n\n'
    + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\ndata: {"type":"message_stop"}\n\n'));
  assert.equal(await anthropic.complete({...input, service: {...service, apiFormat: 'anthropic'}}), 'hello');
  for (const reason of ['content_filter', 'tool_calls', 'function_call']) {
    let calls = 0;
    await assert.rejects(new OpenAICompatibleClient(async () => { calls++; return openAIStream('partial', reason); }).complete(input), /未正常结束/);
    assert.equal(calls, 1);
  }
});

test('HTTP failures are not silently retried or changed to non-streaming requests', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient(async (_url, init) => {
    calls++; assert.equal(JSON.parse(String(init?.body)).stream, true);
    return Response.json({error: {message: 'gateway timeout'}}, {status: 504});
  });
  await assert.rejects(client.complete(input), /504/); assert.equal(calls, 1);
});

test('a gateway returning JSON to a streaming request is read once without replay', async () => {
  for (const apiFormat of ['openai', 'anthropic'] as const) {
    let calls = 0;
    const client = new OpenAICompatibleClient(async (_url, init) => {
      calls++; assert.equal(JSON.parse(String(init?.body)).stream, true);
      return Response.json(apiFormat === 'openai'
        ? {choices: [{message: {content: 'OK'}, finish_reason: 'stop'}]}
        : {content: [{type: 'text', text: 'OK'}], stop_reason: 'end_turn'});
    });
    assert.equal(await client.complete({...input, service: {...service, apiFormat}}), 'OK'); assert.equal(calls, 1);
  }
});

test('parsing failures cancel an unfinished body and never release partial results as success', async () => {
  let cancelled = false;
  const client = new OpenAICompatibleClient(async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('data: {bad-json}\n\n')); },
    cancel() { cancelled = true; },
  }), {headers: {'content-type': 'text/event-stream'}}));
  await assert.rejects(client.complete(input), /无效 JSON/); assert.equal(cancelled, true);
});

test('the original timeout budget also covers streaming body reads', async () => {
  let calls = 0, aborted = false;
  const keepAlive = setTimeout(() => {}, 200);
  const client = new OpenAICompatibleClient(async (_url, init) => {
    calls++;
    return new Response(new ReadableStream({start(c) {
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      init!.signal!.addEventListener('abort', () => { aborted = true; c.error(init!.signal!.reason); }, {once: true});
    }}), {headers: {'content-type': 'text/event-stream'}});
  });
  try { await assert.rejects(client.complete({...input, timeoutMs: 20}), /timeout/i); assert.ok(aborted); assert.equal(calls, 1); }
  finally { clearTimeout(keepAlive); }
});

test('a truncation retry shares the initial time budget', async t => {
  let now = 0, calls = 0;
  const budgets: number[] = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { budgets.push(ms); return new AbortController().signal; });
  const client = new OpenAICompatibleClient(async () => {
    calls++; now = 75;
    return calls === 1 ? openAIStream('partial', 'length') : openAIStream('complete');
  });
  assert.equal(await client.complete({...input, timeoutMs: 100}), 'complete');
  assert.deepEqual(budgets, [100, 25]);
});

test('JSON gateway fallback recognizes media types regardless of letter case', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient(async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }] }), {
      headers: { 'content-type': 'Application/JSON; Charset=UTF-8' },
    });
  });
  assert.equal(await client.complete(input), 'Answer');
  assert.equal(calls, 1);
});

test('Chat Completions reads only known text blocks in JSON and SSE without flattening metadata', async () => {
  const content = [
    { type: 'text', text: '  First\n' },
    { type: 'reasoning', text: 'Private reasoning' },
    { type: 'tool_call', text: 'Tool data', arguments: { text: 'Nested tool data' } },
    { type: 'unknown', text: 'Unknown data' },
    { text: 'Unlabelled metadata' },
    { type: 'output_text', text: 'Second  ' },
  ];
  for (const transport of ['json', 'sse'] as const) {
    let calls = 0;
    const client = new OpenAICompatibleClient(async () => {
      calls++;
      return transport === 'json'
        ? Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
        : sse(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    assert.equal(await client.complete(input), '  First\nSecond  ');
    const chunks: string[] = [];
    await client.stream(input, chunk => { chunks.push(chunk); });
    assert.deepEqual(chunks, ['  First\n', 'Second  ']);
    assert.equal(calls, 2);
  }
});

test('known Chat Completions text blocks require string text and invalid content is never retried', async () => {
  for (const content of [
    [{ type: 'text', text: { value: 'Nested text' } }],
    [{ type: 'output_text', text: 42 }],
    [{ type: 'text' }],
    [{ type: 'text', text: null }],
    { text: 'Object outside content blocks' },
  ]) {
    for (const transport of ['json', 'sse'] as const) {
      let calls = 0;
      const client = new OpenAICompatibleClient(async () => {
        calls++;
        return transport === 'json'
          ? Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
          : sse(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      });
      await assert.rejects(client.complete(input), /内容.*格式无效/);
      assert.equal(calls, 1);
    }
  }
});

test('JSON gateway fallback requires an explicit successful or truncated completion reason', async () => {
  for (const apiFormat of ['openai', 'anthropic'] as const) {
    for (const reason of [undefined, null, '', 'content_filter', 'tool_use']) {
      let calls = 0;
      const client = new OpenAICompatibleClient(async () => {
        calls++;
        return Response.json(apiFormat === 'openai'
          ? { choices: [{ message: { content: '{"matches":[]}' }, finish_reason: reason }] }
          : { content: [{ type: 'text', text: '{"matches":[]}' }], stop_reason: reason });
      });
      await assert.rejects(client.complete({ ...input, service: { ...service, apiFormat } }), /未.*结束/);
      assert.equal(calls, 1);
    }
  }
});

test('complete and stream reject whitespace-only answers while preserving nonempty source text', async () => {
  for (const apiFormat of ['openai', 'anthropic'] as const) {
    for (const transport of ['json', 'sse'] as const) {
      let calls = 0;
      let text = ' \n\t ';
      const client = new OpenAICompatibleClient(async () => {
        calls++;
        if (transport === 'sse') return apiFormat === 'openai' ? openAIStream(text) : anthropicStream(text);
        return Response.json(apiFormat === 'openai'
          ? { choices: [{ message: { content: text }, finish_reason: 'stop' }] }
          : { content: [{ type: 'text', text }], stop_reason: 'end_turn' });
      });
      const completionInput = { ...input, service: { ...service, apiFormat } };
      await assert.rejects(client.complete(completionInput), /空内容/);
      await assert.rejects(client.stream(completionInput, () => {}), /空内容/);
      assert.equal(calls, 2);
      text = ' \nAnswer\n ';
      assert.equal(await client.complete(completionInput), text);
      let streamed = '';
      await client.stream(completionInput, chunk => { streamed += chunk; });
      assert.equal(streamed, text);
      assert.equal(calls, 4);
    }
  }
});
