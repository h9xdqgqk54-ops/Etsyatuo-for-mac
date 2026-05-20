/**
 * 1688 Image-Based Product Search
 *
 * Uses Playwright to:
 *   1. Scrape Etsy listing pages for the main product image
 *   2. Perform reverse image search on 1688.com
 *   3. Parse and return real 1688 product listings
 *
 * Falls back to simulated results if any step fails.
 */

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

// ── Types ──────────────────────────────────────────────────────

export interface ImageSearchResult {
  title: string;
  price: number;
  priceDisplay: string;
  url: string;
  imageUrl: string;
}

export interface EtsyImageResult {
  imageUrl: string;
  title: string;
}

// ── Config ─────────────────────────────────────────────────────

const TIMEOUT = 30_000;
const HEADLESS = true;

// Realistic browser fingerprint to avoid bot detection
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function createAntiBotPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "DNT": "1",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  const page = await context.newPage();

  // Hide automation fingerprints
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    // @ts-expect-error chrome runtime
    window.chrome = { runtime: {} };
  });

  return page;
}

// ── Etsy Image Extraction ──────────────────────────────────────

/**
 * Scrape the main product image from an Etsy listing page.
 * Uses og:image meta tag first, then falls back to the first
 * large product image in the carousel.
 */
export async function scrapeEtsyImage(etsyUrl: string): Promise<EtsyImageResult | null> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
    const page = await createAntiBotPage(browser);
    await page.goto(etsyUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT });

    const result = await page.evaluate(() => {
      // Strategy 1: og:image meta tag
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) {
        const src = ogImg.getAttribute("content");
        if (src && src.startsWith("http")) return { imageUrl: src, title: document.title };
      }

      // Strategy 2: first large product image in carousel
      const carouselImgs = document.querySelectorAll(
        '[data-listing-id] img, [data-carousel] img, .carousel img, [class*="image"] img, [class*="listing"] img'
      );
      for (const img of carouselImgs) {
        const src = (img as HTMLImageElement).src || img.getAttribute("data-src");
        if (src && src.startsWith("http") && !src.includes("avatar") && !src.includes("icon")) {
          return { imageUrl: src, title: document.title };
        }
      }

      // Strategy 3: any large image on the page
      const allImgs = document.querySelectorAll("img");
      for (const img of allImgs) {
        const w = (img as HTMLImageElement).naturalWidth || img.getAttribute("width");
        const src = (img as HTMLImageElement).src || img.getAttribute("data-src");
        if (src && src.startsWith("http") && Number(w) > 200) {
          return { imageUrl: src, title: document.title };
        }
      }

      return null;
    });

    await browser.close();
    return result;
  } catch {
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

// ── 1688 Image Search ──────────────────────────────────────────

/**
 * Perform a reverse image search on 1688.com using a product image URL.
 * Returns up to 10 matching 1688 product listings.
 */
export async function search1688ByImage(imageUrl: string): Promise<ImageSearchResult[]> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
    const page = await createAntiBotPage(browser);

    // Block unnecessary resources to speed up
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["font", "media", "stylesheet"].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    // 1688 image search URL with the Etsy image as query parameter
    const searchUrl =
      `https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageType=oss&imageAddress=${encodeURIComponent(imageUrl)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT });

    // Wait for search results to load
    try {
      await page.waitForSelector(".image-search-item, .offer-list-item, [class*='search'] [class*='item']", {
        timeout: 15_000,
      });
    } catch {
      // Results might take a different form — try reading the page content anyway
      await page.waitForTimeout(3000);
    }

    const results = await page.evaluate(() => {
      const items: Array<{ title: string; price: string; url: string; imageUrl: string }> = [];

      // 1688 search result selectors — try multiple patterns
      const selectors = [
        ".image-search-item",
        ".offer-list-item",
        "[class*='search-result'] [class*='item']",
        ".sm-offer-item",
        "[data-offer-id]",
      ];

      let cards: NodeListOf<Element> | undefined;
      for (const sel of selectors) {
        cards = document.querySelectorAll(sel);
        if (cards.length > 0) break;
      }

      if (!cards || cards.length === 0) {
        // Last resort: grab any offer links
        const offerLinks = document.querySelectorAll('a[href*="offer"]');
        for (const link of offerLinks) {
          const el = link.closest("li, div[class]") || link;
          const title = el.querySelector('[class*="title"], a')?.textContent?.trim() || "";
          const price = el.querySelector('[class*="price"]')?.textContent?.trim() || "";
          const img = el.querySelector("img");
          const href = (link as HTMLAnchorElement).href;
          if (title && href) {
            items.push({
              title,
              price: "",
              url: href.startsWith("//") ? `https:${href}` : href,
              imageUrl: img?.src || img?.getAttribute("data-src") || "",
            });
          }
        }
        return items.slice(0, 10);
      }

      for (const card of cards) {
        const title =
          card.querySelector('[class*="title"], .offer-title, a[title]')?.textContent?.trim() ||
          card.querySelector("a")?.textContent?.trim() ||
          "";
        const price =
          card.querySelector('[class*="price"], .offer-price')?.textContent?.trim() || "";
        const link = card.querySelector("a[href*='offer']") ||
          card.querySelector("a");
        const url = link
          ? ((link as HTMLAnchorElement).href.startsWith("//")
            ? `https:${(link as HTMLAnchorElement).href}`
            : (link as HTMLAnchorElement).href)
          : "";
        const img = card.querySelector("img");
        const imageUrl = img?.src || img?.getAttribute("data-src") || "";

        if (title && url) {
          items.push({ title, price, url, imageUrl });
        }
      }

      return items.slice(0, 10);
    });

    await browser.close();

    // Parse and normalize prices
    return results.map((r) => {
      const price = parsePrice(r.price);
      return {
        title: r.title.replace(/\s+/g, " ").trim(),
        price,
        priceDisplay: price > 0 ? `¥${price.toFixed(2)}` : r.price || "¥—",
        url: r.url,
        imageUrl: r.imageUrl,
      };
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error("1688 image search failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ── Full Pipeline ──────────────────────────────────────────────

/**
 * Complete pipeline: scrape Etsy image → search 1688 by image.
 * Falls back to simulated results on failure.
 * If source is already a direct image URL, skips the Etsy scraping step.
 */
export async function matchByImage(
  sourceUrl: string,
  etsyTitle: string,
  fallbackIndex: number
): Promise<ImageSearchResult[]> {
  let imageUrl: string | null = null;

  // If source is already a direct image URL, use it directly
  if (isImageUrl(sourceUrl)) {
    imageUrl = sourceUrl;
    console.log(`  [image-search] Using direct image URL: ${imageUrl.slice(0, 80)}...`);
  } else {
    // Step 1: Try to get the Etsy product image from the listing page
    const etsyImage = await scrapeEtsyImage(sourceUrl);
    if (etsyImage?.imageUrl) {
      imageUrl = etsyImage.imageUrl;
      console.log(`  [image-search] Etsy image scraped: ${imageUrl.slice(0, 80)}...`);
    }
  }

  if (imageUrl) {
    const results = await search1688ByImage(imageUrl);
    if (results.length > 0) {
      console.log(`  [image-search] Found ${results.length} 1688 matches via image search`);
      return results;
    }
    console.log("  [image-search] No image search results, falling back to simulation");
  } else {
    console.log("  [image-search] Could not extract Etsy image, falling back to simulation");
  }

  // Fallback: return empty — caller will use simulated data
  return [];
}

// ── Helpers ────────────────────────────────────────────────────

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif|bmp)(\?|#|$)/i.test(url) ||
    url.includes("etsy-static") ||
    url.includes("pinimg.com") ||
    url.includes("alicdn.com");
}

function parsePrice(raw: string): number {
  const cleaned = raw.replace(/[¥￥$,，\s]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
