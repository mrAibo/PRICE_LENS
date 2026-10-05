import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";

test("builds a publishable site with generated legal pages and no broken internal links", () => {
  const env = {
    ...process.env,
    PAGES_OPERATOR_NAME: "Test Person",
    PAGES_OPERATOR_STREET: "Teststraße 1",
    PAGES_OPERATOR_CITY: "30100 Hannover",
    PAGES_OPERATOR_COUNTRY: "Deutschland",
    PAGES_PUBLIC_EMAIL: "test@example.invalid",
    PAGES_PUBLIC_PHONE: "",
    PAGES_VAT_ID: "",
    PAGES_EDITORIAL_RESPONSIBLE_NAME: "",
    PAGES_EDITORIAL_RESPONSIBLE_ADDRESS: ""
  };

  const result = spawnSync(process.execPath, ["scripts/build-pages-site.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const root = path.resolve(".pages");
  assert.ok(fs.existsSync(path.join(root, "impressum.html")));
  assert.ok(fs.existsSync(path.join(root, "datenschutz.html")));

  const impressum = fs.readFileSync(path.join(root, "impressum.html"), "utf8");
  assert.match(impressum, /Test Person/);
  assert.match(impressum, /Teststraße 1/);
  assert.match(impressum, /test@example\.invalid/);

  const htmlFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) htmlFiles.push(full);
    }
  };
  walk(root);

  assert.ok(htmlFiles.length >= 17);

  const broken = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /Impressum/);
    assert.match(html, /Datenschutz/);
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) continue;
      const target = path.normalize(path.join(path.dirname(file), href));
      if (!fs.existsSync(target)) broken.push(`${path.relative(root, file)} -> ${href}`);
    }
  }

  assert.deepEqual(broken, []);
});
