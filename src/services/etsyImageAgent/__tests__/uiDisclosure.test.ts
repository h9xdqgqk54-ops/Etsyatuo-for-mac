import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";
import { describe, expect, it } from "vitest";

function readPublicFile(fileName: string): string {
  return fs.readFileSync(path.resolve("public", fileName), "utf-8");
}

function readMainWorkbenchAssets(): { html: string; css: string; js: string; bundle: string } {
  const html = readPublicFile("etsy-image-agent.html");
  const css = readPublicFile("etsy-image-agent.css");
  const js = readPublicFile("etsy-image-agent.js");
  return { html, css, js, bundle: `${html}\n${css}\n${js}` };
}

function readSettingsAssets(): { html: string; css: string; js: string; bundle: string } {
  const html = readPublicFile("openai-settings.html");
  const css = readPublicFile("openai-settings.css");
  const js = readPublicFile("openai-settings.js");
  return { html, css, js, bundle: `${html}\n${css}\n${js}` };
}

describe("GPT5.5 + OpenAI desktop batch UI", () => {
  it("uses the desktop batch workflow as the image agent main page", () => {
    const { html, bundle } = readMainWorkbenchAssets();
    expect(html).toContain('<link rel="stylesheet" href="/etsy-image-agent.css">');
    expect(html).toContain('<script src="/etsy-image-agent.js" defer></script>');
    expect(html).not.toContain("<style>");
    expect(html).not.toContain("<script>");
    expect(bundle).toContain("GPT5.5 看图写 Prompt");
    expect(bundle).toContain("图片输入");
    expect(bundle).toContain("Prompt 审核");
    expect(bundle).toContain("图片输出");
    expect(bundle).toContain("根据图片自动生成提示词");
    expect(bundle).toContain("重新生成提示词");
    expect(bundle).toContain("negative prompt");
    expect(bundle).toContain("GPT55_VISION_NOT_SUPPORTED");
    expect(bundle).toContain("GPT55_INPUT_METHOD_UNSUPPORTED");
    expect(bundle).toContain("GPT55_AUTH_FAILED");
    expect(bundle).toContain("GPT55_MODEL_NOT_ACCESSIBLE");
    expect(bundle).toContain("PROMPT_REQUIRED");
    expect(bundle).toContain("失败图片可在对应卡片里查看原因并重试");
    expect(bundle).toContain("通过并生成图片");
    expect(bundle).toContain("生成中");
    expect(bundle).toContain("图片审核");
    expect(bundle).toContain("商品工作台");
    expect(bundle).toContain("完成本商品并生成文案");
    expect(bundle).toContain("保存文案");
    expect(bundle).toContain("重新生成文案");
    expect(bundle).toContain("人工建议改写");
    expect(bundle).toContain("revise-with-suggestion");
    expect(bundle).toContain("GPT55_LISTING_REVISION_PARSE_FAILED");
    expect(bundle).toContain("folderInputDir");
    expect(bundle).toContain("folderOutputDir");
    expect(bundle).toContain("saveFoldersBtn");
    expect(bundle).toContain("GPT55_LISTING_PARSE_FAILED");
    expect(bundle).toContain("LISTING_APPROVED_IMAGE_REQUIRED");
    expect(bundle).toContain("通过并保存到输出文件夹");
    expect(bundle).toContain("重新生成提示词");
    expect(bundle).toContain("重新生成图片");
    expect(bundle).toContain("OPENAI_IMAGE_EMPTY_RESPONSE");
    expect(bundle).toContain("stopPolling");
    expect(bundle).toContain("图片生成失败");
    expect(bundle).toContain("/approve-and-generate");
    expect(bundle).not.toContain("素材库");
    expect(bundle).not.toContain("/asset-library");
    expect(bundle).not.toContain("<h2>Prompt Provider</h2>");
    expect(bundle).not.toContain("<h2>OpenAI Image</h2>");
    expect(bundle).not.toContain("promptProviderMeta");
    expect(bundle).not.toContain("openaiMeta");
    expect(bundle).not.toContain("图片信息配对");
    expect(bundle).not.toContain("用 GPT5.5 生成配对信息");
    expect(bundle).not.toContain("保存配对信息");
    expect(bundle).not.toContain("data-meta-color");
    expect(bundle).not.toContain("data-meta-size");
    expect(bundle).not.toContain("data-meta-material");
    expect(bundle).not.toContain("data-meta-note");
    expect(bundle).not.toContain("读取并生成");
    expect(bundle).not.toContain("人工质量检测");
    expect(bundle).not.toContain("提示词输入");
    expect(bundle).not.toContain("价格工作台");
    expect(bundle).not.toContain("确认价格");
    expect(bundle).not.toContain("generatePricesBtn");
    expect(bundle).not.toContain("confirmPriceNamesBtn");
    expect(bundle).not.toContain("data-price-");
    expect(bundle).not.toContain("/api/etsy-agent/desktop-batch/start");
    expect(bundle).not.toContain("confirm-price-filenames");
    expect(bundle).not.toContain("确认并重命名图片");
    expect(bundle).not.toContain("DOUBAO_PROMPT");
    expect(bundle).not.toContain("ARK_API_KEY");
    expect(bundle).not.toContain("groupDrawer");
    expect(bundle).not.toContain("上传参考图");
    expect(bundle).not.toContain("确认分组");
    expect(bundle).not.toContain("生成素材</b>");
    expect(bundle).not.toContain("cloudflared");
    expect(bundle).not.toContain("NEED_PUBLIC_IMAGE_URL");
  });

  it("keeps settings focused on GPT5.5 prompt and OpenAI image responsibilities", () => {
    const { html, bundle } = readSettingsAssets();
    expect(html).toContain('<link rel="stylesheet" href="/openai-settings.css">');
    expect(html).toContain('<script src="/openai-settings.js" defer></script>');
    expect(html).not.toContain("<style>");
    expect(html).not.toContain("<script>");
    expect(bundle).toContain("图片 Agent Provider 设置");
    expect(bundle).toContain("GPT5.5 文本视觉");
    expect(bundle).toContain("GPT55_API_KEY");
    expect(bundle).toContain("GPT55_BASE_URL");
    expect(bundle).toContain("GPT55_MODEL");
    expect(bundle).toContain("Prompt Provider");
    expect(bundle).toContain("保存 GPT5.5 配置");
    expect(bundle).toContain("填入默认 GPT5.5 配置");
    expect(bundle).toContain("测试 GPT5.5 配置");
    expect(bundle).toContain("GPT5.5 Model");
    expect(bundle).toContain("Prompt ready");
    expect(bundle).toContain("gpt-5.5");
    expect(bundle).toContain("Diagnostic");
    expect(bundle).toContain("删除网页 GPT5.5 Key");
    expect(bundle).toContain("测试 GPT5.5 配置");
    expect(bundle).toContain("OPENAI_API_KEY");
    expect(bundle).toContain("OPENAI_BASE_URL");
    expect(bundle).toContain("Base URL");
    expect(bundle).toContain("Public URL");
    expect(bundle).toContain("not required");
    expect(bundle).toContain("gpt-image-2");
    expect(bundle).not.toContain("localStorage");
    expect(bundle).not.toContain("sessionStorage");
    expect(bundle).not.toContain("cloudflared");
    expect(bundle).not.toContain("IMAGE_AGENT_PUBLIC_BASE_URL");
    expect(bundle).not.toContain("ARK_API_KEY");
    expect(bundle).not.toContain("DOUBAO_PROMPT_MODEL");
  });

  it("does not expose a standalone asset library page or navigation entry", () => {
    const mainHtml = readMainWorkbenchAssets().bundle;
    const settingsHtml = readSettingsAssets().bundle;
    expect(fs.existsSync(path.resolve("public/asset-library.html"))).toBe(false);
    expect(fs.existsSync(path.resolve("public/app.html"))).toBe(false);
    expect(fs.existsSync(path.resolve("public/test_panel.html"))).toBe(false);
    expect(mainHtml).not.toContain("素材库");
    expect(mainHtml).not.toContain("/asset-library");
    expect(settingsHtml).not.toContain("素材库");
    expect(settingsHtml).not.toContain("/asset-library");
  });
});

