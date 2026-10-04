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

describe("eBay search fixture capture tool", () => {
  it("reduces a saved search page, syntheticizes item ids and excludes unrelated markup", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "price-lens-search-capture-"));
    temporaryDirectories.push(directory);

    const sourcePath = path.join(directory, "saved-search.html");
    const outputPath = path.join(directory, "fixture.json");
    writeFileSync(
      sourcePath,
      `<!doctype html>
      <html><body>
        <div class="account">private-user@example.test</div>
        <ul class="srp-results">
          <li class="s-item">
            <div class="seller">real-seller-name</div>
            <a class="s-item__link"
              href="https://www.ebay.de/itm/123456789012?hash=abc&campid=secret">
              <div class="s-item__title">Neues Angebot Sony WH-1000XM6</div>
            </a>
            <span class="s-item__price">EUR 349,00</span>
            <span class="s-item__shipping">Kostenloser Versand</span>
            <span class="SECONDARY_INFO">Neu</span>
            <img src="https://i.ebayimg.com/tracking-image.jpg?token=secret">
          </li>
          <li class="s-item">
            <div role="heading">Unvollständiges Werbeelement</div>
            <span class="s-item__price">EUR 20,00</span>
          </li>
        </ul>
      </body></html>`,
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [
        "apps/extension/tools/capture-ebay-search-fixture.mjs",
        "--html",
        sourcePath,
        "--url",
        "https://www.ebay.de/sch/i.html?_nkw=sony&campid=source-secret",
        "--id",
        "capture-tool-e2e",
        "--layout-class",
        "desktop-list",
        "--out",
        outputPath
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Captured anonymized search fixture");

    const fixture = JSON.parse(readFileSync(outputPath, "utf8")) as {
      reviewed: boolean;
      source: {
        kind: string;
        sourceUrlSha256: string;
        capturedCardCount: number;
      };
      url: string;
      html: string;
      expectedCards: Array<Record<string, unknown>>;
    };

    expect(fixture.reviewed).toBe(false);
    expect(fixture.source.kind).toBe("observed-search");
    expect(fixture.source.sourceUrlSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.source.capturedCardCount).toBe(2);
    expect(fixture.url).toBe(
      "https://www.ebay.de/sch/i.html?_nkw=pricelens-fixture"
    );

    expect(fixture.html).not.toContain("123456789012");
    expect(fixture.html).not.toContain("real-seller-name");
    expect(fixture.html).not.toContain("private-user@example.test");
    expect(fixture.html).not.toContain("campid");
    expect(fixture.html).not.toContain("<img");
    expect(fixture.html).not.toContain("tracking-image");

    expect(fixture.expectedCards).toHaveLength(2);
    expect(fixture.expectedCards[0]).toMatchObject({
      cardIndex: 0,
      supported: true,
      title: "Sony WH-1000XM6",
      "price.amount": 349,
      "price.currency": "EUR",
      "shipping.amount": 0,
      "shipping.currency": "EUR",
      condition: "new"
    });
    expect(String(fixture.expectedCards[0]?.itemId)).toMatch(/^\d{9,15}$/);
    expect(fixture.expectedCards[0]?.itemId).not.toBe("123456789012");

    expect(fixture.expectedCards[1]).toEqual({
      cardIndex: 1,
      supported: false
    });
  });

  it("rejects non-search source URLs", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "price-lens-search-capture-"));
    temporaryDirectories.push(directory);

    const sourcePath = path.join(directory, "saved-search.html");
    const outputPath = path.join(directory, "fixture.json");
    writeFileSync(sourcePath, "<html><body></body></html>", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "apps/extension/tools/capture-ebay-search-fixture.mjs",
        "--html",
        sourcePath,
        "--url",
        "https://www.ebay.de/itm/123456789012",
        "--id",
        "wrong-page",
        "--out",
        outputPath
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must be an https://www.ebay.de/sch/");
  });
});
