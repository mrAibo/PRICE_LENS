import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import {extractEbayItemId, extractEbayListing} from "../src/ebay/extract.js";

describe("eBay item id", () => {
  it("extracts ids from short and titled item URLs", () => {
    expect(extractEbayItemId("https://www.ebay.de/itm/123456789012")).toBe("123456789012");
    expect(
      extractEbayItemId("https://www.ebay.de/itm/Apple-iPhone-16-Pro/123456789012?hash=x")
    ).toBe("123456789012");
  });
});

describe("eBay listing extraction", () => {
  it("prefers Product JSON-LD", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"Sony WH-1000XM6",
        "brand":{"@type":"Brand","name":"Sony"},
        "model":"WH-1000XM6",
        "mpn":"WH1000XM6B",
        "gtin13":"4548736162657",
        "image":"https://example.test/image.jpg",
        "offers":{
          "@type":"Offer",
          "price":"399.99",
          "priceCurrency":"EUR",
          "itemCondition":"https://schema.org/NewCondition"
        }
      }
      </script>
      </head><body><h1>Fallback title</h1></body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/Sony-WH-1000XM6/123456789012?foo=bar"
    );

    expect(listing?.itemId).toBe("123456789012");
    expect(listing?.title).toBe("Sony WH-1000XM6");
    expect(listing?.price).toEqual({amount: 399.99, currency: "EUR"});
    expect(listing?.condition).toBe("new");
    expect(listing?.identity).toEqual({
      brand: "Sony",
      model: "WH-1000XM6",
      mpn: "WH1000XM6B",
      gtin: "4548736162657"
    });
  });

  it("falls back to meta title and localized DOM price", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
      <meta property="og:title" content="Example Camera">
      </head><body>
      <div data-testid="x-price-primary">EUR 1.249,90</div>
      </body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing?.title).toBe("Example Camera");
    expect(listing?.price).toEqual({amount: 1249.9, currency: "EUR"});
    expect(listing?.condition).toBe("unknown");
    expect(listing?.extractionWarnings).toContain(
      "No strong product identifier was found on the page."
    );
  });
});
