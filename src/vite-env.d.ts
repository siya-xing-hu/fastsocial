/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_AUTHORIZE_URL: string;
  readonly VITE_OAUTH_CALLBACK_URL: string;
  readonly VITE_DEBUG_ENABLED: string;
  readonly VITE_DEBUG_LOG: string;
  readonly VITE_STRIPE_PRICE_ID: string;
  readonly VITE_STRIPE_BILLING_PORTAL_CONFIG_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
