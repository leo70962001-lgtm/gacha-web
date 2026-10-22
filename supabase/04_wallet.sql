-- 第 4 步：錢包（在 03_stock.sql 之後跑一次）
-- 每個使用者（瀏覽器）一個錢包：一開始 1000 枚；轉別人的機台 → 扣錢，別人轉你的機台 → 加錢
-- 錢包的鑰匙跟機台一樣只存雜湊；錢包、明細網頁都讀不到，只能帶鑰匙呼叫 wallet_open()
create table if not exists public.wallets (
  id text primary key check (id ~ '^[0-9A-Za-z]{10}$'),
  key_hash text not null,
  balance int not null default 1000 check (balance >= 0),
  created_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
revoke all on public.wallets from anon, authenticated;

create table if not exists public.ledger (
  id bigint generated always as identity primary key,
  wallet text not null references public.wallets (id) on delete cascade,
  delta int not null,
  kind text not null check (kind in ('start', 'buy', 'sell')),
  machine_id text,
  n int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ledger_wallet on public.ledger (wallet, id desc);
alter table public.ledger enable row level security;
revoke all on public.ledger from anon, authenticated;

-- 機台：每轉一次幾枚（伺服器照這個扣錢）、誰的錢包收錢（不給網頁讀）
alter table public.machines add column if not exists price int not null default 1 check (price between 1 and 20);
alter table public.machines add column if not exists owner text references public.wallets (id) on delete set null;
revoke select on public.machines from anon, authenticated;
grant select (id, data, stock, price, created_at, updated_at) on public.machines to anon, authenticated;

create or replace function public.wallet_key_ok(p_id text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  select key_hash into stored from wallets where id = p_id;
  if not found then
    return null;
  end if;
  return stored = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
end;
$$;
revoke all on function public.wallet_key_ok(text, text) from public, anon, authenticated;

-- 打開錢包：沒有就開一個（1000 枚）→ 回傳餘額＋最近 30 筆明細
create or replace function public.wallet_open(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  bal int;
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  ok := wallet_key_ok(p_id, p_key);
  if ok is null then
    insert into wallets (id, key_hash, balance) values (p_id, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), 1000);
    insert into ledger (wallet, delta, kind) values (p_id, 1000, 'start');
  elsif not ok then
    raise exception 'wrong key' using errcode = '42501';
  end if;
  select balance into bal from wallets where id = p_id;
  return jsonb_build_object(
    'balance', bal,
    'ledger', coalesce((
      select jsonb_agg(jsonb_build_object('d', delta, 'k', kind, 'm', machine_id, 'n', n, 't', created_at) order by id desc)
      from (select * from ledger where wallet = p_id order by id desc limit 30) l
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.wallet_open(text, text) from public;
grant execute on function public.wallet_open(text, text) to anon, authenticated;

-- 存機台：多了價錢、收錢的錢包（錢包鑰匙對才記；改設定時沒帶就維持原本的）
drop function if exists public.save_machine(text, text, text, jsonb);
create or replace function public.save_machine(
  p_id text, p_key text, p_data text, p_stock jsonb, p_price int, p_wallet text default null, p_wallet_key text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  k text;
  own text;
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' or jsonb_typeof(p_stock) <> 'object'
     or p_price is null or p_price not between 1 and 20 then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_stock)) > 16 then
    raise exception 'bad request' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_stock) loop
    if length(k) not between 1 and 40 or jsonb_typeof(p_stock -> k) <> 'number'
       or (p_stock ->> k)::numeric not between 1 and 999 then
      raise exception 'bad request' using errcode = '22023';
    end if;
  end loop;
  if p_wallet is not null and wallet_key_ok(p_wallet, p_wallet_key) is true then
    own := p_wallet;
  end if;
  ok := machine_key_ok(p_id, p_key);
  if ok is null then
    if exists (select 1 from machines where id = p_id) then
      raise exception 'locked' using errcode = '42501';
    end if;
    insert into machines (id, data, stock, price, owner) values (p_id, p_data, p_stock, p_price, own);
    insert into machine_keys (id, key_hash) values (p_id, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'));
  elsif ok then
    update machines
      set data = p_data, stock = p_stock, price = p_price, owner = coalesce(own, owner), updated_at = now()
      where id = p_id;
  else
    raise exception 'wrong key' using errcode = '42501';
  end if;
  return p_id;
end;
$$;
revoke all on function public.save_machine(text, text, text, jsonb, int, text, text) from public;
grant execute on function public.save_machine(text, text, text, jsonb, int, text, text) to anon, authenticated;

-- 抽：買家錢包扣「價錢 × 抽到幾顆」、機台主人的錢包加同樣的數字，跟抽獎在同一筆交易裡
-- 先鎖機台，再照 id 順序鎖兩個錢包（互相買對方的機台也不會卡死）
drop function if exists public.pull(text, int);
create or replace function public.pull(p_id text, p_n int, p_wallet text, p_wallet_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  st jsonb;
  pr int;
  own text;
  rem jsonb := '{}'::jsonb;
  keys text[];
  k text;
  total int := 0;
  cnt int;
  r int;
  acc int;
  n int;
  cost int;
  bal int;
  picks text[] := '{}';
begin
  if p_n is null or p_n < 1 or p_n > 10 then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if wallet_key_ok(p_wallet, p_wallet_key) is not true then
    raise exception 'wrong key' using errcode = '42501';
  end if;
  select stock, price, owner into st, pr, own from machines where id = p_id for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(x order by x), '{}') into keys from jsonb_object_keys(st) as x;
  foreach k in array keys loop
    cnt := greatest(0, (st ->> k)::int - coalesce((select p.n from pulls p where p.machine_id = p_id and p.item = k), 0));
    rem := rem || jsonb_build_object(k, cnt);
    total := total + cnt;
  end loop;
  n := least(p_n, total);
  perform 1 from wallets where id in (p_wallet, own) order by id for update;
  select balance into bal from wallets where id = p_wallet;
  if n = 0 then
    return jsonb_build_object('picks', '[]'::jsonb, 'remaining', rem, 'balance', bal);
  end if;
  cost := pr * n;
  if bal < cost then
    raise exception 'insufficient' using errcode = 'P0001', detail = bal::text;
  end if;
  for i in 1 .. n loop
    r := floor(random() * total)::int;
    acc := 0;
    foreach k in array keys loop
      acc := acc + (rem ->> k)::int;
      if r < acc then
        picks := picks || k;
        rem := jsonb_set(rem, array[k], to_jsonb((rem ->> k)::int - 1));
        total := total - 1;
        insert into pulls (machine_id, item, n) values (p_id, k, 1)
          on conflict (machine_id, item) do update set n = pulls.n + 1;
        exit;
      end if;
    end loop;
  end loop;
  update wallets set balance = balance - cost where id = p_wallet;
  insert into ledger (wallet, delta, kind, machine_id, n) values (p_wallet, -cost, 'buy', p_id, n);
  if own is not null then
    update wallets set balance = balance + cost where id = own;
    insert into ledger (wallet, delta, kind, machine_id, n) values (own, cost, 'sell', p_id, n);
  end if;
  select balance into bal from wallets where id = p_wallet;
  return jsonb_build_object('picks', to_jsonb(picks), 'remaining', rem, 'balance', bal, 'cost', cost);
end;
$$;
revoke all on function public.pull(text, int, text, text) from public;
grant execute on function public.pull(text, int, text, text) to anon, authenticated;
