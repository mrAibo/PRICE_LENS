# Open-source reuse policy

PriceLens should reuse mature components where doing so reduces risk, but it must keep licensing and maintainability explicit.

## Approved / preferred

### Zarenk/product-matcher

Repository: https://github.com/Zarenk/product-matcher

License: MIT.

Pinned upstream commit: `7908e1d8da715c3af04f2368cf249a022699a262`.

Use: vendored workspace package at `packages/product-matcher`. The production source snapshot is copied without source modifications; PriceLens adds only the local package/build wrapper.

Reason for vendoring: CI verified on 2026-10-02 that `product-matcher@1.0.0` was not available from the public npm registry, and the Git repository does not include built `dist/` artifacts or a package prepare lifecycle suitable for direct Git installation.

Required action: keep the upstream MIT license, exact upstream SHA, and modification note in `THIRD_PARTY_NOTICES.md`.

### hendt/ebay-api

Repository: https://github.com/hendt/ebay-api

License: MIT.

Planned use: server-side eBay API client when eBay credentials are introduced.

### Antoninnnnnnnn/idealo-scraper

Repository: https://github.com/Antoninnnnnnnn/idealo-scraper

License: MIT.

Planned use: reference implementation for a research spike only. It is Python while the initial PriceLens backend is TypeScript, so wholesale copying is not useful.

### jnslmk/geizhals-mcp

Repository: https://github.com/jnslmk/geizhals-mcp

License: MIT.

Planned use: reference for Geizhals data-shape research, operational constraints, rate limits and fixture design. Browser/challenge handling is not copied into the core architecture.

## Architecture reference only

### twttr/multi-product-comparator

Repository: https://github.com/twttr/multi-product-comparator

The README states MIT and the project demonstrates a clean Manifest V3 TypeScript/esbuild layout plus isolated Idealo/Geizhals site configuration.

Current PriceLens bootstrap does **not** copy its source. Before copying any substantial source later, verify the repository's license file at the exact commit and retain its notice.

Useful ideas:

- isolated site adapters
- MutationObserver-safe content lifecycle
- DOM fixture tests
- minimal extension permissions

### DimensionDev/PriceDoge

Repository: https://github.com/DimensionDev/PriceDoge

License: GPL-3.0.

Policy: architecture inspiration only. Do not copy GPL source into PriceLens' MIT codebase.

### moiz-za/eBay-ds-research-ext

Repository: https://github.com/moiz-za/eBay-ds-research-ext

Policy: reference only unless an explicit compatible license is verified. Do not copy code based merely on public visibility.

## Attribution process

When source code is actually copied or substantially adapted:

1. record source repository + commit SHA
2. record original file path
3. record license
4. retain required copyright/license notice
5. add an entry to `THIRD_PARTY_NOTICES.md`
6. note material modifications

Dependencies installed normally through npm are tracked in package metadata; release packaging will additionally generate a dependency-license inventory before public distribution.