interface MockBatchItem {
  itemId: string;
  batchId: string;
  baseName: string;
  inputAssetId: string;
  inputFileName: string;
  mimeType: string;
  promptRecordId: string;
  promptTextSnapshot: string;
  negativePromptSnapshot: string;
  promptStatusAtGeneration: string;
  status: string;
  outputFilePath?: string;
  outputFileName?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  promptPreview: string;
}

interface MockBatch {
  batchId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  inputDir: string;
  outputDir: string;
  totalItems: number;
  generatedItems: number;
  approvedItems: number;
  failedItems: number;
  model: string;
  size: string;
  quality: string;
  items: MockBatchItem[];
}

interface PageHarness {
  browser: Browser;
  page: Page;
  finalizedRequests: string[];
  revisionRequests: string[];
  workbenchRequests: string[];
  folderSettingsRequests: string[];
  revisionBodies: Array<Record<string, unknown>>;
  stylePatchBodies: Array<Record<string, unknown>>;
  imageMetaPatchBodies: Array<Record<string, unknown>>;
  pageErrors: string[];
}

describe("image agent listing runtime", () => {
  it("keeps the listing action disabled when no desktop batch exists", async () => {
    const harness = await openImageAgentWithBatch(null);
    try {
      await waitForListingText(harness.page, "还没有可完成的批次");
      expect(harness.pageErrors).toEqual([]);
      expect(await listingButtonDisabled(harness.page)).toBe(true);

      await harness.page.evaluate(() => (document.querySelector("#listingBtn") as HTMLButtonElement).click());

      expect(harness.finalizedRequests).toEqual([]);
    } finally {
      await harness.browser.close();
    }
  });

  it("keeps the listing action disabled until generated images are approved", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["generated"]));
    try {
      await waitForListingText(harness.page, "请先在图片审核区点击“通过并保存到输出文件夹”");
      expect(await listingButtonDisabled(harness.page)).toBe(true);

      await harness.page.evaluate(() => (document.querySelector("#listingBtn") as HTMLButtonElement).click());

      expect(harness.finalizedRequests).toEqual([]);
    } finally {
      await harness.browser.close();
    }
  });

  it("keeps the listing action disabled while any image is still queued or running", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved", "running"]));
    try {
      await waitForListingText(harness.page, "还有图片正在生成或排队");
      expect(await listingButtonDisabled(harness.page)).toBe(true);

      await harness.page.evaluate(() => (document.querySelector("#listingBtn") as HTMLButtonElement).click());

      expect(harness.finalizedRequests).toEqual([]);
    } finally {
      await harness.browser.close();
    }
  });

  it("finalizes a listing when approved output images are ready", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved"]));
    try {
      await waitForListingText(harness.page, "可以点击“完成本商品并生成文案”");
      expect(await listingButtonDisabled(harness.page)).toBe(false);

      await harness.page.click("#listingBtn");

      await waitForListingText(harness.page, "Floral Bunny Plush Toy");
      expect(harness.finalizedRequests).toEqual(["POST /api/etsy-agent/desktop-batch/batch_runtime/finalize-listing"]);
      expect(await listingButtonDisabled(harness.page)).toBe(true);
      expect(await harness.page.locator("[id^='listing-colors-']").count()).toBe(0);
      expect(await harness.page.locator("[id^='listing-materials-']").count()).toBe(0);
    } finally {
      await harness.browser.close();
    }
  });

  it("keeps a persistent Chinese suggestion revision bar and applies GPT5.5 English revisions", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved"]));
    try {
      await waitForListingText(harness.page, "人工建议改写");
      expect(await harness.page.locator("#listingRevisionBtn").isDisabled()).toBe(true);
      expect(await harness.page.locator("#listingRevisionStatus").textContent()).toContain("先生成商品文案");

      await harness.page.click("#listingBtn");
      await waitForListingText(harness.page, "Floral Bunny Plush Toy");
      expect(await harness.page.locator("#listingRevisionBtn").isDisabled()).toBe(false);

      await harness.page.fill("#listingRevisionSuggestion", "请改成宠物玩具方向，全部输出英文，款式名短一点。");
      await harness.page.click("#listingRevisionBtn");

      await waitForListingText(harness.page, "Dog Plush Chew Toy");
      expect(await harness.page.locator("#listingRevisionStatus").textContent()).toContain("已按建议改写");
      expect(await harness.page.locator("[id^='listing-title-']").inputValue()).toBe("Dog Plush Chew Toy");
      expect(await harness.page.locator("[data-style-name='item_0']").inputValue()).toBe("Dog Rope Toy");
      expect(harness.revisionRequests).toEqual(["POST /api/etsy-agent/listings/listing_runtime/revise-with-suggestion"]);
      expect(harness.revisionBodies.at(-1)).toEqual({ suggestion: "请改成宠物玩具方向，全部输出英文，款式名短一点。" });
    } finally {
      await harness.browser.close();
    }
  });

  it("clears revision draft and status when the current listing context changes", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved"]));
    try {
      await harness.page.click("#listingBtn");
      await waitForListingText(harness.page, "Floral Bunny Plush Toy");
      await harness.page.fill("#listingRevisionSuggestion", "请改成宠物玩具方向，全部输出英文，款式名短一点。");
      await harness.page.click("#listingRevisionBtn");
      await waitForListingText(harness.page, "已按建议改写");

      await harness.page.evaluate("currentBatch=null;listingRecords=[];workbenchRecord=null;renderListing();");

      await waitForListingText(harness.page, "先生成商品文案后可使用建议改写");
      expect(await harness.page.locator("#listingRevisionSuggestion").inputValue()).toBe("");
      expect(await harness.page.locator("#listingRevisionStatus").textContent()).not.toContain("已按建议改写");
    } finally {
      await harness.browser.close();
    }
  });

  it("does not render the removed price workbench or call price APIs", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved"]));
    try {
      await waitForListingText(harness.page, "款式英文名");
      const listingText = await harness.page.locator("#listingBox").textContent();
      expect(listingText).not.toContain("价格工作台");
      expect(listingText).not.toContain("价格已确认");
      expect(listingText).not.toContain("图片信息配对");
      expect(await harness.page.locator("#generatePricesBtn").count()).toBe(0);
      expect(await harness.page.locator("#confirmPriceNamesBtn").count()).toBe(0);
      expect(await harness.page.locator("[data-price-usd]").count()).toBe(0);
      expect(harness.workbenchRequests.some((entry) => entry.includes("/workbench/prices"))).toBe(false);
      expect(harness.workbenchRequests.some((entry) => entry.includes("/generate-prices"))).toBe(false);
      expect(harness.workbenchRequests.some((entry) => entry.includes("/confirm-prices"))).toBe(false);
    } finally {
      await harness.browser.close();
    }
  });

  it("renders configurable image input and output folders without a prompt input folder", async () => {
    const harness = await openImageAgentWithBatch(null);
    try {
      await harness.page.waitForSelector("#folderInputDir");
      expect(await harness.page.locator("#folderInputDir").inputValue()).toBe("/tmp/in");
      expect(await harness.page.locator("#folderOutputDir").inputValue()).toBe("/tmp/out");
      expect(await harness.page.locator("body").textContent()).not.toContain("提示词输入");

      await harness.page.fill("#folderInputDir", "/tmp/custom-in");
      await harness.page.fill("#folderOutputDir", "/tmp/custom-out");
      await harness.page.click("#saveFoldersBtn");
      await harness.page.waitForTimeout(100);

      expect(harness.folderSettingsRequests).toEqual([
        "GET /api/etsy-agent/folder-settings",
        "POST /api/etsy-agent/folder-settings",
      ]);
    } finally {
      await harness.browser.close();
    }
  });

  it("renders editable style names and calls generate plus save APIs", async () => {
      const harness = await openImageAgentWithBatch(mockBatch(["approved"]));
      try {
        await waitForListingText(harness.page, "款式英文名");
      expect(await harness.page.locator("[data-style-name='item_0']").inputValue()).toBe("Pink Floral Bunny");
      expect(await harness.page.locator("[data-style-count='item_0']").textContent()).toBe("17/20");

      await harness.page.fill("[data-style-name='item_0']", "Cream Bunny");
      expect(await harness.page.locator("[data-style-count='item_0']").textContent()).toBe("11/20");
      await harness.page.click("#saveStyleNamesBtn");
      await harness.page.waitForTimeout(100);

      await harness.page.click("#generateStyleNamesBtn");
      await harness.page.waitForTimeout(100);

      expect(harness.workbenchRequests).toContain("PATCH /api/etsy-agent/desktop-batch/batch_runtime/workbench/style-names");
      expect(harness.workbenchRequests).toContain("POST /api/etsy-agent/desktop-batch/batch_runtime/workbench/style-names/generate");
      expect(harness.stylePatchBodies.at(-1)?.styles).toMatchObject([{ itemId: "item_0", styleNameEn: "Cream Bunny" }]);
    } finally {
      await harness.browser.close();
    }
  });

  it("does not render removed image metadata pairing controls or call image-meta APIs", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved"]), { initialImageMetasEmpty: true });
    try {
      await waitForListingText(harness.page, "款式英文名");
      const listingText = await harness.page.locator("#listingBox").textContent();
      expect(listingText).not.toContain("图片信息配对");
      expect(listingText).not.toContain("用 GPT5.5 生成配对信息");
      expect(listingText).not.toContain("保存配对信息");
      expect(await harness.page.locator("[data-meta-item]").count()).toBe(0);
      expect(await harness.page.locator("[data-meta-color]").count()).toBe(0);
      expect(await harness.page.locator("#generateImageMetasBtn").count()).toBe(0);
      expect(await harness.page.locator("#saveImageMetasBtn").count()).toBe(0);
      expect(harness.workbenchRequests).not.toContain("POST /api/etsy-agent/desktop-batch/batch_runtime/workbench/image-metas/generate");
      expect(harness.workbenchRequests).not.toContain("PATCH /api/etsy-agent/desktop-batch/batch_runtime/workbench/image-metas");
      expect(harness.imageMetaPatchBodies).toHaveLength(0);
    } finally {
      await harness.browser.close();
    }
  });

  it("shows finalize failures in the listing panel and restores the action state", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved"]), {
      finalizeStatus: 400,
      finalizeBody: {
        ok: false,
        error: "GPT55_API_KEY_MISSING：GPT5.5 需要配置 GPT55_API_KEY。",
        code: "GPT55_API_KEY_MISSING",
        details: { code: "GPT55_API_KEY_MISSING" },
      },
    });
    try {
      await waitForListingText(harness.page, "可以点击“完成本商品并生成文案”");

      await harness.page.click("#listingBtn");

      await waitForListingText(harness.page, "缺少 GPT55_API_KEY");
      expect(harness.finalizedRequests).toEqual(["POST /api/etsy-agent/desktop-batch/batch_runtime/finalize-listing"]);
      expect(await listingButtonDisabled(harness.page)).toBe(false);
    } finally {
      await harness.browser.close();
    }
  });
});

