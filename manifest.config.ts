// read version number from package.json
import { version } from "./package.json";
import { defineManifest } from "@crxjs/vite-plugin";

const isDevHostsEnabled = true;

const prodHostPermissions = [
  "https://twitter.com/*",
  "https://x.com/*"
];

const devHostPermissions = [
  "http://localhost:3000/*",
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
      "16": "src/assets/main_logo_enable.png",
      "32": "src/assets/main_logo_enable.png",
      "48": "src/assets/main_logo_enable.png",
      "128": "src/assets/main_logo_enable.png",
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
      default_popup: "src/popup.html",
    },
    options_page: "src/option.html",
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
