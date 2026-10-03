import type {
  EcommerceListing,
  ListingCondition,
  ProductIdentity,
  ProductVariant
} from "@price-lens/contracts";
import type {
  PriceProvider,
  ProviderCandidate,
  ProviderSearchInput
} from "@price-lens/core";
import {
  safeObserveProviderCache,
  type ProviderCacheObserver
} from "./provider-cache.js";

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

export const AMAZON_EU_MARKETPLACE_HOSTS = [
  "www.amazon.de",
  "www.amazon.pl",
  "www.amazon.fr",
  "www.amazon.it",
  "www.amazon.es",
  "www.amazon.nl",
  "www.amazon.com.be"
] as const;

export type AmazonEuMarketplace =
  typeof AMAZON_EU_MARKETPLACE_HOSTS[number];

const AMAZON_MARKETPLACE_ROOTS: Record<AmazonEuMarketplace, string> = {
  "www.amazon.de": "amazon.de",
  "www.amazon.pl": "amazon.pl",
  "www.amazon.fr": "amazon.fr",
  "www.amazon.it": "amazon.it",
  "www.amazon.es": "amazon.es",
  "www.amazon.nl": "amazon.nl",
  "www.amazon.com.be": "amazon.com.be"
};

const AMAZON_MARKETPLACE_CURRENCIES: Record<AmazonEuMarketplace, string> = {
  "www.amazon.de": "EUR",
  "www.amazon.pl": "PLN",
  "www.amazon.fr": "EUR",
  "www.amazon.it": "EUR",
  "www.amazon.es": "EUR",
  "www.amazon.nl": "EUR",
  "www.amazon.com.be": "EUR"
};

export interface AmazonMarketplaceConfig {
  marketplace: AmazonEuMarketplace;
  partnerTag: string;
}

export interface AmazonCreatorsProviderOptions {
  credentialId: string;
  credentialSecret: string;
  credentialVersion: string;
  partnerTag?: string;
  marketplace?: string;
  marketplacePartnerTags?: Record<string, string>;
  marketplaceConcurrency?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  cacheObserver?: ProviderCacheObserver;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface CachedCandidates {
  candidates: ProviderCandidate[];
  expiresAt: number;
}

export class AmazonCreatorsProvider implements PriceProvider {
  readonly id = "amazon" as const;

  private readonly credentialId: string;
  private readonly credentialSecret: string;
  private readonly credentialVersion: string;
  private readonly marketplaces: AmazonMarketplaceConfig[];
  private readonly marketplaceConcurrency: number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly cacheObserver?: ProviderCacheObserver;
  private tokenCache?: CachedToken;
  private tokenInFlight?: Promise<string>;
  private readonly searchCache = new Map<string, CachedCandidates>();
  private readonly searchInFlight = new Map<string, Promise<ProviderCandidate[]>>();

  constructor(options: AmazonCreatorsProviderOptions) {
    this.credentialId = requireValue(options.credentialId, "Amazon credential id");
    this.credentialSecret = requireValue(
      options.credentialSecret,
      "Amazon credential secret"
    );
    this.credentialVersion = requireValue(
      options.credentialVersion,
      "Amazon credential version"
    );
    this.marketplaces = normalizeMarketplaceConfigs(
      options.marketplacePartnerTags,
      options.marketplace,
      options.partnerTag
    );
    this.marketplaceConcurrency = validatePositiveInteger(
      options.marketplaceConcurrency ?? 2,
      "Amazon marketplace concurrency"
    );
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.cacheTtlMs = validateCacheTtl(options.cacheTtlMs ?? 0, "Amazon Creators");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheObserver = options.cacheObserver;
  }

  async search(input: ProviderSearchInput): Promise<ProviderCandidate[]> {
    const settled = await mapWithConcurrency(
      this.marketplaces,
      this.marketplaceConcurrency,
      (config) => this.searchMarketplace(input, config)
    );

    const successful = settled.filter(
      (entry): entry is PromiseFulfilledResult<ProviderCandidate[]> =>
        entry.status === "fulfilled"
    );
    if (successful.length === 0) {
      const firstFailure = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected"
      );
      throw firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error("All configured Amazon marketplace searches failed.");
    }

