# Observed eBay.de fixtures

Files in this directory are generated from real public eBay.de item pages with:

```bash
npm run capture:ebay -- \
  --html /path/to/saved-page.html \
  --url "https://www.ebay.de/itm/REAL_ITEM_ID" \
  --id "observed-example" \
  --layout-class "buy-it-now"
```

The capture tool:

- retains only extractor-relevant JSON-LD, price, condition and whitelisted item-specific DOM;
- does not retain the original item URL, only a SHA-256 digest for provenance/deduplication;
- replaces the item id used by the fixture with a synthetic id;
- excludes seller/account areas by construction;
- writes `reviewed: false` by default.

## Review gate

A fixture is **not evidence** until a person independently checks the generated
`expected` values against the live page or a screenshot and changes:

```json
"reviewed": true
```

If the extractor made a mistake, correct `expected` to the true page value before
marking the fixture reviewed. This prevents self-generated expectations from hiding
extractor errors.

Only reviewed observed fixtures count toward real-layout metrics.

Do not commit saved full eBay pages. Commit only the reduced JSON fixture created by
the capture tool.
