import { getBankOfTaiwanRates } from '../server/bankOfTaiwanRates.js';

// 臺灣銀行偶爾回應較慢，避免 Vercel 使用過短的預設執行時間。
export const maxDuration = 60;

export default async function handler(request, response) {
  try {
    const data = await getBankOfTaiwanRates();
    const currency = String(request.query?.currency || '').trim().toUpperCase();
    response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    if (currency) {
      const quote = data.rates[currency];
      if (!quote) return response.status(404).json({ error: `查無 ${currency} 的即期匯率` });
      return response.status(200).json({ ...data, currency, quote, rates: undefined });
    }
    return response.status(200).json(data);
  } catch (error) {
    response.status(502).json({ error: error.message || '無法取得臺灣銀行匯率' });
  }
}
