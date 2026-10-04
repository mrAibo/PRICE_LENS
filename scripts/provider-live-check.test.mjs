import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveComparisonRequest,
  buildRedactedLiveReport,
  evaluateRequirements,
  runProviderLiveCheck,
  validateLiveCheckOrigin,
  validateLiveEbayItemId
} from "./provider-live-check.mjs";

test("accepts HTTPS remote origins and HTTP loopback origins", () => {
  assert.equal(
    validateLiveCheckOrigin("https://api.pricelens.de"),
    "https://api.pricelens.de"
  );
  assert.equal(
    validateLiveCheckOrigin("http://127.0.0.1:8787"),
    "http://127.0.0.1:8787"
  );
  assert.equal(
    validateLiveCheckOrigin("http://localhost:8787"),
    "http://localhost:8787"
  );
});

test("rejects unsafe live-check origins", () => {
  for (const value of [
    "http://api.pricelens.de",
    "https://user:secret@api.pricelens.de",
    "https://api.pricelens.de/path",
    "ftp://localhost",
    "http://192.0.2.10:8787"
  ]) {
    assert.throws(() => validateLiveCheckOrigin(value));
  }
});

test("validates eBay item IDs and builds a minimal trusted comparison request", () => {
  assert.equal(validateLiveEbayItemId("123456789012"), "123456789012");
  assert.throws(() => validateLiveEbayItemId("1234"));
  assert.throws(() => validateLiveEbayItemId("12345678901x"));

  const request = buildLiveComparisonRequest("123456789012", {
    country: "de",
    postalCode: "30159"
  });

  assert.equal(
    request.listing.url,
    "https://www.ebay.de/itm/123456789012"
  );
  assert.deepEqual(request.destination, {
    country: "DE",
    postalCode: "30159"
  });
  assert.deepEqual(request.listing.identity, {});
});

