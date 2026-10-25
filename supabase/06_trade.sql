-- 第 6 步：好友交換（在 04_wallet.sql 之後跑一次）
-- 使用者 2026-10-25：「追加卡片跟轉蛋好友交換功能」
-- 好友碼＝錢包 id（10 字，給人看沒關係；送出、接受都要帶錢包鑰匙）
-- 收集簿本身還是存在各自的裝置：送出時先從自己的收集簿拿掉（被拒絕、取消就放回來），
--   伺服器只記「誰送誰什麼、對方回送什麼、現在到哪一步」，每一步都只能從 open 往下走一次（不會重複拿到）
create table if not exists public.profiles (
  id text primary key references public.wallets (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;

create table if not exists public.trades (
  id bigint generated always as identity primary key,
  from_id text not null references public.wallets (id) on delete cascade,
  to_id text not null references public.wallets (id) on delete cascade,
  mode text not null default 'swap' check (mode in ('swap', 'gift')),
  give jsonb not null check (octet_length(give::text) <= 200000),
  back jsonb check (back is null or octet_length(back::text) <= 200000),
  note text check (note is null or char_length(note) <= 80),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'cancelled', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trades_to on public.trades (to_id, status);
create index if not exists trades_from on public.trades (from_id, status);
alter table public.trades enable row level security;
revoke all on public.trades from anon, authenticated;

-- 錢包鑰匙要對（錢包要已經開過）
create or replace function public.trade_auth(p_id text, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if wallet_key_ok(p_id, p_key) is not true then
    raise exception 'wrong key' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.trade_auth(text, text) from public, anon, authenticated;

-- 我的暱稱：p_name 有給就改 → 回傳 { name }
create or replace function public.trade_me(p_id text, p_key text, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text;
begin
  perform trade_auth(p_id, p_key);
  if p_name is not null then
    nm := btrim(p_name);
    if char_length(nm) not between 1 and 24 then
      raise exception 'bad request' using errcode = '22023';
    end if;
    insert into profiles (id, name) values (p_id, nm)
      on conflict (id) do update set name = excluded.name, updated_at = now();
  end if;
  return jsonb_build_object('name', (select name from profiles where id = p_id));
end;
$$;
revoke all on function public.trade_me(text, text, text) from public;
grant execute on function public.trade_me(text, text, text) to anon, authenticated;

-- 好友碼 → 暱稱（只回傳存在的錢包；沒取暱稱的是空字串），一次最多 50 個
create or replace function public.trade_lookup(p_ids text[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(w.id, coalesce(p.name, '')), '{}'::jsonb)
  from wallets w left join profiles p on p.id = w.id
  where w.id = any (p_ids[1:50]);
$$;
revoke all on function public.trade_lookup(text[]) from public;
grant execute on function public.trade_lookup(text[]) to anon, authenticated;

-- 送出：mode＝swap（對方要選一個回送）或 gift（直接送）→ 回傳交換的 id
create or replace function public.trade_offer(p_id text, p_key text, p_to text, p_mode text, p_give jsonb, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  tid bigint;
begin
  perform trade_auth(p_id, p_key);
  if p_to !~ '^[0-9A-Za-z]{10}$' or p_to = p_id or p_mode not in ('swap', 'gift')
     or jsonb_typeof(p_give) <> 'object' or (p_note is not null and char_length(p_note) > 80) then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if not exists (select 1 from wallets where id = p_to) then
    raise exception 'no friend' using errcode = 'P0002';
  end if;
  if (select count(*) from trades where from_id = p_id and status = 'open') >= 30 then
    raise exception 'too many' using errcode = '54000';
  end if;
  insert into trades (from_id, to_id, mode, give, note) values (p_id, p_to, p_mode, p_give, nullif(btrim(p_note), ''))
    returning id into tid;
  return tid;
end;
$$;
revoke all on function public.trade_offer(text, text, text, text, jsonb, text) from public;
grant execute on function public.trade_offer(text, text, text, text, jsonb, text) to anon, authenticated;

-- 我的交換：in＝別人送來、還沒回覆的；out＝我送出的（open 等回覆、accepted 對方收了（帶回送的東西）、declined 被拒絕）
create or replace function public.trade_list(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  return jsonb_build_object(
    'in', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'from', t.from_id, 'name', coalesce(p.name, ''), 'mode', t.mode,
                                          'give', t.give, 'note', t.note, 't', t.created_at) order by t.id desc)
      from (select * from trades where to_id = p_id and status = 'open' order by id desc limit 50) t
      left join profiles p on p.id = t.from_id
    ), '[]'::jsonb),
    'out', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'to', t.to_id, 'name', coalesce(p.name, ''), 'mode', t.mode, 'status', t.status,
                                          'item', t.give -> 'n', 'm', t.give -> 'm' -> 'key',
                                          'back', case when t.status = 'accepted' then t.back end,
                                          't', t.created_at) order by t.id desc)
      from (select * from trades where from_id = p_id and status in ('open', 'accepted', 'declined') order by id desc limit 50) t
      left join profiles p on p.id = t.to_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.trade_list(text, text) from public;
grant execute on function public.trade_list(text, text) to anon, authenticated;

-- 接受：swap 要帶回送的東西（p_back），gift 不用 → 回傳對方送的東西
create or replace function public.trade_accept(p_id text, p_key text, p_trade bigint, p_back jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g jsonb;
begin
  perform trade_auth(p_id, p_key);
  if p_back is not null and (jsonb_typeof(p_back) <> 'object' or octet_length(p_back::text) > 200000) then
    raise exception 'bad request' using errcode = '22023';
  end if;
  update trades set status = 'accepted', back = case when mode = 'swap' then p_back end, updated_at = now()
    where id = p_trade and to_id = p_id and status = 'open' and (mode = 'gift' or p_back is not null)
    returning give into g;
  if not found then
    raise exception 'gone' using errcode = 'P0002';
  end if;
  return g;
end;
$$;
revoke all on function public.trade_accept(text, text, bigint, jsonb) from public;
grant execute on function public.trade_accept(text, text, bigint, jsonb) to anon, authenticated;

-- 拒絕（收到的人）
create or replace function public.trade_decline(p_id text, p_key text, p_trade bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  update trades set status = 'declined', updated_at = now() where id = p_trade and to_id = p_id and status = 'open';
  if not found then
    raise exception 'gone' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.trade_decline(text, text, bigint) from public;
grant execute on function public.trade_decline(text, text, bigint) to anon, authenticated;

-- 取消（送出的人，對方還沒回覆）→ 縮圖那些不用再存
create or replace function public.trade_cancel(p_id text, p_key text, p_trade bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  update trades set status = 'cancelled', give = jsonb_build_object('n', give -> 'n'), updated_at = now()
    where id = p_trade and from_id = p_id and status = 'open';
  if not found then
    raise exception 'gone' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.trade_cancel(text, text, bigint) from public;
grant execute on function public.trade_cancel(text, text, bigint) to anon, authenticated;

-- 送出的人收好了（回送的東西放進收集簿，或被拒絕的放回來）→ 結案，縮圖清掉
create or replace function public.trade_done(p_id text, p_key text, p_trade bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  update trades set status = 'done', give = jsonb_build_object('n', give -> 'n'), back = case when back is null then null else jsonb_build_object('n', back -> 'n') end, updated_at = now()
    where id = p_trade and from_id = p_id and status in ('accepted', 'declined');
end;
$$;
revoke all on function public.trade_done(text, text, bigint) from public;
grant execute on function public.trade_done(text, text, bigint) to anon, authenticated;
