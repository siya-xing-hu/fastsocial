import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPTION_HASH,
  loadOptionNavigation,
  OPTION_NAVIGATION_STORAGE_KEY,
  parseOptionNavigation,
  saveOptionNavigation,
} from "./option-navigation.ts";

function memoryStorage(initialValue?: string): Storage {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(OPTION_NAVIGATION_STORAGE_KEY, initialValue);
  }

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("parses basic and every server section", () => {
  assert.deepEqual(parseOptionNavigation("#basic"), {
    hash: "#basic",
    area: "basic",
    serverSection: "overview",
  });

  for (const section of ["overview", "connections", "ai", "monitors", "prompts"] as const) {
    assert.deepEqual(parseOptionNavigation(`#server/${section}`), {
      hash: `#server/${section}`,
      area: "server",
      serverSection: section,
    });
  }
});

test("falls back to basic for unsupported or malformed hashes", () => {
  for (const hash of ["#server", "#server/settings", "#unknown", "basic", "#server/AI"] as const) {
    assert.deepEqual(parseOptionNavigation(hash), {
      hash: DEFAULT_OPTION_HASH,
      area: "basic",
      serverSection: "overview",
    });
  }
});

test("loads the stored route only when the URL has no hash", () => {
  const storage = memoryStorage("#server/monitors");

  assert.equal(loadOptionNavigation("", storage).hash, "#server/monitors");
  assert.equal(loadOptionNavigation("#server/ai", storage).hash, "#server/ai");
  assert.equal(loadOptionNavigation("#broken", storage).hash, DEFAULT_OPTION_HASH);
});

test("saving normalizes invalid routes before persisting", () => {
  const storage = memoryStorage();

  assert.equal(saveOptionNavigation("#server/prompts", storage), "#server/prompts");
  assert.equal(loadOptionNavigation("", storage).hash, "#server/prompts");

  assert.equal(saveOptionNavigation("#invalid", storage), DEFAULT_OPTION_HASH);
  assert.equal(loadOptionNavigation("", storage).hash, DEFAULT_OPTION_HASH);
});