    return successful.flatMap((entry) => entry.value);
  }

  private async searchMarketplace(
    input: ProviderSearchInput,
    config: AmazonMarketplaceConfig
  ): Promise<ProviderCandidate[]> {
    const cacheKey = `${config.marketplace}|${listingCacheKey(input)}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      safeObserveProviderCache(this.cacheObserver, {
        source: "amazon",
        outcome: "hit"
      });
      return cached.candidates;
    }
    if (cached) {
      this.searchCache.delete(cacheKey);
    }

    const active = this.searchInFlight.get(cacheKey);
    if (active) {
      safeObserveProviderCache(this.cacheObserver, {
        source: "amazon",
        outcome: "coalesced"
      });
      return waitForSignal(
        active,
        input.signal,
        "Amazon Creators request was aborted."
      );
    }

    safeObserveProviderCache(this.cacheObserver, {
      source: "amazon",
      outcome: "miss"
    });
    const pending = this.fetchAndCacheSearch(
      input.listing,
      cacheKey,
      config
    ).finally(() => {
      if (this.searchInFlight.get(cacheKey) === pending) {
        this.searchInFlight.delete(cacheKey);
      }
    });
    this.searchInFlight.set(cacheKey, pending);

    return waitForSignal(
      pending,
      input.signal,
      "Amazon Creators request was aborted."
    );
  }

  private async fetchAndCacheSearch(
    listing: EcommerceListing,
    cacheKey: string,
    config: AmazonMarketplaceConfig
  ): Promise<ProviderCandidate[]> {
    let response = await this.searchItems(listing, false, config);
    if (response.status === 401) {
      this.tokenCache = undefined;
      response = await this.searchItems(listing, true, config);
    }

    if (response.status === 404) {
      return [];
    }

    if (response.status === 429) {
      throw new Error(
        `Amazon Creators API rate limit reached for ${config.marketplace}.`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Amazon Creators API request failed for ${config.marketplace} with HTTP ${response.status}.`
      );
    }

    const payload = await readJsonRecord(
      response,
      `Amazon Creators API (${config.marketplace})`
    );
    const candidates = parseSearchItems(
      payload,
      this.now(),
      config.marketplace
    );
    if (this.cacheTtlMs > 0) {
      this.searchCache.set(cacheKey, {
        candidates,
        expiresAt: this.now() + this.cacheTtlMs
      });
    }
    return candidates;
  }

  private async searchItems(
    listing: EcommerceListing,
    forceTokenRefresh: boolean,
    config: AmazonMarketplaceConfig
  ): Promise<Response> {
    const token = await this.getToken(forceTokenRefresh);
    const searchTerms = [
      listing.identity.brand,
      listing.identity.model,
      listing.identity.mpn
    ]
      .filter((value): value is string => !!value?.trim())
      .join(" ")
      .trim();

    const body: Record<string, unknown> = {
      partnerTag: config.partnerTag,
      marketplace: config.marketplace,
      keywords: searchTerms || listing.title,
      itemCount: 10,
      currencyOfPreference:
        AMAZON_MARKETPLACE_CURRENCIES[config.marketplace],
      resources: [
        "itemInfo.title",
        "itemInfo.byLineInfo",
        "itemInfo.externalIds",
        "itemInfo.manufactureInfo",
        "itemInfo.contentInfo",
        "itemInfo.productInfo",
        "offersV2.listings.availability",
        "offersV2.listings.condition",
        "offersV2.listings.merchantInfo",
        "offersV2.listings.price"
      ]
    };

    if (listing.identity.brand) {
      body.brand = listing.identity.brand;
    }
    if (listing.condition === "new") {
      body.condition = "New";
    }

    return this.fetchWithTimeout(
      new URL("https://creatorsapi.amazon/catalog/v1/searchItems"),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          "x-marketplace": config.marketplace
        },
        body: JSON.stringify(body)
      }
    );
  }

  private async getToken(forceRefresh: boolean): Promise<string> {
    if (
      !forceRefresh &&
      this.tokenCache &&
      this.tokenCache.expiresAt > this.now()
    ) {
      return this.tokenCache.token;
    }

    if (this.tokenInFlight) return this.tokenInFlight;

    const pending = this.mintToken().finally(() => {
      if (this.tokenInFlight === pending) {
        this.tokenInFlight = undefined;
      }
    });
    this.tokenInFlight = pending;
    return pending;
  }

  private async mintToken(): Promise<string> {
    const response = await this.fetchWithTimeout(
      new URL("/auth/o2/token", tokenBaseUrl(this.credentialVersion)),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: this.credentialId,
          client_secret: this.credentialSecret,
          scope: "creatorsapi::default"
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Amazon Creators OAuth request failed with HTTP ${response.status}.`
      );
    }

    const payload = await readJsonRecord(response, "Amazon Creators OAuth");
    const token = readString(payload.access_token);
    const expiresIn = readPositiveNumber(payload.expires_in);
    if (!token || !expiresIn) {
      throw new Error("Amazon Creators OAuth response was incomplete.");
    }

    const safetyWindowMs = Math.min(60_000, Math.floor(expiresIn * 100));
    this.tokenCache = {
      token,
      expiresAt: this.now() + expiresIn * 1000 - safetyWindowMs
    };
    return token;
  }

  private async fetchWithTimeout(
    input: URL,
    init: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, {once: true});
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(input, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        if (externalSignal?.aborted) {
          throw new Error("Amazon Creators request was aborted.");
        }
        throw new Error(
          `Amazon Creators request timed out after ${this.timeoutMs} ms.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }
}

