import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type archiverType from "archiver";
import { etsyAgentConfig, storagePathFromPublicUrl } from "./config.js";
import { deleteAsset, findAsset, findTask, initStorage, isRegisteredMediaPath, listAssets } from "./assetLibrary.js";
import { approveDesktopBatchItem, approvePromptAndGenerateImage, cleanupPendingDesktopCandidates, getCurrentDesktopBatch, getDesktopBatchById, regenerateDesktopBatchItem, scanDesktopBatchFolders, startDesktopBatchGeneration } from "./desktopBatchWorkflow.js";
import { getImageAgentFolderSettings, saveImageAgentFolderSettings } from "./folderSettings.js";
import { findGroupSession, mergeGroups, moveImageBetweenGroups, renameGroup, saveGroupSession, setGroupLocked, setGroupMainImage, splitGroup } from "./groupSessionStore.js";
import { findInputAsset } from "./inputAssetRegistry.js";
import { finalizeBatchListing, listProductListingRecords, regenerateProductListingRecord, reviseProductListingWithSuggestion, updateProductListingRecord } from "./listingGenerationService.js";
import { generateProductWorkbenchStyleNames, getProductWorkbench, syncProductWorkbench, updateProductWorkbenchStyleNames } from "./productWorkbenchService.js";
import { clearStalePromptProviderFailures, generatePromptsFromImages, listImagePromptRecords, regenerateImagePromptRecord, saveManualImagePromptRecord, updateImagePromptRecord } from "./promptGenerationService.js";
import { runRealImageSmokeTest } from "./realSmokeTest.js";
import { cancelTask, createEtsyAgentTask, getTask, getTasks, regenerateAsset, retryTask, retryTaskProduct } from "./taskQueue.js";
import { deleteLocalGpt55Key, deleteLocalOpenAIKey, publicOpenAISettingsStatus, saveLocalGpt55PromptSettings, saveLocalOpenAIBaseURL, saveLocalOpenAIInputFidelity, saveLocalOpenAIKey, testGpt55PromptProviderConnection, testOpenAIConnection } from "./secureConfig.js";
import { publicErrorPayload } from "./structuredErrors.js";
import { ETSY_PROMPT_TEMPLATES } from "./templates.js";
import type { AgentApiResponse } from "./types.js";
import { parseJsonBody, parseMultipartImages } from "./uploadParser.js";
import { safeJoin } from "./utils.js";

