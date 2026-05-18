import csvParser from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import * as fs from "node:fs";
import * as path from "node:path";
import prompts from "prompts";

// ── Types ────────────────────────────────────────────────────

interface EtsyRecord {
  title: string;
  price: string;
  link: string;
  shopName?: string;
}

interface PriceBin {
  range: string;
  min: number;
  max: number | null;
  count: number;
  pct: string;
}

interface KeywordEntry {
  word: string;
  count: number;
}

interface DuplicateEntry {
  title: string;
  count: number;
}

interface AnalysisResult {
  totalItems: number;
  averagePrice: number;
  minPrice: number;
  minPriceTitle: string;
  maxPrice: number;
  maxPriceTitle: string;
  priceDistribution: PriceBin[];
  duplicates: DuplicateEntry[];
  shopNames: string[];
  shopCount: number;
  shopFrequency: { shop: string; count: number }[];
  keywordFrequency: KeywordEntry[];
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_CSV_PATH = "etsy_results.csv";
const OUTPUT_DIR = "output";
const OUTPUT_FILE = "etsy_analysis.csv";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "in", "to", "with",
  "is", "on", "at", "from", "by", "as", "be", "it", "its",
  "no", "not", "this", "that", "but", "so", "if", "we", "our",
  "all", "are", "was", "has", "had", "been", "can", "will",
  "just", "more", "than", "each", "also", "very", "your",
  "her", "his", "she", "he", "they", "them", "their",
  "gift", "set", "size", "us",
]);

const PRICE_BINS: Omit<PriceBin, "count" | "pct">[] = [
  { range: "< $20", min: 0, max: 19.99 },
  { range: "$20 - $50", min: 20, max: 49.99 },
  { range: "$50 - $100", min: 50, max: 99.99 },
  { range: "> $100", min: 100, max: null },
];

// ── Interactive Prompt ───────────────────────────────────────

async function promptKeyword(): Promise<string> {
  const response = await prompts({
    type: "text",
    name: "keyword",
    message: "Enter search keyword",
    initial: "silver ring",
    validate: (v: string) => v.trim().length > 0 || "Keyword cannot be empty",
  });

  if (!response.keyword) {
    console.log("Cancelled.");
    process.exit(0);
  }

  return response.keyword.trim();
}

// ── CSV Reader ───────────────────────────────────────────────

async function parseCSV(filePath: string): Promise<EtsyRecord[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}\n` +
      `Please run the crawler first to generate data.`,
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
          reject(new Error("CSV file is empty."));
        } else {
          resolve(records);
        }
      })
      .on("error", (err) => reject(new Error(`Parse error: ${err.message}`)));
  });
}

function normalizeRecord(row: Record<string, string>): EtsyRecord {
  const keys: Record<string, string> = {};
  for (const k of Object.keys(row)) {
    keys[k.trim().toLowerCase()] = (row[k] ?? "").trim();
  }

  return {
    title: keys["title"] ?? "",
    price: keys["price"] ?? "0",
    link: keys["link"] ?? "",
    shopName: keys["shopname"] ?? keys["shop_name"] ?? extractShopName(keys["title"] ?? ""),
  };
}

// ── Shop Name Extraction ─────────────────────────────────────

function extractShopName(title: string): string | null {
  // "by SomeShopName" pattern (common in Etsy listing titles)
  const m = title.match(/\bby\s+([A-Z][\w\s&.'-]+?)(?:\s*[•|/-]|$)/);
  return m ? m[1]!.trim() : null;
}

// ── Price Helpers ────────────────────────────────────────────

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  const num = Number(cleaned);
  return Number.isNaN(num) || num < 0 ? null : num;
}

// ── Keyword Frequency ────────────────────────────────────────

function getKeywordFrequency(titles: string[], topN = 20): KeywordEntry[] {
  const freq = new Map<string, number>();

  for (const title of titles) {
    const words = title
      .toLowerCase()
      .replace(/[•|,./;:!?()[\]{}"'*#@&$%^_+=<>~`\\-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && Number.isNaN(Number(w)));

    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

