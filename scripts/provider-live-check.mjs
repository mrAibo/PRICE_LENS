import {writeFile} from "node:fs/promises";
import net from "node:net";
import {pathToFileURL} from "node:url";

const REQUIREMENTS = new Set([
  "ebay_enrichment",
  "ebay_market",
  "amazon",
  "fx"
]);

export function validateLiveCheckOrigin(rawOrigin) {
  if (typeof rawOrigin !== "string" || rawOrigin.trim() === "") {
    throw new Error("API origin is required.");
  }

  let url;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error("API origin must be an absolute URL.");
  }

  if (url.username || url.password) {
    throw new Error("API origin must not contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("API origin must not contain a path, query, or fragment.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1";

  if (local) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Local API origin must use HTTP or HTTPS.");
    }
  } else if (url.protocol !== "https:") {
    throw new Error("Remote API origin must use HTTPS.");
  }

  if (!local && net.isIP(host)) {
    throw new Error("Remote API origin must use a DNS hostname, not an IP address.");
  }

  return url.origin;
}

export function validateLiveEbayItemId(value) {
  if (typeof value !== "string" || !/^\d{9,15}$/.test(value.trim())) {
    throw new Error("eBay item ID must contain 9 to 15 digits.");
  }
  return value.trim();
}

export function buildLiveComparisonRequest(
  itemId,
  {country = "DE", postalCode} = {}
) {
  const normalizedItemId = validateLiveEbayItemId(itemId);
  const normalizedCountry = String(country).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalizedCountry)) {
    throw new Error("Destination country must be a two-letter ISO code.");
  }

  const destination = {country: normalizedCountry};
  if (postalCode !== undefined && String(postalCode).trim() !== "") {
    const normalizedPostalCode = String(postalCode).trim();
    if (
      normalizedPostalCode.length > 16 ||
      !/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(normalizedPostalCode)
    ) {
      throw new Error(
        "Destination postal code must contain only letters, numbers, spaces or hyphens and be at most 16 characters."
      );
    }
    destination.postalCode = normalizedPostalCode;
  }

  return {
    listing: {
      source: "ebay",
      itemId: normalizedItemId,
      url: `https://www.ebay.de/itm/${normalizedItemId}`,
      title: "PriceLens live provider validation item",
      price: {amount: 1, currency: "EUR"},
      condition: "unknown",
      identity: {},
      extractionEvidence: ["live-validation:item-id"],
      extractionWarnings: []
    },
    destination
  };
}

export async function runProviderLiveCheck({
  origin,
  itemId,
  country = "DE",
  postalCode,
  required = [],
  sessionToken,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
  now = () => new Date()
}) {
  const apiOrigin = validateLiveCheckOrigin(origin);
  const requestBody = buildLiveComparisonRequest(itemId, {
    country,
    postalCode
  });
  const requirements = normalizeRequirements(required);

  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available.");
  }
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60_000
  ) {
    throw new Error("timeoutMs must be an integer between 100 and 60000.");
  }

  const ready = await requestJson(
    fetchImpl,
    new URL("/ready", apiOrigin),
    {method: "GET", headers: {accept: "application/json"}},
    timeoutMs,
    "/ready"
  );
  if (ready?.status !== "ready") {
    throw new Error("API /ready returned an unexpected status payload.");
  }

  const health = await requestJson(
    fetchImpl,
    new URL("/health", apiOrigin),
    {method: "GET", headers: {accept: "application/json"}},
    timeoutMs,
    "/health"
  );
  if (health?.status !== "ok") {
    throw new Error("API /health returned an unexpected status payload.");
  }

  const headers = {
    accept: "application/json",
    "content-type": "application/json"
  };
  if (sessionToken) {
    headers.authorization = `Bearer ${sessionToken}`;
  }

  const comparison = await requestJson(
    fetchImpl,
    new URL("/v1/compare", apiOrigin),
    {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    },
    timeoutMs,
    "/v1/compare"
  );

  const report = buildRedactedLiveReport({
    origin: apiOrigin,
    health,
    comparison,
    destinationConfigured: true,
    checkedAt: now().toISOString()
  });
  const requirementResults = evaluateRequirements(report, requirements);
  report.requirements = requirementResults;

  const failed = Object.entries(requirementResults)
    .filter(([, value]) => value !== "pass")
    .map(([name]) => name);
  if (failed.length > 0) {
    const error = new Error(
      `Live provider requirements failed: ${failed.join(", ")}.`
    );
    error.report = report;
    throw error;
  }

  return report;
}

