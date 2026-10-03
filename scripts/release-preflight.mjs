import net from "node:net";
import {pathToFileURL} from "node:url";

const RESERVED_EXACT_HOSTS = new Set([
  "localhost",
  "example.com",
  "example.net",
  "example.org"
]);

const RESERVED_SUFFIXES = [
  ".localhost",
  ".invalid",
  ".test",
  ".example",
  ".example.com",
  ".example.net",
  ".example.org"
];

export function validateProductionOrigin(rawOrigin) {
  if (typeof rawOrigin !== "string" || rawOrigin.trim() === "") {
    throw new Error("Production API origin is required.");
  }

  let url;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error("Production API origin must be an absolute URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Production API origin must use HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("Production API origin must not contain credentials.");
  }

  if (url.port) {
    throw new Error("Production API origin must use the default HTTPS port.");
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Production API origin must not contain a path, query, or fragment.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || net.isIP(hostname)) {
    throw new Error("Production API origin must use a public DNS hostname, not an IP address.");
  }

  if (!hostname.includes(".")) {
    throw new Error("Production API origin must use a fully-qualified DNS hostname.");
  }

  if (
    RESERVED_EXACT_HOSTS.has(hostname) ||
    RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("Production API origin must not use a reserved example/test hostname.");
  }

  if (/(^|[.-])(replace(?:-with)?|placeholder|your-domain|yourdomain)([.-]|$)/i.test(hostname)) {
    throw new Error("Production API origin still contains a placeholder hostname.");
  }

  return url.origin;
}

export async function probeProductionOrigin(
  rawOrigin,
  {fetchImpl = globalThis.fetch, timeoutMs = 5000} = {}
) {
  const origin = validateProductionOrigin(rawOrigin);
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available for the release probe.");
  }

  const checks = [
    {path: "/ready", expectedStatus: "ready"},
    {path: "/health", expectedStatus: "ok"}
  ];

  for (const check of checks) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(new URL(check.path, origin), {
        method: "GET",
        headers: {accept: "application/json"},
        redirect: "error",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(
          `Production API ${check.path} probe returned HTTP ${response.status}.`
        );
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`Production API ${check.path} probe did not return JSON.`);
      }

      if (!payload || payload.status !== check.expectedStatus) {
        throw new Error(
          `Production API ${check.path} probe returned an unexpected status payload.`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Production API ${check.path} probe timed out after ${timeoutMs} ms.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return origin;
}

function parseArgs(argv) {
  let origin;
  let probe = false;
  let timeoutMs = 5000;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--origin") {
      origin = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--probe") {
      probe = true;
      continue;
    }

    if (argument === "--timeout-ms") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(value) || value < 100 || value > 30000) {
        throw new Error("--timeout-ms must be an integer between 100 and 30000.");
      }
      timeoutMs = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown release-preflight argument: ${argument}`);
  }

  return {origin, probe, timeoutMs};
}

export async function main(argv = process.argv.slice(2)) {
  const {origin, probe, timeoutMs} = parseArgs(argv);
  const validatedOrigin = probe
    ? await probeProductionOrigin(origin, {timeoutMs})
    : validateProductionOrigin(origin);

  process.stdout.write(
    `PriceLens production release preflight passed for ${validatedOrigin}${probe ? " (endpoint verified)" : ""}.\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `PriceLens production release preflight failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