test("builds a redacted report without product, seller, URL or request identifiers", () => {
  const report = buildRedactedLiveReport({
    origin: "https://api.pricelens.de",
    checkedAt: "2026-10-04T13:00:00.000Z",
    destinationConfigured: true,
    health: {
      status: "ok",
      enrichment: {ebay: "configured", fx: "configured"},
      providers: {
        ebay_market: "configured",
        amazon: "configured"
      }
    },
    comparison: {
      requestId: "SECRET-REQUEST-ID",
      listing: {
        title: "SECRET PRODUCT TITLE",
        url: "https://www.ebay.de/itm/123456789012",
        identity: {
          brand: "SECRET-BRAND",
          model: "SECRET-MODEL",
          ean: "4548736162657"
        },
        extractionEvidence: ["ebay-browse:brand,model,ean"]
      },
      ebayLandedPrice: {amount: 1, currency: "EUR"},
      ebayLandedCostStatus: "shipping_unknown",
      warnings: [],
      providerStatus: [
        {
          provider: "ebay_market",
          state: "ok",
          latencyMs: 123,
          reviewCandidates: [
            {productTitle: "SECRET REVIEW PRODUCT"}
          ]
        },
        {
          provider: "amazon",
          state: "no_match",
          latencyMs: 90
        }
      ],
      offers: [
        {
          provider: "ebay_market",
          merchant: "SECRET-SELLER",
          url: "https://www.ebay.pl/itm/987654321012",
          providerProductId: "SECRET-PRODUCT-ID",
          landedPriceComplete: true,
          landedPrice: {amount: 400, currency: "PLN"},
          comparisonLandedPrice: {amount: 91.4, currency: "EUR"},
          fx: {source: "ecb_reference"}
        }
      ]
    }
  });

  assert.deepEqual(report.comparison.identityPresence, {
    brand: true,
    model: true,
    mpn: false,
    gtin: false,
    ean: true,
    upc: false,
    epid: false
  });
  assert.equal(report.comparison.acceptedOfferCount, 1);
  assert.equal(report.comparison.fxNormalizedOfferCount, 1);
  assert.equal(report.comparison.foreignCurrencyCompleteOfferCount, 1);
  assert.deepEqual(report.comparison.offersByProvider, {ebay_market: 1});
  assert.deepEqual(report.comparison.providerStates.ebay_market, {
    state: "ok",
    latencyMs: 123,
    reviewCandidateCount: 1
  });

  const serialized = JSON.stringify(report);
  for (const secret of [
    "SECRET-REQUEST-ID",
    "SECRET PRODUCT TITLE",
    "SECRET-BRAND",
    "SECRET-MODEL",
    "4548736162657",
    "SECRET REVIEW PRODUCT",
    "SECRET-SELLER",
    "SECRET-PRODUCT-ID",
    "987654321012"
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("evaluates configured provider requirements without exposing source payloads", () => {
  const report = {
    configuration: {
      ebayEnrichment: true,
      fx: true,
      providers: {
        ebay_market: true,
        amazon: true
      }
    },
    comparison: {
      ebayBrowseEvidence: true,
      enrichmentFallback: false,
      foreignCurrencyCompleteOfferCount: 1,
      fxNormalizedOfferCount: 1,
      providerStates: {
        ebay_market: {state: "ok"},
        amazon: {state: "no_match"}
      }
    }
  };

  assert.deepEqual(
    evaluateRequirements(report, [
      "ebay_enrichment",
      "ebay_market",
      "amazon",
      "fx"
    ]),
    {
      ebay_enrichment: "pass",
      ebay_market: "pass",
      amazon: "pass",
      fx: "pass"
    }
  );
});

test("runs the end-to-end live check and sends optional session auth without printing it", async () => {
  const calls = [];
  const sessionToken = "SESSION-TOKEN-DO-NOT-PRINT";

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({
      path: url.pathname,
      headers: new Headers(init.headers),
      body: init.body
    });

    if (url.pathname === "/ready") {
      return jsonResponse({status: "ready"});
    }
    if (url.pathname === "/health") {
      return jsonResponse({
        status: "ok",
        enrichment: {ebay: "configured", fx: "unconfigured"},
        providers: {
          ebay_market: "configured",
          amazon: "unconfigured"
        }
      });
    }
    if (url.pathname === "/v1/compare") {
      return jsonResponse({
        requestId: "hidden-request-id",
        listing: {
          identity: {brand: "Sony", model: "WH-1000XM6", ean: "4548736162657"},
          extractionEvidence: ["ebay-browse:brand,model,ean"]
        },
        ebayLandedPrice: {amount: 1, currency: "EUR"},
        ebayLandedCostStatus: "shipping_unknown",
        warnings: [],
        providerStatus: [
          {provider: "ebay_market", state: "no_match", latencyMs: 42}
        ],
        offers: []
      });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };

  const report = await runProviderLiveCheck({
    origin: "http://127.0.0.1:8787",
    itemId: "123456789012",
    postalCode: "30159",
    required: ["ebay_enrichment", "ebay_market"],
    sessionToken,
    fetchImpl,
    now: () => new Date("2026-10-04T13:00:00.000Z")
  });

  assert.equal(calls.length, 3);
  assert.equal(
    calls[2].headers.get("authorization"),
    `Bearer ${sessionToken}`
  );
  assert.equal(
    JSON.parse(calls[2].body).destination.postalCode,
    "30159"
  );
  assert.deepEqual(report.requirements, {
    ebay_enrichment: "pass",
    ebay_market: "pass"
  });
  assert.equal(JSON.stringify(report).includes(sessionToken), false);
  assert.equal(JSON.stringify(report).includes("4548736162657"), false);
});

test("fails when an explicitly required provider is not healthy", async () => {
  const fetchImpl = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/ready") return jsonResponse({status: "ready"});
    if (path === "/health") {
      return jsonResponse({
        status: "ok",
        enrichment: {ebay: "configured", fx: "unconfigured"},
        providers: {ebay_market: "configured"}
      });
    }
    return jsonResponse({
      requestId: "hidden",
      listing: {
        identity: {ean: "4548736162657"},
        extractionEvidence: ["ebay-browse:ean"]
      },
      ebayLandedPrice: {amount: 1, currency: "EUR"},
      warnings: [],
      providerStatus: [
        {provider: "ebay_market", state: "error", latencyMs: 10}
      ],
      offers: []
    });
  };

  await assert.rejects(
    () =>
      runProviderLiveCheck({
        origin: "http://localhost:8787",
        itemId: "123456789012",
        required: ["ebay_market"],
        fetchImpl
      }),
    /requirements failed: ebay_market/
  );
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"content-type": "application/json"}
  });
}
