/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_TIMEZONE?: string;
  readonly VITE_SHOW_DEMO_HINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
