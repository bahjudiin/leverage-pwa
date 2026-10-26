/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional build-time YouTube Data API key.
   * NOT a secret: Vite inlines this into the public client bundle.
   * Protect it with API + HTTP-referrer restrictions, never secrecy.
   */
  readonly VITE_YOUTUBE_API_KEY?: string;
  // Gemini is deliberately NOT read from env: a shared, unrestricted
  // key in client code is unsafe, and securing it needs a backend this
  // app does not have. Users supply their own key in Settings.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
