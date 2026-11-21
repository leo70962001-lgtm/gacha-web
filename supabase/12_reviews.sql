-- 玩家評價（使用者 2026-11-21：「可以增加討論區或留言區讓做的人可以知道玩的人的感受或評價」）
--   每台機台、每個玩家一則：1–5 顆星＋一句感想（可以不寫）；轉過這台才能評（店主不能評自己的）
--   店主在「通知」看到新的評價；逛機台的卡片顯示平均星數
create table if not exists public.machine_reviews (
  machine_id text not null references public.machines (id) on delete cascade,
  wallet text not null references public.wallets (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  body text check (body is null or char_length(body) between 1 and 140),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (machine_id, wallet)
);
create index if not exists machine_reviews_m on public.machine_reviews (machine_id, updated_at desc);
alter table public.machine_reviews enable row level security;
revoke all on public.machine_reviews from anon, authenticated;

-- 一台機台的評價：{ avg, n, dist[1..5], can（這個人能不能評）, mine, list }
create or replace function public.reviews(p_m text, p_viewer text default null, p_vkey text default null, p_limit int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := soc_viewer(p_viewer, p_vkey);
  own text;
begin
  select owner into own from machines where id = p_m;
  return jsonb_build_object(
    'avg', (select round(avg(stars)::numeric, 2) from machine_reviews where machine_id = p_m and not hidden),
    'n', (select count(*) from machine_reviews where machine_id = p_m and not hidden),
    'dist', (select jsonb_agg(coalesce((select count(*) from machine_reviews r where r.machine_id = p_m and not r.hidden and r.stars = s), 0) order by s) from generate_series(1, 5) s),
    'can', v is not null and v is distinct from own and exists (select 1 from ledger where wallet = v and machine_id = p_m and kind = 'buy'),
    'mine', (select jsonb_build_object('s', stars, 'b', body) from machine_reviews where machine_id = p_m and wallet = v),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object('w', r.wallet, 'nm', coalesce(p.name, ''), 'av', p.avatar, 's', r.stars, 'b', r.body, 't', r.updated_at) order by r.updated_at desc)
      from (select * from machine_reviews where machine_id = p_m and not hidden order by updated_at desc limit least(greatest(coalesce(p_limit, 30), 1), 50)) r
      left join profiles p on p.id = r.wallet
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.reviews(text, text, text, int) from public;
grant execute on function public.reviews(text, text, text, int) to anon, authenticated;

-- 評（再評一次＝改掉自己那一則）
create or replace function public.review_set(p_id text, p_key text, p_m text, p_stars int, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := nullif(btrim(coalesce(p_body, '')), '');
  own text;
begin
  perform trade_auth(p_id, p_key);
  select owner into own from machines where id = p_m;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_stars is null or p_stars not between 1 and 5 or char_length(coalesce(b, '')) > 140 then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if own = p_id or not exists (select 1 from ledger where wallet = p_id and machine_id = p_m and kind = 'buy') then
    raise exception 'not played' using errcode = '42501';
  end if;
  if exists (select 1 from machine_reviews where wallet = p_id and updated_at > now() - interval '5 seconds') then
    raise exception 'too many' using errcode = '54000';
  end if;
  insert into machine_reviews (machine_id, wallet, stars, body) values (p_m, p_id, p_stars, b)
  on conflict (machine_id, wallet) do update set stars = excluded.stars, body = excluded.body, hidden = false, updated_at = now();
  return reviews(p_m, p_id, p_key);
end;
$$;
revoke all on function public.review_set(text, text, text, int, text) from public;
grant execute on function public.review_set(text, text, text, int, text) to anon, authenticated;

-- 刪掉自己的評價
create or replace function public.review_del(p_id text, p_key text, p_m text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  delete from machine_reviews where machine_id = p_m and wallet = p_id;
  return reviews(p_m, p_id, p_key);
end;
$$;
revoke all on function public.review_del(text, text, text) from public;
grant execute on function public.review_del(text, text, text) to anon, authenticated;

-- 逛機台：一次查好幾台的平均星數 → { 機台 id: [平均, 則數] }
create or replace function public.ratings(p_ids text[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(machine_id, jsonb_build_array(a, c)), '{}'::jsonb)
  from (
    select machine_id, round(avg(stars)::numeric, 1) as a, count(*) as c
    from machine_reviews
    where machine_id = any (p_ids[1:60]) and not hidden
    group by machine_id
  ) x;
$$;
revoke all on function public.ratings(text[]) from public;
grant execute on function public.ratings(text[]) to anon, authenticated;

-- 通知：多一種「rev」（有人評了你的機台；s＝星數、x＝感想）
create or replace function public.notices(p_id text, p_key text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  res jsonb;
begin
  perform trade_auth(p_id, p_key);
  with ev as (
    select 'like'::text as k, l.wallet as w, l.created_at as t, l.machine_id as m, m.meta ->> 'n' as x, null::int as s, 0 as n
      from machine_likes l join machines m on m.id = l.machine_id where m.owner = p_id and l.wallet <> p_id and l.created_at > now() - interval '30 days'
    union all
    select 'cmt', c.wallet, c.created_at, c.machine_id, c.body, c.stamp::int, 0
      from comments c join machines m on m.id = c.machine_id where m.owner = p_id and c.wallet <> p_id and not c.hidden and c.created_at > now() - interval '30 days'
    union all
    select 'fol', f.follower, f.created_at, null, null, null, 0
      from follows f where f.followee = p_id and f.created_at > now() - interval '30 days'
    union all
    select 'plike', pl.wallet, pl.created_at, po.machine_id, po.title, null, 0
      from post_likes pl join posts po on po.id = pl.post_id where po.wallet = p_id and pl.wallet <> p_id and pl.created_at > now() - interval '30 days'
    union all
    select 'preact', pr.wallet, pr.created_at, po.machine_id, po.title, pr.stamp::int, 0
      from post_reacts pr join posts po on po.id = pr.post_id where po.wallet = p_id and pr.wallet <> p_id and pr.created_at > now() - interval '30 days'
    union all
    select 'buy', l.wallet, l.created_at, l.machine_id, m.meta ->> 'n', null, l.n
      from ledger l join machines m on m.id = l.machine_id where l.kind = 'buy' and m.owner = p_id and l.wallet <> p_id and l.created_at > now() - interval '30 days'
    union all
    select 'rev', r.wallet, r.updated_at, r.machine_id, r.body, r.stars::int, 0
      from machine_reviews r join machines m on m.id = r.machine_id where m.owner = p_id and r.wallet <> p_id and not r.hidden and r.updated_at > now() - interval '30 days'
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('k', e.k, 'w', e.w, 'nm', coalesce(p.name, ''), 'av', p.avatar, 't', e.t, 'm', e.m, 'x', e.x, 's', e.s, 'n', e.n) order by e.t desc)
      from (select * from ev order by t desc limit 40) e left join profiles p on p.id = e.w
    ), '[]'::jsonb),
    'unread', (select count(*) from ev where p_since is null or t > p_since))
  into res;
  return res;
end;
$$;
revoke all on function public.notices(text, text, timestamptz) from public;
grant execute on function public.notices(text, text, timestamptz) to anon, authenticated;
