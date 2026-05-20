import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type archiverType from "archiver";
import { etsyAgentConfig, storagePathFromPublicUrl } from "./config.js";
import { deleteAsset, findAsset, findTask, initStorage, isRegisteredMediaPath, listAssets } from "./assetLibrary.js";
import { approveDesktopBatchItem, cleanupPendingDesktopCandidates, getCurrentDesktopBatch, regenerateDesktopBatchItem, scanDesktopBatchFolders, startDesktopBatchGeneration } from "./desktopBatchWorkflow.js";
import { findGroupSession, mergeGroups, moveImageBetweenGroups, renameGroup, saveGroupSession, setGroupLocked, setGroupMainImage, splitGroup } from "./groupSessionStore.js";
import { runRealImageSmokeTest } from "./realSmokeTest.js";
import { cancelTask, createEtsyAgentTask, getTask, getTasks, regenerateAsset, retryTask, retryTaskProduct } from "./taskQueue.js";
import { deleteLocalOpenAIKey, publicOpenAISettingsStatus, saveLocalOpenAIBaseURL, saveLocalOpenAIInputFidelity, saveLocalOpenAIKey, testOpenAIConnection } from "./secureConfig.js";
import { publicErrorPayload } from "./structuredErrors.js";
import { ETSY_PROMPT_TEMPLATES } from "./templates.js";
import type { AgentApiResponse } from "./types.js";
import { parseJsonBody, parseMultipartImages } from "./uploadParser.js";
import { safeJoin } from "./utils.js";

initStorage();
const require = createRequire(import.meta.url);
const archiver = require("archiver") as typeof archiverType;

export function isEtsyAgentRoute(url: string): boolean {
  return url.startsWith("/api/etsy-agent/") || url === "/api/etsy-agent";
}

