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
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
    return new Response(JSON.stringify({ choices: [{ message: { content: "world" } }] }));
  });
  assert.equal(await client.complete(input), "world");
  assert.equal(body?.model, "model");
  assert.equal(body?.stream, false);
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
