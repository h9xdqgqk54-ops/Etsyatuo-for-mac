import type { EtsyClientConfig } from "./etsyClient.js";

export async function etsyListingImageSortPlaceholder(
  _client: EtsyClientConfig,
  _listingId: string,
  _imageIds: string[],
): Promise<never> {
  throw new Error("Etsy listing image sorting is intentionally disabled in v1 until OAuth authorization is implemented.");
}
