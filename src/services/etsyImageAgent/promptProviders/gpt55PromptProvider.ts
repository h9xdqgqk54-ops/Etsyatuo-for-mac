import * as fs from "node:fs";
import { fetchWithTimeout, readResponseTextLimited } from "../httpUtils.js";
import { getEffectiveGpt55PromptSettings, sanitizeProviderError, type EffectiveGpt55PromptSettings } from "../secureConfig.js";
import { structuredError } from "../structuredErrors.js";
import type { ImagePromptRole } from "../types.js";
import type { GenerateImageMetasInput, GenerateImageMetasResult, GenerateListingCopyInput, GenerateListingCopyResult, GeneratePromptInput, GeneratePromptResult, GenerateStyleNamesInput, GenerateStyleNamesResult, ListingCopyImageInput, PromptProvider } from "./types.js";

const SUPPORTED_PROMPT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const GPT55_PROMPT_TIMEOUT_MS = 120_000;

export const gpt55PromptProvider: PromptProvider = {
  id: "gpt55",
  async generatePrompt(input): Promise<GeneratePromptResult> {
    const settings = getEffectiveGpt55PromptSettings();
    assertGpt55PromptConfig(settings);
    validatePromptImage(input, settings);
    const requestBody = buildGpt55PromptRequest(input, settings);
    let requestId: string | undefined;
    try {
      const response = await fetchWithTimeout(chatCompletionsUrl(settings.baseURL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }, "GPT5.5图片理解", GPT55_PROMPT_TIMEOUT_MS);
      requestId = response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? undefined;
      const text = await readResponseTextLimited(response, "GPT5.5图片理解响应", 1024 * 1024);
      if (!response.ok) throw Gpt55PromptHttpError(response.status, text, requestId);
      const content = extractGpt55MessageContent(text, requestId);
      const parsed = parseGpt55PromptJson(content, requestId);
      return {
        ...parsed,
        model: settings.model,
        providerTraceId: requestId,
        promptProviderRequestId: requestId,
      };
    } catch (error) {
      if (isKnownStructuredPromptError(error)) throw error;
      throw structuredError({
        code: "GPT55_PROMPT_GENERATION_FAILED",
        message: "GPT55_PROMPT_GENERATION_FAILED：GPT5.5图片理解生成提示词失败。",
        provider: "gpt55",
        model: settings.model,
        requestId,
        reason: sanitizeProviderError(error),
      });
    }
  },
  async generateListingCopy(input): Promise<GenerateListingCopyResult> {
    const settings = getEffectiveGpt55PromptSettings();
    assertGpt55PromptConfig(settings);
    if (input.images.length === 0) {
      throw structuredError({
        code: "LISTING_APPROVED_IMAGE_REQUIRED",
        message: "LISTING_APPROVED_IMAGE_REQUIRED：至少需要 1 张已通过并输出的图片才能生成商品文案。",
        provider: "gpt55",
        model: settings.model,
      });
    }
    input.images.forEach((image) => validateListingImage(image, settings));
    const requestBody = buildGpt55ListingCopyRequest(input, settings);
    let requestId: string | undefined;
    try {
      const response = await fetchWithTimeout(chatCompletionsUrl(settings.baseURL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }, "GPT5.5 Etsy 商品文案", GPT55_PROMPT_TIMEOUT_MS);
      requestId = response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? undefined;
      const text = await readResponseTextLimited(response, "GPT5.5 Etsy 商品文案响应", 1024 * 1024);
      if (!response.ok) throw Gpt55PromptHttpError(response.status, text, requestId);
      const content = extractGpt55MessageContent(text, requestId);
      const parsed = parseGpt55ListingCopyJson(content, requestId);
      return {
        ...parsed,
        model: settings.model,
        providerTraceId: requestId,
        promptProviderRequestId: requestId,
      };
    } catch (error) {
      if (isKnownStructuredPromptError(error)) throw error;
      throw structuredError({
        code: "GPT55_LISTING_GENERATION_FAILED",
        message: "GPT55_LISTING_GENERATION_FAILED：GPT5.5生成 Etsy 商品文案失败。",
        provider: "gpt55",
        model: settings.model,
        requestId,
        reason: sanitizeProviderError(error),
      });
    }
  },
  async generateStyleNames(input): Promise<GenerateStyleNamesResult> {
    const settings = getEffectiveGpt55PromptSettings();
    assertGpt55PromptConfig(settings);
    if (input.images.length === 0) {
      throw structuredError({
        code: "LISTING_APPROVED_IMAGE_REQUIRED",
        message: "LISTING_APPROVED_IMAGE_REQUIRED：至少需要 1 张已通过并输出的图片才能生成款式英文名。",
        provider: "gpt55",
        model: settings.model,
      });
    }
    input.images.forEach((image) => validateListingImage(image, settings));
    const requestBody = buildGpt55StyleNamesRequest(input, settings);
    let requestId: string | undefined;
    try {
      const response = await fetchWithTimeout(chatCompletionsUrl(settings.baseURL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }, "GPT5.5商品款式英文名", GPT55_PROMPT_TIMEOUT_MS);
      requestId = response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? undefined;
      const text = await readResponseTextLimited(response, "GPT5.5商品款式英文名响应", 1024 * 1024);
      if (!response.ok) throw Gpt55PromptHttpError(response.status, text, requestId);
      const content = extractGpt55MessageContent(text, requestId);
      const parsed = parseGpt55StyleNamesJson(content, requestId);
      return {
        ...parsed,
        model: settings.model,
        providerTraceId: requestId,
        promptProviderRequestId: requestId,
      };
    } catch (error) {
      if (isKnownStructuredPromptError(error)) throw error;
      throw structuredError({
        code: "GPT55_STYLE_NAME_GENERATION_FAILED",
        message: "GPT55_STYLE_NAME_GENERATION_FAILED：GPT5.5生成商品款式英文名失败。",
        provider: "gpt55",
        model: settings.model,
        requestId,
        reason: sanitizeProviderError(error),
      });
    }
  },
  async generateImageMetas(input): Promise<GenerateImageMetasResult> {
    const settings = getEffectiveGpt55PromptSettings();
    assertGpt55PromptConfig(settings);
    if (input.images.length === 0) {
      throw structuredError({
        code: "LISTING_APPROVED_IMAGE_REQUIRED",
        message: "LISTING_APPROVED_IMAGE_REQUIRED：至少需要 1 张已通过并输出的图片才能生成图片配对信息。",
        provider: "gpt55",
        model: settings.model,
      });
    }
    input.images.forEach((image) => validateListingImage(image, settings));
    const requestBody = buildGpt55ImageMetasRequest(input, settings);
    let requestId: string | undefined;
    try {
      const response = await fetchWithTimeout(chatCompletionsUrl(settings.baseURL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }, "GPT5.5商品图片信息配对", GPT55_PROMPT_TIMEOUT_MS);
      requestId = response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? undefined;
      const text = await readResponseTextLimited(response, "GPT5.5商品图片信息配对响应", 1024 * 1024);
      if (!response.ok) throw Gpt55PromptHttpError(response.status, text, requestId);
      const content = extractGpt55MessageContent(text, requestId);
      const parsed = parseGpt55ImageMetasJson(content, requestId);
      return {
        ...parsed,
        model: settings.model,
        providerTraceId: requestId,
        promptProviderRequestId: requestId,
      };
    } catch (error) {
      if (isKnownStructuredPromptError(error)) throw error;
      throw structuredError({
        code: "GPT55_IMAGE_META_GENERATION_FAILED",
        message: "GPT55_IMAGE_META_GENERATION_FAILED：GPT5.5生成图片配对信息失败。",
        provider: "gpt55",
        model: settings.model,
        requestId,
        reason: sanitizeProviderError(error),
      });
    }
  },
};

