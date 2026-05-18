import csvParser from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ────────────────────────────────────────────────

interface EtsyRecord {
  title: string;
  price: string;
  link: string;
  shopName?: string;
}

interface AnalysisResult {
  totalItems: number;
  averagePrice: number;
  maxPrice: number;
  maxPriceTitle: string;
  minPrice: number;
  minPriceTitle: string;
  shopNames: string[];
  shopCount: number;
  itemFrequency: Map<string, number>;
}

// ── CSV Reader ───────────────────────────────────────────

async function parseCSV(filePath: string): Promise<EtsyRecord[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    const records: EtsyRecord[] = [];

    fs.createReadStream(filePath, "utf-8")
      .on("error", (err) => reject(new Error(`Failed to read CSV: ${err.message}`)))
      .pipe(csvParser())
      .on("data", (row: Record<string, string>) => {
        records.push(normalizeRecord(row));
      })
      .on("end", () => resolve(records))
      .on("error", (err) => reject(new Error(`CSV parse error: ${err.message}`)));
  });
}

/** Map raw CSV row to EtsyRecord, handling common column name variants. */
function normalizeRecord(row: Record<string, string>): EtsyRecord {
  const keys = Object.keys(row).reduce<Record<string, string>>(
    (acc, k) => {
      acc[k.trim().toLowerCase()] = row[k] ?? "";
      return acc;
    },
    {},
  );

  return {
    title: keys["title"] ?? "",
    price: keys["price"] ?? "",
    link: keys["link"] ?? "",
    shopName: keys["shopname"] ?? keys["shop_name"] ?? undefined,
  };
}

// ── Price Helpers ────────────────────────────────────────

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

// ── Analysis ─────────────────────────────────────────────

function analyze(records: EtsyRecord[]): AnalysisResult {
  const prices: { price: number; title: string }[] = [];
  const itemFrequency = new Map<string, number>();
  const shopNames = new Set<string>();

  for (const rec of records) {
    const price = parsePrice(rec.price);
    if (price !== null) {
      prices.push({ price, title: rec.title });
    }

    const key = rec.title.trim().toLowerCase();
    itemFrequency.set(key, (itemFrequency.get(key) ?? 0) + 1);

    if (rec.shopName && rec.shopName.trim()) {
      shopNames.add(rec.shopName.trim());
    }
  }

  const sorted = prices.slice().sort((a, b) => a.price - b.price);

  const total = prices.reduce((sum, p) => sum + p.price, 0);
  const averagePrice = prices.length > 0 ? total / prices.length : 0;

  return {
    totalItems: records.length,
    averagePrice: Math.round(averagePrice * 100) / 100,
    maxPrice: sorted.length > 0 ? sorted[sorted.length - 1]!.price : 0,
    maxPriceTitle: sorted.length > 0 ? sorted[sorted.length - 1]!.title : "",
    minPrice: sorted.length > 0 ? sorted[0]!.price : 0,
    minPriceTitle: sorted.length > 0 ? sorted[0]!.title : "",
    shopNames: [...shopNames],
    shopCount: shopNames.size,
    itemFrequency,
  };
}

// ── Output: Console ──────────────────────────────────────

function printAnalysis(result: AnalysisResult): void {
  const duplicates = [...result.itemFrequency.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);

  console.log("\n═══════════════════════════════════════");
  console.log("       Etsy Results Analysis");
  console.log("═══════════════════════════════════════");
  console.log(` Total items:      ${result.totalItems}`);
  console.log(` Average price:    $${result.averagePrice.toFixed(2)}`);
  console.log(` Lowest price:     $${result.minPrice.toFixed(2)}`);
  console.log(`   → ${result.minPriceTitle}`);
  console.log(` Highest price:    $${result.maxPrice.toFixed(2)}`);
  console.log(`   → ${result.maxPriceTitle}`);
  console.log(` Shops found:      ${result.shopCount}`);

  if (result.shopNames.length > 0) {
    console.log(` Shop list:        ${result.shopNames.join(", ")}`);
  } else {
    console.log(` (no shop name column in source CSV)`);
  }

  if (duplicates.length > 0) {
    console.log("───────────────────────────────────────");
    console.log(` Duplicate items:  ${duplicates.length} titles`);
    for (const [title, count] of duplicates.slice(0, 10)) {
      const short = title.length > 60 ? title.slice(0, 57) + "..." : title;
      console.log(`   [${count}x] ${short}`);
    }
    if (duplicates.length > 10) {
      console.log(`   ... and ${duplicates.length - 10} more`);
    }
  }

  console.log("═══════════════════════════════════════\n");
}

// ── Output: CSV ─────────────────────────────────────────

async function saveAnalysis(
  result: AnalysisResult,
  outputPath: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const duplicates = [...result.itemFrequency.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);

  const metrics = [
    { metric: "total_items", value: String(result.totalItems) },
    { metric: "average_price", value: result.averagePrice.toFixed(2) },
    { metric: "min_price", value: result.minPrice.toFixed(2) },
    { metric: "max_price", value: result.maxPrice.toFixed(2) },
    { metric: "shop_count", value: String(result.shopCount) },
    { metric: "duplicate_titles", value: String(duplicates.length) },
  ];

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "metric", title: "metric" },
      { id: "value", title: "value" },
    ],
  });

  await csvWriter.writeRecords(metrics);
  console.log(`Analysis saved to: ${outputPath}`);
}

// ── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const inputPath = path.resolve("etsy_results.csv");
  const outputPath = path.resolve("output", "etsy_analysis.csv");

  try {
    console.log(`Reading: ${inputPath}`);
    const records = await parseCSV(inputPath);

    if (records.length === 0) {
      console.log("No records found in CSV file.");
      return;
    }

    const result = analyze(records);
    printAnalysis(result);

    try {
      await saveAnalysis(result, outputPath);
    } catch (err) {
      console.error(`Failed to save analysis CSV: ${err}`);
    }
  } catch (err) {
    console.error("Analysis failed:", err);
    process.exit(1);
  }
}

// ── Exports ──────────────────────────────────────────────

export { analyze, parseCSV, parsePrice, printAnalysis, saveAnalysis };
export type { AnalysisResult, EtsyRecord };

// Allow running directly via tsx
const isMain = process.argv[1]?.endsWith("analyze.ts") || process.argv[1]?.endsWith("analyze.js");
if (isMain) {
  main();
}
