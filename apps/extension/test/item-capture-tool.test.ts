import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, {recursive: true, force: true});
  }
});

describe("eBay item fixture capture tool", () => {
  it("preserves only allowed selected SKU values and lets selected storage override a generic title", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "price-lens-item-capture-"));
    temporaryDirectories.push(directory);

    const sourcePath = path.join(directory, "saved-item.html");
    const outputPath = path.join(directory, "fixture.json");
    writeFileSync(
      sourcePath,
      `<!doctype html><html><head>
        <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"Phone 128GB/256GB",
         "offers":{"@type":"Offer","price":"654.99","priceCurrency":"EUR",
                   "itemCondition":"https://schema.org/NewCondition"}}
        </script>
      </head><body>
        <div class="seller">real-seller-name</div>
        <div data-testid="x-price-primary">EUR 654,99</div>
        <div data-testid="x-msku-evo">
          <button class="listbox-button__control">
            <span class="btn__label">Farbe:</span>
            <span class="btn__text">Schwarz</span>
          </button>
          <button class="listbox-button__control">
            <span class="btn__label">Speicherkapazität:</span>
            <span class="btn__text">128 GB</span>
          </button>
        </div>
      </body></html>`,
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [
        "apps/extension/tools/capture-ebay-fixture.mjs",
        "--html",
        sourcePath,
        "--url",
        "https://www.ebay.de/itm/123456789012?var=987654321001",
        "--id",
        "selected-sku-capture-e2e",
        "--layout-class",
        "selected-multi-variant",
        "--out",
        outputPath
      ],
      {cwd: repoRoot, encoding: "utf8"}
    );

    expect(result.status, result.stderr).toBe(0);
    const fixture = JSON.parse(readFileSync(outputPath, "utf8")) as {
      reviewed: boolean;
      url: string;
      html: string;
      expected: Record<string, unknown>;
    };

    expect(fixture.reviewed).toBe(false);
    expect(fixture.url).toMatch(/^https:\/\/www\.ebay\.de\/itm\/\d{9,15}$/);
    expect(fixture.url).not.toContain("?");
    expect(fixture.html).not.toContain("real-seller-name");
    expect(fixture.html).not.toContain("Schwarz");
    expect(fixture.html).toContain("Speicherkapazität:");
    expect(fixture.html).toContain("128 GB");
    expect(fixture.expected["identity.variant.storageGb"]).toBe(128);
  });
});
