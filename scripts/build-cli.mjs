import * as fs from "node:fs";
import * as path from "node:path";
import { build } from "esbuild";

const outdir = path.resolve("dist/cli");
const outfile = path.join(outdir, "etsyauto-launcher.cjs");

fs.mkdirSync(outdir, { recursive: true });

await build({
  banner: { js: "#!/usr/bin/env node" },
  bundle: true,
  entryPoints: ["src/cli/launcher.ts"],
  external: [
    "sharp",
    "fsevents",
    "playwright",
    "playwright-core",
    "chromium-bidi/*",
  ],
  format: "cjs",
  logLevel: "info",
  outfile,
  platform: "node",
  sourcemap: false,
  target: "node22",
});

fs.chmodSync(outfile, 0o755);
console.log(`Built CLI launcher: ${path.relative(process.cwd(), outfile)}`);
