import {describe, expect, it, vi} from "vitest";
import type {EcommerceListing, MarketOffer} from "@price-lens/contracts";
import {
  EcbFxNormalizer,
  createEcbFxNormalizerFromEnv,
  parseEcbDailyRates
} from "../src/ecb-fx.js";

const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
  xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time="2026-10-02">
      <Cube currency="USD" rate="1.1225"/>
      <Cube currency="PLN" rate="4.3775"/>
      <Cube currency="GBP" rate="0.85033"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const listing: EcommerceListing = {
  source: "ebay",
  itemId: "123456789012",
  url: "https://www.ebay.de/itm/123456789012",
  title: "Sony WH-1000XM6",
  price: {amount: 349, currency: "EUR"},
  shipping: {amount: 0, currency: "EUR"},
  condition: "new",
  identity: {ean: "4548736162657"},
  extractionEvidence: ["fixture"],
  extractionWarnings: []
};

function offer(
  landedAmount: number,
  currency: string,
  id = "offer"
): MarketOffer {
  return {
    provider: "ebay_market",
    providerProductId: id,
    productTitle: "Sony WH-1000XM6",
    marketplace: currency === "PLN" ? "EBAY_PL" : "EBAY_DE",
    url: currency === "PLN"
      ? `https://www.ebay.pl/itm/${id}`
      : `https://www.ebay.de/itm/${id}`,
    condition: "new",
    itemPrice: {amount: landedAmount, currency},
    shipping: {amount: 0, currency},
    landedPrice: {amount: landedAmount, currency},
    landedPriceComplete: true,
    confidence: 1,
    matchMethod: "gtin",
    matchReason: "Exact EAN match.",
    fetchedAt: "2026-10-04T00:00:00.000Z"
  };
}

function xmlResponse(xml = ECB_XML): Response {
  return new Response(xml, {
    status: 200,
    headers: {"content-type": "text/xml"}
  });
}

describe("ECB FX reference rates", () => {
  it("parses the ECB daily rate date and currencies", () => {
    const table = parseEcbDailyRates(
      ECB_XML,
      Date.parse("2026-10-04T00:00:00.000Z")
    );

    expect(table.rateDate).toBe("2026-10-02");
    expect(table.fetchedAt).toBe("2026-10-04T00:00:00.000Z");
    expect(table.ratesPerEuro.get("EUR")).toBe(1);
    expect(table.ratesPerEuro.get("PLN")).toBe(4.3775);
  });

  it("converts a complete PLN landed price to an estimated EUR comparison price", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(xmlResponse());
    const normalizer = new EcbFxNormalizer({
      fetchImpl,
      now: () => Date.parse("2026-10-04T00:00:00.000Z")
    });

    const result = await normalizer.normalize(
      listing,
      [offer(1244, "PLN", "poland")]
    );

    expect(result.warnings).toEqual([]);
    expect(result.offers[0]).toMatchObject({
      landedPrice: {amount: 1244, currency: "PLN"},
      comparisonLandedPrice: {amount: 284.18, currency: "EUR"},
      fx: {
        source: "ecb_reference",
        rateDate: "2026-10-02",
        fetchedAt: "2026-10-04T00:00:00.000Z",
        fromCurrency: "PLN",
        toCurrency: "EUR"
      }
    });
    expect(result.offers[0]?.fx?.rate).toBeCloseTo(1 / 4.3775, 9);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("leaves same-currency offers unchanged without fetching ECB data", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const normalizer = new EcbFxNormalizer({fetchImpl});

    const sameCurrency = offer(300, "EUR", "germany");
    const result = await normalizer.normalize(listing, [sameCurrency]);

    expect(result).toEqual({offers: [sameCurrency]});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("coalesces concurrent ECB fetches and reuses the fresh cache", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(pending);
    const normalizer = new EcbFxNormalizer({
      fetchImpl,
      now: () => Date.parse("2026-10-04T00:00:00.000Z"),
      cacheTtlMs: 60_000
    });

    const first = normalizer.normalize(listing, [offer(1244, "PLN", "a")]);
    const second = normalizer.normalize(listing, [offer(1200, "PLN", "b")]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveResponse!(xmlResponse());
    await Promise.all([first, second]);

    await normalizer.normalize(listing, [offer(1100, "PLN", "c")]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects stale or malformed ECB data rather than ranking with it", async () => {
    const stale = ECB_XML.replace("2026-10-02", "2026-09-01");
    const staleNormalizer = new EcbFxNormalizer({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(xmlResponse(stale)),
      now: () => Date.parse("2026-10-04T00:00:00.000Z"),
      maxRateAgeDays: 7
    });

    await expect(
      staleNormalizer.normalize(listing, [offer(1244, "PLN")])
    ).rejects.toThrow("too old");

    expect(() =>
      parseEcbDailyRates(
        "<not-rates />",
        Date.parse("2026-10-04T00:00:00.000Z")
      )
    ).toThrow("rate date");
  });
});

describe("ECB FX environment configuration", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(createEcbFxNormalizerFromEnv({})).toBeUndefined();
  });

  it("rejects invalid cache, rate-age and timeout settings", () => {
    expect(() =>
      createEcbFxNormalizerFromEnv({
        ECB_FX_ENABLED: "1",
        ECB_FX_CACHE_TTL_MS: "-1"
      })
    ).toThrow("ECB_FX_CACHE_TTL_MS");

    expect(() =>
      createEcbFxNormalizerFromEnv({
        ECB_FX_ENABLED: "1",
        ECB_FX_MAX_RATE_AGE_DAYS: "0"
      })
    ).toThrow("positive");

    expect(() =>
      createEcbFxNormalizerFromEnv({
        ECB_FX_ENABLED: "1",
        ECB_FX_TIMEOUT_MS: "0"
      })
    ).toThrow("positive");
  });
});
