import { getBankOfTaiwanRates } from '../server/bankOfTaiwanRates.js';

export default async function handler(_request, response) {
  try {
    const data = await getBankOfTaiwanRates();
    response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    response.status(200).json(data);
  } catch (error) {
    response.status(502).json({ error: error.message || '無法取得臺灣銀行匯率' });
  }
}
