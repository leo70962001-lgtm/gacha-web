// Clatter 意見回饋 → Discord「カスタマーサービス」頻道（Supabase Edge Function `feedback`；JWT 驗證開著，網頁帶公開的 anon key 過閘道）
// 使用者 2026-10-30：「有 feedback 的話在這裡」（給了カスタマーサービス頻道的 webhook）
//   網頁直接打 Discord webhook 的話，網址會公開在網頁原始碼裡（誰都能拿去洗頻道）→ 網址放在這裡的秘密，網頁只打這個 function
//
// 網頁用：POST /  { kind: 'bug'|'idea'|'other', text, contact?, page?, machine?, lang?, device? } → { ok: true }
//   擋：內容 1–1000 字、聯絡方式 100 字、同一個 IP 每分鐘 3 則（這台機器的記憶體，擋手滑連按）、@everyone 之類的提及不會響
//
// 秘密（Supabase → Edge Functions → Secrets，使用者自己貼）：DISCORD_FEEDBACK_WEBHOOK＝カスタマーサービス頻道的 webhook 網址
//   2026-10-30 實際存成了 Discord 那邊 webhook 的名字「Captain Hook」（值是對的）→ 兩個名字都認

const env = (k: string): string => ((globalThis as any).Deno ? (globalThis as any).Deno.env.get(k) : (globalThis as any).process?.env?.[k]) || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// 種類 → Discord 卡片的標題、顏色（三種語言都寫，順序中文、日文、英文）
const KINDS: Record<string, { label: string; color: number }> = {
  bug: { label: '🐞 問題回報 / 不具合 / Bug', color: 0xe8423b },
  idea: { label: '💡 建議 / 要望 / Idea', color: 0xffc83d },
  other: { label: '💬 其他 / その他 / Other', color: 0x4f8cff },
};

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // 不要一直長大
  return list.length > 3;
}
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v : '').trim().slice(0, n);

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const hook = env('DISCORD_FEEDBACK_WEBHOOK') || env('Captain Hook');
  if (!hook) return json({ error: 'off' }, 503);
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  if (limited(ip)) return json({ error: 'slow' }, 429);
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'bad' }, 400);
  }
  const text = clip(b.text, 1000);
  if (!text) return json({ error: 'empty' }, 400);
  const kind = KINDS[b.kind as string] ? (b.kind as string) : 'other';
  const fields = [
    ['聯絡方式 / 連絡先 / Contact', clip(b.contact, 100), false],
    ['頁面 / ページ / Page', clip(b.page, 200), false],
    ['機台 / マシン / Machine', clip(b.machine, 120), false],
    ['語言 / 言語 / Lang', clip(b.lang, 10), true],
    ['裝置 / 端末 / Device', clip(b.device, 200), false],
  ]
    .filter(([, v]) => v)
    .map(([name, value, inline]) => ({ name, value, inline }));
  const r = await fetch(hook + (hook.includes('?') ? '&' : '?') + 'wait=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Clatter フィードバック',
      allowed_mentions: { parse: [] },
      embeds: [{ title: KINDS[kind].label, description: text, color: KINDS[kind].color, fields, timestamp: new Date().toISOString() }],
    }),
  });
  if (!r.ok) return json({ error: 'discord', status: r.status }, 502);
  return json({ ok: true });
}

if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(handle);
