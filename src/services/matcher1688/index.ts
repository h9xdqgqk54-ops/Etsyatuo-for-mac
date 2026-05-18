/**
 * Step 3 — 1688 Image-to-Product Matching (Simulated)
 *
 * Reads selected_etsy.csv (or etsy_results.csv), simulates 1688
 * reverse-image-search and returns matching wholesale listings.
 *
 * No real API calls. No image/text generation.
 * Output: 1688_matches.csv
 */

import csvParser from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ────────────────────────────────────────────────────

interface EtsyRecord {
  etsy_title: string;
  etsy_url: string;
}

interface MatchResult {
  etsy_title: string;
  etsy_url: string;
  "1688_title": string;
  "1688_url": string;
  "1688_price": string;
}

// ── Constants ────────────────────────────────────────────────

const INPUT_CSV = "output/selected_etsy.csv";
const FALLBACK_CSV = "etsy_results.csv";
const OUTPUT_DIR = "output";
const OUTPUT_CSV = "1688_matches.csv";

const FACTORY_SUFFIXES = [
  "Factory Direct Wholesale Custom Logo",
  "Wholesale Supplier Bulk Order",
  "Hot Selling Factory Price Customizable",
  "High Quality Manufacturer Direct",
  "Wholesale Factory Custom OEM ODM",
  "Hot Sale Factory Direct Supply",
  "Manufacturer Wholesale In Stock",
  "Factory Outlet Custom Design Welcome",
];

const MATERIALS = [
  "925 Sterling Silver",
  "Stainless Steel",
  "Zinc Alloy",
  "Titanium Steel",
  "Copper Alloy",
  "Brass",
  "S925 Silver Plated",
  "Tungsten Steel",
];

const FAKE_OFFER_IDS = [
  "681234567890", "691234567891", "671234567892", "661234567893",
  "651234567894", "641234567895", "631234567896", "621234567897",
  "611234567898", "601234567899", "591234567900", "581234567901",
  "571234567902", "561234567903", "551234567904", "541234567905",
];

// ── CSV Reader ───────────────────────────────────────────────

async function parseCSV(filePath: string): Promise<EtsyRecord[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}\n` +
      `Run the Etsy selector first: pnpm tsx src/services/select_etsy.ts`,
    );
  }

  return new Promise((resolve, reject) => {
    const records: EtsyRecord[] = [];

    fs.createReadStream(filePath, "utf-8")
      .on("error", (err) => reject(new Error(`Read error: ${err.message}`)))
      .pipe(csvParser())
      .on("data", (row: Record<string, string>) => {
        records.push(normalizeRecord(row));
      })
      .on("end", () => {
        if (records.length === 0) {
          reject(new Error("CSV file is empty — nothing to match."));
        } else {
          resolve(records);
        }
      })
      .on("error", (err) => reject(new Error(`Parse error: ${err.message}`)));
  });
}

/** Accept both new-style (etsy_title/etsy_url) and legacy (title/link) columns. */
function normalizeRecord(row: Record<string, string>): EtsyRecord {
  const keys: Record<string, string> = {};
  for (const k of Object.keys(row)) {
    keys[k.trim().toLowerCase()] = (row[k] ?? "").trim();
  }

  return {
    etsy_title: keys["etsy_title"] ?? keys["title"] ?? "",
    etsy_url: keys["etsy_url"] ?? keys["link"] ?? keys["url"] ?? "",
  };
}

// ── Price Helpers ────────────────────────────────────────────

function parsePrice(raw: string): number {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  const num = Number(cleaned);
  return Number.isNaN(num) || num < 0 ? 0 : num;
}

// ── Title Transformation ─────────────────────────────────────

function extractCoreKeywords(title: string): string {
  return title
    .replace(/[•|,/;:!?"'()]/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function generate1688Title(etsyTitle: string, index: number): string {
  const core = extractCoreKeywords(etsyTitle);
  const words = core.split(/\s+/).filter((w) => w.length > 2);
  const keyWords = words.slice(0, Math.min(words.length, 5));

  const material = MATERIALS[index % MATERIALS.length]!;
  const suffix = FACTORY_SUFFIXES[index % FACTORY_SUFFIXES.length]!;

  return `${material} ${keyWords.join(" ")} ${suffix}`;
}

// ── Price Simulation ─────────────────────────────────────────

/**
 * Simulated 1688 wholesale price (20–45% of estimated Etsy retail).
 * Since selected_etsy.csv may not include price, use a base range.
 */
function generate1688Price(index: number): string {
  // Simulated wholesale price range: $2.50 – $80
  const basePrices = [
    6.80, 12.50, 8.20, 22.00, 4.50, 18.30, 9.90, 35.00,
    15.60, 7.40, 28.00, 3.80, 11.20, 19.50, 5.90, 42.00,
  ];
  const base = basePrices[index % basePrices.length]!;
  const jitter = (Math.random() * 0.2 - 0.1) * base; // ±10%
  return (base + jitter).toFixed(2);
}

function generate1688Url(index: number): string {
  const offerId = FAKE_OFFER_IDS[index % FAKE_OFFER_IDS.length]!;
  return `https://detail.1688.com/offer/${offerId}.html`;
}

