import assert from "node:assert/strict";
import test from "node:test";
import { OpenAICompatibleClient } from "./openai-compatible-client.ts";

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

test("OpenAI client sends a compatible completion request", async () => {
  let body: Record<string, unknown> | undefined;
  const client = new OpenAICompatibleClient(async (_url, init) => {
    body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer secret");
    assert.equal(headers.get("anthropic-version"), null);
    return new Response(JSON.stringify({ choices: [{ message: { content: "world" } }] }));
  });
  assert.equal(await client.complete(input), "world");
  assert.equal(body?.model, "model");
  assert.equal(body?.stream, false);
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
    return new Response(JSON.stringify({
      content: [
        { type: "text", text: "hello" },
        { type: "tool_use", id: "tool" },
        { type: "text", text: " world" },
      ],
    }));
  });

  assert.equal(await client.complete(anthropicInput), "hello world");
  assert.equal(body?.model, "model");
  assert.equal(body?.max_tokens, 1024);
  assert.equal(body?.stream, false);
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
  const client = new OpenAICompatibleClient(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"partial":true}' } }] })));
  await assert.rejects(client.complete({ service: { id: 's', name: 's', endpoint: 'https://example.com/chat', apiKey: 'test', enabled: true, models: [] }, model: { name: 'test' }, messages: [] }), /截断/);
});

test('Kimi 2.6 uses its required temperature without changing other models', async () => {
  for (const [model, temperature] of [['kimi-2.6', 1], ['glm-5.3', 0.2]] as const) {
    const client = new OpenAICompatibleClient(async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).temperature, temperature);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    });
    assert.equal(await client.complete({ ...input, model: { name: model } }), 'OK');
  }
});
