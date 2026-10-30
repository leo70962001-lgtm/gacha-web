// 版本更新公告 → Discord「更新」頻道（使用者 2026-10-30：「版本更新時候把它寫到更新裡」，日中英三種語言）
//   順序：中文、日文、英文（使用者 2026-10-30：「發表的時候要寫 中文 日文 英文」）
//   寫好 tools/release/next.md（## zh／## ja／## en 三段，每段幾行 - 列點）→ node tools/publish.js 推上去以後自動貼出去
//   → 貼成功就整段搬進 CHANGELOG.md、刪掉 next.md（不會重貼）；沒設定 webhook 就留著，下次 publish 再貼
//   webhook 網址＝頻道的密碼：放在 tools/.discord-webhook（.gitignore 擋掉）或環境變數 CLATTER_DISCORD_WEBHOOK，不進 repo
//   node tools/discord.js --dry  只印出要貼的內容；node tools/discord.js --post  不 publish、直接把 next.md 貼出去
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const NEXT = path.join(__dirname, 'release', 'next.md');
const LOG = path.join(ROOT, 'CHANGELOG.md');
const HOOK_FILE = path.join(__dirname, '.discord-webhook');
const SITE = 'https://leo70962001-lgtm.github.io/gacha-web/';
const LANG = {
  ja: { title: (v) => `🆕 Clatter ガチャ屋 アップデート ${v}`, color: 0xe8423b },
  zh: { title: (v) => `🆕 Clatter 轉蛋鋪 更新 ${v}`, color: 0xffc83d },
  en: { title: (v) => `🆕 Clatter update ${v}`, color: 0x4f8cff },
};

function webhook() {
  if (process.env.CLATTER_DISCORD_WEBHOOK) return process.env.CLATTER_DISCORD_WEBHOOK.trim();
  try {
    return fs.readFileSync(HOOK_FILE, 'utf8').trim();
  } catch (e) {
    return '';
  }
}

// next.md → { ja, zh, en }（沒寫的語言就略過）
function readNotes() {
  let text = '';
  try {
    text = fs.readFileSync(NEXT, 'utf8');
  } catch (e) {
    return null;
  }
  const out = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^##\s*(ja|zh|en)\b/i);
    if (m) {
      cur = m[1].toLowerCase();
      out[cur] = [];
    } else if (cur) out[cur].push(line.trimEnd());
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').replace(/\n{3,}/g, '\n\n').trim(); // 段落之間的空行留著
  return Object.values(out).some(Boolean) ? out : null;
}

// 版本號＝日期（同一天第二次起加 .2、.3…），照 CHANGELOG.md 裡已經有的算
function nextVersion() {
  const d = new Date();
  const day = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  let log = '';
  try {
    log = fs.readFileSync(LOG, 'utf8');
  } catch (e) {
    /* 第一次 */
  }
  const n = (log.match(new RegExp(`^## v${day.replace(/\./g, '\\.')}(\\.\\d+)?\\b`, 'gm')) || []).length;
  return 'v' + day + (n ? '.' + (n + 1) : '');
}

function payload(notes, ver) {
  const embeds = ['zh', 'ja', 'en']
    .filter((k) => notes[k])
    .map((k) => ({ title: LANG[k].title(ver), url: SITE, color: LANG[k].color, description: notes[k].slice(0, 4000) }));
  return { username: 'Clatter', content: '', embeds, allowed_mentions: { parse: [] } };
}

async function send(url, body) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('Discord ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

// publish 推上去以後叫：有 next.md 就貼（三種語言加起來超過 Discord 一則 6000 字的上限 → 一種語言一則）
async function postRelease({ dry = false } = {}) {
  const notes = readNotes();
  if (!notes) return 'Discord: no release notes (tools/release/next.md) — nothing to post';
  const ver = nextVersion();
  const body = payload(notes, ver);
  if (dry) return JSON.stringify(body, null, 2);
  const url = webhook();
  if (!url) return 'Discord: no webhook yet (tools/.discord-webhook) — notes kept in tools/release/next.md for the next publish';
  const total = body.embeds.reduce((n, e) => n + e.title.length + e.description.length, 0);
  if (total <= 5800) await send(url, body);
  else for (const e of body.embeds) await send(url, { ...body, embeds: [e] });
  const entry = `## ${ver}\n\n` + ['zh', 'ja', 'en'].filter((k) => notes[k]).map((k) => `### ${k}\n\n${notes[k]}\n`).join('\n');
  let log = '';
  try {
    log = fs.readFileSync(LOG, 'utf8');
  } catch (e) {
    log = '# 更新紀錄（Discord「更新」頻道貼過的公告）\n\n';
  }
  const head = log.indexOf('\n## ');
  fs.writeFileSync(LOG, head < 0 ? log.trimEnd() + '\n\n' + entry : log.slice(0, head + 1) + entry + '\n' + log.slice(head + 1));
  fs.unlinkSync(NEXT);
  return 'Discord: posted ' + ver + ' to the update channel';
}

module.exports = { postRelease };

if (require.main === module) {
  const dry = process.argv.includes('--dry');
  if (!dry && !process.argv.includes('--post')) {
    console.log('node tools/discord.js --dry | --post');
    process.exit(0);
  }
  postRelease({ dry })
    .then((s) => console.log(s))
    .catch((e) => {
      console.error('discord failed:', e.message);
      process.exit(1);
    });
}
