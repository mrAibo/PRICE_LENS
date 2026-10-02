import type {
  EcommerceListing,
  ProductIdentity
} from "@price-lens/contracts";

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
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
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

  private async getItemByLegacyId(
    legacyItemId: string
  ): Promise<JsonRecord | null> {
    const cached = this.itemCache.get(legacyItemId);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    const active = this.itemInFlight.get(legacyItemId);
    if (active) return active;

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
      this.itemCache.set(legacyItemId, {
        expiresAt: this.now() + Math.min(this.cacheTtlMs, 60_000),
        value: null
      });
      return null;
    }

    if (response.status === 429) {
      throw new Error("eBay Browse API rate limit reached.");
    }

    if (!response.ok) {
      throw new Error(`eBay Browse API request failed with HTTP ${response.status}.`);
    }

    const payload = await readJsonRecord(response, "eBay Browse API");
    this.itemCache.set(legacyItemId, {
      expiresAt: this.now() + this.cacheTtlMs,
      value: payload
    });
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

  private async fetchWithTimeout(
    input: URL,
    init: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(input, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`eBay request timed out after ${this.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createEbayBrowseEnricherFromEnv(
  env: NodeJS.ProcessEnv = process.env
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
    marketplaceId: env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_DE"
  });
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

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} must not be empty.`);
  return trimmed;
}
