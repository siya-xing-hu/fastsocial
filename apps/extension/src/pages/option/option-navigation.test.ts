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
    serverSection: "accounts",
  });

  for (const section of ["accounts", "following", "connections", "ai", "workflows", "skills"] as const) {
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
      serverSection: "accounts",
    });
  }
});

test("loads the stored route only when the URL has no hash", () => {
  const storage = memoryStorage("#server/workflows");

  assert.equal(loadOptionNavigation("", storage).hash, "#server/workflows");
  assert.equal(loadOptionNavigation("#server/ai", storage).hash, "#server/ai");
  assert.equal(loadOptionNavigation("#broken", storage).hash, DEFAULT_OPTION_HASH);
});

test("saving normalizes invalid routes before persisting", () => {
  const storage = memoryStorage();

  assert.equal(saveOptionNavigation("#server/prompts", storage), "#server/skills");
  assert.equal(loadOptionNavigation("", storage).hash, "#server/skills");

  assert.equal(saveOptionNavigation("#invalid", storage), DEFAULT_OPTION_HASH);
  assert.equal(loadOptionNavigation("", storage).hash, DEFAULT_OPTION_HASH);
});

test("old monitoring navigation opens unified workflows",()=>{
  assert.equal(parseOptionNavigation('#server/monitors').hash,'#server/workflows');
  assert.equal(parseOptionNavigation('#server/outreach').hash,'#server/workflows');
});