// ── Analysis ─────────────────────────────────────────────────

function analyze(records: EtsyRecord[]): AnalysisResult {
  // --- prices ---
  const priceEntries: { price: number; title: string }[] = [];
  for (const rec of records) {
    const p = parsePrice(rec.price);
    if (p !== null) {
      priceEntries.push({ price: p, title: rec.title });
    }
  }
  const sortedByPrice = priceEntries.slice().sort((a, b) => a.price - b.price);
  const totalPrice = priceEntries.reduce((s, x) => s + x.price, 0);
  const avgPrice = priceEntries.length > 0
    ? Math.round((totalPrice / priceEntries.length) * 100) / 100
    : 0;

  // --- price distribution ---
  const distribution: PriceBin[] = PRICE_BINS.map((bin) => {
    const count = priceEntries.filter(
      (p) => p.price >= bin.min && (bin.max === null || p.price <= bin.max),
    ).length;
    const pct = priceEntries.length > 0
      ? ((count / priceEntries.length) * 100).toFixed(1) + "%"
      : "0%";
    return { ...bin, count, pct };
  });

  // --- duplicates ---
  const freqMap = new Map<string, number>();
  for (const rec of records) {
    const key = rec.title.trim().toLowerCase();
    freqMap.set(key, (freqMap.get(key) ?? 0) + 1);
  }
  const duplicates: DuplicateEntry[] = [...freqMap.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([title, count]) => ({ title, count }));

  // --- shops ---
  const shopMap = new Map<string, number>();
  const shopNames = new Set<string>();
  for (const rec of records) {
    const name = rec.shopName?.trim();
    if (name && name.length > 0) {
      shopNames.add(name);
      shopMap.set(name, (shopMap.get(name) ?? 0) + 1);
    }
  }
  const shopFrequency = [...shopMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([shop, count]) => ({ shop, count }));

  // --- keywords ---
  const titles = records.map((r) => r.title);
  const keywordFrequency = getKeywordFrequency(titles);

  return {
    totalItems: records.length,
    averagePrice: avgPrice,
    minPrice: sortedByPrice[0]?.price ?? 0,
    minPriceTitle: sortedByPrice[0]?.title ?? "",
    maxPrice: sortedByPrice[sortedByPrice.length - 1]?.price ?? 0,
    maxPriceTitle: sortedByPrice[sortedByPrice.length - 1]?.title ?? "",
    priceDistribution: distribution,
    duplicates,
    shopNames: [...shopNames],
    shopCount: shopNames.size,
    shopFrequency,
    keywordFrequency,
  };
}

// ── Terminal Output ──────────────────────────────────────────

function printAnalysis(result: AnalysisResult, keyword: string): void {
  const divider = "═".repeat(52);

  console.log(`\n${divider}`);
  console.log(`  Etsy Market Analysis —— "${keyword}"`);
  console.log(divider);

  // summary
  console.log(`\n  ── Overview ──`);
  console.log(`  Items found:       ${result.totalItems}`);
  console.log(`  Average price:     $${result.averagePrice.toFixed(2)}`);
  console.log(`  Lowest price:      $${result.minPrice.toFixed(2)}`);
  console.log(`    → ${truncate(result.minPriceTitle, 55)}`);
  console.log(`  Highest price:     $${result.maxPrice.toFixed(2)}`);
  console.log(`    → ${truncate(result.maxPriceTitle, 55)}`);

  // price distribution
  console.log(`\n  ── Price Distribution ──`);
  for (const bin of result.priceDistribution) {
    const bar = "█".repeat(Math.max(1, Math.round(bin.count / Math.max(1, result.totalItems) * 30)));
    console.log(`  ${bin.range.padEnd(12)} ${String(bin.count).padStart(3)} items (${bin.pct.padStart(5)})  ${bar}`);
  }

  // shops
  console.log(`\n  ── Shops ──`);
  if (result.shopCount > 0) {
    console.log(`  Unique shops:      ${result.shopCount}`);
    for (const s of result.shopFrequency.slice(0, 5)) {
      console.log(`    [${s.count}x] ${truncate(s.shop, 42)}`);
    }
    if (result.shopFrequency.length > 5) {
      console.log(`    ... and ${result.shopFrequency.length - 5} more`);
    }
  } else {
    console.log(`  (no shop name data — extracted from title "by X" patterns)`);
  }

  // duplicates
  console.log(`\n  ── Duplicate Items ──`);
  if (result.duplicates.length > 0) {
    for (const d of result.duplicates) {
      console.log(`    [${d.count}x] ${truncate(d.title, 42)}`);
    }
  } else {
    console.log(`  (no duplicate items found)`);
  }

  // keywords
  console.log(`\n  ── Top Keywords in Titles ──`);
  for (const kw of result.keywordFrequency.slice(0, 15)) {
    console.log(`  ${kw.word.padEnd(18)} ${kw.count}`);
  }

  console.log(`\n${divider}\n`);
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
}

