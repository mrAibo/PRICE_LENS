import type {
  BuyerDestination,
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
import {
  safeObserveProviderFanout,
  type ProviderFanoutObserver
} from "./provider-fanout.js";

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

export type EbayApiEnvironment = "sandbox" | "production";

export const EBAY_EU_MARKETPLACE_IDS = [
  "EBAY_DE",
  "EBAY_PL",
  "EBAY_AT",
  "EBAY_FR",
  "EBAY_IT",
  "EBAY_ES",
  "EBAY_NL",
  "EBAY_BE"
] as const;

export type EbayEuMarketplaceId = typeof EBAY_EU_MARKETPLACE_IDS[number];

const EBAY_MARKETPLACE_HOSTS: Record<EbayEuMarketplaceId, readonly string[]> = {
  EBAY_DE: ["ebay.de"],
  EBAY_PL: ["ebay.pl"],
  EBAY_AT: ["ebay.at"],
  EBAY_FR: ["ebay.fr"],
  EBAY_IT: ["ebay.it"],
  EBAY_ES: ["ebay.es"],
  EBAY_NL: ["ebay.nl"],
  EBAY_BE: ["ebay.be", "ebay.com.be"]
};

const EBAY_CATALOG_MARKETPLACE_IDS = [
  "EBAY_DE",
  "EBAY_ES",
  "EBAY_FR",
  "EBAY_IT"
] as const;

type EbayCatalogMarketplaceId =
  typeof EBAY_CATALOG_MARKETPLACE_IDS[number];

type EbayMarketplaceDiscovery =
  | {kind: "gtin"; value: string}
  | {kind: "epid"; value: string};

export interface EbayBrowseEnricherOptions {
  clientId: string;
  clientSecret: string;
  environment?: EbayApiEnvironment;
  marketplaceId?: string;
  marketplaceSearchIds?: string[];
  deliveryCountry?: string;
  marketplaceSearchConcurrency?: number;
  catalogEpidFallbackEnabled?: boolean;
  catalogMarketplaceId?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  cacheObserver?: ProviderCacheObserver;
  fanoutObserver?: ProviderFanoutObserver;
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
  private readonly marketplaceSearchIds: EbayEuMarketplaceId[];
  private readonly deliveryCountry: string;
  private readonly marketplaceSearchConcurrency: number;
  private readonly catalogEpidFallbackEnabled: boolean;
  private readonly catalogMarketplaceId: EbayCatalogMarketplaceId;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly cacheObserver?: ProviderCacheObserver;
  private readonly fanoutObserver?: ProviderFanoutObserver;
  private readonly itemCache = new Map<string, CachedItem>();
  private readonly itemInFlight = new Map<string, Promise<JsonRecord | null>>();
  private tokenCache?: CachedToken;
  private tokenInFlight?: Promise<string>;
  private catalogTokenCache?: CachedToken;
  private catalogTokenInFlight?: Promise<string>;

  constructor(options: EbayBrowseEnricherOptions) {
    this.clientId = requireNonEmpty(options.clientId, "eBay client id");
    this.clientSecret = requireNonEmpty(options.clientSecret, "eBay client secret");
    this.environment = options.environment ?? "sandbox";
    this.marketplaceId = options.marketplaceId ?? "EBAY_DE";
    this.marketplaceSearchIds = validateMarketplaceIds(
      options.marketplaceSearchIds ?? [this.marketplaceId]
    );
    this.deliveryCountry = validateCountryCode(
      options.deliveryCountry ?? "DE",
      "eBay delivery country"
    );
    this.marketplaceSearchConcurrency = validatePositiveInteger(
      options.marketplaceSearchConcurrency ?? 3,
      "eBay marketplace search concurrency"
    );
    this.catalogEpidFallbackEnabled =
      options.catalogEpidFallbackEnabled ?? false;
    this.catalogMarketplaceId = validateCatalogMarketplaceId(
      options.catalogMarketplaceId ??
        (
          EBAY_CATALOG_MARKETPLACE_IDS.includes(
            this.marketplaceId as EbayCatalogMarketplaceId
          )
            ? this.marketplaceId
            : "EBAY_DE"
        )
    );
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.cacheTtlMs = validateCacheTtl(options.cacheTtlMs ?? 0, "eBay Browse");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheObserver = options.cacheObserver;
    this.fanoutObserver = options.fanoutObserver;
  }

  async enrich(listing: EcommerceListing): Promise<EcommerceListing> {
    const item = await this.getItemByLegacyId(listing.itemId);
    if (!item) return listing;

    const browseIdentity = extractBrowseIdentity(item);
    const merged = mergeIdentity(listing.identity, browseIdentity);
    let identity = merged.identity;
    const addedFields = [...merged.addedFields];
    const warnings = [...merged.warnings];

    if (
      this.catalogEpidFallbackEnabled &&
      !strongestTradeIdentifier(identity) &&
      !cleanEpid(identity.epid) &&
      identity.brand &&
      identity.mpn
    ) {
      try {
        const epid = await this.resolveCatalogEpid(identity);
        if (epid) {
          identity = {...identity, epid};
          addedFields.push("epid");
        }
      } catch {
        warnings.push(
          "eBay Catalog ePID fallback is currently unavailable; Browse identity was kept."
        );
      }
    }

    const browseItemLocationCountry = normalizeResponseCountryCode(
      readString(readRecord(item.itemLocation)?.country)
    );
    const itemLocationCountry =
      listing.itemLocationCountry ?? browseItemLocationCountry;
    const locationAdded =
      listing.itemLocationCountry === undefined &&
      itemLocationCountry !== undefined;

    if (
      addedFields.length === 0 &&
      warnings.length === 0 &&
      !locationAdded
    ) {
      return listing;
    }

    const evidenceFields = [
      ...addedFields,
      ...(locationAdded ? ["itemLocationCountry"] : [])
    ];

    return {
      ...listing,
      identity,
      ...(itemLocationCountry ? {itemLocationCountry} : {}),
      extractionEvidence:
        evidenceFields.length > 0
          ? [...listing.extractionEvidence, `ebay-browse:${evidenceFields.join(",")}`]
          : listing.extractionEvidence,
      extractionWarnings: [...listing.extractionWarnings, ...warnings]
    };
  }

  async searchMarketplace(
    listing: EcommerceListing,
    signal?: AbortSignal,
    destination?: BuyerDestination
  ): Promise<ProviderCandidate[]> {
    const startedAt = this.now();
    const discovery = strongestMarketplaceDiscovery(listing.identity);
    if (!discovery) {
      safeObserveProviderFanout(this.fanoutObserver, {
        source: "ebay",
        attempted: 0,
        succeeded: 0,
        failed: 0,
        durationMs: Math.max(0, this.now() - startedAt)
      });
      return [];
    }

    const effectiveDestination = normalizeDestination(
      destination,
      this.deliveryCountry
    );

    const settled = await mapWithConcurrency(
      this.marketplaceSearchIds,
      this.marketplaceSearchConcurrency,
      (marketplaceId) =>
        this.searchSingleMarketplace(
          marketplaceId,
          listing,
          discovery,
          effectiveDestination,
          signal
        )
    );

    const successful = settled.filter(
      (entry): entry is PromiseFulfilledResult<ProviderCandidate[]> =>
        entry.status === "fulfilled"
    );
    const failed = settled.length - successful.length;

    safeObserveProviderFanout(this.fanoutObserver, {
      source: "ebay",
      attempted: settled.length,
      succeeded: successful.length,
      failed,
      durationMs: Math.max(0, this.now() - startedAt)
    });

    if (successful.length === 0) {
      const firstFailure = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected"
      );
      throw firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error("All configured eBay marketplace searches failed.");
    }

    return dedupeMarketplaceCandidates(
      successful.flatMap((entry) => entry.value),
      listing.price.currency
    );
  }

  private async searchSingleMarketplace(
    marketplaceId: EbayEuMarketplaceId,
    listing: EcommerceListing,
    discovery: EbayMarketplaceDiscovery,
    destination: BuyerDestination,
    signal?: AbortSignal
  ): Promise<ProviderCandidate[]> {
    let response = await this.fetchMarketplaceSearch(
      marketplaceId,
      discovery,
      false,
      destination,
      signal
    );
    if (response.status === 401) {
      this.tokenCache = undefined;
      response = await this.fetchMarketplaceSearch(
        marketplaceId,
        discovery,
        true,
        destination,
        signal
      );
    }

    if (response.status === 429) {
      throw new Error(
        `eBay Browse marketplace search rate limit reached for ${marketplaceId}.`
      );
    }

    if (!response.ok) {
      throw new Error(
        `eBay Browse marketplace search failed for ${marketplaceId} with HTTP ${response.status}.`
      );
    }

    const payload = await readJsonRecord(
      response,
      `eBay Browse marketplace search (${marketplaceId})`
    );
    return extractMarketplaceCandidates(
      payload,
      listing,
      discovery,
      this.now(),
      marketplaceId
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

  private async resolveCatalogEpid(
    identity: ProductIdentity
  ): Promise<string | undefined> {
    const brand = identity.brand?.trim();
    const mpn = identity.mpn?.trim();
    if (!brand || !isMeaningfulIdentifier(mpn)) return undefined;

    let response = await this.fetchCatalogProductSearch(mpn, false);
    if (response.status === 401) {
      this.catalogTokenCache = undefined;
      response = await this.fetchCatalogProductSearch(mpn, true);
    }

    if (response.status === 429) {
      throw new Error("eBay Catalog API rate limit reached.");
    }

    if (!response.ok) {
      throw new Error(
        `eBay Catalog product search failed with HTTP ${response.status}.`
      );
    }

    const payload = await readJsonRecord(response, "eBay Catalog product search");
    const summaries = Array.isArray(payload.productSummaries)
      ? payload.productSummaries
      : [];
    const exactEpids = new Set<string>();
    const expectedBrand = normalizeToken(brand);
    const expectedMpn = normalizeToken(mpn);

    for (const value of summaries) {
      const product = readRecord(value);
      if (!product) continue;

      const productBrand = readString(product.brand);
      const productMpns = readStringArray(product.mpn);
      const epid = cleanEpid(readString(product.epid));
      if (
        !productBrand ||
        !epid ||
        normalizeToken(productBrand) !== expectedBrand ||
        !productMpns.some((candidateMpn) =>
          normalizeToken(candidateMpn) === expectedMpn
        )
      ) {
        continue;
      }

      exactEpids.add(epid);
    }

    return exactEpids.size === 1
      ? [...exactEpids][0]
      : undefined;
  }

  private async fetchCatalogProductSearch(
    mpn: string,
    forceTokenRefresh: boolean
  ): Promise<Response> {
    const token = await this.getCatalogToken(forceTokenRefresh);
    const endpoint = new URL(
      "/commerce/catalog/v1_beta/product_summary/search",
      this.apiBaseUrl()
    );
    endpoint.searchParams.set("mpn", mpn);
    endpoint.searchParams.set("limit", "20");

    return this.fetchWithTimeout(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "x-ebay-c-marketplace-id": this.catalogMarketplaceId,
        accept: "application/json"
      }
    });
  }

  private async fetchMarketplaceSearch(
    marketplaceId: EbayEuMarketplaceId,
    discovery: EbayMarketplaceDiscovery,
    forceTokenRefresh: boolean,
    destination: BuyerDestination,
    signal?: AbortSignal
  ): Promise<Response> {
    const token = await this.getApplicationToken(forceTokenRefresh);
    const endpoint = new URL(
      "/buy/browse/v1/item_summary/search",
      this.apiBaseUrl()
    );
    endpoint.searchParams.set(discovery.kind, discovery.value);
    endpoint.searchParams.set("limit", "25");
    const filters = [
      "buyingOptions:{FIXED_PRICE}",
      `deliveryCountry:${destination.country}`
    ];
    if (destination.postalCode) {
      filters.push(`deliveryPostalCode:${destination.postalCode}`);
    }
    endpoint.searchParams.set("filter", filters.join(","));

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": marketplaceId,
      accept: "application/json"
    };
    if (destination.postalCode) {
      headers["x-ebay-c-enduserctx"] =
        `contextualLocation=${encodeURIComponent(
          `country=${destination.country},zip=${destination.postalCode}`
        )}`;
    }

    return this.fetchWithTimeout(
      endpoint,
      {
        method: "GET",
        headers
      },
      signal
    );
  }

  private async getCatalogToken(forceRefresh: boolean): Promise<string> {
    if (
      !forceRefresh &&
      this.catalogTokenCache &&
      this.catalogTokenCache.expiresAt > this.now()
    ) {
      return this.catalogTokenCache.token;
    }

    if (this.catalogTokenInFlight) return this.catalogTokenInFlight;

    const pending = this.mintApplicationToken(
      "https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly"
    ).then((cached) => {
      this.catalogTokenCache = cached;
      return cached.token;
    }).finally(() => {
      if (this.catalogTokenInFlight === pending) {
        this.catalogTokenInFlight = undefined;
      }
    });

    this.catalogTokenInFlight = pending;
    return pending;
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

    const pending = this.mintApplicationToken(
      "https://api.ebay.com/oauth/api_scope"
    ).then((cached) => {
      this.tokenCache = cached;
      return cached.token;
    }).finally(() => {
      if (this.tokenInFlight === pending) {
        this.tokenInFlight = undefined;
      }
    });
    this.tokenInFlight = pending;
    return pending;
  }

  private async mintApplicationToken(scope: string): Promise<CachedToken> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
      "utf8"
    ).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope
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
    return {
      token,
      expiresAt: this.now() + expiresIn * 1000 - safetyWindowMs
    };
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
    search: ({listing, destination, signal}) =>
      enricher.searchMarketplace(listing, signal, destination)
  };
}

export function createEbayBrowseEnricherFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  runtimeOptions: Pick<
    EbayBrowseEnricherOptions,
    "cacheObserver" | "fanoutObserver"
  > = {}
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
    marketplaceSearchIds: parseMarketplaceSearchIds(
      env.EBAY_MARKETPLACE_SEARCH_IDS
    ),
    deliveryCountry: env.EBAY_DELIVERY_COUNTRY?.trim() || "DE",
    marketplaceSearchConcurrency: parsePositiveIntegerEnv(
      env.EBAY_MARKETPLACE_SEARCH_CONCURRENCY,
      "EBAY_MARKETPLACE_SEARCH_CONCURRENCY",
      3
    ),
    cacheTtlMs: parseCacheTtlEnv(
      env.EBAY_BROWSE_CACHE_TTL_MS,
      "EBAY_BROWSE_CACHE_TTL_MS"
    ),
    cacheObserver: runtimeOptions.cacheObserver,
    fanoutObserver: runtimeOptions.fanoutObserver
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
    if (!isAllowedEbayMarketplaceUrl(url, marketplaceId)) continue;

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

function isAllowedEbayMarketplaceUrl(
  raw: string,
  marketplaceId: string
): boolean {
  const validatedMarketplace = validateMarketplaceId(marketplaceId);
  const expectedHost = EBAY_MARKETPLACE_HOSTS[validatedMarketplace];

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === expectedHost || host.endsWith(`.${expectedHost}`))
    );
  } catch {
    return false;
  }
}

