# eBay Sandbox Live Validation

Validated: **2026-10-04**

Environment: **eBay Sandbox / EBAY_DE**

This document records the first credential-backed PriceLens live validation. It is intentionally redacted: no Client Secret, OAuth token, seller identifier, product title or production customer data is stored here.

## Result summary

| Check | Result |
| --- | --- |
| Sandbox Client ID / Cert ID accepted | **pass** |
| OAuth client-credentials token request | **HTTP 200** |
| OAuth token returned | **yes** |
| Token lifetime returned by eBay | **7200 seconds** |
| Browse `item_summary/search` | **HTTP 200** |
| Sandbox Browse search result | **1 result returned** |
| PriceLens `/ready` | **pass** |
| PriceLens `/health` | **pass** |
| PriceLens `/v1/compare` | **pass** |
| Browse identity enrichment | **pass** |
| Enriched identity fields observed | brand, model, GTIN, EAN |
| Enrichment fallback warning | **no** |
| eBay same-product provider execution | **pass / no_match** |
| Catalog readonly OAuth scope on current keyset | **HTTP 400 `invalid_scope`** |

The full PriceLens redacted live-check gate passed both:

- `ebay_enrichment=pass`
- `ebay_market=pass`

The same-product provider returned `no_match` for the selected Sandbox product, which is an acceptable non-error provider state and confirms that the configured Browse search path executed.

## Sandbox item used

The test item came from an eBay Sandbox Browse search and used the Sandbox legacy item id:

`110590598827`

No Production listing was used to prove the Sandbox enrichment gate because eBay Sandbox and Production inventories are separate.

## Identity improvement observed

The validation request intentionally started with an empty PriceLens product identity.

After official Browse enrichment, the normalized listing contained:

- brand: present
- model: present
- GTIN: present
- EAN: present

This demonstrates that Browse materially improves product-identity coverage and satisfies the Phase 3 enrichment objective for the tested Sandbox record.

## Catalog fallback finding

PriceLens contains optional Catalog-based fallback paths for resolving a unique ePID from Brand+MPN or Brand+Model. Those fallbacks are disabled by default.

A direct OAuth token request for:

`https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly`

returned:

`HTTP 400 invalid_scope`

for the current Sandbox keyset.

Therefore:

1. Catalog fallbacks remain disabled.
2. PriceLens must not depend on Catalog for normal operation.
3. Exact Browse GTIN/EAN/UPC and direct ePID paths remain the production design baseline.
4. Catalog fallback may be reconsidered only after eBay explicitly grants the required Catalog scope/permissions and the authorization model is validated for the PriceLens use case.

## Security

- The Client Secret exists only in the local git-excluded `.tmp` environment on the authorized workstation.
- No Client Secret or OAuth token was printed into GitHub, committed to the repository, or added to this document.
- Provider product-data cache TTL remains `0` until provider-approved freshness rules are known.

## Remaining eBay gates

Sandbox credential and Browse-enrichment validation are complete.

Still required before public Production use:

- broader live same-product validation across representative Sandbox/Production categories and conditions;
- confirm shipping/delivery behavior in Production;
- eBay Partner Network software/browser-extension approval;
- Buy API Production approval / Developer Support review as required;
- Application Growth Check for restricted Production Buy APIs;
- Production keyset validation;
- provider-specific cache/rate/freshness policy confirmation.
