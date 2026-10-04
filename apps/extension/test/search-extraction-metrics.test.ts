import {readdirSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import type {EcommerceListing, ListingCondition} from "@price-lens/contracts";
import {extractEbaySearchCard} from "../src/search-results.js";

type Field =
  | "itemId"
  | "title"
  | "price.amount"
  | "price.currency"
  | "shipping.amount"
  | "shipping.currency"
  | "condition";

type Value = string | number | null;

interface ExpectedCard {
  cardIndex: number;
  supported: boolean;
  itemId?: string;
  title?: string;
  "price.amount"?: number;
  "price.currency"?: string;
  "shipping.amount"?: number | null;
  "shipping.currency"?: string | null;
  condition?: ListingCondition;
}

interface Fixture {
  reviewed: boolean;
  url: string;
  html: string;
  expectedCards: ExpectedCard[];
}

interface Metric {
  labelled: number;
  passed: number;
}

const observedDir = fileURLToPath(
  new URL("./fixtures/observed-search/", import.meta.url)
);

describe("eBay search-card extraction evidence metrics", () => {
  it("reports independently reviewed observed search-layout accuracy", () => {
    const fixtures = loadFixtures().filter((fixture) => fixture.reviewed);
    const metrics = new Map<string, Metric>();

    for (const fixture of fixtures) {
      const dom = new JSDOM(fixture.html, {url: fixture.url});
      const cards = [...dom.window.document.querySelectorAll(".s-item")];

      for (const expected of fixture.expectedCards) {
        const listing = cards[expected.cardIndex]
          ? extractEbaySearchCard(cards[expected.cardIndex]!)
          : undefined;
        record(metrics, "supported", listing !== undefined, expected.supported);

        if (!expected.supported) continue;
        for (const [field, value] of Object.entries(expected)) {
          if (field === "cardIndex" || field === "supported") continue;
          record(
            metrics,
            family(field as Field),
            readField(listing, field as Field),
            value as Value
          );
        }
      }
    }

    const total = totalMetric(metrics);
    console.log("\nPriceLens search-layout evidence: observed-reviewed");
    console.log(
      `fixtures=${fixtures.length} labelled=${total.labelled} passed=${total.passed}`
    );
    console.log("| field family | passed | labelled | exact accuracy |");
    console.log("| --- | ---: | ---: | ---: |");
    for (const name of ["supported", "listing", "price", "shipping", "condition"]) {
      const metric = metrics.get(name) ?? {labelled: 0, passed: 0};
      const accuracy = metric.labelled === 0
        ? "n/a"
        : `${((metric.passed / metric.labelled) * 100).toFixed(1)}%`;
      console.log(
        `| ${name} | ${metric.passed} | ${metric.labelled} | ${accuracy} |`
      );
    }

    expect(total.passed).toBe(total.labelled);
  });
});

function loadFixtures(): Fixture[] {
  let names: string[] = [];
  try {
    names = readdirSync(observedDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return names.sort().map((name) =>
    JSON.parse(
      readFileSync(
        new URL(`./fixtures/observed-search/${name}`, import.meta.url),
        "utf8"
      )
    ) as Fixture
  );
}

function record(
  metrics: Map<string, Metric>,
  name: string,
  actual: unknown,
  expected: unknown
): void {
  const metric = metrics.get(name) ?? {labelled: 0, passed: 0};
  metric.labelled += 1;
  if (Object.is(actual, expected)) metric.passed += 1;
  metrics.set(name, metric);
}

function family(field: Field): string {
  if (field.startsWith("price.")) return "price";
  if (field.startsWith("shipping.")) return "shipping";
  if (field === "condition") return "condition";
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

function readField(
  listing: EcommerceListing | undefined,
  field: Field
): Value {
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
  }
}