// ── CSV Output ───────────────────────────────────────────────

async function saveAnalysis(
  result: AnalysisResult,
  outputPath: string,
  keyword: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const rows: { section: string; key: string; value: string }[] = [];

  // summary
  rows.push(
    { section: "summary", key: "keyword", value: keyword },
    { section: "summary", key: "total_items", value: String(result.totalItems) },
    { section: "summary", key: "average_price", value: result.averagePrice.toFixed(2) },
    { section: "summary", key: "min_price", value: result.minPrice.toFixed(2) },
    { section: "summary", key: "max_price", value: result.maxPrice.toFixed(2) },
    { section: "summary", key: "shop_count", value: String(result.shopCount) },
    { section: "summary", key: "duplicate_count", value: String(result.duplicates.length) },
  );

  // price distribution
  for (const bin of result.priceDistribution) {
    rows.push({
      section: "price_distribution",
      key: bin.range,
      value: `${bin.count} (${bin.pct})`,
    });
  }

  // top keywords
  for (const kw of result.keywordFrequency) {
    rows.push({
      section: "keyword_frequency",
      key: kw.word,
      value: String(kw.count),
    });
  }

  // duplicates
  for (const d of result.duplicates) {
    rows.push({
      section: "duplicates",
      key: d.title.slice(0, 80),
      value: String(d.count),
    });
  }

  // shops
  if (result.shopFrequency.length > 0) {
    for (const s of result.shopFrequency) {
      rows.push({
        section: "shops",
        key: s.shop,
        value: String(s.count),
      });
    }
  }

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "section", title: "section" },
      { id: "key", title: "key" },
      { id: "value", title: "value" },
    ],
  });

  await csvWriter.writeRecords(rows);
  console.log(`Report saved → ${outputPath}`);
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     Etsy Market Analyzer v1.0        ║");
  console.log("╚══════════════════════════════════════╝\n");

  const keyword = await promptKeyword();

  const inputPath = path.resolve(DEFAULT_CSV_PATH);
  const outputPath = path.resolve(OUTPUT_DIR, OUTPUT_FILE);

  // Check CSV exists
  if (!fs.existsSync(inputPath)) {
    console.log(`\n  CSV file not found: ${inputPath}`);
    console.log(`  Please run the crawler first (e.g. pnpm tsx src/crawler.ts)\n`);
    process.exit(1);
  }

  try {
    console.log(`  Reading: ${inputPath}`);
    const records = await parseCSV(inputPath);
    console.log(`  Loaded ${records.length} records.\n`);

    const result = analyze(records);
    printAnalysis(result, keyword);

    await saveAnalysis(result, outputPath, keyword);
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}

// ── Exports ──────────────────────────────────────────────────

export {
  analyze,
  extractShopName,
  getKeywordFrequency,
  parseCSV,
  parsePrice,
  printAnalysis,
  promptKeyword,
  saveAnalysis,
};
export type { AnalysisResult, DuplicateEntry, EtsyRecord, KeywordEntry, PriceBin };

// Direct execution
const isMain =
  process.argv[1]?.endsWith("main.ts") ||
  process.argv[1]?.endsWith("main.js") ||
  process.argv[1]?.includes("tsx");
if (isMain) {
  main();
}
