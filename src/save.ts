import { createObjectCsvWriter } from "csv-writer";

export interface EtsyCrawlResult {
  etsy_title: string;
  etsy_url: string;
  etsy_price: string;
  etsy_sales: string;
  etsy_favorites: string;
  etsy_image_url: string;
}

export async function saveToCSV(data: EtsyCrawlResult[]) {
  const csvWriter = createObjectCsvWriter({
    path: "etsy_results.csv",

    header: [
      { id: "etsy_title", title: "etsy_title" },
      { id: "etsy_url", title: "etsy_url" },
      { id: "etsy_price", title: "etsy_price" },
      { id: "etsy_sales", title: "etsy_sales" },
      { id: "etsy_favorites", title: "etsy_favorites" },
      { id: "etsy_image_url", title: "etsy_image_url" },
    ],
  });

  await csvWriter.writeRecords(data);

  console.log("CSV saved → etsy_results.csv");
}