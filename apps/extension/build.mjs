import {cp, mkdir, rm} from "node:fs/promises";
import {build} from "esbuild";

const outdir = "dist";

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
  logLevel: "info"
});

await cp("manifest.json", `${outdir}/manifest.json`);