// ── Matching Engine ──────────────────────────────────────────

function matchRecords(etsyRecords: EtsyRecord[]): MatchResult[] {
  return etsyRecords.map((rec, i) => ({
    etsy_title: rec.etsy_title,
    etsy_url: rec.etsy_url,
    "1688_title": generate1688Title(rec.etsy_title, i),
    "1688_url": generate1688Url(i),
    "1688_price": generate1688Price(i),
  }));
}

// ── CSV Writer ───────────────────────────────────────────────

async function saveMatches(
  matches: MatchResult[],
  outputPath: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "etsy_title", title: "etsy_title" },
      { id: "etsy_url", title: "etsy_url" },
      { id: "1688_title", title: "1688_title" },
      { id: "1688_url", title: "1688_url" },
      { id: "1688_price", title: "1688_price" },
    ],
  });

  await csvWriter.writeRecords(matches);
  console.log(`  Matches saved → ${outputPath}`);
}

// ── Terminal Report ──────────────────────────────────────────

function printReport(etsyCount: number, matchCount: number, matches: MatchResult[]): void {
  const divider = "═".repeat(52);

  console.log(`\n${divider}`);
  console.log(`  Etsy → 1688 Match Report`);
  console.log(divider);
  console.log(`  Etsy listings scanned:    ${etsyCount}`);
  console.log(`  1688 matches generated:   ${matchCount}`);
  console.log(`  Mode:                     simulated (no API calls)`);
  console.log(divider);

  console.log(`\n  ── Sample Matches (first 4) ──`);
  for (let i = 0; i < Math.min(4, matches.length); i++) {
    const m = matches[i]!;
    console.log(`\n  [Etsy]  ${truncate(m.etsy_title, 50)}`);
    console.log(`  [1688]  ${truncate(m["1688_title"], 50)}`);
    console.log(`          ¥${m["1688_price"]}  |  ${m["1688_url"]}`);
  }

  console.log(`\n  Note: 1688 data is SIMULATED.`);
  console.log(`  Use a real crawler (e.g. Playwright) for live data.`);
  console.log(`${divider}\n`);
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
}

// ── Main ─────────────────────────────────────────────────────

/** Resolve input path: prefer selected_etsy.csv, fall back to etsy_results.csv. */
function resolveInputPath(): { path: string; usedFallback: boolean } {
  const primary = path.resolve(INPUT_CSV);
  if (fs.existsSync(primary)) {
    return { path: primary, usedFallback: false };
  }
  const fallback = path.resolve(FALLBACK_CSV);
  if (fs.existsSync(fallback)) {
    return { path: fallback, usedFallback: true };
  }
  return { path: primary, usedFallback: false };
}

async function main(): Promise<void> {
  const outputPath = path.resolve(OUTPUT_DIR, OUTPUT_CSV);
  const { path: inputPath, usedFallback } = resolveInputPath();

  console.log("╔══════════════════════════════════════╗");
  console.log("║   Etsy → 1688 Matcher (Simulated)   ║");
  console.log("╚══════════════════════════════════════╝\n");

  if (usedFallback) {
    console.log(`  Using fallback: ${inputPath}`);
    console.log(`  (Run select_etsy.ts first for scored selections.)\n`);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`  Input file not found: ${inputPath}`);
    console.error(`  Run: pnpm tsx src/services/select_etsy.ts  first.\n`);
    process.exit(1);
  }

  let etsyRecords: EtsyRecord[];
  try {
    console.log(`  Reading: ${inputPath}`);
    etsyRecords = await parseCSV(inputPath);
    console.log(`  Loaded ${etsyRecords.length} Etsy listings.\n`);
  } catch (err) {
    console.error(`  Failed to read CSV: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  console.log(`  Simulating 1688 keyword search...`);
  const matches = matchRecords(etsyRecords);
  console.log(`  Generated ${matches.length} mock 1688 matches.\n`);

  try {
    await saveMatches(matches, outputPath);
  } catch (err) {
    console.error(`  Failed to write output: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  printReport(etsyRecords.length, matches.length, matches);
}

// ── Exports ──────────────────────────────────────────────────

export {
  extractCoreKeywords,
  generate1688Price,
  generate1688Title,
  generate1688Url,
  matchRecords,
  parseCSV,
  saveMatches,
};
export type { EtsyRecord, MatchResult };

const isMain =
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js") ||
  process.argv[1]?.includes("matcher1688");
if (isMain) {
  main();
}
