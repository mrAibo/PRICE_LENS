import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {build} from "esbuild";
import {
  hostPermissionForOrigin,
  normalizeApiOrigin
} from "./build-config.mjs";

const outdir = "dist";
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
  target: ["chrome120"],
  sourcemap: true,
  logLevel: "info",
  define: {
    __PRICE_LENS_API_ORIGIN__: JSON.stringify(apiOrigin)
  }
});

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.host_permissions = [hostPermissionForOrigin(apiOrigin)];

await writeFile(
  `${outdir}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8"
);

process.stdout.write(
  `PriceLens extension API origin: ${apiOrigin}\n`
);