export function buildGpt55PromptRequest(input: GeneratePromptInput, settings = getEffectiveGpt55PromptSettings()): Record<string, unknown> {
  const dataUrl = imageDataUrl(input.asset.filePath, input.asset.mimeType);
  return {
    model: settings.model,
    messages: [
      { role: "system", content: Gpt55PromptSystemPrompt() },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
          {
            type: "text",
            text: [
              "请为这张商品图生成一条后续 OpenAI Image 图生图使用的中文 prompt。",
              `roleHint: ${input.roleHint ?? "main"}`,
              `stylePreset: ${input.stylePreset ?? "american_vintage_etsy"}`,
              "请只返回 JSON，不要解释。",
            ].join("\n"),
          },
        ],
      },
    ],
    temperature: 0.2,
  };
}

export function buildGpt55ListingCopyRequest(input: GenerateListingCopyInput, settings = getEffectiveGpt55PromptSettings()): Record<string, unknown> {
  const imageParts = input.images.map((image) => ({
    type: "image_url",
    image_url: { url: imageDataUrl(image.filePath, image.mimeType) },
  }));
  return {
    model: settings.model,
    messages: [
      { role: "system", content: Gpt55ListingSystemPrompt() },
      {
        role: "user",
        content: [
          ...imageParts,
          {
            type: "text",
            text: [
              `batchId: ${input.batchId}`,
              "请根据这些已通过审核的商品图片，生成一套适合 Etsy listing 使用的英文商品文案。",
              listingImageMetaPrompt(input),
              "请根据图片产品给我写适合 Etsy 的英文标题和更丰富的英文描述。描述要贴合产品，把可确认的颜色、尺寸、材质、用途、风格和礼物场景自然融合在段落中，不要单独输出颜色/尺寸/材质板块。",
              "关键词要求：13 个关键词，每个词语 20 字母以内包括空格，关键词间用逗号隔开，关键词要适配此产品而且要在 Etsy 上有一定搜索热度，以搜索热度从高到低的顺序排名。",
              "如果无法从图片或配对信息确认尺寸，不要编造精确数字；在 description 中使用保守表述。",
              "请只返回 JSON，不要解释。",
            ].join("\n"),
          },
        ],
      },
    ],
    temperature: 0.2,
  };
}

