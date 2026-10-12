import assert from "node:assert/strict";
import test from "node:test";
import { commandKey, skillQuery } from "./skill-commands.ts";

test("only an incomplete slash command opens the menu, respecting the caret", () => {
  assert.equal(skillQuery("/"), ""); assert.equal(skillQuery("/rep"), "rep");
  assert.equal(skillQuery(" /POST"), "post");
  assert.equal(skillQuery("/reply "), null); assert.equal(skillQuery("/reply text"), null);
  assert.equal(skillQuery("Explain /reply"), null); assert.equal(skillQuery("/reply", 3), null);
  assert.equal(skillQuery("/rep ", 4), "rep");
});
test("arrow keys wrap, Enter confirms the active option, and Tab only completes a unique match", () => {
  assert.deepEqual(commandKey("ArrowDown", 3, 0), { handled: true, selected: 1 });
  assert.equal(commandKey("ArrowDown", 3, 2).selected, 0);
  assert.equal(commandKey("ArrowUp", 3, 0).selected, 2);
  assert.deepEqual(commandKey("Enter", 3, 2), { handled: true, selected: 2, confirm: 2 });
  assert.equal(commandKey("Tab", 1, 0).confirm, 0);
  assert.equal(commandKey("Tab", 3, 0).handled, false);
  assert.equal(commandKey("Escape", 3, 0).dismiss, true);
});
test("IME confirmation and ordinary keys never select a skill", () => {
  assert.equal(commandKey("Enter", 3, 0, true).handled, false);
  assert.equal(commandKey("Enter", 0, 0).handled, false);
  assert.equal(commandKey("a", 3, 0).handled, false);
});