async function openImageAgentWithBatch(batch: MockBatch | null, options: {
  finalizeStatus?: number;
  finalizeBody?: Record<string, unknown>;
  initialImageMetasEmpty?: boolean;
} = {}): Promise<PageHarness> {
  const assets = readMainWorkbenchAssets();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const finalizedRequests: string[] = [];
  const revisionRequests: string[] = [];
  const workbenchRequests: string[] = [];
  const folderSettingsRequests: string[] = [];
  const revisionBodies: Array<Record<string, unknown>> = [];
  const stylePatchBodies: Array<Record<string, unknown>> = [];
  const imageMetaPatchBodies: Array<Record<string, unknown>> = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => handleImageAgentRoute(route, assets, batch, finalizedRequests, revisionRequests, workbenchRequests, folderSettingsRequests, revisionBodies, stylePatchBodies, imageMetaPatchBodies, options));
  await page.goto("http://local.test/etsy-image-agent");
  await page.waitForSelector("#listingBtn");
  return { browser, page, finalizedRequests, revisionRequests, workbenchRequests, folderSettingsRequests, revisionBodies, stylePatchBodies, imageMetaPatchBodies, pageErrors };
}

async function handleImageAgentRoute(
  route: Route,
  assets: { html: string; css: string; js: string },
  batch: MockBatch | null,
  finalizedRequests: string[],
  revisionRequests: string[],
  workbenchRequests: string[],
  folderSettingsRequests: string[],
  revisionBodies: Array<Record<string, unknown>>,
  stylePatchBodies: Array<Record<string, unknown>>,
  imageMetaPatchBodies: Array<Record<string, unknown>>,
  options: { finalizeStatus?: number; finalizeBody?: Record<string, unknown>; initialImageMetasEmpty?: boolean },
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === "/etsy-image-agent") {
    await route.fulfill({ status: 200, contentType: "text/html", body: assets.html });
    return;
  }
  if (url.pathname === "/etsy-image-agent.css") {
    await route.fulfill({ status: 200, contentType: "text/css", body: assets.css });
    return;
  }
  if (url.pathname === "/etsy-image-agent.js") {
    await route.fulfill({ status: 200, contentType: "application/javascript", body: assets.js });
    return;
  }
  if (url.pathname === "/api/etsy-agent/image-provider-settings") {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: mockSettings() }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/folder-settings") {
    folderSettingsRequests.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { inputDir: "/tmp/in", outputDir: "/tmp/out", sources: { inputDir: "session", outputDir: "session" } } }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/desktop-batch/scan") {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { inputDir: "/tmp/in", outputDir: "/tmp/out", assets: [] } }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/prompts") {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { records: [] } }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/desktop-batch") {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: batch }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/listings") {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { records: [] } }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/desktop-batch/batch_runtime/workbench") {
    workbenchRequests.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: mockWorkbenchRecord(batch, false, false, options.initialImageMetasEmpty) }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/desktop-batch/batch_runtime/workbench/image-metas") {
    workbenchRequests.push(`${request.method()} ${url.pathname}`);
    imageMetaPatchBodies.push(JSON.parse(request.postData() || "{}") as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: mockWorkbenchRecord(batch, true) }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/desktop-batch/batch_runtime/workbench/image-metas/generate") {
    workbenchRequests.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: mockWorkbenchRecord(batch, true) }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/desktop-batch/batch_runtime/workbench/style-names") {
    workbenchRequests.push(`${request.method()} ${url.pathname}`);
    stylePatchBodies.push(JSON.parse(request.postData() || "{}") as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: mockWorkbenchRecord(batch, true) }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/desktop-batch/batch_runtime/workbench/style-names/generate") {
    workbenchRequests.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: mockWorkbenchRecord(batch, true) }) });
    return;
  }
  if (url.pathname === "/api/etsy-agent/desktop-batch/batch_runtime/finalize-listing") {
    finalizedRequests.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({
      status: options.finalizeStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(options.finalizeBody ?? { ok: true, data: mockListingRecord() }),
    });
    return;
  }
  if (url.pathname === "/api/etsy-agent/listings/listing_runtime/revise-with-suggestion") {
    revisionRequests.push(`${request.method()} ${url.pathname}`);
    revisionBodies.push(JSON.parse(request.postData() || "{}") as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          listing: mockRevisedListingRecord(),
          workbench: mockRevisedWorkbenchRecord(batch),
        },
      }),
    });
    return;
  }
  await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: `Unexpected route: ${url.pathname}` }) });
}

