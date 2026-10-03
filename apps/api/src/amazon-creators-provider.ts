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

export interface AmazonCreatorsProviderOptions {
  credentialId: string;
  credentialSecret: string;
  credentialVersion: string;
  partnerTag: string;
  marketplace?: string;
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
  private readonly partnerTag: string;
  private readonly marketplace: string;
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
    this.partnerTag = requireValue(options.partnerTag, "Amazon partner tag");
    this.marketplace = normalizeAmazonMarketplace(
      options.marketplace ?? "www.amazon.de"
    );
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.cacheTtlMs = validateCacheTtl(options.cacheTtlMs ?? 0, "Amazon Creators");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheObserver = options.cacheObserver;
  }

  async search(input: ProviderSearchInput): Promise<ProviderCandidate[]> {
    const cacheKey = listingCacheKey(input);
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
    const pending = this.fetchAndCacheSearch(input.listing, cacheKey).finally(() => {
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
    cacheKey: string
  ): Promise<ProviderCandidate[]> {
    let response = await this.searchItems(listing, false);
    if (response.status === 401) {
      this.tokenCache = undefined;
      response = await this.searchItems(listing, true);
    }

    if (response.status === 404) {
      return [];
    }

    if (response.status === 429) {
      throw new Error("Amazon Creators API rate limit reached.");
    }

    if (!response.ok) {
      throw new Error(
        `Amazon Creators API request failed with HTTP ${response.status}.`
      );
    }

    const payload = await readJsonRecord(response, "Amazon Creators API");
    const candidates = parseSearchItems(payload, this.now(), this.marketplace);
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
    forceTokenRefresh: boolean
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
      partnerTag: this.partnerTag,
      marketplace: this.marketplace,
      keywords: searchTerms || listing.title,
      itemCount: 10,
      currencyOfPreference: "EUR",
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
          "x-marketplace": this.marketplace
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

  if (!credentialId || !credentialSecret || !credentialVersion || !partnerTag) {
    throw new Error(
      "AMAZON_CREATORS_ENABLED=1 requires credential id, secret, version and partner tag."
    );
  }

  return new AmazonCreatorsProvider({
    credentialId,
    credentialSecret,
    credentialVersion,
    partnerTag,
    marketplace: env.AMAZON_MARKETPLACE?.trim() || "www.amazon.de",
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

function normalizeAmazonMarketplace(value: string): string {
  const hostname = requireValue(value, "Amazon marketplace").toLowerCase();
  if (
    hostname.includes("://") ||
    hostname.includes("/") ||
    hostname.includes("?") ||
    hostname.includes("#") ||
    (
      hostname !== "amazon.de" &&
      !hostname.endsWith(".amazon.de")
    )
  ) {
    throw new Error(
      "Amazon marketplace must be an amazon.de hostname such as www.amazon.de."
    );
  }
  return hostname;
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

    const hostname = url.hostname.toLowerCase();
    const marketplaceHostname = normalizeAmazonMarketplace(marketplace);
    const rootDomain = marketplaceHostname === "amazon.de"
      ? "amazon.de"
      : marketplaceHostname.split(".").slice(-2).join(".");

    return (
      rootDomain === "amazon.de" &&
      (hostname === "amazon.de" || hostname.endsWith(".amazon.de"))
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
