export interface EtsyClientConfig {
  accessToken?: string;
  shopId?: string;
  apiBaseUrl?: string;
}

export function createEtsyClient(config: EtsyClientConfig = {}): EtsyClientConfig {
  return {
    apiBaseUrl: config.apiBaseUrl ?? "https://openapi.etsy.com/v3",
    accessToken: config.accessToken,
    shopId: config.shopId,
  };
}