function mockSettings(): Record<string, unknown> {
  return {
    model: "gpt-image-2",
    flags: { realGenerationEnabled: true },
    configured: true,
    source: "env",
    maskedKey: "sk-...",
    baseURL: "",
    imageSize: "1024x1024",
    imageQuality: "low",
    inputFidelity: "off",
    inputFidelitySource: "default",
    promptProvider: {
      provider: "gpt55",
      ready: true,
      configured: true,
      model: "fake-vision-model",
      baseURL: "https://allin-api.com/v1",
      maskedKey: "ark...",
      maxInputMb: 5,
      batchLimit: 10,
    },
  };
}

function mockBatch(statuses: string[]): MockBatch {
  return {
    batchId: "batch_runtime",
    status: statuses.some((status) => status === "queued" || status === "running") ? "running" : "reviewing",
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    inputDir: "/tmp/in",
    outputDir: "/tmp/out",
    totalItems: statuses.length,
    generatedItems: statuses.filter((status) => status === "generated").length,
    approvedItems: statuses.filter((status) => status === "approved").length,
    failedItems: statuses.filter((status) => status === "failed").length,
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "low",
    items: statuses.map((status, index) => ({
      itemId: `item_${index}`,
      batchId: "batch_runtime",
      baseName: `item-${index + 1}`,
      inputAssetId: `input_${index}`,
      inputFileName: `item-${index + 1}.jpg`,
      mimeType: "image/jpeg",
      promptRecordId: `prompt_${index}`,
      promptTextSnapshot: "same product prompt",
      negativePromptSnapshot: "no text",
      promptStatusAtGeneration: "approved",
      status,
      outputFilePath: status === "approved" ? `/tmp/out/item-${index + 1}.png` : undefined,
      outputFileName: status === "approved" ? `item-${index + 1}.png` : undefined,
      attempts: 1,
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      promptPreview: "same product prompt",
    })),
  };
}

