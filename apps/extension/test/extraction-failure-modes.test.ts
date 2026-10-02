import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import {extractEbayListing} from "../src/ebay/extract.js";

const itemUrl = "https://www.ebay.de/itm/123456789012";

describe("eBay extraction failure-mode contract", () => {
  it("ignores malformed JSON-LD and falls back to current DOM data", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <script type="application/ld+json">{"@type":"Product", broken</script>
        <meta property="og:title" content="DOM Fallback Product">
      </head><body>
        <div data-testid="x-price-primary">EUR 199,90</div>
      </body></html>
    `);

    const listing = extractEbayListing(dom.window.document, itemUrl);

    expect(listing).toMatchObject({
      title: "DOM Fallback Product",
      price: {amount: 199.9, currency: "EUR"}
    });
    expect(listing?.extractionEvidence).toContain("dom:primary-price");
  });

  it("finds Product data nested inside a JSON-LD @graph", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <script type="application/ld+json">
        {
          "@context":"https://schema.org",
          "@graph":[
            {"@type":"WebPage","name":"Page"},
            {
              "@type":"Product",
              "name":"Graph Product",
              "brand":{"@type":"Brand","name":"GraphBrand"},
              "gtin13":"4006381333931",
              "offers":{
                "@type":"Offer",
                "price":"249.00",
                "priceCurrency":"EUR"
              }
            }
          ]
        }
        </script>
      </head><body></body></html>
    `);

    const listing = extractEbayListing(dom.window.document, itemUrl);

    expect(listing).toMatchObject({
      title: "Graph Product",
      price: {amount: 249, currency: "EUR"},
      identity: {
        brand: "GraphBrand",
        gtin: "4006381333931"
      }
    });
    expect(listing?.extractionEvidence).toContain("jsonld:Product.name");
  });

  it("returns unsupported when no eBay item id can be established", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Product">
      </head><body>
        <div class="x-price-primary">EUR 10,00</div>
      </body></html>
    `);

    expect(
      extractEbayListing(dom.window.document, "https://www.ebay.de/sch/i.html")
    ).toBeNull();
  });

  it("returns unsupported when every title source is missing", () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <div data-testid="x-price-primary">EUR 10,00</div>
      </body></html>
    `);

    expect(extractEbayListing(dom.window.document, itemUrl)).toBeNull();
  });

  it("returns unsupported when every current price source is missing", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Price-less Product">
      </head><body></body></html>
    `);

    expect(extractEbayListing(dom.window.document, itemUrl)).toBeNull();
  });

  it("keeps the listing supported but shipping unknown when structured rates conflict", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <script type="application/ld+json">
        {
          "@context":"https://schema.org",
          "@type":"Product",
          "name":"Ambiguous Shipping Product",
          "offers":{
            "@type":"Offer",
            "price":"100.00",
            "priceCurrency":"EUR",
            "shippingDetails":[
              {"shippingRate":{"value":"4.99","currency":"EUR"}},
              {"shippingRate":{"value":"9.99","currency":"EUR"}}
            ]
          }
        }
        </script>
      </head><body></body></html>
    `);

    const listing = extractEbayListing(dom.window.document, itemUrl);

    expect(listing).not.toBeNull();
    expect(listing?.shipping).toBeUndefined();
    expect(listing?.price).toEqual({amount: 100, currency: "EUR"});
  });

  it("does not convert an invalid strong identifier into product identity", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <script type="application/ld+json">
        {
          "@context":"https://schema.org",
          "@type":"Product",
          "name":"Invalid Identifier Product",
          "gtin13":"12345",
          "mpn":"N/A",
          "offers":{
            "@type":"Offer",
            "price":"59.00",
            "priceCurrency":"EUR"
          }
        }
        </script>
      </head><body></body></html>
    `);

    const listing = extractEbayListing(dom.window.document, itemUrl);

    expect(listing?.identity.gtin).toBeUndefined();
    expect(listing?.identity.mpn).toBeUndefined();
    expect(listing?.extractionWarnings).toContain(
      "No strong product identifier was found on the page."
    );
  });
});
