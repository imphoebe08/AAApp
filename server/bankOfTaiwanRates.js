const PRIMARY_URL = 'https://cdn.jsdelivr.net/gh/haotool/app@data/public/rates/latest.json';
const FALLBACK_URL = 'https://raw.githubusercontent.com/haotool/app/data/public/rates/latest.json';

const fetchSnapshot = async (url) => {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'AAApp/1.0' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`匯率快照回應異常（HTTP ${response.status}）`);
  return response.json();
};

export const getBankOfTaiwanRates = async () => {
  let snapshot;
  try { snapshot = await fetchSnapshot(PRIMARY_URL); }
  catch { snapshot = await fetchSnapshot(FALLBACK_URL); }

  const rates = Object.entries(snapshot.details || {}).reduce((result, [rawCode, detail]) => {
    const code = rawCode.trim().toUpperCase();
    const spotSell = Number(detail?.spot?.sell);
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(spotSell) && spotSell > 0) {
      result[code] = { rate: spotSell, type: '即期賣出' };
    }
    return result;
  }, {});
  const timestamp = snapshot.timestamp ? new Date(snapshot.timestamp) : new Date();
  const rateDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(timestamp);

  if (!Object.keys(rates).length) throw new Error('匯率快照中沒有可用的即期賣出價');
  return {
    source: '臺灣銀行（CDN 快照）',
    sourceUrl: snapshot.sourceUrl || 'https://rate.bot.com.tw/xrt',
    fetchedAt: new Date().toISOString(),
    rateDate,
    rates
  };
};
