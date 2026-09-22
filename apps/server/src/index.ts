import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.ts";
import { resolveHost, resolvePort } from "./runtime-config.ts";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

async function findWorkspaceRoot(startDirectory: string): Promise<string | null> {
  let directory = resolve(startDirectory);

  while (true) {
    try {
      await access(resolve(directory, "pnpm-workspace.yaml"));
      return directory;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  }
}

async function resolveDataDirectory(): Promise<string> {
  const configuredDirectory = process.env.FAST_SOCIAL_DATA_DIR?.trim();
  if (configuredDirectory) return resolve(configuredDirectory);

  const workspaceRoot = await findWorkspaceRoot(currentDirectory);
  return resolve(workspaceRoot ?? process.cwd(), ".data");
}

async function start(): Promise<void> {
  const dataDirectory = await resolveDataDirectory();
  await mkdir(dataDirectory, { recursive: true });

  const app = createApp({
    databasePath: resolve(dataDirectory, "fastsocial.db"),
    startScheduler: true,
  });

  const address = await app.listen({ host: resolveHost(), port: resolvePort() });
  console.log(`Fast Social local service listening at ${address}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}

await start().catch((error) => {
  console.error("Fast Social local service failed to start", error);
  process.exitCode = 1;
});
