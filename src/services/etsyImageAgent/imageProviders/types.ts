import type { ImageGenerationMode, ImageProviderId, PlannedPrompt, ProductGroup } from "../types.js";

export interface ImageProviderSettings {
  provider: ImageProviderId;
  mode: "real";
  apiKey: string;
  configured: boolean;
  enableRealGeneration: boolean;
  keyFingerprint: string;
  baseURL?: string;
  model: string;
  imageSize: string;
  imageQuality?: string;
  inputFidelity?: "off" | "low" | "high";
}

export interface GenerateImageInput {
  group?: ProductGroup;
  prompt: PlannedPrompt | { optimizedPrompt: string };
  outputPath: string;
  provider?: ImageProviderId;
  imageGenerationMode?: ImageGenerationMode;
  inputAssetIds?: string[];
  preserveProduct?: boolean;
}

export interface GenerateImageResult {
  provider: ImageProviderId;
  model: string;
  outputSize: string;
  quality?: string;
  estimatedCost?: string;
  usedReferenceImage?: boolean;
  referenceImageCount?: number;
  referenceImageUrls?: string[];
  resolvedReferenceImageUrls?: string[];
  providerTraceId?: string;
  openaiRequestId?: string;
}

export interface ImageProvider {
  id: ImageProviderId;
  generate(input: GenerateImageInput, settings: ImageProviderSettings): Promise<GenerateImageResult>;
}
