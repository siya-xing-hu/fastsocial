import { parseBasicSettingsJson } from "./config-transfer.ts";
import type { BasicSettingsSnapshot } from "./config-transfer.ts";

interface ConfigPersistenceOptions {
  read: () => BasicSettingsSnapshot;
  write: (values: Record<string, string>) => Promise<void>;
  apply: (settings: BasicSettingsSnapshot) => void;
  notify: () => Promise<void>;
}

export function createConfigPersistence(options: ConfigPersistenceOptions) {
  let pending: Promise<unknown> = Promise.resolve();

  function enqueue(operation: () => Promise<boolean>): Promise<boolean> {
    const next = pending.catch(() => {}).then(operation);
    pending = next;
    return next;
  }

  async function notify(): Promise<boolean> {
    try {
      await options.notify();
      return true;
    } catch {
      // A notification failure must not turn a successful storage write into a failed import.
      return false;
    }
  }

  return {
    saveConfig: () => enqueue(async () => {
      await options.write({ "fast-social-config": JSON.stringify(options.read().config) });
      return notify();
    }),
    saveApiKeys: () => enqueue(async () => {
      await options.write({ "fast-social-api-keys": JSON.stringify(options.read().apiKeys) });
      return notify();
    }),
    importJson: async (text: string): Promise<boolean> => {
      const settings = parseBasicSettingsJson(text);
      return enqueue(async () => {
        // Store configuration and keys together before updating the form or notifying tabs.
        await options.write({
          "fast-social-config": JSON.stringify(settings.config),
          "fast-social-api-keys": JSON.stringify(settings.apiKeys),
        });
        options.apply(settings);
        return notify();
      });
    },
  };
}
