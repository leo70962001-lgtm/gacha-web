-- 季節活動（使用者 2026-11-21：「再加入 時期的活動」「比如說過年等等」）
--   一年 10 個活動（日期用玩家自己的時區）：活動期間做任務拿硬幣，五個都做完再加碼
--   每個活動的任務都一樣：轉 3 次、讚 3 次、留言或スタンプ 1 次、發到廣場 1 次、更新／公開自己的機台 1 次；全部做完 +50
--   領過的記在 event_claims（每個活動、每一年、每個任務一次）
create table if not exists public.event_claims (
  wallet text not null references public.wallets (id) on delete cascade,
  ev text not null,
  yr int not null,
  mission text not null check (mission in ('pull', 'like', 'talk', 'post', 'make', 'all')),
  coins int not null,
  created_at timestamptz not null default now(),
  primary key (wallet, ev, yr, mission)
);
alter table public.event_claims enable row level security;
revoke all on public.event_claims from anon, authenticated;

-- 活動表：id、開始月日、結束月日（含）；不跨年
create or replace function public.soc_event_list()
returns jsonb
language sql
immutable
as $$
  select '[
    {"id": "newyear",   "m": 1,  "d": 1,  "m2": 1,  "d2": 7},
    {"id": "setsubun",  "m": 2,  "d": 1,  "m2": 2,  "d2": 3},
    {"id": "valentine", "m": 2,  "d": 7,  "m2": 2,  "d2": 14},
    {"id": "hanami",    "m": 3,  "d": 25, "m2": 4,  "d2": 10},
    {"id": "tanabata",  "m": 7,  "d": 1,  "m2": 7,  "d2": 7},
    {"id": "natsu",     "m": 7,  "d": 20, "m2": 8,  "d2": 31},
    {"id": "halloween", "m": 10, "d": 20, "m2": 10, "d2": 31},
    {"id": "momiji",    "m": 11, "d": 16, "m2": 12, "d2": 5},
    {"id": "xmas",      "m": 12, "d": 18, "m2": 12, "d2": 25},
    {"id": "toshi",     "m": 12, "d": 26, "m2": 12, "d2": 31}
  ]'::jsonb;
$$;

-- 現在進行中的活動＋任務進度 → [{ id, from, to, yr, list: [{ k, need, have, done, claimed, c }] }]
create or replace function public.soc_events(p_id text, p_off int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  off int := least(greatest(coalesce(p_off, 0), -840), 840);
  dy date := ((now() at time zone 'UTC') + make_interval(mins => off))::date;
  y int := extract(year from dy)::int;
  e jsonb;
  s date;
  t date;
  t0 timestamptz;
  t1 timestamptz;
  outp jsonb := '[]'::jsonb;
  list jsonb;
  k text;
  need int;
  have int;
  c int;
  cl int;
  ndone int;
begin
  for e in select * from jsonb_array_elements(soc_event_list()) loop
    s := make_date(y, (e ->> 'm')::int, (e ->> 'd')::int);
    t := make_date(y, (e ->> 'm2')::int, (e ->> 'd2')::int);
    continue when dy < s or dy > t;
    t0 := (s::timestamp - make_interval(mins => off)) at time zone 'UTC';
    t1 := ((t + 1)::timestamp - make_interval(mins => off)) at time zone 'UTC';
    list := '[]'::jsonb;
    ndone := 0;
    foreach k in array array['pull', 'like', 'talk', 'post', 'make'] loop
      need := case k when 'pull' then 3 when 'like' then 3 else 1 end;
      have := case k
        when 'pull' then coalesce((select sum(n) from ledger where wallet = p_id and kind = 'buy' and created_at >= t0 and created_at < t1), 0)
        when 'like' then (select count(*) from machine_likes where wallet = p_id and created_at >= t0 and created_at < t1) + (select count(*) from post_likes where wallet = p_id and created_at >= t0 and created_at < t1)
        when 'talk' then (select count(*) from comments where wallet = p_id and created_at >= t0 and created_at < t1)
        when 'post' then (select count(*) from posts where wallet = p_id and created_at >= t0 and created_at < t1)
        when 'make' then (select count(*) from machines where owner = p_id and updated_at >= t0 and updated_at < t1)
      end;
      c := case k when 'pull' then 30 when 'like' then 15 when 'talk' then 15 when 'post' then 20 else 30 end;
      select ec.coins into cl from event_claims ec where ec.wallet = p_id and ec.ev = e ->> 'id' and ec.yr = y and ec.mission = k;
      if have >= need then
        ndone := ndone + 1;
      end if;
      list := list || jsonb_build_object('k', k, 'need', need, 'have', least(have, need), 'done', have >= need, 'claimed', cl is not null, 'c', coalesce(cl, c));
      cl := null;
    end loop;
    select ec.coins into cl from event_claims ec where ec.wallet = p_id and ec.ev = e ->> 'id' and ec.yr = y and ec.mission = 'all';
    list := list || jsonb_build_object('k', 'all', 'need', 5, 'have', ndone, 'done', ndone >= 5, 'claimed', cl is not null, 'c', coalesce(cl, 50));
    cl := null;
    outp := outp || jsonb_build_object('id', e ->> 'id', 'from', s, 'to', t, 'yr', y, 'list', list);
  end loop;
  return outp;
end;
$$;
revoke all on function public.soc_events(text, int) from public, anon, authenticated;

create or replace function public.events(p_id text, p_key text, p_off int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  return soc_events(p_id, p_off);
end;
$$;
revoke all on function public.events(text, text, int) from public;
grant execute on function public.events(text, text, int) to anon, authenticated;

-- 領獎：活動進行中、做完了才給，每個任務一次 → { got, balance, state }
create or replace function public.event_claim(p_id text, p_key text, p_off int, p_ev text, p_k text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stt jsonb;
  ev jsonb;
  it jsonb;
  ins int;
  got int := 0;
begin
  perform trade_auth(p_id, p_key);
  stt := soc_events(p_id, p_off);
  select e into ev from jsonb_array_elements(stt) e where e ->> 'id' = p_ev;
  if ev is null then
    raise exception 'gone' using errcode = 'P0002';
  end if;
  select x into it from jsonb_array_elements(ev -> 'list') x where x ->> 'k' = p_k;
  if it is null then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if not (it ->> 'done')::boolean then
    raise exception 'not done' using errcode = 'P0001';
  end if;
  if not (it ->> 'claimed')::boolean then
    insert into event_claims (wallet, ev, yr, mission, coins) values (p_id, p_ev, (ev ->> 'yr')::int, p_k, (it ->> 'c')::int) on conflict do nothing;
    get diagnostics ins = row_count;
    if ins > 0 then
      got := (it ->> 'c')::int;
      update wallets set balance = balance + got where id = p_id;
      insert into ledger (wallet, delta, kind, n) values (p_id, got, 'bonus', 1);
    end if;
  end if;
  return jsonb_build_object('got', got, 'balance', (select balance from wallets where id = p_id), 'state', soc_events(p_id, p_off));
end;
$$;
revoke all on function public.event_claim(text, text, int, text, text) from public;
grant execute on function public.event_claim(text, text, int, text, text) to anon, authenticated;
