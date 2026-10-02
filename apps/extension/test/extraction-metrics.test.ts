import {readdirSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {extractEbayListing} from "../src/ebay/extract.js";
import {
  EBAY_EXTRACTION_FIXTURES,
  type EbayExtractionFixture,
  type FixtureField,
  type FixtureValue
} from "./fixtures/ebay-corpus.js";

interface ObservedFixture extends EbayExtractionFixture {
  schemaVersion: 1;
  source: {
    kind: "observed";
    marketplace: "ebay.de";
    capturedAt: string;
    sourceUrlSha256: string;
    layoutClass: string;
  };
  reviewed: boolean;
}

interface Metric {
  labelled: number;
  passed: number;
}

describe("eBay extraction field metrics", () => {
  it("reports synthetic and independently reviewed observed metrics", () => {
    const observed = loadObservedFixtures().filter((fixture) => fixture.reviewed);

    const syntheticMetrics = evaluateCorpus(EBAY_EXTRACTION_FIXTURES);
    const observedMetrics = evaluateCorpus(observed);

    printMetrics("synthetic-regression", EBAY_EXTRACTION_FIXTURES.length, syntheticMetrics);
    printMetrics("observed-reviewed", observed.length, observedMetrics);

    const syntheticTotal = totalMetric(syntheticMetrics);
    expect(syntheticTotal.labelled).toBeGreaterThanOrEqual(70);
    expect(syntheticTotal.passed).toBe(syntheticTotal.labelled);

    const observedTotal = totalMetric(observedMetrics);
    expect(observedTotal.passed).toBe(observedTotal.labelled);
  });
});

function evaluateCorpus(fixtures: EbayExtractionFixture[]): Map<string, Metric> {
  const metrics = new Map<string, Metric>();

  for (const fixture of fixtures) {
    const dom = new JSDOM(fixture.html, {url: fixture.url});
    const listing = extractEbayListing(dom.window.document, fixture.url);

    for (const [field, expected] of Object.entries(fixture.expected) as Array<
      [FixtureField, FixtureValue]
    >) {
      const family = fieldFamily(field);
      const metric = metrics.get(family) ?? {labelled: 0, passed: 0};
      metric.labelled += 1;
      if (Object.is(readFixtureField(listing, field), expected)) {
        metric.passed += 1;
      }
      metrics.set(family, metric);
    }
  }

  return metrics;
}

function loadObservedFixtures(): ObservedFixture[] {
  const observedDir = fileURLToPath(
    new URL("./fixtures/observed/", import.meta.url)
  );

  let names: string[] = [];
  try {
    names = readdirSync(observedDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  return names
    .sort()
    .map((name) =>
      JSON.parse(
        readFileSync(new URL(`./fixtures/observed/${name}`, import.meta.url), "utf8")
      ) as ObservedFixture
    );
}

function fieldFamily(field: FixtureField): string {
  if (field === "supported") return "supported";
  if (field.startsWith("price.")) return "price";
  if (field.startsWith("shipping.")) return "shipping";
  if (field === "condition") return "condition";
  if (field.startsWith("identity.variant.")) return "variant";
  if (field.startsWith("identity.")) return "identity";
  return "listing";
}

function totalMetric(metrics: Map<string, Metric>): Metric {
  let labelled = 0;
  let passed = 0;
  for (const metric of metrics.values()) {
    labelled += metric.labelled;
    passed += metric.passed;
  }
  return {labelled, passed};
}

function printMetrics(
  corpus: string,
  fixtureCount: number,
  metrics: Map<string, Metric>
): void {
  const total = totalMetric(metrics);
  console.log(`\nPriceLens extraction metrics: ${corpus}`);
  console.log(`fixtures=${fixtureCount} labelled=${total.labelled} passed=${total.passed}`);
  console.log("| field family | passed | labelled | exact accuracy |");
  console.log("| --- | ---: | ---: | ---: |");

  for (const family of [
    "supported",
    "listing",
    "price",
    "shipping",
    "condition",
    "identity",
    "variant"
  ]) {
    const metric = metrics.get(family) ?? {labelled: 0, passed: 0};
    const accuracy =
      metric.labelled === 0
        ? "n/a"
        : `${((metric.passed / metric.labelled) * 100).toFixed(1)}%`;
    console.log(
      `| ${family} | ${metric.passed} | ${metric.labelled} | ${accuracy} |`
    );
  }
}

function readFixtureField(
  listing: EcommerceListing | null,
  field: FixtureField
): FixtureValue {
  if (field === "supported") return listing !== null;
  if (!listing) return null;

  switch (field) {
    case "itemId":
      return listing.itemId;
    case "title":
      return listing.title;
    case "price.amount":
      return listing.price.amount;
    case "price.currency":
      return listing.price.currency;
    case "shipping.amount":
      return listing.shipping?.amount ?? null;
    case "shipping.currency":
      return listing.shipping?.currency ?? null;
    case "condition":
      return listing.condition;
    case "identity.brand":
      return listing.identity.brand ?? null;
    case "identity.model":
      return listing.identity.model ?? null;
    case "identity.mpn":
      return listing.identity.mpn ?? null;
    case "identity.gtin":
      return listing.identity.gtin ?? null;
    case "identity.ean":
      return listing.identity.ean ?? null;
    case "identity.upc":
      return listing.identity.upc ?? null;
    case "identity.variant.storageGb":
      return listing.identity.variant?.storageGb ?? null;
    case "identity.variant.ramGb":
      return listing.identity.variant?.ramGb ?? null;
    case "identity.variant.screenSizeInches":
      return listing.identity.variant?.screenSizeInches ?? null;
    case "identity.variant.packCount":
      return listing.identity.variant?.packCount ?? null;
  }
}
