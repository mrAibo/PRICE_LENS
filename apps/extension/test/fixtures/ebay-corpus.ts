import type {ListingCondition} from "@price-lens/contracts";

export type FixtureField =
  | "supported"
  | "itemId"
  | "title"
  | "price.amount"
  | "price.currency"
  | "shipping.amount"
  | "shipping.currency"
  | "condition"
  | "identity.brand"
  | "identity.model"
  | "identity.mpn"
  | "identity.gtin"
  | "identity.ean"
  | "identity.upc"
  | "identity.variant.storageGb"
  | "identity.variant.ramGb"
  | "identity.variant.screenSizeInches"
  | "identity.variant.packCount";

export type FixtureValue = string | number | boolean | null;

export interface EbayExtractionFixture {
  id: string;
  description: string;
  url: string;
  html: string;
  expected: Partial<Record<FixtureField, FixtureValue>>;
  expectedCondition?: ListingCondition;
}

export const EBAY_EXTRACTION_FIXTURES: EbayExtractionFixture[] = [
  {
    id: "jsonld-new-de-shipping",
    description: "Structured Product/Offer with German destination shipping and strong identifiers.",
    url: "https://www.ebay.de/itm/Sony-WH-1000XM6/123456789012?hash=fixture",
    html: `
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
          "offers":{
            "@type":"Offer",
            "price":"399.99",
            "priceCurrency":"EUR",
            "itemCondition":"https://schema.org/NewCondition",
            "shippingDetails":[
              {
                "@type":"OfferShippingDetails",
                "shippingRate":{"value":"4.99","currency":"EUR"},
                "shippingDestination":{"addressCountry":"DE"}
              },
              {
                "@type":"OfferShippingDetails",
                "shippingRate":{"value":"19.99","currency":"EUR"},
                "shippingDestination":{"addressCountry":"US"}
              }
            ]
          }
        }
        </script>
      </head><body><main></main></body></html>
    `,
    expected: {
      supported: true,
      itemId: "123456789012",
      title: "Sony WH-1000XM6",
      "price.amount": 399.99,
      "price.currency": "EUR",
      "shipping.amount": 4.99,
      "shipping.currency": "EUR",
      condition: "new",
      "identity.brand": "Sony",
      "identity.model": "WH-1000XM6",
      "identity.mpn": "WH1000XM6B",
      "identity.gtin": "4548736162657"
    }
  },
  {
    id: "dom-german-variants-free-shipping",
    description: "German DOM fallbacks with identity and explicit structured variant item specifics.",
    url: "https://www.ebay.de/itm/987654321098",
    html: `
      <!doctype html><html><head>
        <meta property="og:title" content="Notebook Pro 15">
      </head><body>
        <div data-testid="x-price-primary">EUR 1.249,90</div>
        <div class="x-item-condition-text"><span class="ux-textspans">Neu</span></div>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Marke:</span></dt>
          <dd class="ux-labels-values__values"><span>ExampleTech</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Modell:</span></dt>
          <dd class="ux-labels-values__values"><span>Pro 15</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Herstellernummer:</span></dt>
          <dd class="ux-labels-values__values"><span>PRO15-16-1TB</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>EAN:</span></dt>
          <dd class="ux-labels-values__values"><span>4006381333931</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Speicherkapazität:</span></dt>
          <dd class="ux-labels-values__values"><span>1 TB</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Arbeitsspeicher:</span></dt>
          <dd class="ux-labels-values__values"><span>16 GB</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Bildschirmgröße:</span></dt>
          <dd class="ux-labels-values__values"><span>15,6 Zoll</span></dd>
        </dl>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Anzahl pro Packung:</span></dt>
          <dd class="ux-labels-values__values"><span>1 Stück</span></dd>
        </dl>
        <dl class="ux-labels-values ux-labels-values--shipping">
          <dt class="ux-labels-values__labels"><span>Versand:</span></dt>
          <dd class="ux-labels-values__values"><span class="ux-textspans--BOLD">Kostenloser Versand</span></dd>
        </dl>
      </body></html>
    `,
    expected: {
      supported: true,
      itemId: "987654321098",
      title: "Notebook Pro 15",
      "price.amount": 1249.9,
      "price.currency": "EUR",
      "shipping.amount": 0,
      "shipping.currency": "EUR",
      condition: "new",
      "identity.brand": "ExampleTech",
      "identity.model": "Pro 15",
      "identity.mpn": "PRO15-16-1TB",
      "identity.ean": "4006381333931",
      "identity.variant.storageGb": 1000,
      "identity.variant.ramGb": 16,
      "identity.variant.screenSizeInches": 15.6,
      "identity.variant.packCount": 1
    }
  },
  {
    id: "content-price-minimal-identity",
    description: "Content-attribute price fallback with no strong product identity or shipping.",
    url: "https://www.ebay.de/itm/111222333444",
    html: `
      <!doctype html><html><head>
        <meta property="og:title" content="Generic Camera Accessory">
      </head><body>
        <span itemprop="price" content="49.95"></span>
        <span itemprop="priceCurrency" content="EUR"></span>
      </body></html>
    `,
    expected: {
      supported: true,
      itemId: "111222333444",
      title: "Generic Camera Accessory",
      "price.amount": 49.95,
      "price.currency": "EUR",
      "shipping.amount": null,
      "shipping.currency": null,
      condition: "unknown",
      "identity.gtin": null,
      "identity.mpn": null
    }
  },
  {
    id: "multi-offer-dom-selected-variant",
    description: "Conflicting JSON-LD variants must fall back to the currently rendered DOM variant.",
    url: "https://www.ebay.de/itm/222333444555",
    html: `
      <!doctype html><html><head>
        <script type="application/ld+json">
        {
          "@context":"https://schema.org",
          "@type":"Product",
          "name":"Variant Headphones",
          "offers":[
            {
              "@type":"Offer",
              "price":"99.90",
              "priceCurrency":"EUR",
              "itemCondition":"https://schema.org/UsedCondition",
              "shippingDetails":{
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
    `,
    expected: {
      supported: true,
      itemId: "222333444555",
      title: "Variant Headphones",
      "price.amount": 129.9,
      "price.currency": "EUR",
      "shipping.amount": 5.49,
      "shipping.currency": "EUR",
      condition: "new"
    }
  },
  {
    id: "ambiguous-price-unsupported",
    description: "Conflicting structured variant prices without a current DOM price are unsupported.",
    url: "https://www.ebay.de/itm/333444555666",
    html: `
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
    `,
    expected: {
      supported: false
    }
  },
  {
    id: "dom-used-paid-shipping",
    description: "Used-condition German DOM listing with paid shipping.",
    url: "https://www.ebay.de/itm/444555666777",
    html: `
      <!doctype html><html><head>
        <meta property="og:title" content="Used Example Lens">
      </head><body>
        <div class="x-price-primary">EUR 349,00</div>
        <div class="x-item-condition-text"><span class="ux-textspans">Gebraucht</span></div>
        <dl class="ux-labels-values ux-labels-values--shipping">
          <dt class="ux-labels-values__labels"><span>Versand:</span></dt>
          <dd class="ux-labels-values__values"><span class="ux-textspans--BOLD">EUR 6,99</span></dd>
        </dl>
      </body></html>
    `,
    expected: {
      supported: true,
      itemId: "444555666777",
      title: "Used Example Lens",
      "price.amount": 349,
      "price.currency": "EUR",
      "shipping.amount": 6.99,
      "shipping.currency": "EUR",
      condition: "used"
    }
  },
  {
    id: "dom-open-box",
    description: "Open-box condition mapping from German page text.",
    url: "https://www.ebay.de/itm/555666777888",
    html: `
      <!doctype html><html><head>
        <meta property="og:title" content="Open Box Tablet">
      </head><body>
        <div class="x-price-primary">EUR 499,00</div>
        <div class="x-item-condition-text"><span class="ux-textspans">Geöffnete Verpackung</span></div>
      </body></html>
    `,
    expected: {
      supported: true,
      itemId: "555666777888",
      title: "Open Box Tablet",
      "price.amount": 499,
      "price.currency": "EUR",
      "shipping.amount": null,
      condition: "open_box"
    }
  },
  {
    id: "dom-refurbished",
    description: "Refurbished condition mapping from German page text.",
    url: "https://www.ebay.de/itm/666777888999",
    html: `
      <!doctype html><html><head>
        <meta property="og:title" content="Refurbished Phone">
      </head><body>
        <div class="x-price-primary">EUR 299,00</div>
        <div class="x-item-condition-text"><span class="ux-textspans">Generalüberholt</span></div>
      </body></html>
    `,
    expected: {
      supported: true,
      itemId: "666777888999",
      title: "Refurbished Phone",
      "price.amount": 299,
      "price.currency": "EUR",
      "shipping.amount": null,
      condition: "refurbished"
    }
  },
  {
    id: "ambiguous-storage-not-invented",
    description: "Multiple storage values in one item-specific value must not become a guessed variant.",
    url: "https://www.ebay.de/itm/777888999000",
    html: `
      <!doctype html><html><head>
        <meta property="og:title" content="Configurable Laptop">
      </head><body>
        <div class="x-price-primary">EUR 999,00</div>
        <dl class="ux-labels-values">
          <dt class="ux-labels-values__labels"><span>Speicherkapazität:</span></dt>
          <dd class="ux-labels-values__values"><span>256 GB / 512 GB</span></dd>
        </dl>
      </body></html>
    `,
    expected: {
      supported: true,
      itemId: "777888999000",
      title: "Configurable Laptop",
      "price.amount": 999,
      "price.currency": "EUR",
      "shipping.amount": null,
      condition: "unknown",
      "identity.variant.storageGb": null
    }
  }
];
