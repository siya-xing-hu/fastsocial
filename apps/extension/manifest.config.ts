// read version number from package.json
import { version } from "./package.json";
import { defineManifest } from "@crxjs/vite-plugin";

const isDevHostsEnabled = true;

const prodHostPermissions = [
  "http://127.0.0.1:5127/*",
  "https://x.com/*",
  "https://*.x.com/*",
  "https://translate.googleapis.com/*",
  "https://api.deepl.com/*",
  "https://api-free.deepl.com/*",
];

const devHostPermissions = [
  "http://localhost:5127/*",
  "http://localhost:9000/*",
];

// if isDevHostsEnabled === true, then use devHostPermissions and prodHostPermissions, otherwise use prodHostPermissions
const hostPermissions = isDevHostsEnabled
  ? devHostPermissions.concat(prodHostPermissions)
  : prodHostPermissions;

export default defineManifest(async () => {
  return {
    manifest_version: 3,
    name: "Fast Social",
    description: "A Twitter Copilot Chrome Extension",
    version: version,
    icons: {
      "16": "src/assets/icons/icon-16.png",
      "32": "src/assets/icons/icon-32.png",
      "48": "src/assets/icons/icon-48.png",
      "128": "src/assets/icons/icon-128.png",
    },
    host_permissions: hostPermissions,
    permissions: [
      "activeTab",
      "storage",
      "webRequest",
      "tabs",
      "scripting"
    ],
    action: {
      // default_title: "Click to show Fast Social Config",
      default_popup: "src/pages/popup/popup.html",
    },
    commands: {
      "open-options": {
        suggested_key: {
          default: "Alt+Shift+F",
        },
        description: "打开 Fast Social 设置",
      },
    },
    options_page: "src/pages/option/option.html",
    content_scripts: [
      {
        js: ["src/content-script.ts"],
        "matches": [
          "<all_urls>"
        ],
        run_at: "document_end"
      },
    ],
    background: {
      service_worker: "src/service-worker.ts",
      type: "module",
    },
  };
});
