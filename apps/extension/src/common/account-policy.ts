import type { AccountConfiguration } from "@fast-social/contracts";

export function resolveAccountPolicy(
  localAutoTranslate: boolean,
  remote: AccountConfiguration | null,
  serviceUnavailable = true,
): AccountConfiguration {
  return (
    remote ?? {
      accountId: null,
      autoTranslate: serviceUnavailable && localAutoTranslate,
      prompts: [],
    }
  );
}
export function xAccountIdentity(
  cookie: string,
  switcherText: string,
  profileHref: string
): { actorId: string; username: string } {
  let actorId = "";
  try {
    const value =
      cookie
        .split(";")
        .map((p) => p.trim())
        .find((p) => p.startsWith("twid="))
        ?.slice(5) ?? "";
    actorId = /^"?u=(\d+)"?$/.exec(decodeURIComponent(value))?.[1] ?? "";
  } catch {
    /* Fall back to the signed-in profile link. */
  }
  const handle = [...switcherText.matchAll(/@([A-Za-z0-9_]{1,15})\b/g)].pop()?.[1];
  const path = profileHref.replace(/^https?:\/\/[^/]+/, "");
  return {
    actorId,
    username: (
      /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(path)?.[1] ??
      handle ??
      ""
    ).toLowerCase(),
  };
}
