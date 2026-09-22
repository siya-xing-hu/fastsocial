import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.ts";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const dataDirectory = resolve(currentDirectory, "../data");
await mkdir(dataDirectory, { recursive: true });

const app = createApp({
  databasePath: resolve(dataDirectory, "fastsocial.db"),
  startScheduler: true,
});

try {
  const address = await app.listen({ host: "127.0.0.1", port: 3000 });
  console.log(`Fast Social local service listening at ${address}`);
} catch (error) {
  console.error("Fast Social local service failed to start", error);
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
