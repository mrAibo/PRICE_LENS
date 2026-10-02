import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {build} from "esbuild";
import {
  hostPermissionForOrigin,
  normalizeApiOrigin
} from "./build-config.mjs";

const firefox = process.argv.includes("--firefox");
const browser = firefox ? "firefox" : "chrome";
const outdir = firefox ? "dist-firefox" : "dist";
const apiOrigin = normalizeApiOrigin(process.env.PRICE_LENS_API_ORIGIN);

await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});

await build({
  entryPoints: {
    content: "src/content.ts",
    background: "src/background.ts"
  },
  bundle: true,
  outdir,
  format: "iife",
  platform: "browser",
  target: [firefox ? "firefox140" : "chrome120"],
  sourcemap: true,
  logLevel: "info",
  define: {
    __PRICE_LENS_API_ORIGIN__: JSON.stringify(apiOrigin)
  }
});

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.host_permissions = [hostPermissionForOrigin(apiOrigin)];

if (firefox) {
  manifest.background = {
    scripts: ["background.js"]
  };
  manifest.browser_specific_settings = {
    gecko: {
      id: "price-lens@mraibo.github",
      strict_min_version: "140.0",
      data_collection_permissions: {
        required: ["browsingActivity", "websiteContent"]
      }
    }
  };
}

await writeFile(
  `${outdir}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8"
);

process.stdout.write(
  `PriceLens ${browser} extension API origin: ${apiOrigin}\n`
);
