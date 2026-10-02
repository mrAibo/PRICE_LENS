import {readFile, stat} from "node:fs/promises";
import {
  hostPermissionForOrigin,
  normalizeApiOrigin
} from "./build-config.mjs";

const expectedOrigin = normalizeApiOrigin(process.env.PRICE_LENS_API_ORIGIN);
const expectedHostPermission = hostPermissionForOrigin(expectedOrigin);
const distDir = new URL("./dist/", import.meta.url);

const requiredFiles = ["manifest.json", "background.js", "content.js"];
for (const file of requiredFiles) {
  await assertRegularFile(new URL(file, distDir), file);
}

const manifestPath = new URL("manifest.json", distDir);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

assert(manifest.manifest_version === 3, "manifest_version must be 3.");
assert(
  manifest.background?.service_worker === "background.js",
  "background.service_worker must be background.js."
);

const hostPermissions = manifest.host_permissions;
assert(
  Array.isArray(hostPermissions),
  "manifest.host_permissions must be an array."
);
assert(
  hostPermissions.length === 1 &&
    hostPermissions[0] === expectedHostPermission,
  `manifest.host_permissions must contain only ${expectedHostPermission}.`
);
assert(
  !JSON.stringify(manifest).includes("<all_urls>"),
  "Release manifest must not contain <all_urls>."
);

const contentScripts = manifest.content_scripts;
assert(
  Array.isArray(contentScripts) && contentScripts.length === 1,
  "Release manifest must contain exactly one content-script declaration."
);
const itemScript = contentScripts[0];
assert(
  Array.isArray(itemScript.matches) &&
    itemScript.matches.length === 1 &&
    itemScript.matches[0] === "https://www.ebay.de/itm/*",
  "Content script must remain scoped to eBay.de item pages."
);
assert(
  Array.isArray(itemScript.js) &&
    itemScript.js.length === 1 &&
    itemScript.js[0] === "content.js",
  "Content script bundle must be content.js."
);

const backgroundBundle = await readFile(new URL("background.js", distDir), "utf8");
assert(
  backgroundBundle.includes(expectedOrigin),
  `background.js does not contain the expected API origin ${expectedOrigin}.`
);

const extensionJs = [
  backgroundBundle,
  await readFile(new URL("content.js", distDir), "utf8")
].join("\n");

for (const forbidden of [
  "EBAY_CLIENT_SECRET",
  "AMAZON_CREATORS_CREDENTIAL_SECRET",
  "AMAZON_CREATORS_CREDENTIAL_ID"
]) {
  assert(
    !extensionJs.includes(forbidden),
    `Extension artifact unexpectedly contains backend credential key ${forbidden}.`
  );
}

process.stdout.write(
  `Verified PriceLens extension artifact for ${expectedOrigin}\n`
);

async function assertRegularFile(url, label) {
  let info;
  try {
    info = await stat(url);
  } catch {
    throw new Error(`Missing required extension artifact: ${label}`);
  }

  assert(info.isFile(), `Required extension artifact is not a file: ${label}`);
  assert(info.size > 0, `Required extension artifact is empty: ${label}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