function mockListingRecord(): Record<string, unknown> {
  return {
    listingId: "listing_runtime",
    batchId: "batch_runtime",
    title: "Floral Bunny Plush Toy",
    description: "A soft plush toy for nursery styling.",
    colors: "Pink, cream",
    sizeInfo: "Size not specified from image",
    materials: "Soft plush fabric",
    keywords: ["bunny plush", "plush toy", "rabbit toy", "soft bunny", "nursery decor", "kids gift", "baby shower", "stuffed animal", "easter bunny", "cute plush", "floral bunny", "pink bunny", "gift for kids"],
    status: "generated",
    model: "fake-vision-model",
    outputFilePath: "/tmp/out/listing.txt",
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
  };
}

function mockRevisedListingRecord(): Record<string, unknown> {
  return {
    ...mockListingRecord(),
    title: "Dog Plush Chew Toy",
    description: "A soft plush dog toy with a gentle rope accent for playful pet gift photos.",
    keywords: ["dog chew toy", "pet plush toy", "puppy toy", "rope dog toy", "soft pet toy", "animal dog toy", "dog gift", "plush chew toy", "cute dog toy", "small dog toy", "pet supplies", "dog birthday", "puppy gift"],
    status: "edited",
    updatedAt: "2026-05-22T00:10:00.000Z",
  };
}

