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
  | "OPENAI_API_KEY_MISSING";

export interface StructuredErrorDetails {
  code: EtsyAgentErrorCode | string;
  message: string;
  provider?: ImageProviderId;
  model?: string;
  requestId?: string;
  statusCode?: number;
  reason?: string;
}

export class StructuredEtsyAgentError extends Error {
  code: string;
  provider?: ImageProviderId;
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
