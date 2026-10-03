import type {
  EcommerceListing,
  ListingCondition,
  Money,
  ProductIdentity
} from "@price-lens/contracts";
import type {PriceProvider, ProviderCandidate} from "@price-lens/core";
import {
  safeObserveProviderCache,
  type ProviderCacheObserver
} from "./provider-cache.js";

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

export type EbayApiEnvironment = "sandbox" | "production";

export interface EbayBrowseEnricherOptions {
  clientId: string;
  clientSecret: string;
  environment?: EbayApiEnvironment;
  marketplaceId?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  cacheObserver?: ProviderCacheObserver;
}

interface CachedItem {
  expiresAt: number;
  value: JsonRecord | null;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class EbayBrowseEnricher {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly environment: EbayApiEnvironment;
  private readonly marketplaceId: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly cacheObserver?: ProviderCacheObserver;
  private readonly itemCache = new Map<string, CachedItem>();
  private readonly itemInFlight = new Map<string, Promise<JsonRecord | null>>();
  private tokenCache?: CachedToken;
  private tokenInFlight?: Promise<string>;

  constructor(options: EbayBrowseEnricherOptions) {
    this.clientId = requireNonEmpty(options.clientId, "eBay client id");
    this.clientSecret = requireNonEmpty(options.clientSecret, "eBay client secret");
    this.environment = options.environment ?? "sandbox";
    this.marketplaceId = options.marketplaceId ?? "EBAY_DE";
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.cacheTtlMs = validateCacheTtl(options.cacheTtlMs ?? 0, "eBay Browse");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheObserver = options.cacheObserver;
  }

  async enrich(listing: EcommerceListing): Promise<EcommerceListing> {
    const item = await this.getItemByLegacyId(listing.itemId);
    if (!item) return listing;

    const browseIdentity = extractBrowseIdentity(item);
    const {identity, addedFields, warnings} = mergeIdentity(
      listing.identity,
      browseIdentity
    );

    if (addedFields.length === 0 && warnings.length === 0) {
      return listing;
    }

    return {
      ...listing,
      identity,
      extractionEvidence:
        addedFields.length > 0
          ? [...listing.extractionEvidence, `ebay-browse:${addedFields.join(",")}`]
          : listing.extractionEvidence,
      extractionWarnings: [...listing.extractionWarnings, ...warnings]
    };
  }

  async searchMarketplace(
    listing: EcommerceListing,
    signal?: AbortSignal
  ): Promise<ProviderCandidate[]> {
    const gtin = strongestTradeIdentifier(listing.identity);
    if (!gtin) return [];

    let response = await this.fetchMarketplaceSearch(gtin, false, signal);
    if (response.status === 401) {
      this.tokenCache = undefined;
      response = await this.fetchMarketplaceSearch(gtin, true, signal);
    }

    if (response.status === 429) {
      throw new Error("eBay Browse marketplace search rate limit reached.");
    }

    if (!response.ok) {
      throw new Error(
        `eBay Browse marketplace search failed with HTTP ${response.status}.`
      );
    }

    const payload = await readJsonRecord(
      response,
      "eBay Browse marketplace search"
    );
    return extractMarketplaceCandidates(
      payload,
      listing,
      gtin,
      this.now(),
      this.marketplaceId
    );
  }

  private async getItemByLegacyId(
    legacyItemId: string
  ): Promise<JsonRecord | null> {
    const cached = this.itemCache.get(legacyItemId);
    if (cached && cached.expiresAt > this.now()) {
      safeObserveProviderCache(this.cacheObserver, {
        source: "ebay",
        outcome: "hit"
      });
      return cached.value;
    }
    if (cached) {
      this.itemCache.delete(legacyItemId);
    }

    const active = this.itemInFlight.get(legacyItemId);
    if (active) {
      safeObserveProviderCache(this.cacheObserver, {
        source: "ebay",
        outcome: "coalesced"
      });
      return active;
    }

    safeObserveProviderCache(this.cacheObserver, {
      source: "ebay",
      outcome: "miss"
    });
    const pending = this.fetchAndCacheItem(legacyItemId).finally(() => {
      if (this.itemInFlight.get(legacyItemId) === pending) {
        this.itemInFlight.delete(legacyItemId);
      }
    });
    this.itemInFlight.set(legacyItemId, pending);
    return pending;
  }

  private async fetchAndCacheItem(
    legacyItemId: string
  ): Promise<JsonRecord | null> {
    let response = await this.fetchBrowseItem(legacyItemId, false);
    if (response.status === 401) {
      this.tokenCache = undefined;
      response = await this.fetchBrowseItem(legacyItemId, true);
    }

    if (response.status === 404) {
      if (this.cacheTtlMs > 0) {
        this.itemCache.set(legacyItemId, {
          expiresAt: this.now() + Math.min(this.cacheTtlMs, 60_000),
          value: null
        });
      }
      return null;
    }

    if (response.status === 429) {
      throw new Error("eBay Browse API rate limit reached.");
    }

    if (!response.ok) {
      throw new Error(`eBay Browse API request failed with HTTP ${response.status}.`);
    }

    const payload = await readJsonRecord(response, "eBay Browse API");
    if (this.cacheTtlMs > 0) {
      this.itemCache.set(legacyItemId, {
        expiresAt: this.now() + this.cacheTtlMs,
        value: payload
      });
    }
    return payload;
  }

  private async fetchBrowseItem(
    legacyItemId: string,
    forceTokenRefresh: boolean
  ): Promise<Response> {
    const token = await this.getApplicationToken(forceTokenRefresh);
    const endpoint = new URL(
      "/buy/browse/v1/item/get_item_by_legacy_id",
      this.apiBaseUrl()
    );
    endpoint.searchParams.set("legacy_item_id", legacyItemId);
    endpoint.searchParams.set("fieldgroups", "PRODUCT");

    return this.fetchWithTimeout(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "x-ebay-c-marketplace-id": this.marketplaceId,
        accept: "application/json"
      }
    });
  }

  private async fetchMarketplaceSearch(
    gtin: string,
    forceTokenRefresh: boolean,
    signal?: AbortSignal
  ): Promise<Response> {
    const token = await this.getApplicationToken(forceTokenRefresh);
    const endpoint = new URL(
      "/buy/browse/v1/item_summary/search",
      this.apiBaseUrl()
    );
    endpoint.searchParams.set("gtin", gtin);
    endpoint.searchParams.set("limit", "25");
    endpoint.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");

    return this.fetchWithTimeout(
      endpoint,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-ebay-c-marketplace-id": this.marketplaceId,
          accept: "application/json"
        }
      },
      signal
    );
  }

  private async getApplicationToken(forceRefresh: boolean): Promise<string> {
    if (
      !forceRefresh &&
      this.tokenCache &&
      this.tokenCache.expiresAt > this.now()
    ) {
      return this.tokenCache.token;
    }

    if (this.tokenInFlight) return this.tokenInFlight;

    const pending = this.mintApplicationToken().finally(() => {
      if (this.tokenInFlight === pending) {
        this.tokenInFlight = undefined;
      }
    });
    this.tokenInFlight = pending;
    return pending;
  }

  private async mintApplicationToken(): Promise<string> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
      "utf8"
    ).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope"
    });

    const response = await this.fetchWithTimeout(
      new URL("/identity/v1/oauth2/token", this.apiBaseUrl()),
      {
        method: "POST",
        headers: {
          authorization: `Basic ${credentials}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json"
        },
        body: body.toString()
      }
    );

    if (!response.ok) {
      throw new Error(`eBay OAuth token request failed with HTTP ${response.status}.`);
    }

    const payload = await readJsonRecord(response, "eBay OAuth");
    const token = readString(payload.access_token);
    const expiresIn = readPositiveNumber(payload.expires_in);

    if (!token || !expiresIn) {
      throw new Error("eBay OAuth token response was incomplete.");
    }

    const safetyWindowMs = Math.min(60_000, Math.floor(expiresIn * 100));
    this.tokenCache = {
      token,
      expiresAt: this.now() + expiresIn * 1000 - safetyWindowMs
    };
    return token;
  }

  private apiBaseUrl(): string {
    return this.environment === "production"
      ? "https://api.ebay.com"
      : "https://api.sandbox.ebay.com";
  }

  private async fetchWithTimeout(
    input: URL,
    init: RequestInit,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", onExternalAbort, {once: true});
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      return await this.fetchImpl(input, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (timedOut) {
        throw new Error(`eBay request timed out after ${this.timeoutMs} ms.`);
      }
      if (externalSignal?.aborted) {
        throw new Error("eBay marketplace search was aborted.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

export function createEbayMarketplaceProvider(
  enricher: EbayBrowseEnricher
): PriceProvider {
  return {
    id: "ebay_market",
    matchAcrossConditions: true,
    search: ({listing, signal}) => enricher.searchMarketplace(listing, signal)
  };
}

export function createEbayBrowseEnricherFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  runtimeOptions: Pick<EbayBrowseEnricherOptions, "cacheObserver"> = {}
): EbayBrowseEnricher | undefined {
  if (env.EBAY_BROWSE_ENABLED !== "1") return undefined;

  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "EBAY_BROWSE_ENABLED=1 requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET."
    );
  }

  const rawEnvironment = env.EBAY_ENVIRONMENT?.trim().toLowerCase();
  if (
    rawEnvironment &&
    rawEnvironment !== "sandbox" &&
    rawEnvironment !== "production"
  ) {
    throw new Error("EBAY_ENVIRONMENT must be 'sandbox' or 'production'.");
  }

  return new EbayBrowseEnricher({
    clientId,
    clientSecret,
    environment: (rawEnvironment as EbayApiEnvironment | undefined) ?? "sandbox",
    marketplaceId: env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_DE",
    cacheTtlMs: parseCacheTtlEnv(
      env.EBAY_BROWSE_CACHE_TTL_MS,
      "EBAY_BROWSE_CACHE_TTL_MS"
    ),
    cacheObserver: runtimeOptions.cacheObserver
  });
}

function extractMarketplaceCandidates(
  payload: JsonRecord,
  listing: EcommerceListing,
  gtin: string,
  fetchedAtMs: number,
  marketplaceId: string
): ProviderCandidate[] {
  const summaries = Array.isArray(payload.itemSummaries)
    ? payload.itemSummaries
    : [];
  const candidates: ProviderCandidate[] = [];

  for (const value of summaries) {
    const item = readRecord(value);
    if (!item) continue;

    const itemId = readString(item.itemId);
    const title = readString(item.title);
    const url = readString(item.itemWebUrl);
    const price = readMoney(item.price);
    if (!itemId || !title || !url || !price) continue;

    const legacyItemId = legacyItemIdFromRestId(itemId);
    if (legacyItemId && legacyItemId === listing.itemId) continue;
    if (!isAllowedEbayGermanyUrl(url)) continue;

    const buyingOptions = Array.isArray(item.buyingOptions)
      ? item.buyingOptions.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (
      buyingOptions.length > 0 &&
      !buyingOptions.includes("FIXED_PRICE")
    ) {
      continue;
    }

    const seller = readRecord(item.seller);
    const shipping = lowestShippingCost(item.shippingOptions, price.currency);
    const condition = normalizeEbayCondition(
      readString(item.conditionId),
      readString(item.condition)
    );

    candidates.push({
      provider: "ebay_market",
      providerProductId: itemId,
      productTitle: title,
      merchant: readString(seller?.username),
      marketplace: marketplaceId,
      itemLocationCountry: readString(readRecord(item.itemLocation)?.country),
      sellerFeedbackPercentage: readFiniteNumber(seller?.feedbackPercentage),
      sellerFeedbackScore: readFiniteNumber(seller?.feedbackScore),
      url,
      condition,
      identity: {gtin},
      itemPrice: price,
      shipping,
      fetchedAt: new Date(fetchedAtMs).toISOString()
    });
  }

  return candidates;
}

function strongestTradeIdentifier(identity: ProductIdentity): string | undefined {
  return (
    cleanTradeIdentifier(identity.gtin) ??
    cleanTradeIdentifier(identity.ean) ??
    cleanTradeIdentifier(identity.upc)
  );
}

function legacyItemIdFromRestId(itemId: string): string | undefined {
  const match = /^v1\|(\d+)\|/.exec(itemId);
  return match?.[1];
}

function isAllowedEbayGermanyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "ebay.de" || host.endsWith(".ebay.de"))
    );
  } catch {
    return false;
  }
}

function normalizeEbayCondition(
  conditionId: string | undefined,
  label: string | undefined
): ListingCondition {
  const numericId = conditionId ? Number.parseInt(conditionId, 10) : Number.NaN;
  if (numericId === 1000) return "new";
  if (numericId === 1500 || numericId === 1750) return "open_box";
  if (numericId >= 2000 && numericId < 3000) return "refurbished";
  if (numericId >= 3000) return "used";

  const normalized = normalizeWords(label ?? "");
  if (!normalized) return "unknown";
  if (/refurb|generaluberholt|erneuert/.test(normalized)) return "refurbished";
  if (/open box|geoffnet|wie neu|neuwertig/.test(normalized)) return "open_box";
  if (/gebraucht|used|akzeptabel|acceptable|good|sehr gut|very good/.test(normalized)) {
    return "used";
  }
  if (/^neu$|^new$|neu mit|new with/.test(normalized)) return "new";
  return "unknown";
}

function readMoney(value: unknown): Money | undefined {
  const record = readRecord(value);
  const currency = readString(record?.currency);
  const amount = readFiniteNumber(record?.value);
  if (!currency || amount === undefined || amount < 0) return undefined;
  return {amount, currency: currency.toUpperCase()};
}

function lowestShippingCost(
  value: unknown,
  currency: string
): Money | undefined {
  if (!Array.isArray(value)) return undefined;
  const costs = value
    .map((entry) => readMoney(readRecord(entry)?.shippingCost))
    .filter(
      (cost): cost is Money =>
        cost !== undefined &&
        cost.currency.toUpperCase() === currency.toUpperCase()
    )
    .sort((left, right) => left.amount - right.amount);
  return costs[0];
}

function readFiniteNumber(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function extractBrowseIdentity(item: JsonRecord): ProductIdentity {
  const product = readRecord(item.product);
  const aspects = aspectMap(item.localizedAspects);
  const productAspects = aspectMap(product?.localizedAspects);

  const readAspect = (...names: string[]): string | undefined => {
    for (const name of names) {
      const key = normalizeWords(name);
      const value = aspects.get(key) ?? productAspects.get(key);
      if (value) return value;
    }
    return undefined;
  };

  const identity: ProductIdentity = {};

  const brand =
    readString(item.brand) ??
    readString(product?.brand) ??
    readAspect("Brand", "Marke");
  const model =
    readString(product?.model) ??
    readAspect("Model", "Modell", "Model Number", "Modellnummer");
  const mpn =
    readString(item.mpn) ??
    readString(product?.mpn) ??
    readAspect("MPN", "Manufacturer Part Number", "Herstellernummer");
  const rawGtin =
    readString(item.gtin) ??
    readString(product?.gtin) ??
    readAspect("GTIN");
  const rawEan =
    readString(item.ean) ??
    readString(product?.ean) ??
    readAspect("EAN");
  const rawUpc =
    readString(item.upc) ??
    readString(product?.upc) ??
    readAspect("UPC");

  if (brand) identity.brand = brand;
  if (model) identity.model = model;
  if (isMeaningfulIdentifier(mpn)) identity.mpn = mpn;
  const gtin = cleanTradeIdentifier(rawGtin);
  const ean = cleanTradeIdentifier(rawEan);
  const upc = cleanTradeIdentifier(rawUpc);
  if (gtin) identity.gtin = gtin;
  if (ean) identity.ean = ean;
  if (upc) identity.upc = upc;

  return identity;
}

function mergeIdentity(
  base: ProductIdentity,
  enrichment: ProductIdentity
): {
  identity: ProductIdentity;
  addedFields: string[];
  warnings: string[];
} {
  const identity: ProductIdentity = {
    ...base,
    variant: base.variant ? {...base.variant} : undefined
  };
  const addedFields: string[] = [];
  const warnings: string[] = [];

  mergeTextField("brand");
  mergeTextField("model");
  mergeTextField("mpn");

  const existingTradeIds = canonicalTradeItemIdentifiers(base);
  const enrichedTradeIds = canonicalTradeItemIdentifiers(enrichment);

  if (enrichedTradeIds.size > 0) {
    if (
      existingTradeIds.size > 0 &&
      !setsIntersect(existingTradeIds, enrichedTradeIds)
    ) {
      warnings.push(
        "eBay Browse enrichment returned a conflicting product identifier; page identity was kept."
      );
    } else if (existingTradeIds.size === 0) {
      if (enrichment.gtin) {
        identity.gtin = enrichment.gtin;
        addedFields.push("gtin");
      }
      if (enrichment.ean) {
        identity.ean = enrichment.ean;
        addedFields.push("ean");
      }
      if (enrichment.upc) {
        identity.upc = enrichment.upc;
        addedFields.push("upc");
      }
    }
  }

  return {identity, addedFields, warnings};

  function mergeTextField(field: "brand" | "model" | "mpn"): void {
    const current = base[field];
    const incoming = enrichment[field];
    if (!incoming) return;

    if (!current) {
      if (
        field === "mpn" &&
        !identity.brand &&
        !enrichment.brand
      ) {
        return;
      }
      identity[field] = incoming;
      addedFields.push(field);
      return;
    }

    if (normalizeToken(current) !== normalizeToken(incoming)) {
      warnings.push(
        `eBay Browse enrichment disagreed on ${field}; page value was kept.`
      );
    }
  }
}

function aspectMap(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(value)) return result;

  for (const entry of value) {
    const record = readRecord(entry);
    const name = readString(record?.name);
    const aspectValue = readString(record?.value);
    if (!name || !aspectValue) continue;
    result.set(normalizeWords(name), aspectValue);
  }
  return result;
}

function canonicalTradeItemIdentifiers(identity: ProductIdentity): Set<string> {
  const result = new Set<string>();

  for (const raw of [identity.gtin, identity.ean, identity.upc]) {
    const digits = raw?.replace(/\D/g, "");
    if (!digits) continue;
    result.add(digits);
    if (digits.length === 12) result.add(`0${digits}`);
    if (digits.length === 13 && digits.startsWith("0")) {
      result.add(digits.slice(1));
    }
  }

  return result;
}

function cleanTradeIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : undefined;
}

function isMeaningfulIdentifier(value: string | undefined): value is string {
  if (!value) return false;
  return !/^(?:n\/?a|none|unknown|nicht\s+zutreffend|does\s+not\s+apply)$/i.test(
    value.trim()
  );
}

function normalizeToken(value: string): string {
  return normalizeWords(value).replace(/\s+/g, "");
}

function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setsIntersect(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function readRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

async function readJsonRecord(
  response: Response,
  source: string
): Promise<JsonRecord> {
  const value = await response.json() as unknown;
  const record = readRecord(value);
  if (!record) {
    throw new Error(`${source} returned an invalid JSON object.`);
  }
  return record;
}

function parseCacheTtlEnv(
  raw: string | undefined,
  name: string
): number {
  if (raw === undefined || raw.trim() === "") return 0;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a non-negative integer number of milliseconds.`);
  }

  return validateCacheTtl(Number(raw.trim()), name);
}

function validateCacheTtl(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} cache TTL must be a non-negative safe integer.`);
  }
  return value;
}

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} must not be empty.`);
  return trimmed;
}
