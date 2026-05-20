import type { EtsyClientConfig } from "./etsyClient.js";

export async function etsyListingImageUploadPlaceholder(
  _client: EtsyClientConfig,
  _listingId: string,
  _localImagePath: string,
): Promise<never> {
  throw new Error("Etsy listing image upload is intentionally disabled in v1 until OAuth authorization is implemented.");
}
