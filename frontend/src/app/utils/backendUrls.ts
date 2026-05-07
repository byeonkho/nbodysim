// Single source of truth for backend URL.
// NEXT_PUBLIC_BACKEND_URL is the backend's origin (e.g. "http://localhost:8080"
// or "https://spacesim-api.fly.dev"). Trailing slashes are stripped.

const DEFAULT_ORIGIN = "http://localhost:8080";

const origin = (process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_ORIGIN).replace(
  /\/$/,
  "",
);

export const REST_URL = `${origin}/api/simulation`;