export function buildGpt55StyleNamesRequest(input: GenerateStyleNamesInput, settings = getEffectiveGpt55PromptSettings()): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  for (const image of input.images) {
    content.push({
      type: "image_url",
      image_url: { url: imageDataUrl(image.filePath, image.mimeType) },
    });
    content.push({
      type: "text",
      text: [
        `itemId=${image.itemId}`,
        `inputFileName=${image.inputFileName}`,
        `outputFileName=${image.outputFileName}`,
        `color=${image.color || "not specified"}`,
        `size=${image.size || "not specified"}`,
        `material=${image.material || "not specified"}`,
        `note=${image.note || "not specified"}`,
      ].join("\n"),
    });
  }
  content.push({
    type: "text",
    text: [
      `batchId: ${input.batchId}`,
      "请逐张读取商品图片，为每个 itemId 生成一个英文款式名 styleNameEn。",
      "单个款式名必须是英文，最多 20 个字符（包含空格），可以适当缩短但要贴合图片款式。",
      "优先表达颜色、图案或款式差异，例如 Pink Floral Bunny、Gray Bunny、Strawberry Bunny。",
      "不要输出品牌名、价格、尺寸、材质认证或图片中无法确认的信息。",
      "请只返回 JSON，不要解释。",
      'JSON 字段：{"styles":[{"itemId":"...","styleNameEn":"..."}]}',
    ].join("\n"),
  });
  return {
    model: settings.model,
    messages: [
      { role: "system", content: Gpt55StyleNamesSystemPrompt() },
      { role: "user", content },
    ],
    temperature: 0.2,
  };
}

