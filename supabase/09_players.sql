-- 第 9 步：機台的數據後台（在 08_member.sql 之後跑一次）
-- 使用者 2026-10-28：「增加在自己的機台裡可以知道有誰轉過自己的轉蛋跟國家分布」「可以參考 YouTube 的後台可以看到的加進去」
--   誰轉過：本來就記在 ledger（kind = 'buy'、machine_id、wallet、n、時間）
--   每次轉多記：國家（兩碼國碼，網頁從玩家裝置的「時區」推出來，伺服器不看 IP）、裝置（phone／tablet／desktop）、
--   從哪裡來（browse 逛機台／link 連結／album 收集簿／shop 我的商店／other）；以前的紀錄這三個是空的
--   只有開店的人（帶機台的修改鑰匙）看得到；玩家只給名字（好友那邊設的）或錢包 id 的前 4 碼

alter table public.ledger add column if not exists country text;
alter table public.ledger add column if not exists device text;
alter table public.ledger add column if not exists src text;
alter table public.ledger drop constraint if exists ledger_country_ok;
alter table public.ledger add constraint ledger_country_ok check (country is null or country ~ '^[A-Z]{2}$');
alter table public.ledger drop constraint if exists ledger_device_ok;
alter table public.ledger add constraint ledger_device_ok check (device is null or device in ('phone', 'tablet', 'desktop'));
alter table public.ledger drop constraint if exists ledger_src_ok;
alter table public.ledger add constraint ledger_src_ok check (src is null or src in ('browse', 'link', 'album', 'shop', 'other'));
create index if not exists ledger_machine_buy on public.ledger (machine_id, id desc) where kind = 'buy';

-- pull 多 p_country、p_device、p_src（預設 null，舊版網頁照樣能叫）
-- 舊的 4 個參數版本要先拿掉，不然 PostgREST 分不出要叫哪一個
drop function if exists public.pull(text, int, text, text);
create or replace function public.pull(p_id text, p_n int, p_wallet text, p_wallet_key text, p_country text default null, p_device text default null, p_src text default null)
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
  cc text := case when p_country ~ '^[A-Z]{2}$' then p_country end;
  dv text := case when p_device in ('phone', 'tablet', 'desktop') then p_device end;
  sr text := case when p_src in ('browse', 'link', 'album', 'shop', 'other') then p_src end;
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
  insert into ledger (wallet, delta, kind, machine_id, n, country, device, src) values (p_wallet, -cost, 'buy', p_id, n, cc, dv, sr);
  if own is not null then
    update wallets set balance = balance + cost where id = own;
    insert into ledger (wallet, delta, kind, machine_id, n) values (own, cost, 'sell', p_id, n);
  end if;
  select balance into bal from wallets where id = p_wallet;
  return jsonb_build_object('picks', to_jsonb(picks), 'remaining', rem, 'balance', bal, 'cost', cost);
end;
$$;
revoke all on function public.pull(text, int, text, text, text, text, text) from public;
grant execute on function public.pull(text, int, text, text, text, text, text) to anon, authenticated;

-- 開店的人看（帶機台鑰匙）：
--   players＝每個玩家（名字或錢包前 4 碼、是不是自己、轉幾次、花幾枚、第一次／最後一次、最近的國家、裝置）最多 300 人
--   countries／devices／sources＝全部的轉蛋次數分布；events＝最近 2000 筆（時間、幾顆、前 4 碼、國家、裝置、來源）給網頁畫每日、時段、新舊玩家
create or replace function public.machine_stats(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  own text;
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if machine_key_ok(p_id, p_key) is not true then
    raise exception 'wrong key' using errcode = '42501';
  end if;
  select owner into own from machines where id = p_id;
  return jsonb_build_object(
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('w', left(x.wallet, 4), 'me', x.wallet = own, 'name', x.name, 'n', x.n, 'coins', x.coins,
                                          'first', x.first, 'last', x.last, 'c', x.c, 'd', x.d) order by x.last desc)
      from (
        select l.wallet, max(p.name) as name, sum(l.n)::int as n, sum(-l.delta)::int as coins, min(l.created_at) as first, max(l.created_at) as last,
               (array_agg(l.country order by l.id desc) filter (where l.country is not null))[1] as c,
               (array_agg(l.device order by l.id desc) filter (where l.device is not null))[1] as d
        from ledger l left join profiles p on p.id = l.wallet
        where l.machine_id = p_id and l.kind = 'buy'
        group by l.wallet
        order by max(l.created_at) desc
        limit 300
      ) x
    ), '[]'::jsonb),
    'countries', coalesce((select jsonb_object_agg(k, v) from (select coalesce(country, '??') as k, sum(n)::int as v from ledger where machine_id = p_id and kind = 'buy' group by 1) y), '{}'::jsonb),
    'devices', coalesce((select jsonb_object_agg(k, v) from (select coalesce(device, '??') as k, sum(n)::int as v from ledger where machine_id = p_id and kind = 'buy' group by 1) y), '{}'::jsonb),
    'sources', coalesce((select jsonb_object_agg(k, v) from (select coalesce(src, '??') as k, sum(n)::int as v from ledger where machine_id = p_id and kind = 'buy' group by 1) y), '{}'::jsonb),
    'pulls', coalesce((select sum(n)::int from ledger where machine_id = p_id and kind = 'buy'), 0),
    'coins', coalesce((select sum(-delta)::int from ledger where machine_id = p_id and kind = 'buy'), 0),
    'players_n', (select count(distinct wallet)::int from ledger where machine_id = p_id and kind = 'buy'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('t', e.created_at, 'n', e.n, 'w', left(e.wallet, 4), 'c', e.country, 'd', e.device, 's', e.src) order by e.id)
      from (select * from ledger where machine_id = p_id and kind = 'buy' order by id desc limit 2000) e
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.machine_stats(text, text) from public;
grant execute on function public.machine_stats(text, text) to anon, authenticated;
