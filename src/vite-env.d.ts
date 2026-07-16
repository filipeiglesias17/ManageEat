/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_NETWORK_HOST?: string
  // Supabase local (Docker). Ver src/lib/supabase.ts e `npx supabase status`.
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  // Versão do bundle web injetada no build (ver vite.config.ts e src/lib/ota.ts).
  readonly VITE_BUILD_VERSION?: string
}

interface Window {
  Capacitor?: unknown
}

