import axios from "axios";

const API_KEY = process.env.ETSY_API_KEY;

export async function searchEtsy(keyword: string) {
  const url = `https://openapi.etsy.com/v3/application/listings/active`;

  try {
    const response = await axios.get(url, {
      headers: {
        "x-api-key": API_KEY || "",
      },
      params: {
        keywords: keyword,
        limit: 20,
      },
    });

    const results = response.data.results;

    return results.map((item: any) => ({
      title: item.title,
      price: item.price?.amount
        ? Number(item.price.amount) / item.price.divisor
        : "",
      currency: item.price?.currency_code || "",
      shop: item.shop_name || "",
      url: item.url,
    }));
  } catch (error: any) {
    console.log("API 请求失败");
    console.log(error.response?.data || error.message);

    return [];
  }
}