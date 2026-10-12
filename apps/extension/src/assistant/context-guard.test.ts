import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantContext } from "@fast-social/contracts";
import { draftError, parseSkillCommand } from "./context-guard.ts";

const snapshot = (): AssistantContext => ({ documentId: "doc-1", url: "https://x.com/other/status/1", title: "Post", account: { actorId: "10", username: "me" }, selection: "", posts: [], target: { id: "1", author: "other", text: "test", url: "https://x.com/other/status/1" }, composer: { id: "editor-1", scene: "reply", text: "original", targetId: "1" } });
test("draft fill is limited to the frozen account, document, page, editor, target and original text", () => {
  const frozen = snapshot();
  assert.equal(draftError(frozen, snapshot(), "reply"), null);
  for (const mutate of [
    (c: AssistantContext) => { c.documentId = "doc-2"; },
    (c: AssistantContext) => { c.url = "https://x.com/home"; },
    (c: AssistantContext) => { c.account.actorId = "99"; },
    (c: AssistantContext) => { c.composer!.id = "replaced"; },
    (c: AssistantContext) => { c.composer!.text = "user typed more"; },
    (c: AssistantContext) => { c.composer!.targetId = "2"; },
    (c: AssistantContext) => { c.composer!.scene = "post"; },
    (c: AssistantContext) => { c.composer = null; },
  ]) { const current = snapshot(); mutate(current); assert.ok(draftError(frozen, current, "reply")); }
  assert.ok(draftError(frozen, snapshot(), "summary"));
});
test("a newly opened draft must be empty and target the frozen post", () => {
  const frozen = snapshot(), current = snapshot(); frozen.composer = null;
  assert.ok(draftError(frozen, current, "reply"));
  current.composer!.text = "";
  assert.equal(draftError(frozen, current, "reply"), null);
  current.composer!.targetId = null;
  assert.ok(draftError(frozen, current, "reply"));
});
test("changing the display name does not invalidate the same account's draft", () => {
  const frozen = snapshot(), current = snapshot();
  frozen.account.displayName = "Before"; current.account.displayName = "After";
  assert.equal(draftError(frozen, current, "reply"), null);
});
test("slash commands do not silently route unsupported commands", () => {
  assert.deepEqual(parseSkillCommand("/reply 更直接一点"), { skill: "reply", input: "更直接一点" });
  assert.deepEqual(parseSkillCommand("/summary"), { skill: "summary", input: "" });
  assert.deepEqual(parseSkillCommand("帮我写一条推文"), { input: "帮我写一条推文" });
  assert.ok(parseSkillCommand("/publish now").error);
  assert.ok(parseSkillCommand("/").error);
});
