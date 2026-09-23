export const OPTION_NAVIGATION_STORAGE_KEY = "fast-social.option-navigation";
export const DEFAULT_OPTION_HASH = "#basic" as const;

export const SERVER_SECTIONS = [
  "overview",
  "connections",
  "ai",
  "monitors",
  "prompts",
] as const;

export type ServerSection = typeof SERVER_SECTIONS[number];
export type OptionNavigationHash = "#basic" | `#server/${ServerSection}`;

export interface OptionNavigation {
  hash: OptionNavigationHash;
  area: "basic" | "server";
  serverSection: ServerSection;
}

type OptionNavigationStorage = Pick<Storage, "getItem" | "setItem">;
type HashLocation = Pick<Location, "hash">;

const serverSectionSet = new Set<string>(SERVER_SECTIONS);

function defaultStorage(): OptionNavigationStorage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

export function normalizeOptionNavigationHash(hash: string): OptionNavigationHash {
  if (hash === DEFAULT_OPTION_HASH) {
    return hash;
  }

  if (hash.startsWith("#server/")) {
    const section = hash.slice("#server/".length);
    if (serverSectionSet.has(section)) {
      return hash as OptionNavigationHash;
    }
  }

  return DEFAULT_OPTION_HASH;
}

export function parseOptionNavigation(hash: string): OptionNavigation {
  const normalizedHash = normalizeOptionNavigationHash(hash);
  if (normalizedHash === DEFAULT_OPTION_HASH) {
    return {
      hash: normalizedHash,
      area: "basic",
      serverSection: "overview",
    };
  }

  return {
    hash: normalizedHash,
    area: "server",
    serverSection: normalizedHash.slice("#server/".length) as ServerSection,
  };
}

/**
 * Resolve the initial navigation state. A valid URL hash always wins; when the
 * URL has no hash, the last saved route is restored. A malformed URL hash is
 * intentionally sent to the safe default instead of silently opening a stale
 * stored route.
 */
export function loadOptionNavigation(
  hash: string,
  storage: OptionNavigationStorage | undefined = defaultStorage(),
): OptionNavigation {
  if (hash.length > 0) {
    return parseOptionNavigation(hash);
  }

  try {
    return parseOptionNavigation(storage?.getItem(OPTION_NAVIGATION_STORAGE_KEY) ?? DEFAULT_OPTION_HASH);
  } catch {
    return parseOptionNavigation(DEFAULT_OPTION_HASH);
  }
}

export function saveOptionNavigation(
  hash: string,
  storage: OptionNavigationStorage | undefined = defaultStorage(),
): OptionNavigationHash {
  const normalizedHash = normalizeOptionNavigationHash(hash);
  try {
    storage?.setItem(OPTION_NAVIGATION_STORAGE_KEY, normalizedHash);
  } catch {
    // Navigation should still work when browser storage is unavailable.
  }
  return normalizedHash;
}

/** Persist and apply a route from an Option page navigation control. */
export function navigateOption(
  hash: string,
  location: HashLocation = window.location,
  storage: OptionNavigationStorage | undefined = defaultStorage(),
): OptionNavigation {
  const normalizedHash = saveOptionNavigation(hash, storage);
  location.hash = normalizedHash;
  return parseOptionNavigation(normalizedHash);
}
