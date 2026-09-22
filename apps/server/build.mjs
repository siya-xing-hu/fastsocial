import { rm, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const serverRoot = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(serverRoot, "../../dist/server");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  absWorkingDir: serverRoot,
  entryPoints: ["src/index.ts"],
  outfile: resolve(outputDirectory, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  tsconfigRaw: {
    compilerOptions: {
      useDefineForClassFields: true,
    },
  },
  minify: false,
  sourcemap: "linked",
  banner: {
    js: 'import { createRequire as __fastSocialCreateRequire } from "node:module"; const require = __fastSocialCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});
