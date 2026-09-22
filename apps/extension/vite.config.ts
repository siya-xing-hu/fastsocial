import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import manifest from "./manifest.config";
import tsconfigPaths from "vite-tsconfig-paths";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  root: extensionRoot,
  plugins: [tsconfigPaths(), vue(), crx({ manifest })],
  build: {
    outDir: resolve(extensionRoot, "../../dist/extension"),
    emptyOutDir: true,
    // Avoid sharing preloads across extension pages and isolated content scripts.
    modulePreload: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        popup: resolve(extensionRoot, "src/pages/popup/popup.html"),
      },
    },
  },
});