export function createAmazonCreatorsProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  runtimeOptions: Pick<AmazonCreatorsProviderOptions, "cacheObserver"> = {}
): AmazonCreatorsProvider | undefined {
  if (env.AMAZON_CREATORS_ENABLED !== "1") return undefined;

  const credentialId = env.AMAZON_CREATORS_CREDENTIAL_ID?.trim();
  const credentialSecret = env.AMAZON_CREATORS_CREDENTIAL_SECRET?.trim();
  const credentialVersion = env.AMAZON_CREATORS_CREDENTIAL_VERSION?.trim();
  const partnerTag = env.AMAZON_PARTNER_TAG?.trim();
  const marketplacePartnerTags = parseMarketplacePartnerTagsEnv(
    env.AMAZON_MARKETPLACE_PARTNER_TAGS_JSON
  );

  if (!credentialId || !credentialSecret || !credentialVersion) {
    throw new Error(
      "AMAZON_CREATORS_ENABLED=1 requires credential id, secret and version."
    );
  }
  if (
    (!marketplacePartnerTags ||
      Object.keys(marketplacePartnerTags).length === 0) &&
    !partnerTag
  ) {
    throw new Error(
      "AMAZON_CREATORS_ENABLED=1 requires at least one marketplace Partner Tag."
    );
  }

  return new AmazonCreatorsProvider({
    credentialId,
    credentialSecret,
    credentialVersion,
    partnerTag,
    marketplace: env.AMAZON_MARKETPLACE?.trim() || "www.amazon.de",
    marketplacePartnerTags,
    marketplaceConcurrency: parsePositiveIntegerEnv(
      env.AMAZON_MARKETPLACE_SEARCH_CONCURRENCY,
      "AMAZON_MARKETPLACE_SEARCH_CONCURRENCY",
      2
    ),
    cacheTtlMs: parseCacheTtlEnv(
      env.AMAZON_CREATORS_CACHE_TTL_MS,
      "AMAZON_CREATORS_CACHE_TTL_MS"
    ),
    cacheObserver: runtimeOptions.cacheObserver
  });
}

function waitForSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  abortMessage: string
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error(abortMessage));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(abortMessage));
    signal.addEventListener("abort", onAbort, {once: true});

    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function parseSearchItems(
  payload: JsonRecord,
  now: number,
  marketplace: string
): ProviderCandidate[] {
  const searchResult = readRecord(payload.searchResult);
  const items = Array.isArray(searchResult?.items) ? searchResult.items : [];
  const fetchedAt = new Date(now).toISOString();
  const result: ProviderCandidate[] = [];

  for (const rawItem of items) {
    const item = readRecord(rawItem);
    if (!item) continue;

    const asin = readString(item.asin);
    const url = readString(item.detailPageURL);
    const itemInfo = readRecord(item.itemInfo);
    const title = readDisplayValue(readRecord(itemInfo?.title));
    if (
      !asin ||
      !url ||
      !title ||
      !isTrustedAmazonDetailUrl(url, marketplace)
    ) {
      continue;
    }

    const identity = parseIdentity(itemInfo);
    const offersV2 = readRecord(item.offersV2);
    const listings = Array.isArray(offersV2?.listings)
      ? offersV2.listings
      : [];

    for (const rawListing of listings) {
      const listing = readRecord(rawListing);
      if (!listing) continue;

      const availability = readRecord(listing.availability);
      const availabilityType = readString(availability?.type)?.toUpperCase();
      if (
        availabilityType &&
        ["OUT_OF_STOCK", "OUTOFSTOCK", "UNAVAILABLE"].includes(
          availabilityType
        )
      ) {
        continue;
      }

      const price = readRecord(listing.price);
      const money = readRecord(price?.money);
      const amount = readPositiveOrZeroNumber(money?.amount);
      const currency = readString(money?.currency)?.toUpperCase();
      if (amount === undefined || !currency) continue;

      const conditionRecord = readRecord(listing.condition);
      const condition = mapCondition(
        readString(conditionRecord?.value),
        readString(conditionRecord?.subCondition)
      );
      const merchant = readString(readRecord(listing.merchantInfo)?.name);

      result.push({
        provider: "amazon",
        providerProductId: asin,
        productTitle: title,
        merchant,
        marketplace,
        url,
        condition,
        identity,
        itemPrice: {amount, currency},
        shipping: undefined,
        fetchedAt
      });
    }
  }

  return result;
}

function parseIdentity(itemInfo: JsonRecord | undefined): ProductIdentity {
  const identity: ProductIdentity = {};
  if (!itemInfo) return identity;

  const byLine = readRecord(itemInfo.byLineInfo);
  const manufacture = readRecord(itemInfo.manufactureInfo);
  const external = readRecord(itemInfo.externalIds);
  const contentInfo = readRecord(itemInfo.contentInfo);
  const productInfo = readRecord(itemInfo.productInfo);

  const brand = readDisplayValue(readRecord(byLine?.brand));
  const model = readDisplayValue(readRecord(manufacture?.model));
  const mpn = readDisplayValue(readRecord(manufacture?.itemPartNumber));
  const ean = firstTradeIdentifier(readRecord(external?.eans)?.displayValues);
  const upc = firstTradeIdentifier(readRecord(external?.upcs)?.displayValues);

  if (brand) identity.brand = brand;
  if (model) identity.model = model;
  if (mpn) identity.mpn = mpn;
  if (ean) identity.ean = ean;
  if (upc) identity.upc = upc;

  const variant: ProductVariant = {};
  const edition = readDisplayValue(readRecord(contentInfo?.edition));
  const unitCount = readPositiveNumber(
    readRecord(productInfo?.unitCount)?.displayValue
  );
  if (edition) variant.edition = edition;
  if (unitCount && Number.isInteger(unitCount) && unitCount <= 1000) {
    variant.packCount = unitCount;
  }
  if (Object.keys(variant).length > 0) identity.variant = variant;

  return identity;
}

function mapCondition(
  value: string | undefined,
  subCondition: string | undefined
): ListingCondition {
  const sub = normalizeToken(subCondition);
  if (sub === "openbox") return "open_box";

  switch (normalizeToken(value)) {
    case "new":
      return "new";
    case "used":
      return "used";
    case "refurbished":
      return "refurbished";
    default:
      return "unknown";
  }
}

