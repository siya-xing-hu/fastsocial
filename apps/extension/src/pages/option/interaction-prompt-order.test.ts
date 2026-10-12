import assert from "node:assert/strict";
import test from "node:test";
import type { InteractionPrompt } from "@fast-social/contracts";
import { reorderInteractionPrompts } from "./interaction-prompt-order.ts";

const prompt = (id: string, scene: InteractionPrompt["scene"]): InteractionPrompt => ({
  id, scene, name: id, prompt: `Template ${id}`, enabled: true,
});
const mixed = () => [prompt("p1", "post"), prompt("r1", "reply"), prompt("p2", "post"), prompt("r2", "reply"), prompt("p3", "post")];
const ids = (prompts: InteractionPrompt[]) => prompts.map(item => item.id);

test("pinning a post preserves reply slots, remaining post order, and the rollback snapshot", () => {
  const original = mixed();
  const result = reorderInteractionPrompts(original, "p3", "top");
  assert.deepEqual(ids(result), ["p3", "r1", "p1", "r2", "p2"]);
  assert.deepEqual(ids(original), ["p1", "r1", "p2", "r2", "p3"]);
  assert.equal(result[1], original[1]);
  assert.equal(result[3], original[3]);
  assert.equal(result[0], original[4]);
});

test("pinning a reply changes only reply priority and does not enable a disabled template", () => {
  const original = mixed();
  original[3].enabled = false;
  const result = reorderInteractionPrompts(original, "r2", "top");
  assert.deepEqual(ids(result), ["p1", "r2", "p2", "r1", "p3"]);
  assert.equal(result[1].enabled, false);
  assert.deepEqual(result.filter(item => item.scene === "post"), original.filter(item => item.scene === "post"));
});

test("moving down skips templates in the other scene", () => {
  const original = mixed();
  assert.deepEqual(ids(reorderInteractionPrompts(original, "p1", "down")), ["p2", "r1", "p1", "r2", "p3"]);
  assert.deepEqual(ids(reorderInteractionPrompts(original, "r1", "down")), ["p1", "r2", "p2", "r1", "p3"]);
});

test("scene boundaries, missing IDs, and single-item scenes do not require a save", () => {
  const original = mixed();
  for (const [id, action] of [["p1", "top"], ["r1", "top"], ["p3", "down"], ["r2", "down"], ["missing", "top"]] as const) {
    assert.equal(reorderInteractionPrompts(original, id, action), original);
  }
  const single = [prompt("r1", "reply"), prompt("p1", "post")];
  for (const action of ["top", "down"] as const) {
    assert.equal(reorderInteractionPrompts(single, "p1", action), single);
  }
  const empty: InteractionPrompt[] = [];
  assert.equal(reorderInteractionPrompts(empty, "missing", "top"), empty);
});
