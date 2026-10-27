-- 第 8 步：收藏者會員卡（Apple Wallet）— 在 07_browse.sql 之後跑一次
-- 使用者 2026-10-28：每人一張「收藏者會員卡」，選一張收集到的卡面當主題 → 伺服器簽 .pkpass → 加進 Apple Wallet；
--   換主題、積分變了 → 推播 → iPhone 自己來拿新版（同一張卡更新）
-- 卡號＝錢包 id（也是好友碼），QR＝加好友的邀請連結
-- 簽名、推播在 Edge Function `wallet`（supabase/functions/wallet/index.ts）；這些表只給它（service role）用，網頁讀不到

create table if not exists public.member_cards (
  wallet text primary key references public.wallets (id) on delete cascade,
  auth_token text not null,               -- 放進 pass.json 的 authenticationToken（iPhone 每次來拿新版都帶著）
  data jsonb not null default '{}'::jsonb, -- 名字、積分、等級、收集數、主題卡名稱、顏色、語言（網頁算好送上來）
  img text,                               -- 卡面圖那一組的雜湊：storage passes/<wallet>/<img>/<檔名>
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.member_cards enable row level security;
revoke all on public.member_cards from anon, authenticated;

-- 有裝這張卡的 iPhone（Wallet 的 deviceLibraryIdentifier ＋ 推播用的 token）
create table if not exists public.pass_devices (
  id text primary key,
  push_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.pass_devices enable row level security;
revoke all on public.pass_devices from anon, authenticated;

create table if not exists public.pass_regs (
  device text not null references public.pass_devices (id) on delete cascade,
  serial text not null references public.member_cards (wallet) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device, serial)
);
create index if not exists pass_regs_serial on public.pass_regs (serial);
alter table public.pass_regs enable row level security;
revoke all on public.pass_regs from anon, authenticated;

-- 下載用的一次性票（10 分鐘）：網頁帶錢包鑰匙換票 → Safari 打開 /get/<票> 跳出「加入 Apple Wallet」
create table if not exists public.pass_tickets (
  id text primary key,
  wallet text not null references public.member_cards (wallet) on delete cascade,
  expires_at timestamptz not null
);
alter table public.pass_tickets enable row level security;
revoke all on public.pass_tickets from anon, authenticated;

-- iPhone 回報的錯誤、推播結果（除錯用，留最近的就好）
create table if not exists public.pass_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  msg text not null
);
alter table public.pass_log enable row level security;
revoke all on public.pass_log from anon, authenticated;

grant all on public.member_cards, public.pass_devices, public.pass_regs, public.pass_tickets, public.pass_log to service_role;
grant execute on function public.wallet_key_ok(text, text) to service_role;

-- 卡面圖（不公開）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('passes', 'passes', false, 2097152, array['image/png'])
on conflict (id) do nothing;
