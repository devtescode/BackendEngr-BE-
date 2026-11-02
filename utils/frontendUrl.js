// Public frontend origin used to build links inside emails.
//
// FRONTEND_URL must be the production origin on the server. A stale
// localhost value (or a missing variable) used to make verification/reset
// links unusable, and a missing variable even blocked sending entirely.
// In production we therefore ignore localhost values, prefer the request's
// Origin when present, and finally fall back to the known production app.
const DEFAULT_PRODUCTION_FRONTEND_URL = "https://eu-hardware-store.vercel.app";
const DEFAULT_DEVELOPMENT_FRONTEND_URL = "http://localhost:5173";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isProduction() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.RENDER === "true" ||
    Boolean(process.env.RENDER_SERVICE_ID)
  );
}

function isLocalUrl(value) {
  try {
    return LOCAL_HOSTNAMES.has(new URL(value).hostname);
  } catch {
    return true;
  }
}

const stripTrailingSlashes = (value) => value.replace(/\/+$/, "");

function getFrontendUrl(req) {
  const configured = stripTrailingSlashes((process.env.FRONTEND_URL || "").trim());
  const production = isProduction();

  if (configured && (!production || !isLocalUrl(configured))) {
    return configured;
  }

  if (production) {
    const origin = req?.get?.("origin");

    if (origin && !isLocalUrl(origin)) {
      return stripTrailingSlashes(origin);
    }

    return DEFAULT_PRODUCTION_FRONTEND_URL;
  }

  return configured || DEFAULT_DEVELOPMENT_FRONTEND_URL;
}

module.exports = {
  getFrontendUrl,
  isProduction,
  DEFAULT_PRODUCTION_FRONTEND_URL,
};
