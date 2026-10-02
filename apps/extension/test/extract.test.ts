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
  it("prefers Product JSON-LD and reads destination-specific shipping", () => {
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
          "itemCondition":"https://schema.org/NewCondition",
          "shippingDetails":[
            {
              "@type":"OfferShippingDetails",
              "shippingRate":{"@type":"MonetaryAmount","value":"4.99","currency":"EUR"},
              "shippingDestination":{"@type":"DefinedRegion","addressCountry":"DE"}
            },
            {
              "@type":"OfferShippingDetails",
              "shippingRate":{"@type":"MonetaryAmount","value":"19.99","currency":"EUR"},
              "shippingDestination":{"@type":"DefinedRegion","addressCountry":"US"}
            }
          ]
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
    expect(listing?.shipping).toEqual({amount: 4.99, currency: "EUR"});
    expect(listing?.condition).toBe("new");
    expect(listing?.identity).toEqual({
      brand: "Sony",
      model: "WH-1000XM6",
      mpn: "WH1000XM6B",
      gtin: "4548736162657"
    });
    expect(listing?.extractionEvidence).toContain("jsonld:Offer.shippingDetails");
  });

  it("falls back to the current DOM variant when JSON-LD offers disagree", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"Variant Product",
        "offers":[
          {
            "@type":"Offer",
            "price":"99.90",
            "priceCurrency":"EUR",
            "itemCondition":"https://schema.org/UsedCondition",
            "shippingDetails":{
              "@type":"OfferShippingDetails",
              "shippingRate":{"value":"0","currency":"EUR"},
              "shippingDestination":{"addressCountry":"DE"}
            }
          },
          {
            "@type":"Offer",
            "price":"129.90",
            "priceCurrency":"EUR",
            "itemCondition":"https://schema.org/NewCondition",
            "shippingDetails":{
              "@type":"OfferShippingDetails",
              "shippingRate":{"value":"19.99","currency":"EUR"},
              "shippingDestination":{"addressCountry":"DE"}
            }
          }
        ]
      }
      </script>
      </head><body>
        <div data-testid="x-price-primary">EUR 129,90</div>
        <div class="x-item-condition-text"><span class="ux-textspans">Neu</span></div>
        <dl class="ux-labels-values ux-labels-values--shipping">
          <dt class="ux-labels-values__labels"><span>Versand:</span></dt>
          <dd class="ux-labels-values__values"><span class="ux-textspans--BOLD">EUR 5,49</span></dd>
        </dl>
      </body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing?.price).toEqual({amount: 129.9, currency: "EUR"});
    expect(listing?.condition).toBe("new");
    expect(listing?.shipping).toEqual({amount: 5.49, currency: "EUR"});
    expect(listing?.extractionEvidence).toContain("dom:primary-price");
    expect(listing?.extractionEvidence).toContain("dom:condition");
    expect(listing?.extractionEvidence).toContain("dom:shipping");
    expect(listing?.extractionEvidence).not.toContain("jsonld:Product.offers.price");
    expect(listing?.extractionEvidence).not.toContain("jsonld:Offer.shippingDetails");
  });

  it("rejects a listing when variant JSON-LD prices disagree and no current price exists", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"Ambiguous Variant Product",
        "offers":[
          {"@type":"Offer","price":"99.90","priceCurrency":"EUR"},
          {"@type":"Offer","price":"129.90","priceCurrency":"EUR"}
        ]
      }
      </script>
      </head><body></body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing).toBeNull();
  });

  it("accepts equivalent prices repeated across structured offers", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"Equivalent Variant Product",
        "offers":[
          {
            "@type":"Offer",
            "price":"149.00",
            "priceCurrency":"EUR",
            "itemCondition":"https://schema.org/NewCondition"
          },
          {
            "@type":"Offer",
            "price":"149.00",
            "priceCurrency":"EUR",
            "itemCondition":"https://schema.org/NewCondition"
          }
        ]
      }
      </script>
      </head><body></body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing?.price).toEqual({amount: 149, currency: "EUR"});
    expect(listing?.condition).toBe("new");
    expect(listing?.extractionEvidence).toContain("jsonld:Product.offers.price");
    expect(listing?.extractionEvidence).toContain("structured:condition");
  });

  it("falls back to content attributes for price", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Example Camera">
      </head><body>
        <span itemprop="price" content="1249.90"></span>
        <span itemprop="priceCurrency" content="EUR"></span>
      </body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing?.price).toEqual({amount: 1249.9, currency: "EUR"});
    expect(listing?.extractionEvidence).toContain("content-attribute:price");
  });

  it("falls back to German DOM item specifics, condition and free shipping", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Example Camera">
      </head><body>
        <div data-testid="x-price-primary">EUR 1.249,90</div>
        <div class="x-item-condition-text"><span class="ux-textspans">Neu</span></div>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Marke:</span></dt>
          <dd class="ux-labels-values__values"><span>Sony</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Modell:</span></dt>
          <dd class="ux-labels-values__values"><span>Alpha 7 IV</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Herstellernummer:</span></dt>
          <dd class="ux-labels-values__values"><span>ILCE7M4/B</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>EAN:</span></dt>
          <dd class="ux-labels-values__values"><span>4548736133767</span></dd>
        </dl>
        <dl class="ux-labels-values ux-labels-values--shipping">
          <dt class="ux-labels-values__labels"><span>Versand:</span></dt>
          <dd class="ux-labels-values__values"><span class="ux-textspans--BOLD">Kostenloser Versand</span></dd>
        </dl>
      </body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing?.price).toEqual({amount: 1249.9, currency: "EUR"});
    expect(listing?.shipping).toEqual({amount: 0, currency: "EUR"});
    expect(listing?.condition).toBe("new");
    expect(listing?.identity).toEqual({
      brand: "Sony",
      model: "Alpha 7 IV",
      mpn: "ILCE7M4/B",
      ean: "4548736133767"
    });
    expect(
      listing?.extractionEvidence.some((value) => value.startsWith("dom:item-specifics:"))
    ).toBe(true);
    expect(listing?.extractionEvidence).toContain("dom:shipping");
  });

  it("extracts a paid DOM shipping price", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Example Product">
      </head><body>
        <div class="x-price-primary">EUR 99,90</div>
        <div class="ux-labels-values ux-labels-values--shipping">
          <div class="ux-labels-values__labels">Versand:</div>
          <div class="ux-labels-values__values"><span class="ux-textspans--BOLD">EUR 5,49</span></div>
        </div>
      </body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing?.shipping).toEqual({amount: 5.49, currency: "EUR"});
  });

  it("does not guess when structured shipping has multiple ambiguous rates", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"Example",
        "offers":{
          "@type":"Offer",
          "price":"100.00",
          "priceCurrency":"EUR",
          "shippingDetails":[
            {"@type":"OfferShippingDetails","shippingRate":{"value":"4.99","currency":"EUR"}},
            {"@type":"OfferShippingDetails","shippingRate":{"value":"9.99","currency":"EUR"}}
          ]
        }
      }
      </script>
      </head><body></body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing?.shipping).toBeUndefined();
  });

  it("rejects ambiguous DOM price ranges instead of using the first value", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Variable Product">
      </head><body>
        <div class="x-price-primary">EUR 99,90 bis EUR 129,90</div>
      </body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing).toBeNull();
  });

  it("ignores non-identifiers such as Nicht zutreffend", () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Generic Product">
      </head><body>
        <div class="x-price-primary">EUR 49,90</div>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels">EAN:</dt>
          <dd class="ux-labels-values__values">Nicht zutreffend</dd>
        </dl>
      </body></html>
    `);

    const listing = extractEbayListing(
      dom.window.document,
      "https://www.ebay.de/itm/123456789012"
    );

    expect(listing?.identity.ean).toBeUndefined();
    expect(listing?.extractionWarnings).toContain(
      "No strong product identifier was found on the page."
    );
  });
});
