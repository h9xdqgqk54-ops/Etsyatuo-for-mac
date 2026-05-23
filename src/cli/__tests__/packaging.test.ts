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
    expect(packageJson.scripts?.["package:win"]).toBe("pnpm build:cli && node scripts/package-win-cli.mjs && node scripts/package-windows-delivery.mjs");
    expect(packageJson.pkg?.assets).toEqual(expect.arrayContaining(["public/**/*", "node_modules/sharp/**/*", "node_modules/@img/**/*"]));
  });

  it("keeps concrete build scripts in the repository", () => {
    expect(fs.existsSync(path.resolve("scripts/build-cli.mjs"))).toBe(true);
    expect(fs.existsSync(path.resolve("scripts/package-win-cli.mjs"))).toBe(true);
    expect(fs.existsSync(path.resolve("scripts/package-windows-delivery.mjs"))).toBe(true);
  });

  it("packages Windows exe without V8 bytecode cache for cross-target stability", () => {
    const script = fs.readFileSync(path.resolve("scripts/package-win-cli.mjs"), "utf-8");

    expect(script).toContain("--no-bytecode");
    expect(script).toContain("--public");
    expect(script).toContain("--public-packages");
    expect(script).toContain("\"*\"");
    expect(script).toContain("--fallback-to-source");
  });

  it("assembles a Windows delivery folder with the sharp JavaScript package and native win32 sidecars", () => {
    const packageScript = fs.readFileSync(path.resolve("package.json"), "utf-8");
    const deliveryScriptPath = path.resolve("scripts/package-windows-delivery.mjs");
    const deliveryScript = fs.existsSync(deliveryScriptPath) ? fs.readFileSync(deliveryScriptPath, "utf-8") : "";

    expect(packageScript).toContain("scripts/package-windows-delivery.mjs");
    expect(deliveryScript).toContain("node_modules/sharp");
    expect(deliveryScript).toContain("node_modules/@img/sharp-win32-x64");
    expect(deliveryScript).toContain("node_modules/@img/sharp-libvips-win32-x64");
    expect(deliveryScript).toContain("node_modules/sharp/lib/sharp.js");
    expect(deliveryScript).toContain("sharp-win32-x64.node");
    expect(deliveryScript).toContain("createRequire(import.meta.url)(\"archiver\")");
    expect(deliveryScript).toContain("new ZipArchive");
  });

  it("keeps sharp native loading out of modules imported during server startup", () => {
    const startupFiles = [
      "src/services/etsyImageAgent/imageProcessing.ts",
      "src/services/etsyImageAgent/listingGenerationService.ts",
      "src/services/etsyImageAgent/productWorkbenchService.ts",
      "src/services/etsyImageAgent/qualityService.ts",
    ];

    for (const file of startupFiles) {
      const source = fs.readFileSync(path.resolve(file), "utf-8");
      expect(source, file).not.toMatch(/import\s+sharp\s+from\s+["']sharp["']/);
      expect(source, file).not.toMatch(/from\s+["']sharp["']/);
      expect(source, file).not.toMatch(/require\(["']sharp["']\)/);
    }
  });
});