function mockRevisedWorkbenchRecord(batch: MockBatch | null): Record<string, unknown> {
  const record = mockWorkbenchRecord(batch, true);
  return {
    ...record,
    imageMetas: (record.imageMetas as Array<Record<string, unknown>>).map((meta) => ({
      ...meta,
      styleNameEn: "Dog Rope Toy",
      styleNameSource: "gpt55",
    })),
  };
}

function mockWorkbenchRecord(batch: MockBatch | null, edited = false, confirmed = false, emptyImageMetas = false): Record<string, unknown> {
  const approved = batch?.items.filter((item) => item.status === "approved") ?? [];
  return {
    batchId: batch?.batchId ?? "batch_runtime",
    status: confirmed ? "confirmed" : "draft",
    imageMetas: approved.map((item) => ({
      itemId: item.itemId,
      inputFileName: item.inputFileName,
      outputFileName: item.outputFileName,
      outputFilePath: item.outputFilePath,
      publicUrl: `/media/etsy-agent/outputs/item-${Number(item.itemId.replace("item_", "")) + 1}.png`,
      color: emptyImageMetas ? "" : "pink floral",
      size: emptyImageMetas ? "" : "18 cm",
      material: emptyImageMetas ? "" : "soft plush fabric",
      note: emptyImageMetas ? "" : "main listing image",
      styleNameEn: edited ? "Cream Bunny" : "Pink Floral Bunny",
      styleNameSource: edited ? "manual" : "gpt55",
      styleNameUpdatedAt: "2026-05-22T00:00:00.000Z",
      source: "manual",
      updatedAt: "2026-05-22T00:00:00.000Z",
    })),
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
  };
}

async function waitForListingText(page: Page, text: string): Promise<void> {
  await page.waitForFunction((expected) => document.querySelector("#listingBox")?.textContent?.includes(expected), text);
}

async function listingButtonDisabled(page: Page): Promise<boolean> {
  return page.locator("#listingBtn").evaluate((button) => (button as HTMLButtonElement).disabled);
}
