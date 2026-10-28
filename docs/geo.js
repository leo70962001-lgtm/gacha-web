// 玩家大概在哪個國家、用什麼裝置（機台的數據後台用，使用者 2026-10-28：「可以知道有誰轉過自己的轉蛋跟國家分布」）
//   國家：裝置的時區 → 國碼（不查 IP、不用定位）；查不到再看語言的地區（zh-TW → TW）；都沒有＝null
//   裝置：觸控＋螢幕寬度 → phone／tablet／desktop
const TZ = {
  // 亞洲
  'Asia/Taipei': 'TW', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Chongqing': 'CN', 'Asia/Harbin': 'CN', 'Asia/Urumqi': 'CN',
  'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY', 'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Manila': 'PH', 'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Yangon': 'MM', 'Asia/Rangoon': 'MM',
  'Asia/Phnom_Penh': 'KH', 'Asia/Vientiane': 'LA', 'Asia/Kathmandu': 'NP', 'Asia/Colombo': 'LK', 'Asia/Riyadh': 'SA', 'Asia/Tehran': 'IR',
  'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Baghdad': 'IQ', 'Asia/Almaty': 'KZ',
  'Asia/Tashkent': 'UZ', 'Asia/Ulaanbaatar': 'MN', 'Asia/Brunei': 'BN', 'Asia/Dili': 'TL', 'Asia/Thimphu': 'BT', 'Asia/Muscat': 'OM',
  'Asia/Amman': 'JO', 'Asia/Beirut': 'LB', 'Asia/Baku': 'AZ', 'Asia/Tbilisi': 'GE', 'Asia/Yerevan': 'AM', 'Asia/Vladivostok': 'RU', 'Asia/Novosibirsk': 'RU', 'Asia/Yekaterinburg': 'RU',
  // 歐洲
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU', 'Europe/Athens': 'GR',
  'Europe/Lisbon': 'PT', 'Europe/Moscow': 'RU', 'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG',
  'Europe/Belgrade': 'RS', 'Europe/Zagreb': 'HR', 'Europe/Ljubljana': 'SI', 'Europe/Bratislava': 'SK', 'Europe/Vilnius': 'LT', 'Europe/Riga': 'LV',
  'Europe/Tallinn': 'EE', 'Europe/Luxembourg': 'LU', 'Europe/Istanbul': 'TR', 'Europe/Minsk': 'BY', 'Europe/Reykjavik': 'IS', 'Atlantic/Reykjavik': 'IS',
  'Europe/Malta': 'MT', 'Europe/Monaco': 'MC',
  // 美洲
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Phoenix': 'US',
  'America/Anchorage': 'US', 'America/Detroit': 'US', 'America/Boise': 'US', 'America/Indiana/Indianapolis': 'US', 'Pacific/Honolulu': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/St_Johns': 'CA', 'America/Regina': 'CA',
  'America/Mexico_City': 'MX', 'America/Tijuana': 'MX', 'America/Cancun': 'MX', 'America/Monterrey': 'MX', 'America/Sao_Paulo': 'BR', 'America/Manaus': 'BR',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Buenos_Aires': 'AR', 'America/Santiago': 'CL', 'America/Lima': 'PE', 'America/Bogota': 'CO',
  'America/Caracas': 'VE', 'America/Montevideo': 'UY', 'America/Asuncion': 'PY', 'America/La_Paz': 'BO', 'America/Guayaquil': 'EC',
  'America/Panama': 'PA', 'America/Costa_Rica': 'CR', 'America/Guatemala': 'GT', 'America/Havana': 'CU', 'America/Puerto_Rico': 'PR', 'America/Santo_Domingo': 'DO', 'America/Jamaica': 'JM',
  // 大洋洲、非洲
  'Pacific/Auckland': 'NZ', 'Pacific/Fiji': 'FJ', 'Pacific/Guam': 'GU', 'Pacific/Port_Moresby': 'PG', 'Pacific/Tahiti': 'PF', 'Pacific/Noumea': 'NC',
  'Africa/Cairo': 'EG', 'Africa/Johannesburg': 'ZA', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ',
  'Africa/Tunis': 'TN', 'Africa/Accra': 'GH', 'Africa/Addis_Ababa': 'ET', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kampala': 'UG', 'Indian/Mauritius': 'MU', 'Indian/Maldives': 'MV',
};
const PREFIX = [['Australia/', 'AU'], ['Canada/', 'CA'], ['US/', 'US'], ['Brazil/', 'BR'], ['Mexico/', 'MX'], ['Chile/', 'CL']];
// 只有語言沒有地區時的猜測（ja → JP …）
const LANG = { ja: 'JP', ko: 'KR', th: 'TH', vi: 'VN', id: 'ID', ms: 'MY', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', pt: 'BR', ru: 'RU', tr: 'TR', pl: 'PL', nl: 'NL' };

export function guessCountry() {
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {}
  if (TZ[tz]) return TZ[tz];
  for (const [p, c] of PREFIX) if (tz.startsWith(p)) return c;
  const lang = (navigator.language || '').split('-');
  const reg = lang.find((x, i) => i > 0 && /^[A-Z]{2}$/.test(x));
  if (reg) return reg;
  return LANG[lang[0]] || null;
}

export function deviceType() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const w = Math.min(screen.width, screen.height);
  if (!touch) return 'desktop';
  return w >= 600 ? 'tablet' : 'phone';
}

// 國碼 → 國旗（區域指示符號）、國名（瀏覽器的 Intl，照介面語言）
export const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🏳️');
const nameCache = new Map();
export function countryName(cc, lang) {
  if (!/^[A-Z]{2}$/.test(cc || '')) return null;
  const k = lang + cc;
  if (!nameCache.has(k)) {
    let n = cc;
    try {
      n = new Intl.DisplayNames([lang === 'zh' ? 'zh-TW' : lang], { type: 'region' }).of(cc) || cc;
    } catch {}
    nameCache.set(k, n);
  }
  return nameCache.get(k);
}
