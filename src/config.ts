import dotenv from "dotenv";

dotenv.config();

export const config = {
  searchKeyword: process.env.SEARCH_KEYWORD || "silver ring",

  maxPages: Number(process.env.MAX_PAGES || 3),
};