import type {
  EcommerceListing,
  FxConversion,
  MarketOffer,
  Money
} from "@price-lens/contracts";
import type {OfferNormalizationResult} from "@price-lens/core";

type FetchLike = typeof fetch;

const ECB_DAILY_RATES_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const DAY_MS = 24 * 60 * 60 * 1000;

interface EcbRateTable {
  rateDate: string;
  fetchedAt: string;
  ratesPerEuro: Map<string, number>;
}

interface CachedRateTable {
  expiresAt: number;
  table: EcbRateTable;
}

export interface EcbFxNormalizerOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
  cacheTtlMs?: number;
  maxRateAgeDays?: number;
}

export class EcbFxNormalizer {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly maxRateAgeDays: number;
  private cache?: CachedRateTable;
  private inFlight?: Promise<EcbRateTable>;

  constructor(options: EcbFxNormalizerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = validateNonNegativeInteger(
      options.cacheTtlMs ?? 6 * 60 * 60 * 1000,
      "ECB FX cache TTL"
    );
    this.maxRateAgeDays = validatePositiveInteger(
      options.maxRateAgeDays ?? 7,
      "ECB FX maximum rate age"
    );
  }

  async normalize(
    listing: EcommerceListing,
    offers: MarketOffer[]
  ): Promise<OfferNormalizationResult> {
    const targetCurrency = normalizeCurrency(listing.price.currency);
    const needsFx = offers.some(
      (offer) =>
        offer.landedPriceComplete &&
        normalizeCurrency(offer.landedPrice.currency) !== targetCurrency
    );
    if (!needsFx) return {offers};

    const table = await this.getRateTable();
    const warnings = new Set<string>();

    const normalizedOffers = offers.map((offer) => {
      if (!offer.landedPriceComplete) return offer;

      const sourceCurrency = normalizeCurrency(offer.landedPrice.currency);
      if (sourceCurrency === targetCurrency) return offer;

      const conversion = convertMoney(
        offer.landedPrice,
        targetCurrency,
        table
      );
      if (!conversion) {
        warnings.add(
          `ECB reference rate unavailable for ${sourceCurrency}->${targetCurrency}; that offer was not cross-currency ranked.`
        );
        return offer;
      }

      return {
        ...offer,
        comparisonLandedPrice: conversion.money,
        fx: conversion.fx
      };
    });

    return {
      offers: normalizedOffers,
      warnings: [...warnings]
    };
  }

  private async getRateTable(): Promise<EcbRateTable> {
    const now = this.now();
    if (this.cache && this.cache.expiresAt > now) {
      this.assertRateFreshEnough(this.cache.table);
      return this.cache.table;
    }

    if (this.inFlight) return this.inFlight;

    const staleFallback = this.cache?.table;
    const pending = this.fetchRateTable()
      .catch((error) => {
        if (staleFallback && this.rateIsFreshEnough(staleFallback)) {
          return staleFallback;
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlight === pending) this.inFlight = undefined;
      });

    this.inFlight = pending;
    return pending;
  }

  private async fetchRateTable(): Promise<EcbRateTable> {
    const response = await this.fetchImpl(ECB_DAILY_RATES_URL, {
      method: "GET",
      headers: {
        accept: "application/xml,text/xml;q=0.9"
      }
    });

    if (!response.ok) {
      throw new Error(
        `ECB reference-rate request failed with HTTP ${response.status}.`
      );
    }

    const xml = await response.text();
    const table = parseEcbDailyRates(xml, this.now());
    this.assertRateFreshEnough(table);

    this.cache = {
      expiresAt: this.now() + this.cacheTtlMs,
      table
    };
    return table;
  }

  private assertRateFreshEnough(table: EcbRateTable): void {
    if (!this.rateIsFreshEnough(table)) {
      throw new Error(
        `ECB reference rates are too old (${table.rateDate}).`
      );
    }
  }

  private rateIsFreshEnough(table: EcbRateTable): boolean {
    const rateTime = Date.parse(`${table.rateDate}T00:00:00Z`);
    if (!Number.isFinite(rateTime)) return false;
    const age = Math.max(0, this.now() - rateTime);
    return age <= this.maxRateAgeDays * DAY_MS;
  }
}

export function createEcbFxNormalizerFromEnv(
  env: NodeJS.ProcessEnv = process.env
): EcbFxNormalizer | undefined {
  if (env.ECB_FX_ENABLED !== "1") return undefined;

  return new EcbFxNormalizer({
    cacheTtlMs: parseNonNegativeIntegerEnv(
      env.ECB_FX_CACHE_TTL_MS,
      "ECB_FX_CACHE_TTL_MS",
      6 * 60 * 60 * 1000
    ),
    maxRateAgeDays: parsePositiveIntegerEnv(
      env.ECB_FX_MAX_RATE_AGE_DAYS,
      "ECB_FX_MAX_RATE_AGE_DAYS",
      7
    )
  });
}

export function parseEcbDailyRates(
  xml: string,
  fetchedAtMs: number
): EcbRateTable {
  const timeMatch = /<Cube\b[^>]*\btime=["'](\d{4}-\d{2}-\d{2})["'][^>]*>/.exec(
    xml
  );
  if (!timeMatch?.[1]) {
    throw new Error("ECB reference-rate XML did not contain a rate date.");
  }

  const ratesPerEuro = new Map<string, number>([["EUR", 1]]);
  const cubePattern = /<Cube\b([^>]*)\/?\s*>/g;
  let cubeMatch: RegExpExecArray | null;

  while ((cubeMatch = cubePattern.exec(xml))) {
    const attributes = cubeMatch[1] ?? "";
    const currency = /\bcurrency=["']([A-Z]{3})["']/.exec(attributes)?.[1];
    const rawRate = /\brate=["']([0-9]+(?:\.[0-9]+)?)["']/.exec(attributes)?.[1];
    if (!currency || !rawRate) continue;

    const rate = Number.parseFloat(rawRate);
    if (Number.isFinite(rate) && rate > 0) {
      ratesPerEuro.set(currency, rate);
    }
  }

  if (ratesPerEuro.size <= 1) {
    throw new Error("ECB reference-rate XML did not contain currency rates.");
  }

  return {
    rateDate: timeMatch[1],
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    ratesPerEuro
  };
}

function convertMoney(
  money: Money,
  targetCurrency: string,
  table: EcbRateTable
): {money: Money; fx: FxConversion} | undefined {
  const sourceCurrency = normalizeCurrency(money.currency);
  const target = normalizeCurrency(targetCurrency);
  const sourceRate = table.ratesPerEuro.get(sourceCurrency);
  const targetRate = table.ratesPerEuro.get(target);
  if (!sourceRate || !targetRate) return undefined;

  const effectiveRate = targetRate / sourceRate;
  const amount = roundMoney(money.amount * effectiveRate);

  return {
    money: {amount, currency: target},
    fx: {
      source: "ecb_reference",
      rateDate: table.rateDate,
      fetchedAt: table.fetchedAt,
      fromCurrency: sourceCurrency,
      toCurrency: target,
      rate: roundRate(effectiveRate)
    }
  };
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_0000) / 1_000_000_0000;
}

function parseNonNegativeIntegerEnv(
  raw: string | undefined,
  name: string,
  fallback: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return validateNonNegativeInteger(Number(raw.trim()), name);
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

function validateNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}
