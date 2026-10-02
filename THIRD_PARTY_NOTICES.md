# Third-Party Notices

PriceLens contains or depends on third-party open-source software. Each component remains subject to its own license.

## product-matcher

- Upstream: https://github.com/Zarenk/product-matcher
- Upstream commit: `7908e1d8da715c3af04f2368cf249a022699a262`
- Upstream version: `1.0.0`
- License: MIT
- Copyright: Copyright (c) 2026 JD Zárate
- Vendored location: `packages/product-matcher/`

The production TypeScript sources under `packages/product-matcher/src/` are copied from the upstream commit above without source modifications.

PriceLens adds a local workspace package wrapper so the snapshot can be built reproducibly inside this repository. The wrapper is necessary because, when verified on 2026-10-02, the declared `product-matcher@1.0.0` package was not available from the public npm registry, while the upstream Git repository did not contain built `dist/` artifacts.

The upstream MIT license is retained at `packages/product-matcher/LICENSE`.

## npm dependency inventory

The committed `package-lock.json` defines the npm dependency graph used by CI and
the production API container.

A generated release inventory is kept at
[`docs/DEPENDENCY_LICENSES.md`](docs/DEPENDENCY_LICENSES.md). CI fails if an external
package has missing license metadata or introduces a license that has not been
explicitly reviewed in `scripts/license-inventory.mjs`.

This inventory complements, rather than replaces, source-level notices for vendored or
copied code.

