/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG_ENABLED: string;
  readonly VITE_DEBUG_LOG: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
