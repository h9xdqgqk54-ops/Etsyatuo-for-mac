import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";
import { describe, expect, it } from "vitest";

describe("GPT5.5 + OpenAI desktop batch UI", () => {
  it("uses the desktop batch workflow as the image agent main page", () => {
    const html = fs.readFileSync(path.resolve("public/etsy-image-agent.html"), "utf-8");
    expect(html).toContain("GPT5.5 看图写 Prompt");
    expect(html).toContain("图片输入");
    expect(html).toContain("Prompt 审核");
    expect(html).toContain("图片输出");
    expect(html).toContain("根据图片自动生成提示词");
    expect(html).toContain("重新生成提示词");
    expect(html).toContain("negative prompt");
    expect(html).toContain("GPT55_VISION_NOT_SUPPORTED");
    expect(html).toContain("GPT55_INPUT_METHOD_UNSUPPORTED");
    expect(html).toContain("GPT55_AUTH_FAILED");
    expect(html).toContain("GPT55_MODEL_NOT_ACCESSIBLE");
    expect(html).toContain("PROMPT_REQUIRED");
    expect(html).toContain("失败图片可在对应卡片里查看原因并重试");
    expect(html).toContain("通过并生成图片");
    expect(html).toContain("生成中");
    expect(html).toContain("图片审核");
    expect(html).toContain("商品工作台");
    expect(html).toContain("完成本商品并生成文案");
    expect(html).toContain("保存文案");
    expect(html).toContain("重新生成文案");
    expect(html).toContain("folderInputDir");
    expect(html).toContain("folderOutputDir");
    expect(html).toContain("saveFoldersBtn");
    expect(html).toContain("GPT55_LISTING_PARSE_FAILED");
    expect(html).toContain("LISTING_APPROVED_IMAGE_REQUIRED");
    expect(html).toContain("通过并保存到输出文件夹");
    expect(html).toContain("重新生成提示词");
    expect(html).toContain("重新生成图片");
    expect(html).toContain("OPENAI_IMAGE_EMPTY_RESPONSE");
    expect(html).toContain("stopPolling");
    expect(html).toContain("图片生成失败");
    expect(html).toContain("/approve-and-generate");
    expect(html).not.toContain("读取并生成");
    expect(html).not.toContain("人工质量检测");
    expect(html).not.toContain("提示词输入");
    expect(html).not.toContain("价格工作台");
    expect(html).not.toContain("确认价格");
    expect(html).not.toContain("generatePricesBtn");
    expect(html).not.toContain("confirmPriceNamesBtn");
    expect(html).not.toContain("data-price-");
    expect(html).not.toContain("/api/etsy-agent/desktop-batch/start");
    expect(html).not.toContain("confirm-price-filenames");
    expect(html).not.toContain("确认并重命名图片");
    expect(html).not.toContain("DOUBAO_PROMPT");
    expect(html).not.toContain("ARK_API_KEY");
    expect(html).not.toContain("groupDrawer");
    expect(html).not.toContain("上传参考图");
    expect(html).not.toContain("确认分组");
    expect(html).not.toContain("生成素材</b>");
    expect(html).not.toContain("cloudflared");
    expect(html).not.toContain("NEED_PUBLIC_IMAGE_URL");
  });

  it("keeps settings focused on GPT5.5 prompt and OpenAI image responsibilities", () => {
    const html = fs.readFileSync(path.resolve("public/openai-settings.html"), "utf-8");
    expect(html).toContain("图片 Agent Provider 设置");
    expect(html).toContain("GPT5.5 文本视觉");
    expect(html).toContain("GPT55_API_KEY");
    expect(html).toContain("GPT55_BASE_URL");
    expect(html).toContain("GPT55_MODEL");
    expect(html).toContain("Prompt Provider");
    expect(html).toContain("保存 GPT5.5 配置");
    expect(html).toContain("填入默认 GPT5.5 配置");
    expect(html).toContain("测试 GPT5.5 配置");
    expect(html).toContain("GPT5.5 Model");
    expect(html).toContain("Prompt ready");
    expect(html).toContain("gpt-5.5");
    expect(html).toContain("Diagnostic");
    expect(html).toContain("删除网页 GPT5.5 Key");
    expect(html).toContain("测试 GPT5.5 配置");
    expect(html).toContain("OPENAI_API_KEY");
    expect(html).toContain("OPENAI_BASE_URL");
    expect(html).toContain("Base URL");
    expect(html).toContain("Public URL");
    expect(html).toContain("not required");
    expect(html).toContain("gpt-image-2");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("sessionStorage");
    expect(html).not.toContain("cloudflared");
    expect(html).not.toContain("IMAGE_AGENT_PUBLIC_BASE_URL");
    expect(html).not.toContain("ARK_API_KEY");
    expect(html).not.toContain("DOUBAO_PROMPT_MODEL");
  });

  it("keeps the asset library as a pending-candidate child page", () => {
    const html = fs.readFileSync(path.resolve("public/asset-library.html"), "utf-8");
    expect(html).toContain("待审查候选素材");
    expect(html).toContain("OpenAI 设置");
    expect(html).not.toContain("重新生成选中素材");
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
  workbenchRequests: string[];
  folderSettingsRequests: string[];
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

  it("does not render the removed price workbench or call price APIs", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved"]));
    try {
      await waitForListingText(harness.page, "图片信息配对");
      const listingText = await harness.page.locator("#listingBox").textContent();
      expect(listingText).not.toContain("价格工作台");
      expect(listingText).not.toContain("价格已确认");
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

  it("generates editable image metadata and renders real output thumbnails", async () => {
    const harness = await openImageAgentWithBatch(mockBatch(["approved"]), { initialImageMetasEmpty: true });
    try {
      await waitForListingText(harness.page, "图片信息配对");
      expect(await harness.page.locator("[data-meta-color='item_0']").inputValue()).toBe("");
      expect(await harness.page.locator("[data-meta-item='item_0'] img").count()).toBe(1);
      expect(await harness.page.locator("[data-meta-item='item_0'] img").getAttribute("src")).toBe("/media/etsy-agent/outputs/item-1.png");

      await harness.page.click("#generateImageMetasBtn");
      await harness.page.waitForTimeout(100);

      expect(harness.workbenchRequests).toContain("POST /api/etsy-agent/desktop-batch/batch_runtime/workbench/image-metas/generate");
      expect(await harness.page.locator("[data-meta-color='item_0']").inputValue()).toBe("pink floral");
      await harness.page.fill("[data-meta-size='item_0']", "20 cm");
      await harness.page.click("#saveImageMetasBtn");
      await harness.page.waitForTimeout(100);

      expect(harness.workbenchRequests).toContain("PATCH /api/etsy-agent/desktop-batch/batch_runtime/workbench/image-metas");
      expect(harness.imageMetaPatchBodies.at(-1)?.metas).toMatchObject([{ itemId: "item_0", size: "20 cm" }]);
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
  const html = fs.readFileSync(path.resolve("public/etsy-image-agent.html"), "utf-8");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const finalizedRequests: string[] = [];
  const workbenchRequests: string[] = [];
  const folderSettingsRequests: string[] = [];
  const stylePatchBodies: Array<Record<string, unknown>> = [];
  const imageMetaPatchBodies: Array<Record<string, unknown>> = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => handleImageAgentRoute(route, html, batch, finalizedRequests, workbenchRequests, folderSettingsRequests, stylePatchBodies, imageMetaPatchBodies, options));
  await page.goto("http://local.test/etsy-image-agent");
  await page.waitForSelector("#listingBtn");
  return { browser, page, finalizedRequests, workbenchRequests, folderSettingsRequests, stylePatchBodies, imageMetaPatchBodies, pageErrors };
}

async function handleImageAgentRoute(
  route: Route,
  html: string,
  batch: MockBatch | null,
  finalizedRequests: string[],
  workbenchRequests: string[],
  folderSettingsRequests: string[],
  stylePatchBodies: Array<Record<string, unknown>>,
  imageMetaPatchBodies: Array<Record<string, unknown>>,
  options: { finalizeStatus?: number; finalizeBody?: Record<string, unknown>; initialImageMetasEmpty?: boolean },
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === "/etsy-image-agent") {
    await route.fulfill({ status: 200, contentType: "text/html", body: html });
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
