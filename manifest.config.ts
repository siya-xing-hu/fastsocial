// read version number from package.json
import { version } from "./package.json";
import { defineManifest } from "@crxjs/vite-plugin";

const isDevHostsEnabled = false;

const prodHostPermissions = [
  "https://app.xers.ai/*",
  "https://twitter.com/*",
  "https://x.com/*",
  "https://cewakvggtxhcfjmscovo.supabase.co/*",
];

const devHostPermissions = [
  "http://localhost:3000/*",
  "http://localhost:9000/*",
];

// if isDevHostsEnabled === true, then use devHostPermissions and prodHostPermissions, otherwise use prodHostPermissions
const hostPermissions = isDevHostsEnabled
  ? devHostPermissions.concat(prodHostPermissions)
  : prodHostPermissions;

const devCallbackMatches = [
  "http://localhost:9000/xersai-callback*",
];
const prodAuthCallbackMatches = [
  "https://app.xers.ai/xersai-callback*",
];

const authCallbackMatches = isDevHostsEnabled
  ? devCallbackMatches.concat(prodAuthCallbackMatches)
  : prodAuthCallbackMatches;

const devPaymentCallbackMatches = [
  "http://localhost:9000/xersai-payment-callback*",
];
const prodPaymentCallbackMatches = [
  "https://app.xers.ai/xersai-payment-callback*",
];

const paymentCallbackMatches = isDevHostsEnabled
  ? devPaymentCallbackMatches.concat(prodPaymentCallbackMatches)
  : prodPaymentCallbackMatches;

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
    background: {
      service_worker: "src/service-worker.ts",
      type: "module",
    },
    action: {
      // default_title: "Click to show Fast Social Config",
      default_popup: "src/popup.html",
    },
    host_permissions: hostPermissions,
    permissions: [
      "activeTab",
      "storage",
      "notifications",
      "scripting",
      "alarms",
      "cookies",
      "tabs",
    ],
    content_scripts: [
      {
        js: ["src/content-script.ts"],
        matches: ["https://x.com/*", "https://twitter.com/*"],
        exclude_matches: [
          "https://x.com/i/oauth2/*",
          "https://twitter.com/i/oauth2/*",
        ],
        run_at: "document_end",
      },
      {
        js: ["src/auth-callback.ts"],
        matches: authCallbackMatches,
      },
      {
        js: ["src/payment-callback.ts"],
        matches: paymentCallbackMatches,
      },
    ],
  };
});
