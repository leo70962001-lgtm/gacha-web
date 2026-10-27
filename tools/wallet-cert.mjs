// Apple Wallet 會員卡的簽名憑證（supabase/functions/wallet 用）
//   node tools/wallet-cert.mjs csr      → 做私鑰＋憑證申請檔 pass.csr（放在 repo 外面的 D:\ai\wallet-cert，不會被推上 GitHub）
//   （到 Apple 開發者網站：Identifiers → ＋ Pass Type IDs；Certificates → ＋ Pass Type ID Certificate → 上傳 pass.csr → 下載 pass.cer 放進同一個資料夾）
//   node tools/wallet-cert.mjs secrets  → 檢查 pass.cer 跟私鑰配不配、讀出 Pass Type ID 跟 Team ID → 寫 secrets.env
//   （secrets.env 的內容貼到 Supabase → Edge Functions → Secrets；貼好以後會員卡頁的「加入 Apple Wallet」就會動）
import { execFileSync } from 'node:child_process';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.WALLET_CERT_DIR || 'D:/ai/wallet-cert';
const KEY = path.join(DIR, 'pass.key');
const CSR = path.join(DIR, 'pass.csr');

function openssl(args) {
  for (const bin of ['openssl', 'C:/Program Files/Git/mingw64/bin/openssl.exe', 'C:/Program Files/Git/usr/bin/openssl.exe']) {
    try {
      return execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  throw new Error('找不到 openssl（Git for Windows 裡面有一個）');
}

const cmd = process.argv[2];
if (cmd === 'csr') {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(KEY)) console.log('私鑰已經有了，沿用：' + KEY);
  else openssl(['genrsa', '-out', KEY, '2048']);
  openssl(['req', '-new', '-key', KEY, '-out', CSR, '-subj', '/CN=Clatter Wallet Pass/C=TW']);
  console.log('憑證申請檔：' + CSR);
  console.log('下一步：Apple 開發者網站 → Certificates → ＋ → Pass Type ID Certificate → 上傳這個檔 → 下載 pass.cer 放進 ' + DIR);
} else if (cmd === 'secrets') {
  const cerName = fs.readdirSync(DIR).find((f) => /\.cer$/i.test(f));
  if (!cerName) throw new Error(`${DIR} 裡面沒有 .cer（Apple 下載的 pass.cer）`);
  const cert = new X509Certificate(fs.readFileSync(path.join(DIR, cerName)));
  const keyPem = fs.readFileSync(KEY, 'utf8');
  if (!cert.checkPrivateKey(createPrivateKey(keyPem))) throw new Error('pass.cer 跟 pass.key 不是一對（是不是用了別的 .csr？）');
  const field = (k) => (cert.subject.split('\n').find((l) => l.startsWith(k + '=')) || '').slice(k.length + 1);
  const passType = field('UID');
  const team = field('OU');
  if (!passType.startsWith('pass.')) throw new Error('這張不是 Pass Type ID 憑證：' + cert.subject);
  const b64 = (s) => Buffer.from(s).toString('base64');
  const out = [
    `PASS_TYPE_ID=${passType}`,
    `PASS_TEAM_ID=${team}`,
    `PASS_CERT=${b64(cert.toString())}`,
    `PASS_KEY=${b64(keyPem)}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(DIR, 'secrets.env'), out);
  console.log(`Pass Type ID：${passType}\nTeam ID：${team}\n到期：${cert.validTo}`);
  console.log('寫好了：' + path.join(DIR, 'secrets.env') + '（裡面有私鑰，不要傳給別人）');
} else {
  console.log('用法：node tools/wallet-cert.mjs csr | secrets');
}