export function buildRedactedLiveReport({
  origin,
  health,
  comparison,
  destinationConfigured,
  checkedAt
}) {
  const identity =
    comparison?.listing?.identity &&
    typeof comparison.listing.identity === "object"
      ? comparison.listing.identity
      : {};
  const evidence = Array.isArray(comparison?.listing?.extractionEvidence)
    ? comparison.listing.extractionEvidence
    : [];
  const warnings = Array.isArray(comparison?.warnings)
    ? comparison.warnings
    : [];
  const statuses = Array.isArray(comparison?.providerStatus)
    ? comparison.providerStatus
    : [];
  const offers = Array.isArray(comparison?.offers)
    ? comparison.offers
    : [];

  const providerStates = {};
  for (const status of statuses) {
    if (
      !status ||
      typeof status !== "object" ||
      typeof status.provider !== "string" ||
      typeof status.state !== "string"
    ) {
      continue;
    }
    providerStates[status.provider] = {
      state: status.state,
      ...(Number.isFinite(status.latencyMs)
        ? {latencyMs: Math.max(0, Math.round(status.latencyMs))}
        : {}),
      reviewCandidateCount: Array.isArray(status.reviewCandidates)
        ? status.reviewCandidates.length
        : 0
    };
  }

  const byProvider = {};
  let completeLandedOffers = 0;
  let fxNormalizedOffers = 0;
  let foreignCurrencyCompleteOffers = 0;
  const listingCurrency =
    typeof comparison?.ebayLandedPrice?.currency === "string"
      ? comparison.ebayLandedPrice.currency.toUpperCase()
      : undefined;

  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    if (typeof offer.provider === "string") {
      byProvider[offer.provider] = (byProvider[offer.provider] ?? 0) + 1;
    }
    if (offer.landedPriceComplete === true) {
      completeLandedOffers += 1;
      const currency =
        typeof offer.landedPrice?.currency === "string"
          ? offer.landedPrice.currency.toUpperCase()
          : undefined;
      if (
        listingCurrency &&
        currency &&
        currency !== listingCurrency
      ) {
        foreignCurrencyCompleteOffers += 1;
      }
    }
    if (offer.fx && offer.comparisonLandedPrice) {
      fxNormalizedOffers += 1;
    }
  }

  const fallbackWarning = warnings.some(
    (warning) =>
      typeof warning === "string" &&
      warning.includes("API enrichment is currently unavailable")
  );

  return {
    schemaVersion: 1,
    checkedAt,
    origin,
    endpoint: {
      ready: true,
      health: true,
      compare: true
    },
    configuration: {
      ebayEnrichment:
        health?.enrichment?.ebay === "configured",
      fx:
        health?.enrichment?.fx === "configured",
      providers: {
        ebay_market:
          health?.providers?.ebay_market === "configured",
        amazon:
          health?.providers?.amazon === "configured",
        idealo:
          health?.providers?.idealo === "configured",
        geizhals:
          health?.providers?.geizhals === "configured"
      }
    },
    comparison: {
      requestIdPresent:
        typeof comparison?.requestId === "string" &&
        comparison.requestId.length > 0,
      destinationConfigured: destinationConfigured === true,
      identityPresence: {
        brand: hasText(identity.brand),
        model: hasText(identity.model),
        mpn: hasText(identity.mpn),
        gtin: hasText(identity.gtin),
        ean: hasText(identity.ean),
        upc: hasText(identity.upc),
        epid: hasText(identity.epid)
      },
      ebayBrowseEvidence: evidence.some(
        (entry) =>
          typeof entry === "string" &&
          entry.startsWith("ebay-browse:")
      ),
      enrichmentFallback: fallbackWarning,
      warningCount: warnings.length,
      acceptedOfferCount: offers.length,
      completeLandedOfferCount: completeLandedOffers,
      foreignCurrencyCompleteOfferCount: foreignCurrencyCompleteOffers,
      fxNormalizedOfferCount: fxNormalizedOffers,
      offersByProvider: byProvider,
      providerStates,
      landedCostStatus:
        typeof comparison?.ebayLandedCostStatus === "string"
          ? comparison.ebayLandedCostStatus
          : "unknown"
    }
  };
}