export function buildGpt55ImageMetasRequest(input: GenerateImageMetasInput, settings = getEffectiveGpt55PromptSettings()): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  for (const image of input.images) {
    content.push({
      type: "image_url",
      image_url: { url: imageDataUrl(image.filePath, image.mimeType) },
    });
    content.push({
      type: "text",
      text: [
        `itemId=${image.itemId}`,
        `inputFileName=${image.inputFileName}`,
        `outputFileName=${image.outputFileName}`,
        `existingColor=${image.color || "not specified"}`,
        `existingSize=${image.size || "not specified"}`,
        `existingMaterial=${image.material || "not specified"}`,
        `existingNote=${image.note || "not specified"}`,
      ].join("\n"),
    });
  }
  content.push({
    type: "text",
    text: [
      `batchId: ${input.batchId}`,
      "请逐张读取商品图片，为每个 itemId 生成基础图片配对信息 imageMetas。",
      "字段要求：color、size、material、note 都用简洁英文短语，方便 Etsy listing 人工审核。",
      "color 写图片可确认的主色、花色或图案；material 写图片可确认或高度可见的材质，例如 soft plush fabric。",
      "size 只能写图片或已有信息能确认的尺寸；无法确认时返回空字符串，不要编造精确数字。",
      "note 写一句短备注，说明款式差异或可见细节，不要写价格、品牌、物流或图片中无法确认的信息。",
      "如果已有字段存在，可以参考但不要在 JSON 中省略该 itemId。",
      "请只返回 JSON，不要解释。",
      'JSON 字段：{"imageMetas":[{"itemId":"...","color":"...","size":"...","material":"...","note":"..."}]}',
    ].join("\n"),
  });
  return {
    model: settings.model,
    messages: [
      { role: "system", content: Gpt55ImageMetasSystemPrompt() },
      { role: "user", content },
    ],
    temperature: 0.2,
  };
}

export function parseGpt55PromptJson(content: string, requestId?: string): Omit<GeneratePromptResult, "model" | "providerTraceId" | "promptProviderRequestId"> {
  const jsonText = extractJsonText(content);
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const role = normalizePromptRole(parsed.role);
    const promptText = stringField(parsed.promptText);
    if (!promptText) throw new Error("promptText missing");
    return {
      role,
      detectedProduct: stringField(parsed.detectedProduct),
      promptText,
      negativePrompt: stringField(parsed.negativePrompt) || "不要添加文字、水印、logo、人物、手、脚、模特；不要改变商品外观。",
      confidence: normalizeConfidence(parsed.confidence),
    };
  } catch (error) {
    throw structuredError({
      code: "GPT55_PROMPT_PARSE_FAILED",
      message: "GPT55_PROMPT_PARSE_FAILED：GPT5.5返回的提示词不是可解析的 JSON。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      reason: sanitizeProviderError(error),
    });
  }
}

export function parseGpt55ListingCopyJson(content: string, requestId?: string): Omit<GenerateListingCopyResult, "model" | "providerTraceId" | "promptProviderRequestId"> {
  const jsonText = extractJsonText(content);
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const title = stringField(parsed.title);
    const description = stringField(parsed.description);
    const colors = stringOrArrayField(parsed.colors);
    const sizeInfo = stringField(parsed.sizeInfo) || stringField(parsed.size);
    const materials = stringOrArrayField(parsed.materials);
    const keywords = normalizeListingKeywords(parsed.keywords);
    if (!title) throw new Error("title missing");
    if (!description) throw new Error("description missing");
    if (keywords.length !== 13) throw new Error(`keywords must contain exactly 13 items, got ${keywords.length}`);
    const tooLong = keywords.find((keyword) => keyword.length > 20);
    if (tooLong) throw new Error(`keyword exceeds 20 characters: ${tooLong}`);
    return { title, description, colors, sizeInfo, materials, keywords };
  } catch (error) {
    throw structuredError({
      code: "GPT55_LISTING_PARSE_FAILED",
      message: "GPT55_LISTING_PARSE_FAILED：GPT5.5返回的 Etsy 商品文案不是符合要求的 JSON。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      reason: sanitizeProviderError(error),
    });
  }
}

