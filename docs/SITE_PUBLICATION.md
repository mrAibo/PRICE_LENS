# PriceLens site publication

Status: **prepared / not public until operator details are supplied and the workflow is run manually**

The public companion site lives under `site/`. The committed source intentionally does not contain the operator's private address.

## Why operator data is required

For a German public project that is not purely personal/family use, provider-identification obligations can require a real name and postal address. Commercially oriented digital services can additionally fall under § 5 DDG. The project therefore does not publish a fake company, placeholder address or misleading contact data.

The publication build creates two pages at deploy time:

- `impressum.html`
- `datenschutz.html`

The values come from GitHub Actions secrets and therefore do not enter normal Git history. They are nevertheless intentionally public in the generated website.

## Required GitHub Actions secrets

- `PAGES_OPERATOR_NAME`
- `PAGES_OPERATOR_STREET`
- `PAGES_OPERATOR_CITY`
- `PAGES_OPERATOR_COUNTRY`
- `PAGES_PUBLIC_EMAIL`

Optional:

- `PAGES_PUBLIC_PHONE`
- `PAGES_VAT_ID` — only if an actual VAT ID exists
- `PAGES_EDITORIAL_RESPONSIBLE_NAME`
- `PAGES_EDITORIAL_RESPONSIBLE_ADDRESS` — use only after deciding that an editorial-responsibility statement is appropriate

Do not invent values to satisfy an onboarding form.

## Local private staging file

On the authorized Windows workstation, the helper can create and open the git-excluded file without exposing values in chat:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/configure-pages-owner.ps1 -Init
```

It uses:

```text
.tmp/pages-owner.local.env
```

with:

```text
PAGES_OPERATOR_NAME=
PAGES_OPERATOR_STREET=
PAGES_OPERATOR_CITY=
PAGES_OPERATOR_COUNTRY=Deutschland
PAGES_PUBLIC_EMAIL=
PAGES_PUBLIC_PHONE=
PAGES_VAT_ID=
PAGES_EDITORIAL_RESPONSIBLE_NAME=
PAGES_EDITORIAL_RESPONSIBLE_ADDRESS=
```

Keep this file out of Git. `.tmp/` is ignored repository-wide.

To generate a local preview after filling the file:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/configure-pages-owner.ps1 -Preview
```

To upload the values as GitHub Actions secrets without printing them:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/configure-pages-owner.ps1 -Upload
```

Blank optional fields are removed from repository secrets rather than replaced by fake values.

## Local validation

Export the values into the current process and run:

```bash
node scripts/build-pages-site.mjs
```

The output is written to `.pages/`.

CI uses synthetic test values through `scripts/site-build.test.mjs` and verifies that:

- the legal pages are generated;
- every HTML page links to Impressum and Datenschutz;
- internal links resolve;
- operator values are injected into the build artifact rather than committed source.

## Publishing

The workflow `.github/workflows/pages.yml` is intentionally **manual-only**.

After the required secrets exist:

1. In repository Settings -> Pages, choose **GitHub Actions** as the source if it is not already configured.
2. Run the **Publish PriceLens site** workflow manually.
3. Verify the resulting public URL and legal pages.
4. Only then use that URL in EPN, idealo, Geizhals or Amazon applications.

For this project repository, the default GitHub Pages project URL is expected to be:

```text
https://mraibo.github.io/PRICE_LENS/
```

A custom domain can be added later.

## Privacy notes for GitHub Pages

GitHub documents that visitor IP addresses are logged and stored for security purposes on GitHub Pages. The generated Datenschutz page states this and links to GitHub's current documentation/privacy statement.

The committed PriceLens site itself contains no analytics or advertising scripts.

## Release boundary

Publishing this companion site does **not** mean that the browser extension or any provider integration is approved for production. Provider Status and Launch Readiness must continue to reflect the actual approval state.
