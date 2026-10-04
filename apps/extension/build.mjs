import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {build} from "esbuild";
import {
  hostPermissionForOrigin,
  normalizeApiOrigin,
  normalizeGoogleOAuthClientId
} from "./build-config.mjs";

const firefox = process.argv.includes("--firefox");
const browser = firefox ? "firefox" : "chrome";
const outdir = firefox ? "dist-firefox" : "dist";
const apiOrigin = normalizeApiOrigin(process.env.PRICE_LENS_API_ORIGIN);
const googleOAuthClientId = firefox
  ? undefined
  : normalizeGoogleOAuthClientId(
      process.env.PRICE_LENS_GOOGLE_OAUTH_CLIENT_ID
    );
const googleAuthEnabled = googleOAuthClientId !== undefined;

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
    __PRICE_LENS_API_ORIGIN__: JSON.stringify(apiOrigin),
    __PRICE_LENS_GOOGLE_AUTH_ENABLED__: JSON.stringify(googleAuthEnabled)
  }
});

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.host_permissions = [hostPermissionForOrigin(apiOrigin)];
manifest.permissions = ["storage"];

if (googleOAuthClientId) {
  manifest.permissions.push("identity");
  manifest.oauth2 = {
    client_id: googleOAuthClientId,
    scopes: ["openid"]
  };
} else {
  delete manifest.oauth2;
}

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
  `PriceLens ${browser} extension API origin: ${apiOrigin}; Google pilot auth: ${googleAuthEnabled ? "enabled" : "disabled"}\n`
);