function normalizeMarketplaceConfigs(
  marketplacePartnerTags: Record<string, string> | undefined,
  legacyMarketplace: string | undefined,
  legacyPartnerTag: string | undefined
): AmazonMarketplaceConfig[] {
  const entries = marketplacePartnerTags
    ? Object.entries(marketplacePartnerTags)
    : [];

  if (entries.length > 0) {
    return entries.map(([marketplace, partnerTag]) => ({
      marketplace: normalizeAmazonMarketplace(marketplace),
      partnerTag: requireValue(
        partnerTag,
        `Amazon Partner Tag for ${marketplace}`
      )
    }));
  }

  return [{
    marketplace: normalizeAmazonMarketplace(
      legacyMarketplace ?? "www.amazon.de"
    ),
    partnerTag: requireValue(
      legacyPartnerTag ?? "",
      "Amazon partner tag"
    )
  }];
}

function normalizeAmazonMarketplace(value: string): AmazonEuMarketplace {
  const hostname = requireValue(value, "Amazon marketplace").toLowerCase();
  if (
    !AMAZON_EU_MARKETPLACE_HOSTS.includes(
      hostname as AmazonEuMarketplace
    )
  ) {
    throw new Error(
      `Unsupported Amazon EU marketplace: ${value}. Supported markets: ${AMAZON_EU_MARKETPLACE_HOSTS.join(", ")}.`
    );
  }
  return hostname as AmazonEuMarketplace;
}

function isTrustedAmazonDetailUrl(
  value: string,
  marketplace: string
): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return false;
    }

    const marketplaceHostname = normalizeAmazonMarketplace(marketplace);
    const rootDomain = AMAZON_MARKETPLACE_ROOTS[marketplaceHostname];
    const hostname = url.hostname.toLowerCase();

    return (
      hostname === rootDomain ||
      hostname.endsWith(`.${rootDomain}`)
    );
  } catch {
    return false;
  }
}

function tokenBaseUrl(version: string): string {
  switch (version.trim()) {
    case "3.1":
      return "https://api.amazon.com";
    case "3.2":
      return "https://api.amazon.co.uk";
    case "3.3":
      return "https://api.amazon.co.jp";
    default:
      throw new Error(
        "Unsupported Amazon Creators credential version; expected 3.1, 3.2 or 3.3."
      );
  }
}

function listingCacheKey(input: ProviderSearchInput): string {
  const listing = input.listing;
  return JSON.stringify({
    title: listing.title,
    condition: listing.condition,
    brand: listing.identity.brand ?? null,
    model: listing.identity.model ?? null,
    mpn: listing.identity.mpn ?? null,
    gtin: listing.identity.gtin ?? listing.identity.ean ?? listing.identity.upc ?? null,
    variant: listing.identity.variant ?? null
  });
}

function firstTradeIdentifier(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    const raw = readString(entry);
    if (!raw) continue;
    const digits = raw.replace(/\D/g, "");
    if ([8, 12, 13, 14].includes(digits.length)) return digits;
  }
  return undefined;
}

function readDisplayValue(record: JsonRecord | undefined): string | undefined {
  return readString(record?.displayValue);
}

function normalizeToken(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

function readPositiveOrZeroNumber(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

async function readJsonRecord(
  response: Response,
  source: string
): Promise<JsonRecord> {
  const value = await response.json() as unknown;
  const record = readRecord(value);
  if (!record) throw new Error(`${source} returned an invalid JSON object.`);
  return record;
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

  await Promise.all(
    Array.from(
      {length: Math.min(maxConcurrent, values.length)},
      () => worker()
    )
  );
  return results;
}

function parseMarketplacePartnerTagsEnv(
  raw: string | undefined
): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "AMAZON_MARKETPLACE_PARTNER_TAGS_JSON must be a JSON object."
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "AMAZON_MARKETPLACE_PARTNER_TAGS_JSON must be a JSON object."
    );
  }

  const result: Record<string, string> = {};
  for (const [marketplace, value] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(
        `Amazon Partner Tag for ${marketplace} must be a non-empty string.`
      );
    }
    result[normalizeAmazonMarketplace(marketplace)] = value.trim();
  }

  return result;
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

function requireValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} must not be empty.`);
  return trimmed;
}
