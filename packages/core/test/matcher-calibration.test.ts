import {describe, expect, it} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {
  evaluateProviderCandidate,
  PRICE_LENS_MATCH_THRESHOLDS,
  type PriceLensMatchDecision,
  type ProviderCandidate
} from "../src/index.js";

interface CalibrationCase {
  id: string;
  expected: PriceLensMatchDecision;
  listing: EcommerceListing;
  candidate: ProviderCandidate;
}

const BASE_LISTING: EcommerceListing = {
  source: "ebay",
  itemId: "900000000001",
  url: "https://www.ebay.de/itm/900000000001",
  title: "ExampleTech Pro 15",
  price: {amount: 999, currency: "EUR"},
  shipping: {amount: 0, currency: "EUR"},
  condition: "new",
  identity: {
    brand: "ExampleTech",
    model: "Pro 15"
  },
  extractionEvidence: ["calibration"],
  extractionWarnings: []
};

function providerCandidate(
  overrides: Partial<ProviderCandidate> = {}
): ProviderCandidate {
  return {
    provider: "idealo",
    providerProductId: "calibration-candidate",
    productTitle: "ExampleTech Pro 15",
    url: "https://example.test/calibration",
    condition: "new",
    identity: {
      brand: "ExampleTech",
      model: "Pro 15"
    },
    itemPrice: {amount: 949, currency: "EUR"},
    shipping: {amount: 0, currency: "EUR"},
    fetchedAt: "2026-10-02T00:00:00Z",
    ...overrides
  };
}

const RICH_VARIANT = {
  storageGb: 1000,
  ramGb: 16,
  screenSizeInches: 15.6
};

const CASES: CalibrationCase[] = [
  {
    id: "rich-structured-same-product",
    expected: "auto_match",
    listing: {
      ...BASE_LISTING,
      identity: {...BASE_LISTING.identity, variant: RICH_VARIANT}
    },
    candidate: providerCandidate({
      identity: {
        brand: "ExampleTech",
        model: "Pro 15",
        variant: RICH_VARIANT
      }
    })
  },
  {
    id: "exact-gtin",
    expected: "auto_match",
    listing: {
      ...BASE_LISTING,
      identity: {...BASE_LISTING.identity, gtin: "4006381333931"}
    },
    candidate: providerCandidate({
      identity: {
        brand: "ExampleTech",
        model: "Pro 15",
        ean: "4006381333931"
      }
    })
  },
  {
    id: "exact-brand-mpn",
    expected: "auto_match",
    listing: {
      ...BASE_LISTING,
      identity: {...BASE_LISTING.identity, mpn: "PRO15-A"}
    },
    candidate: providerCandidate({
      identity: {
        brand: "ExampleTech",
        model: "Pro 15",
        mpn: "PRO15-A"
      }
    })
  },
  {
    id: "same-product-insufficient-structure",
    expected: "review",
    listing: BASE_LISTING,
    candidate: providerCandidate()
  },
  {
    id: "condition-conflict",
    expected: "reject",
    listing: BASE_LISTING,
    candidate: providerCandidate({condition: "used"})
  },
  {
    id: "storage-conflict",
    expected: "reject",
    listing: {
      ...BASE_LISTING,
      identity: {
        ...BASE_LISTING.identity,
        variant: {...RICH_VARIANT, storageGb: 512}
      }
    },
    candidate: providerCandidate({
      identity: {
        brand: "ExampleTech",
        model: "Pro 15",
        variant: RICH_VARIANT
      }
    })
  },
  {
    id: "edition-conflict",
    expected: "reject",
    listing: {
      ...BASE_LISTING,
      title: "PlayStation 5 Digital Edition",
      identity: {brand: "Sony", model: "PlayStation 5"}
    },
    candidate: providerCandidate({
      productTitle: "PlayStation 5 Disc Edition",
      identity: {brand: "Sony", model: "PlayStation 5"}
    })
  },
  {
    id: "bundle-conflict",
    expected: "reject",
    listing: {
      ...BASE_LISTING,
      title: "Canon EOS R6 Body Only",
      identity: {brand: "Canon", model: "EOS R6"}
    },
    candidate: providerCandidate({
      productTitle: "Canon EOS R6 24-105 Kit",
      identity: {brand: "Canon", model: "EOS R6"}
    })
  },
  {
    id: "model-qualifier-conflict",
    expected: "reject",
    listing: {
      ...BASE_LISTING,
      title: "Apple iPhone 16 Pro",
      identity: {brand: "Apple", model: "iPhone 16 Pro"}
    },
    candidate: providerCandidate({
      productTitle: "Apple iPhone 16 Pro Max",
      identity: {brand: "Apple", model: "iPhone 16 Pro Max"}
    })
  },
  {
    id: "model-generation-conflict",
    expected: "reject",
    listing: {
      ...BASE_LISTING,
      title: "Sony WH-1000XM6",
      identity: {brand: "Sony", model: "WH-1000XM6"}
    },
    candidate: providerCandidate({
      productTitle: "Sony WH-1000XM5",
      identity: {brand: "Sony", model: "WH-1000XM5"}
    })
  },
  {
    id: "unrelated-same-brand",
    expected: "reject",
    listing: {
      ...BASE_LISTING,
      title: "Sony WH-1000XM6",
      identity: {brand: "Sony", model: "WH-1000XM6"}
    },
    candidate: providerCandidate({
      productTitle: "Sony Alpha 7 IV Camera",
      identity: {brand: "Sony", model: "Alpha 7 IV"}
    })
  }
];

describe("PriceLens matcher calibration corpus", () => {
  for (const calibration of CASES) {
    it(`${calibration.id} -> ${calibration.expected}`, () => {
      const actual = evaluateProviderCandidate(
        calibration.listing,
        calibration.candidate
      );

      expect(actual.decision).toBe(calibration.expected);
    });
  }

  it("keeps the documented 0.90 / 0.70 policy measurable", () => {
    const results = CASES.map((calibration) => ({
      ...calibration,
      result: evaluateProviderCandidate(calibration.listing, calibration.candidate)
    }));

    const falseAutomaticMatches = results.filter(
      (entry) =>
        entry.result.decision === "auto_match" &&
        entry.expected !== "auto_match"
    );
    const expectedAutomatic = results.filter(
      (entry) => entry.expected === "auto_match"
    );
    const automaticCorrect = expectedAutomatic.filter(
      (entry) => entry.result.decision === "auto_match"
    );
    const decisionCorrect = results.filter(
      (entry) => entry.result.decision === entry.expected
    );

    console.log("\nPriceLens matcher calibration");
    console.log(
      `thresholds auto=${PRICE_LENS_MATCH_THRESHOLDS.autoMatch} review=${PRICE_LENS_MATCH_THRESHOLDS.review}`
    );
    console.log(
      `cases=${results.length} correct=${decisionCorrect.length} false_auto=${falseAutomaticMatches.length}`
    );
    console.log(
      `auto_recall=${automaticCorrect.length}/${expectedAutomatic.length}`
    );
    for (const entry of results) {
      console.log(
        `${entry.id}: expected=${entry.expected} actual=${entry.result.decision} confidence=${entry.result.confidence.toFixed(3)} reason=${entry.result.reason}`
      );
    }

    expect(PRICE_LENS_MATCH_THRESHOLDS).toEqual({
      autoMatch: 0.9,
      review: 0.7
    });
    expect(falseAutomaticMatches).toHaveLength(0);
    expect(decisionCorrect).toHaveLength(results.length);
  });
});