function dedupeMarketplaceCandidates(
  candidates: ProviderCandidate[],
  preferredCurrency: string
): ProviderCandidate[] {
  const byItem = new Map<string, ProviderCandidate>();
  const normalizedPreferredCurrency = preferredCurrency.toUpperCase();

  for (const candidate of candidates) {
    const key = candidate.providerProductId ?? candidate.url;
    const current = byItem.get(key);
    if (!current) {
      byItem.set(key, candidate);
      continue;
    }

    if (
      candidateIsPreferred(
        candidate,
        current,
        normalizedPreferredCurrency
      )
    ) {
      byItem.set(key, candidate);
    }
  }

  return [...byItem.values()];
}

function candidateIsPreferred(
  candidate: ProviderCandidate,
  current: ProviderCandidate,
  preferredCurrency: string
): boolean {
  const candidateShippingComplete = candidate.shipping !== undefined;
  const currentShippingComplete = current.shipping !== undefined;
  if (candidateShippingComplete !== currentShippingComplete) {
    return candidateShippingComplete;
  }

  const candidateCurrencyMatches =
    candidate.itemPrice.currency.toUpperCase() === preferredCurrency;
  const currentCurrencyMatches =
    current.itemPrice.currency.toUpperCase() === preferredCurrency;
  if (candidateCurrencyMatches !== currentCurrencyMatches) {
    return candidateCurrencyMatches;
  }

  if (
    candidateShippingComplete &&
    currentShippingComplete &&
    candidate.itemPrice.currency.toUpperCase() ===
      current.itemPrice.currency.toUpperCase()
  ) {
    return (
      candidate.itemPrice.amount + candidate.shipping!.amount <
      current.itemPrice.amount + current.shipping!.amount
    );
  }

  return false;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  maxConcurrent: number,
  task: (value: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      try {
        results[index] = {
          status: "fulfilled",
          value: await task(values[index]!)
        };
      } catch (reason) {
        results[index] = {status: "rejected", reason};
      }
    }
  }

  const workers = Array.from(
    {length: Math.min(maxConcurrent, values.length)},
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

function parseMarketplaceSearchIds(
  raw: string | undefined
): EbayEuMarketplaceId[] {
  if (!raw?.trim()) return [...EBAY_EU_MARKETPLACE_IDS];

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return validateMarketplaceIds(values);
}

function validateMarketplaceIds(
  values: readonly string[]
): EbayEuMarketplaceId[] {
  if (values.length === 0) {
    throw new Error("At least one eBay marketplace search ID is required.");
  }

  const unique = new Set<EbayEuMarketplaceId>();
  for (const value of values) {
    unique.add(validateMarketplaceId(value));
  }
  return [...unique];
}

function validateMarketplaceId(value: string): EbayEuMarketplaceId {
  if (
    !EBAY_EU_MARKETPLACE_IDS.includes(value as EbayEuMarketplaceId)
  ) {
    throw new Error(
      `Unsupported eBay marketplace ID: ${value}. Supported EU markets: ${EBAY_EU_MARKETPLACE_IDS.join(", ")}.`
    );
  }
  return value as EbayEuMarketplaceId;
}

function normalizeDestination(
  destination: BuyerDestination | undefined,
  fallbackCountry: string
): BuyerDestination {
  const country = validateCountryCode(
    destination?.country ?? fallbackCountry,
    "eBay delivery country"
  );
  const postalCode = validatePostalCode(
    destination?.postalCode,
    "eBay delivery postal code"
  );

  return {
    country,
    ...(postalCode ? {postalCode} : {})
  };
}

function validatePostalCode(
  value: string | undefined,
  name: string
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (
    normalized.length > 16 ||
    !/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(normalized)
  ) {
    throw new Error(
      `${name} must contain only letters, numbers, spaces or hyphens and be at most 16 characters.`
    );
  }
  return normalized;
}

function normalizeResponseCountryCode(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized)
    ? normalized
    : undefined;
}

function validateCountryCode(value: string, name: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new Error(`${name} must be a two-letter ISO country code.`);
  }
  return normalized;
}

function parsePositiveIntegerEnv(
  raw: string | undefined,
  name: string,
  fallback: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return validatePositiveInteger(Number(raw.trim()), name);
}

function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
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