export function evaluateRequirements(report, requirements) {
  const results = {};

  for (const requirement of requirements) {
    if (requirement === "ebay_enrichment") {
      results[requirement] =
        report.configuration.ebayEnrichment &&
        report.comparison.ebayBrowseEvidence &&
        !report.comparison.enrichmentFallback
          ? "pass"
          : "fail";
      continue;
    }

    if (requirement === "ebay_market" || requirement === "amazon") {
      const configured =
        report.configuration.providers[requirement] === true;
      const state =
        report.comparison.providerStates[requirement]?.state;
      results[requirement] =
        configured && (state === "ok" || state === "no_match")
          ? "pass"
          : "fail";
      continue;
    }

    if (requirement === "fx") {
      const crossCurrency =
        report.comparison.foreignCurrencyCompleteOfferCount;
      const normalized =
        report.comparison.fxNormalizedOfferCount;
      results[requirement] =
        report.configuration.fx &&
        (crossCurrency === 0 || normalized >= crossCurrency)
          ? "pass"
          : "fail";
    }
  }

  return results;
}

function normalizeRequirements(values) {
  const normalized = [];
  for (const raw of values) {
    const value = String(raw).trim();
    if (!value) continue;
    if (!REQUIREMENTS.has(value)) {
      throw new Error(
        `Unknown live-check requirement: ${value}. Allowed: ${[...REQUIREMENTS].join(", ")}.`
      );
    }
    if (!normalized.includes(value)) normalized.push(value);
  }
  return normalized;
}

async function requestJson(
  fetchImpl,
  url,
  init,
  timeoutMs,
  label
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(
        `API ${label} returned HTTP ${response.status}.`
      );
    }

    try {
      return await response.json();
    } catch {
      throw new Error(`API ${label} did not return JSON.`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `API ${label} timed out after ${timeoutMs} ms.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseArgs(argv) {
  const options = {
    country: "DE",
    required: [],
    timeoutMs: 10_000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--origin") {
      options.origin = argv[++index];
      continue;
    }
    if (argument === "--ebay-item-id") {
      options.itemId = argv[++index];
      continue;
    }
    if (argument === "--country") {
      options.country = argv[++index];
      continue;
    }
    if (argument === "--postal-code") {
      options.postalCode = argv[++index];
      continue;
    }
    if (argument === "--require") {
      options.required.push(
        ...(argv[++index] ?? "").split(",")
      );
      continue;
    }
    if (argument === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(argv[++index] ?? "", 10);
      continue;
    }
    if (argument === "--output") {
      options.output = argv[++index];
      continue;
    }

    throw new Error(`Unknown provider-live-check argument: ${argument}`);
  }

  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await runProviderLiveCheck({
    ...options,
    sessionToken:
      process.env.PRICE_LENS_LIVE_SESSION_TOKEN?.trim() || undefined
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  if (options.output) {
    await writeFile(options.output, serialized, {
      encoding: "utf8",
      mode: 0o600
    });
  }

  process.stdout.write(serialized);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    if (error?.report) {
      process.stderr.write(
        `${JSON.stringify(error.report, null, 2)}\n`
      );
    }
    process.stderr.write(
      `PriceLens provider live check failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
