import {readdirSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {extractEbayListing} from "../src/ebay/extract.js";
import type {
  FixtureField,
  FixtureValue
} from "./fixtures/ebay-corpus.js";

interface ObservedFixture {
  schemaVersion: 1;
  id: string;
  description: string;
  source: {
    kind: "observed";
    marketplace: "ebay.de";
    capturedAt: string;
    sourceUrlSha256: string;
    layoutClass: string;
  };
  reviewed: boolean;
  reviewNote?: string;
  url: string;
  html: string;
  expected: Partial<Record<FixtureField, FixtureValue>>;
}

const observedDir = fileURLToPath(
  new URL("./fixtures/observed/", import.meta.url)
);

const fixtures = loadObservedFixtures();

describe("observed eBay.de extraction fixtures", () => {
  it("keeps observed fixtures anonymized and review-gated", () => {
    for (const fixture of fixtures) {
      expect(fixture.schemaVersion).toBe(1);
      expect(fixture.source.kind).toBe("observed");
      expect(fixture.source.marketplace).toBe("ebay.de");
      expect(fixture.source.sourceUrlSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.url).toMatch(/^https:\/\/www\.ebay\.de\/itm\/\d{9,15}$/);
      expect(fixture.url).not.toContain("?");
      // Generic eBay copy such as "contact the seller" is not identifying.
      // Reject account-identifying fields/markup instead.
      expect(fixture.html).not.toMatch(
        /mitgliedsname|username|seller[-_ ]?(?:name|id|account|profile)|verk[aä]ufer(?:name|konto|profil)/i
      );

      const syntheticItemId = fixture.url.match(/\/itm\/(\d{9,15})$/)?.[1];
      expect(syntheticItemId).toBeTruthy();
      for (const match of fixture.html.matchAll(
        /(?:\/itm\/|item_id=)(\d{9,15})/g
      )) {
        expect(match[1]).toBe(syntheticItemId);
      }
    }
  });

  for (const fixture of fixtures.filter((entry) => entry.reviewed)) {
    it(`${fixture.id}: ${fixture.description}`, () => {
      const dom = new JSDOM(fixture.html, {url: fixture.url});
      const listing = extractEbayListing(dom.window.document, fixture.url);

      for (const [field, expected] of Object.entries(fixture.expected) as Array<
        [FixtureField, FixtureValue]
      >) {
        expect(
          readFixtureField(listing, field),
          `fixture=${fixture.id} field=${field}`
        ).toEqual(expected);
      }
    });
  }
});

function loadObservedFixtures(): ObservedFixture[] {
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
