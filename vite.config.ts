import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import manifest from "./manifest.config";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tsconfigPaths(), vue(), crx({ manifest })],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        popup: "src/popup.html", // 将 popup.html 添加到构建输入
      },
    },
  },
});