export async function handleEtsyAgentRoute(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const pathname = url.pathname;
  if (!isEtsyAgentRoute(pathname)) return false;
  if (method === "OPTIONS") return json(res, 200, { ok: true });

  try {
    if (method === "GET" && pathname === "/api/etsy-agent/config") {
      const openAI = openAIOnlySettingsStatus();
      const publicBaseUrl = openAI.publicBaseUrl as { configured: boolean };
      return json(res, 200, {
        ok: true,
        data: {
          limits: publicLimits(),
          templates: ETSY_PROMPT_TEMPLATES,
          openaiConfigured: openAI.configured,
          mockOpenAI: false,
          model: openAI.model,
          publicBaseUrl,
          publicAssetBaseUrl: "",
          publicAssetBaseUrlConfigured: false,
          openAI,
        },
      });
    }

    if (method === "GET" && (pathname === "/api/etsy-agent/image-provider-settings" || pathname === "/api/etsy-agent/openai-settings")) {
      const data = openAIOnlySettingsStatus();
      return json(res, 200, { ok: true, deprecated: pathname.includes("openai-settings"), data });
    }

    if (method === "POST" && (pathname === "/api/etsy-agent/image-provider-settings" || pathname === "/api/etsy-agent/openai-settings")) {
      const body = parseJsonBody<{ apiKey?: string; openaiApiKey?: string; baseURL?: string; baseUrl?: string; openaiBaseURL?: string; openaiBaseUrl?: string; inputFidelity?: string; openaiInputFidelity?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      let status = publicOpenAISettingsStatus();
      if (typeof body.apiKey === "string" && body.apiKey.trim()) status = saveLocalOpenAIKey(body.apiKey);
      if (typeof body.openaiApiKey === "string" && body.openaiApiKey.trim()) status = saveLocalOpenAIKey(body.openaiApiKey);
      const baseURL = body.openaiBaseURL ?? body.openaiBaseUrl ?? body.baseURL ?? body.baseUrl;
      if (typeof baseURL === "string") status = saveLocalOpenAIBaseURL(baseURL);
      const inputFidelity = body.openaiInputFidelity ?? body.inputFidelity;
      if (typeof inputFidelity === "string") status = saveLocalOpenAIInputFidelity(inputFidelity);
      return json(res, 200, { ok: true, deprecated: pathname.includes("openai-settings"), data: openAIOnlySettingsStatus(status) });
    }

    if (method === "POST" && (pathname === "/api/etsy-agent/image-provider-settings/test" || pathname === "/api/etsy-agent/openai-settings/test")) {
      const result = await testOpenAIConnection();
      return json(res, result.ok ? 200 : 400, { ok: result.ok, deprecated: pathname.includes("openai-settings"), data: { ...result, status: openAIOnlySettingsStatus(result.status) }, error: result.ok ? undefined : result.message });
    }

    if (method === "POST" && (pathname === "/api/etsy-agent/image-provider-settings/test-real-image" || pathname === "/api/etsy-agent/openai-settings/test-real-image")) {
      const result = await runRealImageSmokeTest();
      return json(res, 200, { ok: true, deprecated: pathname.includes("openai-settings"), data: result });
    }

    if (method === "DELETE" && (pathname === "/api/etsy-agent/image-provider-settings/key" || pathname === "/api/etsy-agent/openai-settings/key")) {
      return json(res, 200, { ok: true, deprecated: pathname.includes("openai-settings"), data: openAIOnlySettingsStatus(deleteLocalOpenAIKey()) });
    }

    if (method === "DELETE" && (pathname === "/api/etsy-agent/image-provider-settings/ark-key" || pathname === "/api/etsy-agent/openai-settings/ark-key")) {
      return json(res, 410, { ok: false, error: "LEGACY_PROVIDER_REMOVED：当前版本只保留 OpenAI 图片接口。" });
    }

    if (method === "GET" && pathname === "/api/etsy-agent/desktop-batch") {
      return json(res, 200, { ok: true, data: getCurrentDesktopBatch() });
    }

    if (method === "GET" && pathname === "/api/etsy-agent/desktop-batch/scan") {
      return json(res, 200, { ok: true, data: scanDesktopBatchFolders() });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/desktop-batch/start") {
      const rawBody = await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes);
      const body = rawBody.length > 0 ? parseJsonBody<{ confirmedCostRisk?: boolean }>(rawBody) : {};
      return json(res, 201, { ok: true, data: startDesktopBatchGeneration({ confirmedCostRisk: Boolean(body.confirmedCostRisk) }) });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/desktop-batch/cleanup") {
      return json(res, 200, { ok: true, data: cleanupPendingDesktopCandidates() });
    }

    const desktopApproveMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/items\/([^/]+)\/approve$/);
    if (method === "POST" && desktopApproveMatch) {
      return json(res, 200, { ok: true, data: approveDesktopBatchItem(desktopApproveMatch[1]!) });
    }

    const desktopRegenerateMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/items\/([^/]+)\/regenerate$/);
    if (method === "POST" && desktopRegenerateMatch) {
      return json(res, 200, { ok: true, data: regenerateDesktopBatchItem(desktopRegenerateMatch[1]!) });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/group") {
      return json(res, 410, { ok: false, error: "LEGACY_UPLOAD_GROUP_FLOW_REMOVED：当前图片 Agent 已改为读取桌面固定文件夹。" });
    }

    if (pathname.startsWith("/api/etsy-agent/groups/")) {
      return json(res, 410, { ok: false, error: "LEGACY_GROUP_EDIT_FLOW_REMOVED：当前图片 Agent 不再使用上传分组工作流。" });
    }

    const groupSessionMatch = pathname.match(/^\/api\/etsy-agent\/groups\/([^/]+)$/);
    if (method === "GET" && groupSessionMatch) {
      const session = findGroupSession(groupSessionMatch[1]!);
      if (!session) return json(res, 404, { ok: false, error: "商品分组会话不存在。" });
      return json(res, 200, { ok: true, data: session });
    }

    const groupRenameMatch = pathname.match(/^\/api\/etsy-agent\/groups\/([^/]+)\/rename$/);
    if (method === "POST" && groupRenameMatch) {
      const body = parseJsonBody<{ groupId?: string; displayName?: string; sku?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const session = renameGroup(groupRenameMatch[1]!, requireString(body.groupId, "groupId"), requireString(body.displayName, "displayName"), body.sku);
      return json(res, 200, { ok: true, data: session });
    }

    const groupMainMatch = pathname.match(/^\/api\/etsy-agent\/groups\/([^/]+)\/main-image$/);
    if (method === "POST" && groupMainMatch) {
      const body = parseJsonBody<{ groupId?: string; imageId?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const session = setGroupMainImage(groupMainMatch[1]!, requireString(body.groupId, "groupId"), requireString(body.imageId, "imageId"));
      return json(res, 200, { ok: true, data: session });
    }

    const groupMoveMatch = pathname.match(/^\/api\/etsy-agent\/groups\/([^/]+)\/move-image$/);
    if (method === "POST" && groupMoveMatch) {
      const body = parseJsonBody<{ imageId?: string; fromGroupId?: string; toGroupId?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const session = moveImageBetweenGroups(groupMoveMatch[1]!, requireString(body.imageId, "imageId"), requireString(body.fromGroupId, "fromGroupId"), requireString(body.toGroupId, "toGroupId"));
      return json(res, 200, { ok: true, data: session });
    }

    const groupMergeMatch = pathname.match(/^\/api\/etsy-agent\/groups\/([^/]+)\/merge$/);
    if (method === "POST" && groupMergeMatch) {
      const body = parseJsonBody<{ sourceGroupIds?: string[]; targetName?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const session = mergeGroups(groupMergeMatch[1]!, body.sourceGroupIds ?? [], body.targetName);
      return json(res, 200, { ok: true, data: session });
    }

    const groupSplitMatch = pathname.match(/^\/api\/etsy-agent\/groups\/([^/]+)\/split$/);
    if (method === "POST" && groupSplitMatch) {
      const body = parseJsonBody<{ groupId?: string; imageIds?: string[]; newGroupName?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const session = splitGroup(groupSplitMatch[1]!, requireString(body.groupId, "groupId"), body.imageIds ?? [], body.newGroupName);
      return json(res, 200, { ok: true, data: session });
    }

    const groupLockMatch = pathname.match(/^\/api\/etsy-agent\/groups\/([^/]+)\/lock$/);
    if (method === "POST" && groupLockMatch) {
      const body = parseJsonBody<{ groupId?: string; locked?: boolean }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const session = setGroupLocked(groupLockMatch[1]!, requireString(body.groupId, "groupId"), Boolean(body.locked));
      return json(res, 200, { ok: true, data: session });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/tasks") {
      return json(res, 410, { ok: false, error: "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 已改为桌面批量 OpenAI 图生图。" });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/reference-preflight") {
      return json(res, 410, { ok: false, error: "LEGACY_REFERENCE_PREFLIGHT_REMOVED：当前版本不再使用公网参考图预检。" });
    }

    if (method === "GET" && pathname === "/api/etsy-agent/tasks") {
      return json(res, 410, { ok: false, error: "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 使用 /api/etsy-agent/desktop-batch。" });
    }

    const taskMatch = pathname.match(/^\/api\/etsy-agent\/tasks\/([^/]+)$/);
    if (method === "GET" && taskMatch) {
      return json(res, 410, { ok: false, error: "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 使用 /api/etsy-agent/desktop-batch。" });
    }

    const retryMatch = pathname.match(/^\/api\/etsy-agent\/tasks\/([^/]+)\/retry$/);
    if (method === "POST" && retryMatch) {
      return json(res, 410, { ok: false, error: "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 使用桌面批量工作流。" });
    }

    const cancelMatch = pathname.match(/^\/api\/etsy-agent\/tasks\/([^/]+)\/cancel$/);
    if (method === "POST" && cancelMatch) {
      return json(res, 410, { ok: false, error: "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 使用桌面批量工作流。" });
    }

    const productRetryMatch = pathname.match(/^\/api\/etsy-agent\/tasks\/([^/]+)\/products\/([^/]+)\/retry$/);
    if (method === "POST" && productRetryMatch) {
      return json(res, 410, { ok: false, error: "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 使用桌面批量工作流。" });
    }

    const taskDownloadMatch = pathname.match(/^\/api\/etsy-agent\/tasks\/([^/]+)\/download$/);
    if (method === "GET" && taskDownloadMatch) {
      return json(res, 410, { ok: false, error: "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 使用素材库下载单张候选图。" });
    }

    if (method === "GET" && pathname === "/api/etsy-agent/assets") {
      const taskId = url.searchParams.get("taskId");
      const productGroupId = url.searchParams.get("productGroupId");
      const etsyImageType = url.searchParams.get("etsyImageType");
      const qualityStatus = url.searchParams.get("qualityStatus");
      const etsyComplianceStatus = url.searchParams.get("etsyComplianceStatus");
      const createdFrom = url.searchParams.get("createdFrom");
      const createdTo = url.searchParams.get("createdTo");
      let assets = listAssets();
      if (taskId) assets = assets.filter((a) => a.taskId === taskId);
      if (productGroupId) assets = assets.filter((a) => a.productGroupId === productGroupId);
      if (etsyImageType) assets = assets.filter((a) => a.etsyImageType === etsyImageType);
      if (qualityStatus) assets = assets.filter((a) => a.qualityStatus === qualityStatus);
      if (etsyComplianceStatus) assets = assets.filter((a) => a.etsyComplianceStatus === etsyComplianceStatus);
      if (createdFrom) assets = assets.filter((a) => new Date(a.createdAt).getTime() >= new Date(createdFrom).getTime());
      if (createdTo) assets = assets.filter((a) => new Date(a.createdAt).getTime() <= new Date(createdTo).getTime());
      return json(res, 200, { ok: true, data: assets });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/assets/bulk-delete") {
      const body = parseJsonBody<{ assetIds?: string[] }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const ids = body.assetIds ?? [];
      const deleted = ids.filter((id) => deleteAsset(id));
      return json(res, 200, { ok: true, data: { deleted: deleted.length, assetIds: deleted } });
    }

    const assetMatch = pathname.match(/^\/api\/etsy-agent\/assets\/([^/]+)$/);
    if (method === "DELETE" && assetMatch) {
      const ok = deleteAsset(assetMatch[1]!);
      return json(res, ok ? 200 : 404, ok ? { ok: true, data: { deleted: true } } : { ok: false, error: "素材不存在。" });
    }

    const regenerateMatch = pathname.match(/^\/api\/etsy-agent\/assets\/([^/]+)\/regenerate$/);
    if (method === "POST" && regenerateMatch) {
      return json(res, 410, { ok: false, error: "LEGACY_ASSET_REGENERATE_REMOVED：请在图片 Agent 主页面对待审查图片点击重新生成。" });
    }

    if (method === "GET" && pathname === "/api/etsy-agent/assets/download") {
      const assetId = url.searchParams.get("assetId") ?? "";
      const asset = findAsset(assetId);
      if (!asset) return json(res, 404, { ok: false, error: "素材不存在。" });
      return streamFile(res, asset.generatedFilePath, path.basename(asset.generatedFilePath));
    }

    if (method === "POST" && pathname === "/api/etsy-agent/estimate") {
      return json(res, 410, { ok: false, error: "LEGACY_ESTIMATE_FLOW_REMOVED：当前图片 Agent 使用桌面批量 OpenAI 工作流。" });
    }

    return json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return json(res, 400, { ok: false, ...publicErrorPayload(error) });
  }
}

export function tryServeEtsyMedia(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const rawUrl = req.url ?? "/";
  if (!rawUrl.startsWith(etsyAgentConfig.publicMediaPrefix)) return false;
  try {
    const filePath = storagePathFromPublicUrl(rawUrl);
    const safe = safeJoin(etsyAgentConfig.storageRoot, path.relative(etsyAgentConfig.storageRoot, filePath));
    if (!fs.existsSync(safe) || !isRegisteredMediaPath(safe)) {
      text(res, 404, "Not found");
      return true;
    }
    streamFile(res, safe, path.basename(safe));
    return true;
  } catch {
    text(res, 400, "Bad media path");
    return true;
  }
}

function publicLimits(): Record<string, unknown> {
  return {
    maxUploadImages: etsyAgentConfig.maxUploadImages,
    maxProductGroups: etsyAgentConfig.maxProductGroups,
    maxReferenceImagesPerProduct: etsyAgentConfig.maxReferenceImagesPerProduct,
    maxImagesPerProduct: etsyAgentConfig.maxImagesPerProduct,
    maxBatchGeneratedImages: etsyAgentConfig.maxBatchGeneratedImages,
    maxConcurrentGenerations: etsyAgentConfig.maxConcurrentGenerations,
    targetExportSize: etsyAgentConfig.targetExportSize,
    maxJsonBodyBytes: etsyAgentConfig.maxJsonBodyBytes,
    maxMultipartBodyBytes: etsyAgentConfig.maxMultipartBodyBytes,
    isVercelPreview: etsyAgentConfig.isVercel,
    assetStorageProvider: etsyAgentConfig.storageProvider,
    previewMaxProductGroups: etsyAgentConfig.isVercel ? 1 : etsyAgentConfig.maxProductGroups,
    previewMaxImagesPerProduct: etsyAgentConfig.isVercel ? 1 : etsyAgentConfig.maxImagesPerProduct,
  };
}

function openAIOnlySettingsStatus(input = publicOpenAISettingsStatus()): Record<string, unknown> {
  const openaiProvider = input.providersById.openai;
  const diagnostics = input.diagnostics;
  return {
    configured: openaiProvider.configured,
    source: openaiProvider.keySource === "none" ? "not_configured" : openaiProvider.keySource,
    maskedKey: openaiProvider.maskedKey ?? "",
    keyFingerprint: openaiProvider.fingerprint ?? "",
    mode: "real",
    provider: "openai",
    selectedProvider: "openai",
    model: openaiProvider.model,
    imageSize: openaiProvider.imageSize,
    imageQuality: openaiProvider.imageQuality,
    inputFidelity: openaiProvider.inputFidelity,
    inputFidelitySource: openaiProvider.inputFidelitySource,
    baseURL: openaiProvider.baseURL ?? "",
    baseUrl: openaiProvider.baseURL ?? "",
    baseURLSource: openaiProvider.baseURLSource,
    providers: [{
      id: "openai",
      label: "OpenAI 图像生成",
      configured: openaiProvider.configured,
      ready: openaiProvider.ready,
      required: true,
      source: openaiProvider.keySource === "none" ? "not_configured" : openaiProvider.keySource,
      keySource: openaiProvider.keySource,
      maskedKey: openaiProvider.maskedKey ?? "",
      fingerprint: openaiProvider.fingerprint ?? "",
      baseURL: openaiProvider.baseURL ?? "",
      baseURLSource: openaiProvider.baseURLSource,
      inputFidelity: openaiProvider.inputFidelity,
      inputFidelitySource: openaiProvider.inputFidelitySource,
      model: openaiProvider.model,
      imageSize: openaiProvider.imageSize,
      imageQuality: openaiProvider.imageQuality,
    }],
    providersById: { openai: openaiProvider },
    imageProviderConfig: {
      selectedProvider: "openai",
      realGenerationEnabled: input.flags.realGenerationEnabled,
      mockMode: false,
      providers: { openai: openaiProvider },
      diagnostics: diagnostics.map((item) => item.code),
      diagnosticsDetailed: diagnostics,
    },
    diagnostics,
    publicBaseUrl: {
      configured: false,
      value: null,
      isLocalhost: false,
      validForExternalProvider: false,
      note: "not required for OpenAI",
    },
    publicAssetBaseUrl: "",
    publicAssetBaseUrlConfigured: false,
    maxConcurrentGenerations: input.maxConcurrentGenerations,
    maxBatchGeneratedImages: input.maxBatchGeneratedImages,
    enableRealGeneration: input.enableRealGeneration,
    flags: {
      realGenerationEnabled: input.flags.realGenerationEnabled,
      mockMode: false,
    },
    allowWebKeyConfig: input.allowWebKeyConfig,
    configPath: input.configPath,
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 不能为空。`);
  return value.trim();
}

function json<T>(res: http.ServerResponse, status: number, payload: AgentApiResponse<T> | Record<string, unknown>): true {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
  return true;
}

function text(res: http.ServerResponse, status: number, body: string): true {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(body);
  return true;
}

function streamFile(res: http.ServerResponse, filePath: string, downloadName: string): true {
  const ext = path.extname(filePath).toLowerCase();
  const ct = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": ct,
    "Content-Disposition": `inline; filename="${downloadName.replace(/"/g, "")}"`,
    "Access-Control-Allow-Origin": "*",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function streamZip(res: http.ServerResponse, taskId: string, files: string[]): true {
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${taskId}.zip"`,
    "Access-Control-Allow-Origin": "*",
  });
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    if (!res.headersSent) res.writeHead(500);
    res.end(err.message);
  });
  archive.pipe(res);
  for (const file of files.filter((f) => fs.existsSync(f))) {
    archive.file(file, { name: path.basename(file) });
  }
  void archive.finalize();
  return true;
}

function readRawBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const len = Number(req.headers["content-length"] ?? 0);
    if (len > maxBytes) {
      reject(new Error(`请求体过大，最大允许 ${maxBytes} bytes。`));
      req.destroy();
      return;
    }
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`请求体过大，最大允许 ${maxBytes} bytes。`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
