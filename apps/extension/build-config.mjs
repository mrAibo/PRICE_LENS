export const DEFAULT_PRICE_LENS_API_ORIGIN = "http://127.0.0.1:8787";

export function normalizeApiOrigin(rawValue) {
  const raw = (rawValue ?? DEFAULT_PRICE_LENS_API_ORIGIN).trim();
  if (!raw) {
    throw new Error("PRICE_LENS_API_ORIGIN must not be empty.");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PRICE_LENS_API_ORIGIN must be a valid absolute URL origin.");
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "PRICE_LENS_API_ORIGIN must contain only scheme, host and optional port."
    );
  }

  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "PRICE_LENS_API_ORIGIN must use HTTPS; plain HTTP is allowed only for loopback development."
    );
  }

  return url.origin;
}

export function hostPermissionForOrigin(origin) {
  return `${normalizeApiOrigin(origin)}/*`;
}


export function normalizeGoogleOAuthClientId(rawValue) {
  const raw = rawValue?.trim();
  if (!raw) return undefined;

  if (
    raw.length > 255 ||
    !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(raw)
  ) {
    throw new Error(
      "PRICE_LENS_GOOGLE_OAUTH_CLIENT_ID must be a valid Google OAuth client ID ending in .apps.googleusercontent.com."
    );
  }

  return raw;
}
