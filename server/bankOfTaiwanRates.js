const BOT_CSV_URL = 'https://rate.bot.com.tw/xrt/flcsv/0';

const splitCsvLine = (line) => {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { fields.push(value.trim()); value = ''; }
    else value += char;
  }
  fields.push(value.trim());
  return fields;
};

export const getBankOfTaiwanRates = async () => {
  const taipeiToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const cursor = new Date(`${taipeiToday}T00:00:00Z`);
  let rates = {};
  let rateDate = '';

  // 從昨天開始往前找，週末與國定假日會自動略過。
  for (let daysAgo = 1; daysAgo <= 10 && !Object.keys(rates).length; daysAgo += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const candidateDate = cursor.toISOString().slice(0, 10);
    const response = await fetch(`${BOT_CSV_URL}/${candidateDate}`, {
      headers: {
        accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8',
        'user-agent': 'AAApp/1.0 (Bank of Taiwan public exchange-rate client)'
      },
      redirect: 'follow'
    });
    if (!response.ok || !response.url.includes('rate.bot.com.tw')) continue;

    const csv = (await response.text()).replace(/^\uFEFF/, '');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) continue;

    const parsed = lines.slice(1).map(splitCsvLine).reduce((result, row) => {
      const code = row[0]?.toUpperCase();
      const spotSell = Number(row[13]);
      if (/^[A-Z]{3}$/.test(code) && Number.isFinite(spotSell) && spotSell > 0) {
        result[code] = { rate: spotSell, type: '即期賣出收盤' };
      }
      return result;
    }, {});
    if (Object.keys(parsed).length) { rates = parsed; rateDate = candidateDate; }
  }

  if (!Object.keys(rates).length) throw new Error('臺灣銀行目前沒有可用的牌告匯率');
  return {
    source: '臺灣銀行',
    sourceUrl: 'https://rate.bot.com.tw/xrt',
    fetchedAt: new Date().toISOString(),
    rateDate,
    rates
  };
};
