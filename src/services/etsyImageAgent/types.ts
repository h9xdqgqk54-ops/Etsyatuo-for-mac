export type EtsyAgentTaskStatus =
  | "queued"
  | "running"
  | "cancel_requested"
  | "partially_completed"
  | "pending"
  | "grouping"
  | "prompt_optimizing"
  | "generating"
  | "quality_checking"
  | "etsy_compliance_checking"
  | "saving"
  | "completed"
  | "failed"
  | "partially_failed"
  | "cancelled";

export type ImageJobStatus = "queued" | "running" | "cancel_requested" | "completed" | "failed" | "cancelled";
export type ImageProviderId = "openai";
export type ImageGenerationMode = "text_to_image" | "product_reference";
export type ShotType =
  | "hero_white_background"
  | "angled_view"
  | "detail_closeup"
  | "lifestyle_clean"
  | "texture_macro"
  | "square_thumbnail";

export type EtsyImageType = "main" | "angle" | "detail" | "scale" | "lifestyle" | "creative";
export type QualityStatus = "pass" | "warning" | "fail";
export type EtsyComplianceStatus = "pass" | "warning" | "fail";
export type OriginalityRiskLevel = "low" | "medium" | "high";

export interface UploadedImage {
  id: string;
  originalFileName: string;
  relativePath: string;
  storedPath: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  hash: string;
  perceptualKey: string;
  createdAt: string;
}

export interface ProductGroup {
  id: string;
  displayName: string;
  sku?: string;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  reason: string;
  images: UploadedImage[];
  mainImageId?: string;
  locked?: boolean;
  originalFileNames: string[];
}

export interface EtsyPromptTemplate {
  templateId: string;
  name: string;
  description: string;
  category: string;
  basePrompt: string;
  recommendedAngles: string[];
  negativePrompt: string;
  aspectRatio: "1:1";
  creativeStrength: "low" | "medium" | "high";
  etsyComplianceLevel: "strict" | "balanced" | "creative_safe";
}

export interface PlannedPrompt {
  generationIndex: number;
  etsyImageType: EtsyImageType;
  shotType: ShotType;
  recommendedListingOrder: number;
  angle: string;
  optimizedPrompt: string;
  negativePrompt: string;
  originalityRiskLevel: OriginalityRiskLevel;
}

export interface QualityResult {
  status: QualityStatus;
  reason: string;
}

export interface ComplianceResult {
  status: EtsyComplianceStatus;
  reason: string;
}

export interface AssetRecord {
  assetId: string;
  taskId: string;
  productGroupId: string;
  sourceProductGroupId: string;
  batchId?: string;
  itemId?: string;
  baseName?: string;
  inputFileName?: string;
  promptFileName?: string;
  reviewStatus?: "pending" | "approved" | "rejected";
  outputFilePath?: string;
  originalFileNames: string[];
  generatedFilePath: string;
  publicUrl: string;
  prompt: string;
  optimizedPrompt: string;
  provider?: ImageProviderId;
  imageGenerationMode?: ImageGenerationMode;
  shotType?: ShotType;
  referenceAssetIds?: string[];
  preserveProduct?: boolean;
  usedReferenceImage?: boolean;
  promptHash?: string;
  providerTraceId?: string;
  openaiRequestId?: string;
  model: string;
  createdAt: string;
  qualityStatus: QualityStatus;
  qualityReason: string;
  generationIndex: number;
  platform: "etsy";
  etsyImageType: EtsyImageType;
  etsyComplianceStatus: EtsyComplianceStatus;
  etsyComplianceReason: string;
  recommendedListingOrder: number;
  outputSize: string;
  size?: string;
  providerQuality?: string;
  aspectRatio: "1:1";
  originalityRiskLevel: OriginalityRiskLevel;
}

export interface TaskProductState {
  productGroupId: string;
  displayName: string;
  status: EtsyAgentTaskStatus;
  progress: number;
  error?: string;
  prompts: PlannedPrompt[];
  assets: AssetRecord[];
}

export interface ImageGenerationJob {
  jobId: string;
  taskId: string;
  productGroupId: string;
  generationIndex: number;
  etsyImageType: EtsyImageType;
  recommendedListingOrder: number;
  prompt: PlannedPrompt;
  provider: ImageProviderId;
  imageGenerationMode: ImageGenerationMode;
  shotType: ShotType;
  inputAssetIds: string[];
  referenceImageUrls: string[];
  resolvedReferenceImageUrls: string[];
  usedReferenceImage: boolean;
  promptHash?: string;
  providerTraceId?: string;
  openaiRequestId?: string;
  preserveProduct: boolean;
  model: string;
  size: string;
  quality?: string;
  status: ImageJobStatus;
  attempts: number;
  maxAttempts: number;
  assetId?: string;
  error?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface EtsyAgentTask {
  taskId: string;
  status: EtsyAgentTaskStatus;
  progress: number;
  currentStep: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  userPrompt: string;
  templateId: string;
  perProductImageCount: number;
  totalProducts: number;
  totalPlannedImages: number;
  completedImages: number;
  failedImages: number;
  model: string;
  imageGenerationMode?: ImageGenerationMode;
  products: TaskProductState[];
  jobs: ImageGenerationJob[];
  groups: ProductGroup[];
  cost: CostEstimate;
  events: TaskEvent[];
  cancelled?: boolean;
}

export interface CostEstimate {
  productCount: number;
  referenceImageCount: number;
  requestedImagesPerProduct: number;
  plannedGeneratedImages: number;
  estimatedOpenAICalls: number;
  maxConcurrentGenerations: number;
  note: string;
}

export interface CreateTaskInput {
  groups: ProductGroup[];
  userPrompt: string;
  templateId?: string;
  perProductImageCount: number;
  imageGenerationMode?: ImageGenerationMode;
  confirmedRealGeneration?: boolean;
  confirmedCostRisk?: boolean;
}

export interface TaskEvent {
  at: string;
  type: string;
  message: string;
  productGroupId?: string;
  jobId?: string;
}

export interface GroupSession {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  groups: ProductGroup[];
  images: UploadedImage[];
}

export interface GroupRequestFile {
  fileName: string;
  relativePath: string;
  mimeType: string;
  data: Buffer;
}

export interface AgentApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
}
