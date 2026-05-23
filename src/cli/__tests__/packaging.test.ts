import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("CLI launcher packaging", () => {
  it("declares scripts and assets needed for a Windows launcher exe", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf-8")) as {
      pkg?: { assets?: string[] };
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["desktop:dev"]).toBe("tsx src/cli/launcher.ts");
    expect(packageJson.scripts?.["build:cli"]).toBe("node scripts/build-cli.mjs");
    expect(packageJson.scripts?.["package:win"]).toBe("pnpm build:cli && node scripts/package-win-cli.mjs");
    expect(packageJson.pkg?.assets).toEqual(expect.arrayContaining(["public/**/*", "node_modules/sharp/**/*", "node_modules/@img/**/*"]));
  });

  it("keeps concrete build scripts in the repository", () => {
    expect(fs.existsSync(path.resolve("scripts/build-cli.mjs"))).toBe(true);
    expect(fs.existsSync(path.resolve("scripts/package-win-cli.mjs"))).toBe(true);
  });

  it("packages Windows exe without V8 bytecode cache for cross-target stability", () => {
    const script = fs.readFileSync(path.resolve("scripts/package-win-cli.mjs"), "utf-8");

    expect(script).toContain("--no-bytecode");
    expect(script).toContain("--public");
    expect(script).toContain("--public-packages");
    expect(script).toContain("\"*\"");
    expect(script).toContain("--fallback-to-source");
  });
});
