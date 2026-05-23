import type { ImageProviderId } from "./types.js";

export type EtsyAgentErrorCode =
  | "INPUT_REFERENCE_IMAGE_REQUIRED"
  | "INPUT_ASSET_NOT_REGISTERED"
  | "INPUT_ASSET_FILE_NOT_FOUND"
  | "INPUT_IMAGE_TOO_LARGE"
  | "UNSUPPORTED_INPUT_IMAGE_TYPE"
  | "OPENAI_MULTI_REFERENCE_NOT_SUPPORTED_YET"
  | "OPENAI_IMAGE_PARAMETER_UNSUPPORTED"
  | "OPENAI_IMAGE_EMPTY_RESPONSE"
  | "OPENAI_IMAGE_INVALID_RESPONSE_IMAGE"
  | "OPENAI_IMAGE_DOWNLOAD_FAILED"
  | "OPENAI_IMAGE_MODEL_UNAVAILABLE"
  | "OPENAI_ORG_VERIFICATION_REQUIRED"
  | "OPENAI_INSUFFICIENT_QUOTA"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_IMAGE_EDIT_FAILED"
  | "OPENAI_COST_RISK_CONFIRMATION_REQUIRED"
  | "REAL_GENERATION_DISABLED"
  | "OPENAI_API_KEY_MISSING"
  | "INPUT_DIR_NOT_FOUND"
  | "PROMPT_REQUIRED"
  | "PROMPT_BATCH_LIMIT_EXCEEDED"
  | "PROMPT_OVERWRITE_CONFIRMATION_REQUIRED"
  | "PROMPT_RECORD_NOT_FOUND"
  | "INPUT_ASSET_NOT_FOUND"
  | "GPT55_API_KEY_MISSING"
  | "GPT55_AUTH_FAILED"
  | "GPT55_PERMISSION_DENIED"
  | "GPT55_MODEL_NOT_ACCESSIBLE"
  | "GPT55_CONFIG_VALIDATION_FAILED"
  | "GPT55_MODEL_MISSING"
  | "GPT55_IMAGE_TOO_LARGE"
  | "GPT55_INPUT_METHOD_UNSUPPORTED"
  | "GPT55_VISION_NOT_SUPPORTED"
  | "GPT55_PROMPT_PARSE_FAILED"
  | "GPT55_PROMPT_GENERATION_FAILED"
  | "GPT55_LISTING_PARSE_FAILED"
  | "GPT55_LISTING_GENERATION_FAILED"
  | "GPT55_STYLE_NAME_PARSE_FAILED"
  | "GPT55_STYLE_NAME_GENERATION_FAILED"
  | "GPT55_IMAGE_META_PARSE_FAILED"
  | "GPT55_IMAGE_META_GENERATION_FAILED"
  | "FOLDER_SETTINGS_INPUT_DIR_INVALID"
  | "FOLDER_SETTINGS_OUTPUT_DIR_INVALID"
  | "DOUBAO_PROMPT_API_KEY_MISSING"
  | "DOUBAO_PROMPT_AUTH_FAILED"
  | "DOUBAO_PROMPT_PERMISSION_DENIED"
  | "DOUBAO_PROMPT_MODEL_OR_ENDPOINT_NOT_ACCESSIBLE"
  | "DOUBAO_PROMPT_MODEL_NOT_OPEN"
  | "DOUBAO_PROMPT_ENDPOINT_ID_REQUIRED"
  | "DOUBAO_PROMPT_CONFIG_VALIDATION_FAILED"
  | "DOUBAO_PROMPT_MODEL_NOT_FOUND"
  | "DOUBAO_PROMPT_MODEL_MISSING"
  | "DOUBAO_PROMPT_MODEL_INVALID"
  | "DOUBAO_PROMPT_IMAGE_TOO_LARGE"
  | "DOUBAO_PROMPT_INPUT_METHOD_UNSUPPORTED"
  | "DOUBAO_PROMPT_VISION_NOT_SUPPORTED"
  | "DOUBAO_PROMPT_PARSE_FAILED"
  | "DOUBAO_PROMPT_GENERATION_FAILED"
  | "LISTING_APPROVED_IMAGE_REQUIRED"
  | "LISTING_IMAGE_REVIEW_NOT_FINISHED"
  | "LISTING_RECORD_NOT_FOUND"
  | "DOUBAO_LISTING_PARSE_FAILED"
  | "DOUBAO_LISTING_GENERATION_FAILED";

export interface StructuredErrorDetails {
  code: EtsyAgentErrorCode | string;
  message: string;
  provider?: ImageProviderId | "gpt55" | "doubao";
  model?: string;
  requestId?: string;
  statusCode?: number;
  reason?: string;
}

export class StructuredEtsyAgentError extends Error {
  code: string;
  provider?: ImageProviderId | "gpt55" | "doubao";
  model?: string;
  requestId?: string;
  statusCode?: number;
  reason?: string;

  constructor(details: StructuredErrorDetails) {
    super(details.message);
    this.name = "StructuredEtsyAgentError";
    this.code = details.code;
    this.provider = details.provider;
    this.model = details.model;
    this.requestId = details.requestId;
    this.statusCode = details.statusCode;
    this.reason = details.reason;
  }
}

export function structuredError(details: StructuredErrorDetails): StructuredEtsyAgentError {
  return new StructuredEtsyAgentError(details);
}

export function isStructuredError(error: unknown): error is StructuredEtsyAgentError {
  return error instanceof StructuredEtsyAgentError || (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

export function publicErrorPayload(error: unknown): { error: string; code?: string; details?: StructuredErrorDetails } {
  if (isStructuredError(error)) {
    return {
      error: error.message,
      code: error.code,
      details: {
        code: error.code,
        message: error.message,
        provider: error.provider,
        model: error.model,
        requestId: error.requestId,
        statusCode: error.statusCode,
        reason: error.reason,
      },
    };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}