export function parseGpt55StyleNamesJson(content: string, requestId?: string): Omit<GenerateStyleNamesResult, "model" | "providerTraceId" | "promptProviderRequestId"> {
  const jsonText = extractJsonText(content);
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const rawStyles = Array.isArray(parsed.styles) ? parsed.styles : [];
    if (rawStyles.length === 0) throw new Error("styles missing");
    const styles = rawStyles.map((item) => {
      const row = item as Record<string, unknown>;
      const itemId = stringField(row.itemId);
      const styleNameEn = normalizeStyleNameEn(row.styleNameEn);
      if (!itemId) throw new Error("itemId missing");
      if (!styleNameEn) throw new Error(`styleNameEn missing for ${itemId}`);
      return { itemId, styleNameEn };
    });
    return { styles };
  } catch (error) {
    throw structuredError({
      code: "GPT55_STYLE_NAME_PARSE_FAILED",
      message: "GPT55_STYLE_NAME_PARSE_FAILED：GPT5.5返回的商品款式英文名不是符合要求的 JSON，单个英文名必须不超过 20 个字符。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      reason: sanitizeProviderError(error),
    });
  }
}

export function parseGpt55ImageMetasJson(content: string, requestId?: string): Omit<GenerateImageMetasResult, "model" | "providerTraceId" | "promptProviderRequestId"> {
  const jsonText = extractJsonText(content);
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const rawMetas = Array.isArray(parsed.imageMetas) ? parsed.imageMetas : [];
    if (rawMetas.length === 0) throw new Error("imageMetas missing");
    const imageMetas = rawMetas.map((item) => {
      const row = item as Record<string, unknown>;
      const itemId = stringField(row.itemId);
      if (!itemId) throw new Error("itemId missing");
      return {
        itemId,
        color: stringField(row.color),
        size: stringField(row.size),
        material: stringField(row.material),
        note: stringField(row.note),
      };
    });
    return { imageMetas };
  } catch (error) {
    throw structuredError({
      code: "GPT55_IMAGE_META_PARSE_FAILED",
      message: "GPT55_IMAGE_META_PARSE_FAILED：GPT5.5返回的图片配对信息不是符合要求的 JSON。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      reason: sanitizeProviderError(error),
    });
  }
}

function assertGpt55PromptConfig(settings: EffectiveGpt55PromptSettings): void {
  if (!settings.apiKey) {
    throw structuredError({
      code: "GPT55_API_KEY_MISSING",
      message: "GPT55_API_KEY_MISSING：GPT5.5图片理解需要配置 GPT55_API_KEY。",
      provider: "gpt55",
      model: settings.model,
    });
  }
  const model = settings.model.trim();
  if (!model) {
    throw structuredError({
      code: "GPT55_MODEL_MISSING",
      message: "GPT55_MODEL_MISSING：请配置支持图片理解的 GPT55_MODEL。",
      provider: "gpt55",
    });
  }
  if (/seedream/i.test(model)) {
    throw structuredError({
      code: "GPT55_MODEL_NOT_ACCESSIBLE",
      message: "GPT55_MODEL_NOT_ACCESSIBLE：GPT55_MODEL 必须是图片理解/多模态理解模型，不得使用 Seedream 图生图模型。",
      provider: "gpt55",
      model,
    });
  }
}