initStorage();

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

    if (method === "GET" && pathname === "/api/etsy-agent/folder-settings") {
      return json(res, 200, { ok: true, data: getImageAgentFolderSettings() });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/folder-settings") {
      const body = parseJsonBody<{ inputDir?: string; outputDir?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      return json(res, 200, { ok: true, data: saveImageAgentFolderSettings(body) });
    }

    if (method === "POST" && (pathname === "/api/etsy-agent/image-provider-settings" || pathname === "/api/etsy-agent/openai-settings")) {
      const body = parseJsonBody<{ apiKey?: string; openaiApiKey?: string; baseURL?: string; baseUrl?: string; openaiBaseURL?: string; openaiBaseUrl?: string; inputFidelity?: string; openaiInputFidelity?: string; gpt55ApiKey?: string; gpt55BaseURL?: string; gpt55BaseUrl?: string; gpt55Model?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      let status = publicOpenAISettingsStatus();
      if (typeof body.apiKey === "string" && body.apiKey.trim()) status = saveLocalOpenAIKey(body.apiKey);
      if (typeof body.openaiApiKey === "string" && body.openaiApiKey.trim()) status = saveLocalOpenAIKey(body.openaiApiKey);
      const baseURL = body.openaiBaseURL ?? body.openaiBaseUrl ?? body.baseURL ?? body.baseUrl;
      if (typeof baseURL === "string") status = saveLocalOpenAIBaseURL(baseURL);
      const inputFidelity = body.openaiInputFidelity ?? body.inputFidelity;
      if (typeof inputFidelity === "string") status = saveLocalOpenAIInputFidelity(inputFidelity);
      const gpt55BaseURL = body.gpt55BaseURL ?? body.gpt55BaseUrl;
      let stalePromptFailuresCleared = 0;
      if ((typeof body.gpt55ApiKey === "string" && body.gpt55ApiKey.trim()) || typeof gpt55BaseURL === "string" || typeof body.gpt55Model === "string") {
        status = saveLocalGpt55PromptSettings({
          apiKey: body.gpt55ApiKey,
          baseURL: gpt55BaseURL,
          model: body.gpt55Model,
        });
        if (typeof gpt55BaseURL === "string" || typeof body.gpt55Model === "string") {
          stalePromptFailuresCleared = clearStalePromptProviderFailures().deleted;
        }
      }
      return json(res, 200, { ok: true, deprecated: pathname.includes("openai-settings"), data: { ...openAIOnlySettingsStatus(status), stalePromptFailuresCleared } });
    }

    if (method === "POST" && (pathname === "/api/etsy-agent/image-provider-settings/test" || pathname === "/api/etsy-agent/openai-settings/test")) {
      const result = await testOpenAIConnection();
      return json(res, result.ok ? 200 : 400, { ok: result.ok, deprecated: pathname.includes("openai-settings"), data: { ...result, status: openAIOnlySettingsStatus(result.status) }, error: result.ok ? undefined : result.message });
    }

    if (method === "POST" && (pathname === "/api/etsy-agent/image-provider-settings/test-prompt-provider" || pathname === "/api/etsy-agent/openai-settings/test-prompt-provider")) {
      const result = await testGpt55PromptProviderConnection();
      return json(res, result.ok ? 200 : 400, { ok: result.ok, deprecated: pathname.includes("openai-settings"), data: { ...result, status: openAIOnlySettingsStatus(result.status) }, error: result.ok ? undefined : result.message });
    }

    if (method === "POST" && (pathname === "/api/etsy-agent/image-provider-settings/test-real-image" || pathname === "/api/etsy-agent/openai-settings/test-real-image")) {
      const result = await runRealImageSmokeTest();
      return json(res, 200, { ok: true, deprecated: pathname.includes("openai-settings"), data: result });
    }

    if (method === "DELETE" && (pathname === "/api/etsy-agent/image-provider-settings/key" || pathname === "/api/etsy-agent/openai-settings/key")) {
      return json(res, 200, { ok: true, deprecated: pathname.includes("openai-settings"), data: openAIOnlySettingsStatus(deleteLocalOpenAIKey()) });
    }

    if (method === "DELETE" && (pathname === "/api/etsy-agent/image-provider-settings/gpt55-key" || pathname === "/api/etsy-agent/openai-settings/gpt55-key")) {
      return json(res, 200, { ok: true, deprecated: pathname.includes("openai-settings"), data: openAIOnlySettingsStatus(deleteLocalGpt55Key()) });
    }

    if (method === "GET" && pathname === "/api/etsy-agent/desktop-batch") {
      return json(res, 200, { ok: true, data: getCurrentDesktopBatch() });
    }

    if (method === "GET" && pathname === "/api/etsy-agent/desktop-batch/scan") {
      clearStalePromptProviderFailures();
      return json(res, 200, { ok: true, data: scanDesktopBatchFolders() });
    }

    const inputAssetImageMatch = pathname.match(/^\/api\/etsy-agent\/input-assets\/([^/]+)\/image$/);
    if (method === "GET" && inputAssetImageMatch) {
      const asset = findInputAsset(decodeURIComponent(inputAssetImageMatch[1]!));
      if (!asset || !fs.existsSync(asset.filePath)) return text(res, 404, "Not found");
      return streamFile(res, asset.filePath, asset.fileName);
    }

    if (method === "GET" && pathname === "/api/etsy-agent/prompts") {
      clearStalePromptProviderFailures();
      const inputAssetId = url.searchParams.get("inputAssetId") ?? undefined;
      return json(res, 200, { ok: true, data: { records: listImagePromptRecords(inputAssetId) } });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/prompts/manual") {
      clearStalePromptProviderFailures();
      const body = parseJsonBody<{ inputAssetId?: string; productGroupId?: string; role?: "main" | "secondary" | "detail" | "lifestyle"; promptText?: string; negativePrompt?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const record = saveManualImagePromptRecord({
        inputAssetId: requireString(body.inputAssetId, "inputAssetId"),
        productGroupId: body.productGroupId,
        role: body.role,
        promptText: requireString(body.promptText, "promptText"),
        negativePrompt: body.negativePrompt,
      });
      return json(res, 201, { ok: true, data: record });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/prompts/generate-from-images") {
      clearStalePromptProviderFailures();
      const rawBody = await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes);
      const body = rawBody.length > 0 ? parseJsonBody<{ assetIds?: string[]; productGroupId?: string; stylePreset?: "american_vintage_etsy"; roles?: Array<"main" | "secondary" | "detail" | "lifestyle">; mode?: "missing" | "regenerate" }>(rawBody) : {};
      const result = await generatePromptsFromImages({
        assetIds: body.assetIds,
        productGroupId: body.productGroupId,
        stylePreset: body.stylePreset,
        roles: body.roles,
        mode: body.mode,
      });
      return json(res, 200, { ok: true, data: result, records: result.records, failed: result.failed, skipped: result.skipped });
    }

    const promptApproveGenerateMatch = pathname.match(/^\/api\/etsy-agent\/prompts\/([^/]+)\/approve-and-generate$/);
    if (method === "POST" && promptApproveGenerateMatch) {
      const rawBody = await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes);
      const body = rawBody.length > 0 ? parseJsonBody<{ confirmedCostRisk?: boolean }>(rawBody) : {};
      const batch = approvePromptAndGenerateImage(decodeURIComponent(promptApproveGenerateMatch[1]!), {
        confirmedCostRisk: Boolean(body.confirmedCostRisk),
      });
      return json(res, 200, { ok: true, data: batch });
    }

    const promptPatchMatch = pathname.match(/^\/api\/etsy-agent\/prompts\/([^/]+)$/);
    if (method === "PATCH" && promptPatchMatch) {
      const body = parseJsonBody<{ role?: "main" | "secondary" | "detail" | "lifestyle"; promptText?: string; negativePrompt?: string; status?: "edited" | "approved" }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const record = updateImagePromptRecord(decodeURIComponent(promptPatchMatch[1]!), body);
      return json(res, 200, { ok: true, data: record });
    }

    const promptRegenerateMatch = pathname.match(/^\/api\/etsy-agent\/prompts\/([^/]+)\/regenerate$/);
    if (method === "POST" && promptRegenerateMatch) {
      const rawBody = await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes);
      const body = rawBody.length > 0 ? parseJsonBody<{ confirmedOverwrite?: boolean }>(rawBody) : {};
      const record = await regenerateImagePromptRecord(decodeURIComponent(promptRegenerateMatch[1]!), { confirmedOverwrite: Boolean(body.confirmedOverwrite) });
      return json(res, 200, { ok: true, data: record });
    }

    if (method === "GET" && pathname === "/api/etsy-agent/listings") {
      const batchId = url.searchParams.get("batchId") ?? undefined;
      return json(res, 200, { ok: true, data: { records: listProductListingRecords(batchId) } });
    }

    const listingPatchMatch = pathname.match(/^\/api\/etsy-agent\/listings\/([^/]+)$/);
    if (method === "PATCH" && listingPatchMatch) {
      const body = parseJsonBody<{ title?: string; description?: string; colors?: string; sizeInfo?: string; materials?: string; keywords?: string[] | string; status?: "edited" | "approved" }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const record = updateProductListingRecord(decodeURIComponent(listingPatchMatch[1]!), body);
      return json(res, 200, { ok: true, data: record });
    }

    const listingRegenerateMatch = pathname.match(/^\/api\/etsy-agent\/listings\/([^/]+)\/regenerate$/);
    if (method === "POST" && listingRegenerateMatch) {
      const record = await regenerateProductListingRecord(decodeURIComponent(listingRegenerateMatch[1]!));
      return json(res, 200, { ok: true, data: record });
    }

    const listingReviseMatch = pathname.match(/^\/api\/etsy-agent\/listings\/([^/]+)\/revise-with-suggestion$/);
    if (method === "POST" && listingReviseMatch) {
      const body = parseJsonBody<{ suggestion?: string }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const result = await reviseProductListingWithSuggestion(decodeURIComponent(listingReviseMatch[1]!), body);
      return json(res, 200, { ok: true, data: result });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/desktop-batch/start") {
      const rawBody = await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes);
      const body = rawBody.length > 0 ? parseJsonBody<{ confirmedCostRisk?: boolean }>(rawBody) : {};
      return json(res, 201, { ok: true, data: startDesktopBatchGeneration({ confirmedCostRisk: Boolean(body.confirmedCostRisk) }) });
    }

    if (method === "POST" && pathname === "/api/etsy-agent/desktop-batch/cleanup") {
      return json(res, 200, { ok: true, data: cleanupPendingDesktopCandidates() });
    }

    const desktopWorkbenchMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/([^/]+)\/workbench$/);
    if (desktopWorkbenchMatch) {
      const batchId = decodeURIComponent(desktopWorkbenchMatch[1]!);
      if (method === "GET") return json(res, 200, { ok: true, data: getProductWorkbench(batchId) });
      if (method === "POST") return json(res, 200, { ok: true, data: syncProductWorkbench(batchId) });
    }

    const desktopWorkbenchImageMetasMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/([^/]+)\/workbench\/image-metas$/);
    if (desktopWorkbenchImageMetasMatch) {
      return json(res, 410, { ok: false, error: "PRODUCT_IMAGE_META_ENDPOINT_REMOVED：该旧接口已移除，请使用款式英文名和 Listing 建议改写流程。" });
    }

    const desktopWorkbenchGenerateImageMetasMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/([^/]+)\/workbench\/image-metas\/generate$/);
    if (desktopWorkbenchGenerateImageMetasMatch) {
      return json(res, 410, { ok: false, error: "PRODUCT_IMAGE_META_ENDPOINT_REMOVED：该旧接口已移除，请使用款式英文名和 Listing 建议改写流程。" });
    }

    const desktopWorkbenchStyleNamesMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/([^/]+)\/workbench\/style-names$/);
    if (method === "PATCH" && desktopWorkbenchStyleNamesMatch) {
      const body = parseJsonBody<{ styles?: Array<{ itemId: string; styleNameEn?: string }> }>(await readRawBody(req, etsyAgentConfig.maxJsonBodyBytes));
      const record = updateProductWorkbenchStyleNames(decodeURIComponent(desktopWorkbenchStyleNamesMatch[1]!), body.styles ?? []);
      return json(res, 200, { ok: true, data: record });
    }

    const desktopWorkbenchGenerateStyleNamesMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/([^/]+)\/workbench\/style-names\/generate$/);
    if (method === "POST" && desktopWorkbenchGenerateStyleNamesMatch) {
      const record = await generateProductWorkbenchStyleNames(decodeURIComponent(desktopWorkbenchGenerateStyleNamesMatch[1]!));
      return json(res, 200, { ok: true, data: record });
    }

    const desktopFinalizeListingMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/([^/]+)\/finalize-listing$/);
    if (method === "POST" && desktopFinalizeListingMatch) {
      const record = await finalizeBatchListing(decodeURIComponent(desktopFinalizeListingMatch[1]!));
      return json(res, 200, { ok: true, data: record });
    }

    const desktopOutputImageMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/([^/]+)\/items\/([^/]+)\/output-image$/);
    if (method === "GET" && desktopOutputImageMatch) {
      return streamDesktopBatchOutputImage(res, decodeURIComponent(desktopOutputImageMatch[1]!), decodeURIComponent(desktopOutputImageMatch[2]!));
    }

    const desktopApproveMatch = pathname.match(/^\/api\/etsy-agent\/desktop-batch\/items\/([^/]+)\/approve$/);
    if (method === "POST" && desktopApproveMatch) {
      return json(res, 200, { ok: true, data: await approveDesktopBatchItem(desktopApproveMatch[1]!) });
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
      return json(res, 410, { ok: false, error: "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 使用图片审核区保存候选图。" });
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
  const mediaPrefix = etsyAgentConfig.publicMediaPrefix;
  if (rawUrl !== mediaPrefix && !rawUrl.startsWith(`${mediaPrefix}/`)) return false;
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
    promptProvider: input.promptProvider,
    promptProviderId: input.promptProvider.provider,
    gpt55PromptModel: input.promptProvider.model,
    gpt55PromptModelSource: input.promptProvider.modelSource,
    gpt55PromptModelEffectiveSource: input.promptProvider.modelEffectiveSource,
    gpt55PromptModelOverriddenBySession: input.promptProvider.modelOverriddenBySession,
    gpt55PromptReady: input.promptProvider.ready,
    gpt55PromptPendingModel: input.promptProvider.pendingModel,
    gpt55PromptPendingModelSource: input.promptProvider.pendingModelSource,
    gpt55PromptPendingBaseURL: input.promptProvider.pendingBaseURL,
    gpt55PromptPendingBaseURLSource: input.promptProvider.pendingBaseURLSource,
    gpt55PromptConfigured: input.promptProvider.configured,
    gpt55PromptApiKeyConfigured: input.promptProvider.apiKeyConfigured,
    gpt55PromptKeySource: input.promptProvider.keySource,
    gpt55PromptMaskedKey: input.promptProvider.maskedKey,
    gpt55PromptFingerprint: input.promptProvider.fingerprint,
    gpt55PromptBaseURL: input.promptProvider.baseURL,
    gpt55PromptBaseURLSource: input.promptProvider.baseURLSource,
    gpt55PromptMaxInputMb: input.promptProvider.maxInputMb,
    gpt55PromptBatchLimit: input.promptProvider.batchLimit,
    supportsImageInput: input.promptProvider.supportsImageInput,
    gpt55PromptValidationStatus: input.promptProvider.validationStatus,
    gpt55PromptLastValidationError: input.promptProvider.lastValidationError,
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

function createLocalRequire(): NodeJS.Require {
  try {
    return createRequire(import.meta.url);
  } catch {
    return createRequire(path.join(process.cwd(), "package.json"));
  }
}

function createArchive(format: "zip", options: { zlib: { level: number } }): ReturnType<typeof archiverType> {
  const archiver = createLocalRequire()("archiver") as typeof archiverType;
  return archiver(format, options);
}

function streamDesktopBatchOutputImage(res: http.ServerResponse, batchId: string, itemId: string): true {
  const batch = getDesktopBatchById(batchId);
  const item = batch?.items.find((candidate) => candidate.itemId === itemId);
  if (!batch || !item || item.status !== "approved" || !item.outputFilePath) {
    return text(res, 404, "Not found");
  }
  const outputDir = path.resolve(batch.outputDir);
  const outputPath = path.resolve(item.outputFilePath);
  const relative = path.relative(outputDir, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(outputPath)) {
    return text(res, 404, "Not found");
  }
  return streamFile(res, outputPath, item.outputFileName ?? path.basename(outputPath));
}

function streamFile(res: http.ServerResponse, filePath: string, downloadName: string): true {
  const ext = path.extname(filePath).toLowerCase();
  const ct = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": ct,
    "Access-Control-Allow-Origin": "*",
  };
  if (!ct.startsWith("image/")) {
    headers["Content-Disposition"] = contentDispositionAttachment(downloadName);
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function contentDispositionAttachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii || "download"}"; filename*=UTF-8''${encodeRFC5987(fileName)}`;
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function streamZip(res: http.ServerResponse, taskId: string, files: string[]): true {
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${taskId}.zip"`,
    "Access-Control-Allow-Origin": "*",
  });
  const archive = createArchive("zip", { zlib: { level: 9 } });
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
