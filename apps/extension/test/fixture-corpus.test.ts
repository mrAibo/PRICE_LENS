import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {extractEbayListing} from "../src/ebay/extract.js";
import {
  EBAY_EXTRACTION_FIXTURES,
  type FixtureField,
  type FixtureValue
} from "./fixtures/ebay-corpus.js";

describe("labelled eBay extraction corpus", () => {
  for (const fixture of EBAY_EXTRACTION_FIXTURES) {
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

  it("maintains a minimum evidence gate instead of silently shrinking the corpus", () => {
    const labelledFieldCount = EBAY_EXTRACTION_FIXTURES.reduce(
      (sum, fixture) => sum + Object.keys(fixture.expected).length,
      0
    );

    expect(EBAY_EXTRACTION_FIXTURES.length).toBeGreaterThanOrEqual(9);
    expect(labelledFieldCount).toBeGreaterThanOrEqual(70);
  });
});

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