function validatePromptImage(input: GeneratePromptInput, settings: EffectiveGpt55PromptSettings): void {
  if (!fs.existsSync(input.asset.filePath)) {
    throw structuredError({
      code: "INPUT_ASSET_FILE_NOT_FOUND",
      message: "INPUT_ASSET_FILE_NOT_FOUND：已登记输入图片文件不存在。",
      provider: "gpt55",
      model: settings.model,
    });
  }
  if (!SUPPORTED_PROMPT_IMAGE_TYPES.has(input.asset.mimeType)) {
    throw structuredError({
      code: "UNSUPPORTED_INPUT_IMAGE_TYPE",
      message: "UNSUPPORTED_INPUT_IMAGE_TYPE：GPT5.5图片理解仅支持 JPEG、PNG 或 WebP。",
      provider: "gpt55",
      model: settings.model,
    });
  }
  const maxBytes = settings.maxInputMb * 1024 * 1024;
  if (fs.statSync(input.asset.filePath).size > maxBytes) {
    throw structuredError({
      code: "GPT55_IMAGE_TOO_LARGE",
      message: `GPT55_IMAGE_TOO_LARGE：图片超过 ${settings.maxInputMb}MB，无法作为GPT5.5图片理解输入。`,
      provider: "gpt55",
      model: settings.model,
    });
  }
}

function validateListingImage(image: ListingCopyImageInput, settings: EffectiveGpt55PromptSettings): void {
  if (!fs.existsSync(image.filePath)) {
    throw structuredError({
      code: "INPUT_ASSET_FILE_NOT_FOUND",
      message: "INPUT_ASSET_FILE_NOT_FOUND：已输出商品图片文件不存在。",
      provider: "gpt55",
      model: settings.model,
    });
  }
  if (!SUPPORTED_PROMPT_IMAGE_TYPES.has(image.mimeType)) {
    throw structuredError({
      code: "UNSUPPORTED_INPUT_IMAGE_TYPE",
      message: "UNSUPPORTED_INPUT_IMAGE_TYPE：GPT5.5商品文案图片输入仅支持 JPEG、PNG 或 WebP。",
      provider: "gpt55",
      model: settings.model,
    });
  }
  const maxBytes = settings.maxInputMb * 1024 * 1024;
  if (fs.statSync(image.filePath).size > maxBytes) {
    throw structuredError({
      code: "GPT55_IMAGE_TOO_LARGE",
      message: `GPT55_IMAGE_TOO_LARGE：输出图片超过 ${settings.maxInputMb}MB，无法作为GPT5.5商品文案输入。`,
      provider: "gpt55",
      model: settings.model,
    });
  }
}

