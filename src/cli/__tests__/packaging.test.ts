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
    expect(packageJson.scripts?.["package:win"]).toBe("node scripts/build-cli.mjs && node scripts/package-win-cli.mjs && node scripts/package-windows-delivery.mjs");
    expect(packageJson.pkg?.assets).toEqual(expect.arrayContaining(["public/**/*", "node_modules/sharp/**/*", "node_modules/@img/**/*"]));
  });

  it("supports both npm and pnpm installs without enforcing a single package manager", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devEngines?: unknown;
      optionalDependencies?: Record<string, string>;
      packageManager?: string;
    };

    expect(fs.existsSync(path.resolve("pnpm-lock.yaml"))).toBe(true);
    expect(fs.existsSync(path.resolve("package-lock.json"))).toBe(true);
    expect(packageJson.packageManager).toBeUndefined();
    expect(packageJson.devEngines).toBeUndefined();
    expect(packageJson.dependencies).not.toHaveProperty("axios");
    expect(packageJson.dependencies).not.toHaveProperty("csv-parser");
    expect(packageJson.dependencies).not.toHaveProperty("csv-writer");
    expect(packageJson.dependencies).not.toHaveProperty("prompts");
    expect(packageJson.optionalDependencies).toEqual(expect.objectContaining({
      "@img/sharp-libvips-win32-x64": "1.2.4",
      "@img/sharp-win32-x64": "0.34.5",
    }));
  });

  it("keeps concrete build scripts in the repository", () => {
    expect(fs.existsSync(path.resolve("scripts/build-cli.mjs"))).toBe(true);
    expect(fs.existsSync(path.resolve("scripts/package-win-cli.mjs"))).toBe(true);
    expect(fs.existsSync(path.resolve("scripts/package-windows-delivery.mjs"))).toBe(true);
  });

  it("keeps local verification aligned with the simplified image agent workbench", () => {
    const verifyScript = fs.readFileSync(path.resolve("scripts/verify-local.ts"), "utf-8");
    const readme = fs.readFileSync(path.resolve("README.md"), "utf-8");
    const sourcePackageScript = fs.readFileSync(path.resolve("scripts/package-source.mjs"), "utf-8");

    expect(verifyScript).toContain("public/etsy-image-agent.html");
    expect(verifyScript).toContain("public/etsy-image-agent.css");
    expect(verifyScript).toContain("public/etsy-image-agent.js");
    expect(verifyScript).toContain("public/openai-settings.html");
    expect(verifyScript).toContain("public/openai-settings.css");
    expect(verifyScript).toContain("public/openai-settings.js");
    expect(verifyScript).not.toContain("public/app.html");
    expect(verifyScript).not.toContain("public/asset-library.html");
    expect(sourcePackageScript).not.toContain("public/app.html");
    expect(sourcePackageScript).not.toContain("public/test_panel.html");
    expect(sourcePackageScript).not.toContain("public/asset-library.html");
    expect(sourcePackageScript).toContain("public/etsy-image-agent.css");
    expect(sourcePackageScript).toContain("public/openai-settings.js");
    expect(readme).toContain("维护款式英文名和 Etsy listing 文案");
    expect(readme).not.toContain("图片信息配对");
    expect(readme).not.toContain("/asset-library");
    expect(readme).not.toContain("1688");
    expect(readme).not.toContain("Deepseek");
    expect(readme).not.toContain("Image2");
  });

  it("does not ship removed crawler, 1688, or legacy test panel sources", () => {
    const removedPaths = [
      "public/app.html",
      "public/test_panel.html",
      "src/apiCrawler.ts",
      "src/config.ts",
      "src/crawler.ts",
      "src/index.ts",
      "src/main.ts",
      "src/save.ts",
      "src/services/analyze.ts",
      "src/services/generate_tasks.ts",
      "src/services/image_and_text.ts",
      "src/services/image_and_text_pipeline.ts",
      "src/services/matcher1688",
      "src/services/select_etsy.ts",
      "src/services/test_server.ts",
      "src/types/product.ts",
    ];

    for (const removedPath of removedPaths) {
      expect(fs.existsSync(path.resolve(removedPath)), removedPath).toBe(false);
    }
  });

  it("does not keep GPT5.5 image metadata generation after removing the pairing panel", () => {
    const providerTypes = fs.readFileSync(path.resolve("src/services/etsyImageAgent/promptProviders/types.ts"), "utf-8");
    const gpt55Provider = fs.readFileSync(path.resolve("src/services/etsyImageAgent/promptProviders/gpt55PromptProvider.ts"), "utf-8");
    const workbenchService = fs.readFileSync(path.resolve("src/services/etsyImageAgent/productWorkbenchService.ts"), "utf-8");

    expect(providerTypes).not.toContain("GenerateImageMetas");
    expect(providerTypes).not.toContain("generateImageMetas");
    expect(gpt55Provider).not.toContain("buildGpt55ImageMetasRequest");
    expect(gpt55Provider).not.toContain("parseGpt55ImageMetasJson");
    expect(gpt55Provider).not.toContain("Gpt55ImageMetasSystemPrompt");
    expect(gpt55Provider).not.toContain("generateImageMetas");
    expect(workbenchService).not.toContain("generateProductWorkbenchImageMetas");
  });

  it("keeps deployment rewrites pointed at the current image agent pages", () => {
    const vercelJson = fs.readFileSync(path.resolve("vercel.json"), "utf-8");

    expect(vercelJson).toContain('"source": "/etsy-image-agent"');
    expect(vercelJson).toContain('"destination": "/etsy-image-agent.html"');
    expect(vercelJson).toContain('"source": "/"');
    expect(vercelJson).toContain('"destination": "/etsy-image-agent.html"');
    expect(vercelJson).not.toContain("asset-library.html");
    expect(vercelJson).not.toContain("app.html");
    expect(vercelJson).not.toContain("test_panel.html");
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
