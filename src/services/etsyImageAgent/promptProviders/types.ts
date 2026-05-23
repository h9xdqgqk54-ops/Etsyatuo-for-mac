import type { ImagePromptRole, InputAssetRecord } from "../types.js";

export interface GeneratePromptInput {
  asset: InputAssetRecord;
  productGroupId: string;
  roleHint?: ImagePromptRole;
  stylePreset?: "american_vintage_etsy";
}

export interface GeneratePromptResult {
  role: ImagePromptRole;
  detectedProduct: string;
  promptText: string;
  negativePrompt: string;
  confidence: number;
  model: string;
  providerTraceId?: string;
  promptProviderRequestId?: string;
  doubaoRequestId?: string;
}

export interface ListingCopyImageInput {
  filePath: string;
  fileName: string;
  mimeType: string;
}

export interface ListingCopyImageMetaInput {
  itemId: string;
  inputFileName: string;
  outputFileName: string;
  styleNameEn?: string;
  color: string;
  size: string;
  material: string;
  note: string;
}

export interface GenerateListingCopyInput {
  batchId: string;
  images: ListingCopyImageInput[];
  imageMetas?: ListingCopyImageMetaInput[];
}

export interface GenerateListingCopyResult {
  title: string;
  description: string;
  colors?: string;
  sizeInfo?: string;
  materials?: string;
  keywords: string[];
  model: string;
  providerTraceId?: string;
  promptProviderRequestId?: string;
  doubaoRequestId?: string;
}

export interface StyleNameImageInput {
  itemId: string;
  inputFileName: string;
  outputFileName: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  color?: string;
  size?: string;
  material?: string;
  note?: string;
}

export interface GenerateStyleNamesInput {
  batchId: string;
  images: StyleNameImageInput[];
}

export interface ProductStyleNameResult {
  itemId: string;
  styleNameEn: string;
}

export interface GenerateStyleNamesResult {
  styles: ProductStyleNameResult[];
  model: string;
  providerTraceId?: string;
  promptProviderRequestId?: string;
  doubaoRequestId?: string;
}

export interface GenerateImageMetasInput {
  batchId: string;
  images: StyleNameImageInput[];
}

export interface ProductImageMetaResult {
  itemId: string;
  color: string;
  size: string;
  material: string;
  note: string;
}

export interface GenerateImageMetasResult {
  imageMetas: ProductImageMetaResult[];
  model: string;
  providerTraceId?: string;
  promptProviderRequestId?: string;
  doubaoRequestId?: string;
}

export interface PromptProvider {
  id: "gpt55" | "doubao";
  generatePrompt(input: GeneratePromptInput): Promise<GeneratePromptResult>;
  generateListingCopy(input: GenerateListingCopyInput): Promise<GenerateListingCopyResult>;
  generateStyleNames(input: GenerateStyleNamesInput): Promise<GenerateStyleNamesResult>;
  generateImageMetas(input: GenerateImageMetasInput): Promise<GenerateImageMetasResult>;
}