function Gpt55PromptHttpError(statusCode: number, responseText: string, requestId?: string): Error {
  const clean = sanitizeProviderError(responseText);
  const lower = clean.toLowerCase();
  if (statusCode === 401 || /unauthori[sz]ed|invalid api key|authentication|auth failed|鉴权|认证|api key.*无效|token.*无效/.test(lower)) {
    return structuredError({
      code: "GPT55_AUTH_FAILED",
      message: "GPT55_AUTH_FAILED：GPT5.5 GPT55_API_KEY 鉴权失败。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      statusCode,
      reason: clean,
    });
  }
  if (statusCode === 403 || /permission denied|access denied|forbidden|not authorized|无权限|权限不足|未开通|未授权/.test(lower)) {
    return structuredError({
      code: "GPT55_PERMISSION_DENIED",
      message: "GPT55_PERMISSION_DENIED：当前GPT5.5 Key 或账号无权调用该模型。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      statusCode,
      reason: clean,
    });
  }
  if (/modelidaccessdisabled/i.test(clean)) {
    return structuredError({
      code: "GPT55_MODEL_NOT_ACCESSIBLE",
      message: "GPT55_MODEL_NOT_ACCESSIBLE：当前账号不允许直接用模型 ID，请在GPT5.5创建视觉推理接入点并填写 gpt-5.5。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      statusCode,
      reason: clean,
    });
  }
  if (/modelnotopen/i.test(clean)) {
    return structuredError({
      code: "GPT55_MODEL_NOT_ACCESSIBLE",
      message: "GPT55_MODEL_NOT_ACCESSIBLE：当前账号未开通该GPT5.5模型，请在GPT5.5开通或换成已开通的 gpt-5.5。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      statusCode,
      reason: clean,
    });
  }
  if (statusCode === 404 || /invalidendpointormodel\.notfound/i.test(clean) || /model.*(not found|not exist|does not exist|不存在|未找到)|endpoint.*not found|模型.*(不存在|未找到)/.test(lower)) {
    return structuredError({
      code: "GPT55_MODEL_NOT_ACCESSIBLE",
      message: "GPT55_MODEL_NOT_ACCESSIBLE：当前模型/接入点不存在，或这个 GPT55_API_KEY 没有访问权限。请填写已通过图片测试的 gpt-5.5。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      statusCode,
      reason: clean,
    });
  }
  if (/llm model received multi-modal messages|multi-modal messages|multimodal messages/i.test(clean)) {
    return structuredError({
      code: "GPT55_VISION_NOT_SUPPORTED",
      message: "GPT55_VISION_NOT_SUPPORTED：当前 GPT5.5 模型不支持图片输入，请换成支持视觉输入的 GPT5.5 模型。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      statusCode,
      reason: clean,
    });
  }
  if (/image_url|base64|data:image|input method|content type|unsupported parameter|unknown parameter|invalid parameter|输入方式|参数|字段/.test(lower) && /not support|unsupported|不支持|invalid|unknown|非法|无效/.test(lower)) {
    return structuredError({
      code: "GPT55_INPUT_METHOD_UNSUPPORTED",
      message: "GPT55_INPUT_METHOD_UNSUPPORTED：当前GPT5.5接口不支持本地 base64 图片输入方式。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      statusCode,
      reason: clean,
    });
  }
  if (/image|vision|multimodal|multi-modal|图片|图像|多模态|视觉/.test(lower) && /not support|unsupported|不支持|not enabled|not available|invalid|unknown/.test(lower)) {
    return structuredError({
      code: "GPT55_VISION_NOT_SUPPORTED",
      message: "GPT55_VISION_NOT_SUPPORTED：当前GPT5.5模型不支持图片输入。",
      provider: "gpt55",
      model: getEffectiveGpt55PromptSettings().model,
      requestId,
      statusCode,
      reason: clean,
    });
  }
  return structuredError({
    code: "GPT55_PROMPT_GENERATION_FAILED",
    message: "GPT55_PROMPT_GENERATION_FAILED：GPT5.5图片理解请求失败。",
    provider: "gpt55",
    model: getEffectiveGpt55PromptSettings().model,
    requestId,
    statusCode,
    reason: clean,
  });
}

function extractGpt55MessageContent(responseText: string, requestId?: string): string {
  try {
    const parsed = JSON.parse(responseText) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      output?: { text?: unknown };
    };
    const content = parsed.choices?.[0]?.message?.content ?? parsed.output?.text;
    if (Array.isArray(content)) {
      return content.map((item) => typeof item === "string" ? item : (item as { text?: string }).text ?? "").join("\n").trim();
    }
    if (typeof content === "string" && content.trim()) return content.trim();
  } catch {
    // Fall through to parse failure below.
  }
  throw structuredError({
    code: "GPT55_PROMPT_PARSE_FAILED",
    message: "GPT55_PROMPT_PARSE_FAILED：GPT5.5响应中没有可读取的 message content。",
    provider: "gpt55",
    model: getEffectiveGpt55PromptSettings().model,
    requestId,
  });
}

function extractJsonText(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first >= 0 && last > first) return content.slice(first, last + 1).trim();
  return content.trim();
}

