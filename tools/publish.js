// node tools/publish.js ["commit message"] — 建 docs/（tools/build_site.py）、commit、第一次就建 GitHub repo
// （token 從 Git Credential Manager 的 `git credential fill` 拿，不會印出來）、push main、
// 確認 GitHub Pages 用 main 分支的 /docs。跟 kaii-tantei/tools/publish.js 同一套做法。
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const REPO = 'gacha-web';
const sh = (cmd, opts = {}) => execSync(cmd, Object.assign({ cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }, opts)).trim();
const msg = process.argv[2] || 'Update Clatter 轉蛋鋪';

function credential() {
  const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const kv = Object.fromEntries(out.trim().split('\n').map((l) => l.split('=')));
  if (!kv.password) throw new Error('no GitHub credential stored in the credential manager');
  return kv;
}
async function api(token, method, url, body) {
  const r = await fetch('https://api.github.com' + url, { method, headers: { Authorization: 'Bearer ' + token, 'User-Agent': REPO, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch (e) { /* empty */ }
  return { status: r.status, j };
}

(async () => {
  console.log(sh('py -I tools/build_site.py'));
  try { sh('git rev-parse --is-inside-work-tree'); } catch (e) { sh('git init -b main'); }
  const { username, password } = credential();
  const me = await api(password, 'GET', '/user');
  const login = me.j.login || username;
  let name = '', email = '';
  try { name = sh('git config user.name'); email = sh('git config user.email'); } catch (e) { /* unset */ }
  if (!name || !email) {
    try { name = sh('git -C D:/ai/kaii-tantei config user.name'); email = sh('git -C D:/ai/kaii-tantei config user.email'); } catch (e) { /* unset */ }
    if (!name) name = login;
    if (!email) email = (me.j.id ? me.j.id + '+' : '') + login + '@users.noreply.github.com';
    sh('git config user.name "' + name + '"');
    sh('git config user.email "' + email + '"');
  }
  sh('git add -A');
  let changed = true;
  try { sh('git diff --cached --quiet'); changed = false; } catch (e) { changed = true; }
  if (changed) sh('git commit -q -F -', { input: msg + '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' });
  console.log(changed ? 'committed: ' + sh('git log -1 --format=%h%x20%s') : 'nothing new to commit');
  const exists = await api(password, 'GET', '/repos/' + login + '/' + REPO);
  if (exists.status === 404) {
    const made = await api(password, 'POST', '/user/repos', { name: REPO, description: 'Clatter 轉蛋鋪 — 網頁轉蛋機：放進獎品、設定價錢、產生連結，投幣轉把手開扭蛋（three.js toon）', homepage: 'https://' + login + '.github.io/' + REPO + '/', private: false, has_wiki: false, has_projects: false });
    console.log('repo created:', made.status, made.j && made.j.html_url);
  } else console.log('repo exists:', exists.j.html_url);
  const remote = 'https://github.com/' + login + '/' + REPO + '.git';
  try { sh('git remote get-url origin'); sh('git remote set-url origin ' + remote); } catch (e) { sh('git remote add origin ' + remote); }
  console.log(sh('git push -u origin main 2>&1'));
  const pg = await api(password, 'GET', '/repos/' + login + '/' + REPO + '/pages');
  if (pg.status === 404) {
    const on = await api(password, 'POST', '/repos/' + login + '/' + REPO + '/pages', { source: { branch: 'main', path: '/docs' } });
    console.log('pages enabled:', on.status, on.j && (on.j.html_url || on.j.message));
  } else console.log('pages:', pg.status, pg.j && pg.j.html_url, pg.j && pg.j.status);
  console.log('open: https://' + login + '.github.io/' + REPO + '/');
})().catch((e) => { console.error('publish failed:', e.message); process.exit(1); });
