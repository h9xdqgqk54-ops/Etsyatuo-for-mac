import { getImageProviderConfig, getProviderSecret } from "../secureConfig.js";
import { etsyAgentConfig } from "../config.js";
import type { ImageProviderId } from "../types.js";
import { openaiProvider } from "./openaiProvider.js";
import type { GenerateImageInput, GenerateImageResult, ImageProvider, ImageProviderSettings } from "./types.js";

const providers: Partial<Record<ImageProviderId, ImageProvider>> = {
  openai: openaiProvider,
};

export function getCurrentImageProviderSettings(forcedProvider?: ImageProviderId): ImageProviderSettings {
  const settings = getImageProviderConfig();
  const provider: ImageProviderId = forcedProvider === "openai" ? "openai" : settings.selectedProvider;
  const secret = getProviderSecret(provider);
  const model = settings.providers.openai.model;
  const imageSize = etsyAgentConfig.openaiImageSize;
  return {
    provider,
    mode: "real",
    apiKey: secret.apiKey,
    configured: secret.configured,
    enableRealGeneration: settings.realGenerationEnabled,
    keyFingerprint: secret.keyFingerprint,
    baseURL: settings.providers.openai.baseURL,
    model,
    imageSize,
    imageQuality: etsyAgentConfig.openaiImageQuality,
    inputFidelity: settings.providers.openai.inputFidelity,
  };
}

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const settings = getCurrentImageProviderSettings(input.provider);
  const provider = providers[settings.provider];
  if (!provider) throw new Error(`未知图片生成 Provider：${settings.provider}`);
  return provider.generate(input, settings);
}

export function listImageProviders(): ImageProviderId[] {
  return Object.keys(providers) as ImageProviderId[];
}
