/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MIMIR_INSTANCES: string;
  readonly VITE_MIMIR_TARGET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