function imageDataUrl(filePath: string, mimeType: string): string {
  const base64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function chatCompletionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`;
}

function Gpt55PromptSystemPrompt(): string {
  return [
    "你是 Etsy 电商商品图提示词专家。",
    "请分析输入图片中的商品，为后续 OpenAI Image 图生图生成中文提示词。",
    "必须保持商品外观不变，不改变商品类别、颜色、材质、结构、轮廓、装饰细节和数量。",
    "允许改变构图，加入美式复古元素，适合 Etsy 电商产品图。",
    "不要添加文字、水印、logo、人物、手、脚、模特，除非用户明确要求。",
    "只输出 JSON，不要输出散文或 Markdown。",
    'JSON 字段：{"role":"main|secondary|detail|lifestyle","detectedProduct":"...","promptText":"...","negativePrompt":"...","confidence":0.0}',
    "主图风格示例：这是 jellycat 的邦尼兔，保持产品外观不变，改变构图，增加美式复古元素，将它们放在一起，生成一张 Etsy 电商产品主图。",
    "副图风格示例：这是 jellycat 的邦尼兔，紫粉色碎花，保持产品外观不变，改变构图，增加美式复古元素，生成一张 Etsy 电商产品副图。",
  ].join("\n");
}

function Gpt55ListingSystemPrompt(): string {
  return [
    "你是 Etsy 英文 listing 文案专家和商品图片分析专家。",
    "请根据输入图片中的同一商品，生成适合 Etsy 商品页使用的英文标题、丰富描述和关键词。",
    "必须基于图片可见信息描述产品，不要编造品牌授权、产地、精确尺寸、材质认证或图片中无法确认的事实。",
    "颜色、尺寸和材质信息应自然融合进英文 description，不要输出单独的颜色、尺寸或材质板块。",
    "keywords 必须正好 13 个，按 Etsy 搜索热度从高到低排序，每个关键词最多 20 个字符包含空格。",
    "只输出 JSON，不要输出 Markdown 或解释。",
    'JSON 字段：{"title":"...","description":"...","keywords":["keyword 1","keyword 2"]}',
  ].join("\n");
}

function Gpt55StyleNamesSystemPrompt(): string {
  return [
    "你是 Etsy 商品款式英文命名助手。",
    "请根据每张商品图片生成简短英文款式名。",
    "每个 styleNameEn 必须最多 20 个字符，包含空格。",
    "只输出 JSON，不要输出 Markdown 或解释。",
  ].join("\n");
}

function Gpt55ImageMetasSystemPrompt(): string {
  return [
    "你是 Etsy 商品图片信息配对助手。",
    "请根据每张商品图片整理颜色、尺寸、材质和备注，输出给人工审核。",
    "只能基于图片可见信息和用户提供的已有字段，不要编造品牌、价格、精确尺寸或认证信息。",
    "只输出 JSON，不要输出 Markdown 或解释。",
  ].join("\n");
}

function listingImageMetaPrompt(input: GenerateListingCopyInput): string {
  const metas = input.imageMetas ?? [];
  if (metas.length === 0) return "没有额外的图片配对信息；请只依据图片可见信息写文案。";
  return [
    "图片配对信息如下。优先使用这些人工/CSV/系统整理过的信息；如果字段为空，不要编造：",
    ...metas.map((meta, index) => [
      `Image ${index + 1}:`,
      `inputFileName=${meta.inputFileName}`,
      `outputFileName=${meta.outputFileName}`,
      `styleNameEn=${meta.styleNameEn || "not specified"}`,
      `color=${meta.color || "not specified"}`,
      `size=${meta.size || "not specified"}`,
      `material=${meta.material || "not specified"}`,
      `note=${meta.note || "not specified"}`,
    ].join(" ")),
  ].join("\n");
}

function normalizePromptRole(value: unknown): ImagePromptRole {
  if (value === "secondary" || value === "detail" || value === "lifestyle" || value === "main") return value;
  return "main";
}

function normalizeConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(1, n));
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringOrArrayField(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(", ");
  return stringField(value);
}

function normalizeStyleNameEn(value: unknown): string {
  const text = stringField(value).replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length > 20) throw new Error(`styleNameEn exceeds 20 characters: ${text}`);
  if (!/^[\x20-\x7E]+$/.test(text) || !/[A-Za-z]/.test(text)) throw new Error(`styleNameEn must be English ASCII: ${text}`);
  return text;
}

function normalizeListingKeywords(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((item) => String(item))
    : typeof value === "string"
      ? value.split(",")
      : [];
  return raw
    .map((keyword) => keyword.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function isKnownStructuredPromptError(error: unknown): boolean {
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";
}
