import assert from "node:assert/strict";
import test from "node:test";
import { resolveAccountPolicy, xAccountIdentity } from "./account-policy.ts";
import { renderPrompt } from "@fast-social/contracts";
test("online account mapping overrides local toggle and offline fallback never retains account prompts", () => {
  const online = {
    accountId: "cn",
    autoTranslate: false,
    prompts: [
      {
        id: "1",
        name: "中文",
        scene: "reply" as const,
        prompt: "{input}",
        enabled: true,
      },
    ],
  };
  assert.equal(resolveAccountPolicy(true, online).autoTranslate, false);
  assert.deepEqual(resolveAccountPolicy(true, null), {
    accountId: null,
    autoTranslate: true,
    prompts: [],
  });
  assert.equal(resolveAccountPolicy(false, null).autoTranslate, false);
  assert.equal(
    resolveAccountPolicy(false, {
      accountId: "en",
      autoTranslate: true,
      prompts: [],
    }).autoTranslate,
    true
  );
});
test("signed-in account identity uses twid or its own profile link rather than the page being viewed", () => {
  assert.deepEqual(
    xAccountIdentity("twid=u%3D123; ct0=a", "Name @Global", "/global"),
    { actorId: "123", username: "global" }
  );
  assert.deepEqual(xAccountIdentity("", "", "/my_account"), {
    actorId: "",
    username: "my_account",
  });
  assert.deepEqual(xAccountIdentity("twid=invalid", "", ""), {
    actorId: "",
    username: "",
  });
});
test("API failures do not enable global automatic translation on unrelated accounts", () => {
  assert.deepEqual(resolveAccountPolicy(true, null, false), {
    accountId: null, autoTranslate: false, prompts: [],
  });
  assert.equal(resolveAccountPolicy(true, null, true).autoTranslate, true);
});
test("account display names containing mentions cannot override the signed-in profile", () => {
  assert.deepEqual(xAccountIdentity("", "News from @someone @my_account", "/my_account"), {
    actorId: "", username: "my_account",
  });
  assert.equal(xAccountIdentity("", "News from @someone @my_account", "").username, "my_account");
});
test("prompt replacement handles repeated tokens without interpreting inserted text", () => {
  assert.equal(
    renderPrompt("{input}/{input}/{reply}/{{_tl_}}", {
      input: "$& {reply}",
      reply: "source",
      targetLanguage: "en",
    }),
    "$& {reply}/$& {reply}/source/en"
  );
});
