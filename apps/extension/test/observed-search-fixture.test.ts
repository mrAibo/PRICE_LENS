import {readdirSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import type {EcommerceListing, ListingCondition} from "@price-lens/contracts";
import {extractEbaySearchCard} from "../src/search-results.js";

type SearchFixtureField =
  | "itemId"
  | "title"
  | "price.amount"
  | "price.currency"
  | "shipping.amount"
  | "shipping.currency"
  | "condition";

type SearchFixtureValue = string | number | null;

interface ExpectedSearchCard {
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

interface ObservedSearchFixture {
  schemaVersion: 1;
  id: string;
  description: string;
  source: {
    kind: "observed-search";
    marketplace: "ebay.de";
    capturedAt: string;
    sourceUrlSha256: string;
    layoutClass: string;
    capturedCardCount: number;
  };
  reviewed: boolean;
  reviewNote?: string;
  url: string;
  html: string;
  expectedCards: ExpectedSearchCard[];
}

const observedDir = fileURLToPath(
  new URL("./fixtures/observed-search/", import.meta.url)
);
const fixtures = loadFixtures();

describe("observed eBay.de search-layout fixtures", () => {
  it("keeps fixtures anonymized, reduced and review-gated", () => {
    for (const fixture of fixtures) {
      expect(fixture.schemaVersion).toBe(1);
      expect(fixture.source.kind).toBe("observed-search");
      expect(fixture.source.marketplace).toBe("ebay.de");
      expect(fixture.source.sourceUrlSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.source.capturedCardCount).toBe(fixture.expectedCards.length);
      expect(fixture.url).toBe(
        "https://www.ebay.de/sch/i.html?_nkw=pricelens-fixture"
      );
      expect(fixture.html).not.toMatch(
        /seller|verk[aä]ufer|mitgliedsname|username|email|konto|account/i
      );
      expect(fixture.html).not.toMatch(/<img\b/i);
      expect(fixture.html).not.toMatch(/[?&](hash|campid|mkcid|mkrid)=/i);
      expect(fixture.html).toMatch(/https:\/\/www\.ebay\.de\/itm\/\d{9,15}/);
    }
  });

  for (const fixture of fixtures.filter((entry) => entry.reviewed)) {
    it(`${fixture.id}: independently reviewed search extraction`, () => {
      const dom = new JSDOM(fixture.html, {url: fixture.url});
      const cards = [...dom.window.document.querySelectorAll(".s-item")];
      expect(cards).toHaveLength(fixture.expectedCards.length);

      for (const expected of fixture.expectedCards) {
        const card = cards[expected.cardIndex];
        expect(card, `fixture=${fixture.id} card=${expected.cardIndex}`).toBeDefined();
        const listing = card ? extractEbaySearchCard(card) : undefined;

        expect(
          listing !== undefined,
          `fixture=${fixture.id} card=${expected.cardIndex} supported`
        ).toBe(expected.supported);

        if (!expected.supported) continue;
        expect(listing).toBeDefined();

        for (const [field, value] of Object.entries(expected)) {
          if (field === "cardIndex" || field === "supported") continue;
          expect(
            readSearchField(listing, field as SearchFixtureField),
            `fixture=${fixture.id} card=${expected.cardIndex} field=${field}`
          ).toEqual(value as SearchFixtureValue);
        }
      }
    });
  }
});

function loadFixtures(): ObservedSearchFixture[] {
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
        readFileSync(
          new URL(`./fixtures/observed-search/${name}`, import.meta.url),
          "utf8"
        )
      ) as ObservedSearchFixture
    );
}

function readSearchField(
  listing: EcommerceListing | undefined,
  field: SearchFixtureField
): SearchFixtureValue {
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
