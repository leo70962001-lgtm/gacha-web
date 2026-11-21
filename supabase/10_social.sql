-- 第 10 步：社群（在 09_players.sql 之後跑一次）
-- 使用者 2026-11-21：「參考網路上有的增加整體用戶跟製作跟交流跟互動感」（4 組全做，並同意在正式資料庫執行）
--   參考：寶可夢 TCG Pocket（展示櫃、按讚送店主票、好友）、Super Mario Maker 2（創作者頁、讚、留言＋スタンプ、排行）、
--         ガチャメーカー（新作／排行／收藏）、創作平台的每週主題、每日任務＋連續登入
--   用戶：個人頁（暱稱、頭像、一句話、3 張展示卡、徽章）＋追蹤
--   交流：機台留言板（文字或スタンプ）、廣場（把抽到的卡、做好的卡貼出來）
--   互動：機台／貼文按讚（第一次讚送店主幾枚，每人每天最多 10 次有獎勵）、大家正在轉的動態、每日任務、通知
--   身分＝錢包（好友碼＝錢包 id，公開沒關係；寫入都要帶錢包鑰匙）；所有資料表只能透過下面的函式讀寫
--   只新增資料表、欄位跟函式；pull() 換成多記一欄「抽到哪些」（其他完全一樣），以前的紀錄不動

-- ---------- 欄位、資料表 ----------
alter table public.ledger add column if not exists picks text[];
alter table public.ledger drop constraint if exists ledger_kind_check;
alter table public.ledger add constraint ledger_kind_check check (kind in ('start', 'buy', 'sell', 'like', 'bonus'));

alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists avatar text;
alter table public.profiles add column if not exists showcase jsonb;
alter table public.profiles add column if not exists badges text[];
alter table public.profiles drop constraint if exists profiles_bio_ok;
alter table public.profiles add constraint profiles_bio_ok check (bio is null or char_length(bio) <= 80);
alter table public.profiles drop constraint if exists profiles_avatar_ok;
alter table public.profiles add constraint profiles_avatar_ok check (avatar is null or (char_length(avatar) <= 16000 and avatar ~ '^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$'));
alter table public.profiles drop constraint if exists profiles_showcase_ok;
alter table public.profiles add constraint profiles_showcase_ok check (showcase is null or (jsonb_typeof(showcase) = 'array' and octet_length(showcase::text) <= 130000));
alter table public.profiles drop constraint if exists profiles_badges_ok;
alter table public.profiles add constraint profiles_badges_ok check (badges is null or cardinality(badges) <= 40);

create table if not exists public.machine_likes (
  machine_id text not null references public.machines (id) on delete cascade,
  wallet text not null references public.wallets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (machine_id, wallet)
);
create index if not exists machine_likes_wallet on public.machine_likes (wallet, created_at desc);

create table if not exists public.follows (
  follower text not null references public.wallets (id) on delete cascade,
  followee text not null references public.wallets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee on public.follows (followee, created_at desc);

-- 按讚的獎勵只給一次（收回再按不會再給）
create table if not exists public.like_rewards (
  wallet text not null references public.wallets (id) on delete cascade,
  target text not null,
  created_at timestamptz not null default now(),
  primary key (wallet, target)
);
create index if not exists like_rewards_day on public.like_rewards (wallet, created_at desc);

-- 機台留言板：文字（≤120 字）或スタンプ（0–23），或兩個都有；hidden＝刪掉或被檢舉 3 次
create table if not exists public.comments (
  id bigint generated always as identity primary key,
  machine_id text not null references public.machines (id) on delete cascade,
  wallet text not null references public.wallets (id) on delete cascade,
  body text check (body is null or char_length(body) between 1 and 120),
  stamp smallint check (stamp is null or stamp between 0 and 23),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check (body is not null or stamp is not null)
);
create index if not exists comments_machine on public.comments (machine_id, id desc);
create index if not exists comments_wallet on public.comments (wallet, created_at desc);
create table if not exists public.comment_reports (
  comment_id bigint not null references public.comments (id) on delete cascade,
  wallet text not null references public.wallets (id) on delete cascade,
  primary key (comment_id, wallet)
);

-- 廣場：抽到的卡（pull）、自己做的卡（work）、自己的機台（machine）；圖是小的 data:image（≤60k 字）
create table if not exists public.posts (
  id bigint generated always as identity primary key,
  wallet text not null references public.wallets (id) on delete cascade,
  kind text not null check (kind in ('pull', 'work', 'machine')),
  img text not null check (char_length(img) <= 60000 and img ~ '^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$'),
  title text check (title is null or char_length(title) <= 40),
  rar smallint check (rar is null or rar between 0 and 3),
  machine_id text references public.machines (id) on delete set null,
  caption text check (caption is null or char_length(caption) <= 80),
  theme text check (theme is null or theme ~ '^[a-z0-9-]{1,16}$'),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists posts_new on public.posts (id desc) where not hidden;
create index if not exists posts_wallet on public.posts (wallet, id desc);
create index if not exists posts_theme on public.posts (theme, id desc) where theme is not null;
create table if not exists public.post_likes (
  post_id bigint not null references public.posts (id) on delete cascade,
  wallet text not null references public.wallets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, wallet)
);
create index if not exists post_likes_wallet on public.post_likes (wallet, created_at desc);
create table if not exists public.post_reacts (
  post_id bigint not null references public.posts (id) on delete cascade,
  wallet text not null references public.wallets (id) on delete cascade,
  stamp smallint not null check (stamp between 0 and 23),
  created_at timestamptz not null default now(),
  primary key (post_id, wallet)
);
create table if not exists public.post_reports (
  post_id bigint not null references public.posts (id) on delete cascade,
  wallet text not null references public.wallets (id) on delete cascade,
  primary key (post_id, wallet)
);

-- 每日任務：領過的（day＝玩家當地的日期）
create table if not exists public.mission_claims (
  wallet text not null references public.wallets (id) on delete cascade,
  day date not null,
  mission text not null check (mission in ('login', 'pull', 'like', 'talk', 'post', 'make')),
  coins int not null,
  created_at timestamptz not null default now(),
  primary key (wallet, day, mission)
);

do $$
declare tb text;
begin
  foreach tb in array array['machine_likes', 'follows', 'like_rewards', 'comments', 'comment_reports', 'posts', 'post_likes', 'post_reacts', 'post_reports', 'mission_claims'] loop
    execute format('alter table public.%I enable row level security', tb);
    execute format('revoke all on public.%I from anon, authenticated', tb);
  end loop;
end $$;

-- ---------- pull()：跟 09_players.sql 一樣，只多記 picks（這次抽到哪些獎品；動態牆用來算稀有度） ----------
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
  insert into ledger (wallet, delta, kind, machine_id, n, country, device, src, picks) values (p_wallet, -cost, 'buy', p_id, n, cc, dv, sr, picks);
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

-- ---------- 小工具（網頁叫不到） ----------
-- 看的人：錢包 id＋鑰匙對 → id，不對或沒給 → null（只影響「我按過讚沒」這類欄位）
create or replace function public.soc_viewer(p_id text, p_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null or p_key is null or p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' then
    return null;
  end if;
  if wallet_key_ok(p_id, p_key) is true then
    return p_id;
  end if;
  return null;
end;
$$;
revoke all on function public.soc_viewer(text, text) from public, anon, authenticated;

-- 一台機台的列表資料（逛機台、個人頁共用）
create or replace function public.soc_mrow(p_mid text, v text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id, 'meta', m.meta, 't', m.updated_at,
    'pulls', coalesce((select sum(p.n) from pulls p where p.machine_id = m.id), 0),
    'total', coalesce((select sum((e.value)::int) from jsonb_each_text(m.stock) e where e.value ~ '^[0-9]+$'), 0),
    'likes', (select count(*) from machine_likes l where l.machine_id = m.id),
    'liked', v is not null and exists (select 1 from machine_likes l where l.machine_id = m.id and l.wallet = v),
    'cm', (select count(*) from comments c where c.machine_id = m.id and not c.hidden),
    'o', m.owner,
    'on', coalesce((select pr.name from profiles pr where pr.id = m.owner), ''))
  from machines m where m.id = p_mid;
$$;
revoke all on function public.soc_mrow(text, text) from public, anon, authenticated;

-- 一則廣場貼文
create or replace function public.soc_post(p_post bigint, v text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', po.id, 'w', po.wallet, 'nm', coalesce(pr.name, ''), 'av', pr.avatar,
    'k', po.kind, 'img', po.img, 'ti', po.title, 'r', po.rar, 'm', po.machine_id, 'c', po.caption, 'th', po.theme, 't', po.created_at,
    'likes', (select count(*) from post_likes l where l.post_id = po.id),
    'liked', v is not null and exists (select 1 from post_likes l where l.post_id = po.id and l.wallet = v),
    'rc', coalesce((select jsonb_object_agg(x.stamp, x.n) from (select stamp, count(*) as n from post_reacts r where r.post_id = po.id group by stamp) x), '{}'::jsonb),
    'my', (select r.stamp from post_reacts r where r.post_id = po.id and r.wallet = v))
  from posts po left join profiles pr on pr.id = po.wallet
  where po.id = p_post;
$$;
revoke all on function public.soc_post(bigint, text) from public, anon, authenticated;

-- ---------- 個人頁 ----------
create or replace function public.profile_get(p_id text, p_viewer text default null, p_vkey text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := soc_viewer(p_viewer, p_vkey);
  res jsonb;
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'id', w.id, 'since', w.created_at,
    'name', coalesce(p.name, ''), 'bio', p.bio, 'avatar', p.avatar, 'showcase', p.showcase, 'badges', p.badges,
    'followers', (select count(*) from follows f where f.followee = w.id),
    'following', (select count(*) from follows f where f.follower = w.id),
    'i_follow', v is not null and exists (select 1 from follows f where f.follower = v and f.followee = w.id),
    'me', v = w.id,
    'sold', coalesce((select sum(l.n) from ledger l where l.wallet = w.id and l.kind = 'sell'), 0),
    'pulled', coalesce((select sum(l.n) from ledger l where l.wallet = w.id and l.kind = 'buy'), 0),
    'likes', (select count(*) from machine_likes l join machines m on m.id = l.machine_id where m.owner = w.id)
           + (select count(*) from post_likes l join posts po on po.id = l.post_id where po.wallet = w.id),
    'posts_n', (select count(*) from posts po where po.wallet = w.id and not po.hidden),
    'machines', coalesce((
      select jsonb_agg(soc_mrow(m.id, v) order by m.updated_at desc)
      from (select id, updated_at from machines where owner = w.id and listed and meta is not null order by updated_at desc limit 24) m
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(soc_post(po.id, v) order by po.id desc)
      from (select id from posts where wallet = w.id and not hidden order by id desc limit 12) po
    ), '[]'::jsonb))
  into res
  from wallets w left join profiles p on p.id = w.id
  where w.id = p_id;
  if res is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return res;
end;
$$;
revoke all on function public.profile_get(text, text, text) from public;
grant execute on function public.profile_get(text, text, text) to anon, authenticated;

-- 存我的個人頁（暱稱跟好友交換用的是同一個）
create or replace function public.profile_save(p_id text, p_key text, p_name text, p_bio text, p_avatar text, p_showcase jsonb, p_badges text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  bi text := nullif(btrim(coalesce(p_bio, '')), '');
begin
  perform trade_auth(p_id, p_key);
  if char_length(nm) not between 1 and 24 or char_length(coalesce(bi, '')) > 80
     or (p_showcase is not null and (jsonb_typeof(p_showcase) <> 'array' or jsonb_array_length(p_showcase) > 3)) then
    raise exception 'bad request' using errcode = '22023';
  end if;
  insert into profiles (id, name, bio, avatar, showcase, badges)
    values (p_id, nm, bi, p_avatar, p_showcase, p_badges[1:40])
    on conflict (id) do update set name = excluded.name, bio = excluded.bio, avatar = excluded.avatar,
      showcase = excluded.showcase, badges = excluded.badges, updated_at = now();
  return profile_get(p_id, p_id, p_key);
end;
$$;
revoke all on function public.profile_save(text, text, text, text, text, jsonb, text[]) from public;
grant execute on function public.profile_save(text, text, text, text, text, jsonb, text[]) to anon, authenticated;

-- 追蹤／取消追蹤 → { following, followers }
create or replace function public.follow_set(p_id text, p_key text, p_to text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  if p_to !~ '^[0-9A-Za-z]{10}$' or p_to = p_id or not exists (select 1 from wallets where id = p_to) then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if p_on then
    if (select count(*) from follows where follower = p_id) >= 500 then
      raise exception 'too many' using errcode = '54000';
    end if;
    insert into follows (follower, followee) values (p_id, p_to) on conflict do nothing;
  else
    delete from follows where follower = p_id and followee = p_to;
  end if;
  return jsonb_build_object('following', p_on, 'followers', (select count(*) from follows where followee = p_to));
end;
$$;
revoke all on function public.follow_set(text, text, text, boolean) from public;
grant execute on function public.follow_set(text, text, text, boolean) to anon, authenticated;

-- 我追蹤的人（好友碼＋暱稱＋頭像）
create or replace function public.follow_list(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  return coalesce((
    select jsonb_agg(jsonb_build_object('w', f.followee, 'nm', coalesce(p.name, ''), 'av', p.avatar) order by f.created_at desc)
    from follows f left join profiles p on p.id = f.followee
    where f.follower = p_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.follow_list(text, text) from public;
grant execute on function public.follow_list(text, text) to anon, authenticated;

-- ---------- 讚 ----------
-- 第一次讚別人的東西 → 對方 +2 枚（機台）／+1 枚（貼文）；同一個東西只給一次，按讚的人每天最多 10 次有獎勵
create or replace function public.soc_reward(p_from text, p_target text, p_to text, p_coins int, p_machine text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  ins int;
begin
  if p_to is null or p_to = p_from then
    return 0;
  end if;
  if (select count(*) from like_rewards where wallet = p_from and created_at > now() - interval '1 day') >= 10 then
    return 0;
  end if;
  insert into like_rewards (wallet, target) values (p_from, p_target) on conflict do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then
    return 0;
  end if;
  update wallets set balance = balance + p_coins where id = p_to;
  insert into ledger (wallet, delta, kind, machine_id, n) values (p_to, p_coins, 'like', p_machine, 1);
  return p_coins;
end;
$$;
revoke all on function public.soc_reward(text, text, text, int, text) from public, anon, authenticated;

create or replace function public.like_machine(p_id text, p_key text, p_m text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  own text;
  ins int := 0;
  rw int := 0;
begin
  perform trade_auth(p_id, p_key);
  select owner into own from machines where id = p_m;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_on then
    insert into machine_likes (machine_id, wallet) values (p_m, p_id) on conflict do nothing;
    get diagnostics ins = row_count;
    if ins > 0 then
      rw := soc_reward(p_id, 'm:' || p_m, own, 2, p_m);
    end if;
  else
    delete from machine_likes where machine_id = p_m and wallet = p_id;
  end if;
  return jsonb_build_object('liked', p_on, 'likes', (select count(*) from machine_likes where machine_id = p_m), 'reward', rw);
end;
$$;
revoke all on function public.like_machine(text, text, text, boolean) from public;
grant execute on function public.like_machine(text, text, text, boolean) to anon, authenticated;

-- 機台畫面用：店主、讚、留言數、被當模板幾次、靈感來源、參加的主題（不回傳封面那些大的摘要）
create or replace function public.machine_social(p_m text, p_viewer text default null, p_vkey text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := soc_viewer(p_viewer, p_vkey);
  res jsonb;
begin
  select jsonb_build_object(
    'o', m.owner,
    'on', coalesce(p.name, ''), 'oav', p.avatar,
    'ofl', v is not null and m.owner is not null and exists (select 1 from follows f where f.follower = v and f.followee = m.owner),
    'likes', (select count(*) from machine_likes l where l.machine_id = m.id),
    'liked', v is not null and exists (select 1 from machine_likes l where l.machine_id = m.id and l.wallet = v),
    'cm', (select count(*) from comments c where c.machine_id = m.id and not c.hidden),
    'listed', m.listed,
    'w', m.meta ->> 'w',
    'rx', m.meta ->> 'rx',
    'rxn', (select s.meta ->> 'n' from machines s where s.id = m.meta ->> 'rx' and s.listed),
    'rxc', (select count(*) from machines s where s.listed and s.meta ->> 'rx' = m.id),
    'nr', coalesce((m.meta ->> 'nr') = '1', false))
  into res
  from machines m left join profiles p on p.id = m.owner
  where m.id = p_m;
  if res is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return res;
end;
$$;
revoke all on function public.machine_social(text, text, text) from public;
grant execute on function public.machine_social(text, text, text) to anon, authenticated;

-- 逛機台 v2：sort＝new／hot（被轉最多）／likes（讚最多）／follow（追蹤的人）／theme（這週主題，照讚數）；舊的 browse_machines 留著給舊版網頁
create or replace function public.browse2(p_sort text default 'new', p_theme text default null, p_viewer text default null, p_vkey text default null, p_limit int default 24, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := soc_viewer(p_viewer, p_vkey);
  lim int := least(greatest(coalesce(p_limit, 24), 1), 48);
  off int := greatest(coalesce(p_offset, 0), 0);
begin
  if p_sort = 'follow' and v is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(soc_mrow(x.id, v) order by x.rn)
    from (
      select m.id, row_number() over (order by
               case when p_sort = 'hot' then (select coalesce(sum(p.n), 0) from pulls p where p.machine_id = m.id)
                    when p_sort in ('likes', 'theme') then (select count(*) from machine_likes l where l.machine_id = m.id) end desc nulls last,
               m.updated_at desc) as rn
      from machines m
      where m.listed and m.meta is not null
        and (p_sort <> 'follow' or m.owner in (select f.followee from follows f where f.follower = v))
        and (p_sort <> 'theme' or m.meta ->> 'w' = p_theme)
      order by rn
      limit lim offset off
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.browse2(text, text, text, text, int, int) from public;
grant execute on function public.browse2(text, text, text, text, int, int) to anon, authenticated;

-- 排行：最近 30 天被轉的次數＋讚 ×3（Mario Maker 的創作者排行那樣）
create or replace function public.top_makers(p_limit int default 10)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('w', x.w, 'nm', coalesce(p.name, ''), 'av', p.avatar, 'sold', x.sold, 'likes', x.likes, 'sc', x.sc) order by x.sc desc), '[]'::jsonb)
  from (
    select o.w, sum(o.sold)::int as sold, sum(o.likes)::int as likes, sum(o.sold + o.likes * 3)::int as sc
    from (
      select l.wallet as w, l.n as sold, 0 as likes from ledger l where l.kind = 'sell' and l.created_at > now() - interval '30 days'
      union all
      select m.owner, 0, 1 from machine_likes ml join machines m on m.id = ml.machine_id where m.owner is not null and ml.created_at > now() - interval '30 days'
      union all
      select po.wallet, 0, 1 from post_likes pl join posts po on po.id = pl.post_id where pl.created_at > now() - interval '30 days'
    ) o
    group by o.w
    order by sum(o.sold + o.likes * 3) desc
    limit least(greatest(coalesce(p_limit, 10), 1), 30)
  ) x left join profiles p on p.id = x.w;
$$;
revoke all on function public.top_makers(int) from public;
grant execute on function public.top_makers(int) to anon, authenticated;

-- ---------- 留言板 ----------
-- 新的在前；p_after＝只要比這則新的（畫面上即時冒出來）、p_before＝往前翻
create or replace function public.comments_list(p_m text, p_before bigint default null, p_after bigint default null, p_limit int default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'w', c.wallet, 'nm', coalesce(p.name, ''), 'av', p.avatar, 'b', c.body, 's', c.stamp, 't', c.created_at) order by c.id desc), '[]'::jsonb)
  from (
    select * from comments
    where machine_id = p_m and not hidden
      and (p_before is null or id < p_before) and (p_after is null or id > p_after)
    order by id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  ) c left join profiles p on p.id = c.wallet;
$$;
revoke all on function public.comments_list(text, bigint, bigint, int) from public;
grant execute on function public.comments_list(text, bigint, bigint, int) to anon, authenticated;

create or replace function public.comment_add(p_id text, p_key text, p_m text, p_body text, p_stamp int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := nullif(btrim(coalesce(p_body, '')), '');
  cid bigint;
begin
  perform trade_auth(p_id, p_key);
  if not exists (select 1 from machines where id = p_m) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if (b is null and p_stamp is null) or char_length(coalesce(b, '')) > 120 or (p_stamp is not null and p_stamp not between 0 and 23) then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if exists (select 1 from comments where wallet = p_id and created_at > now() - interval '6 seconds')
     or (select count(*) from comments where wallet = p_id and created_at > now() - interval '1 day') >= 80 then
    raise exception 'too many' using errcode = '54000';
  end if;
  insert into comments (machine_id, wallet, body, stamp) values (p_m, p_id, b, p_stamp) returning id into cid;
  return (select jsonb_build_object('id', c.id, 'w', c.wallet, 'nm', coalesce(p.name, ''), 'av', p.avatar, 'b', c.body, 's', c.stamp, 't', c.created_at)
          from comments c left join profiles p on p.id = c.wallet where c.id = cid);
end;
$$;
revoke all on function public.comment_add(text, text, text, text, int) from public;
grant execute on function public.comment_add(text, text, text, text, int) to anon, authenticated;

-- 刪留言：自己的，或是自己機台上的
create or replace function public.comment_del(p_id text, p_key text, p_c bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  update comments c set hidden = true
    where c.id = p_c and (c.wallet = p_id or exists (select 1 from machines m where m.id = c.machine_id and m.owner = p_id));
  return found;
end;
$$;
revoke all on function public.comment_del(text, text, bigint) from public;
grant execute on function public.comment_del(text, text, bigint) to anon, authenticated;

-- 檢舉：3 個人檢舉就先藏起來
create or replace function public.comment_report(p_id text, p_key text, p_c bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  if not exists (select 1 from comments where id = p_c) then
    return false;
  end if;
  insert into comment_reports (comment_id, wallet) values (p_c, p_id) on conflict do nothing;
  if (select count(*) from comment_reports where comment_id = p_c) >= 3 then
    update comments set hidden = true where id = p_c;
  end if;
  return true;
end;
$$;
revoke all on function public.comment_report(text, text, bigint) from public;
grant execute on function public.comment_report(text, text, bigint) to anon, authenticated;

-- ---------- 廣場 ----------
create or replace function public.post_add(p_id text, p_key text, p_kind text, p_img text, p_title text, p_rar int, p_m text, p_caption text, p_theme text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pid bigint;
  mid text := case when p_m ~ '^[0-9A-Za-z]{10}$' and exists (select 1 from machines where id = p_m) then p_m end;
begin
  perform trade_auth(p_id, p_key);
  if p_kind not in ('pull', 'work', 'machine') or p_img is null or char_length(p_img) > 60000
     or p_img !~ '^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$'
     or char_length(coalesce(p_title, '')) > 40 or char_length(coalesce(p_caption, '')) > 80
     or (p_rar is not null and p_rar not between 0 and 3)
     or (p_theme is not null and p_theme !~ '^[a-z0-9-]{1,16}$') then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if exists (select 1 from posts where wallet = p_id and created_at > now() - interval '15 seconds')
     or (select count(*) from posts where wallet = p_id and created_at > now() - interval '1 day') >= 12 then
    raise exception 'too many' using errcode = '54000';
  end if;
  insert into posts (wallet, kind, img, title, rar, machine_id, caption, theme)
    values (p_id, p_kind, p_img, nullif(btrim(coalesce(p_title, '')), ''), p_rar, mid, nullif(btrim(coalesce(p_caption, '')), ''), p_theme)
    returning id into pid;
  return soc_post(pid, p_id);
end;
$$;
revoke all on function public.post_add(text, text, text, text, text, int, text, text, text) from public;
grant execute on function public.post_add(text, text, text, text, text, int, text, text, text) to anon, authenticated;

create or replace function public.post_del(p_id text, p_key text, p_post bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  update posts set hidden = true where id = p_post and wallet = p_id;
  return found;
end;
$$;
revoke all on function public.post_del(text, text, bigint) from public;
grant execute on function public.post_del(text, text, bigint) to anon, authenticated;

create or replace function public.post_report(p_id text, p_key text, p_post bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  if not exists (select 1 from posts where id = p_post) then
    return false;
  end if;
  insert into post_reports (post_id, wallet) values (p_post, p_id) on conflict do nothing;
  if (select count(*) from post_reports where post_id = p_post) >= 3 then
    update posts set hidden = true where id = p_post;
  end if;
  return true;
end;
$$;
revoke all on function public.post_report(text, text, bigint) from public;
grant execute on function public.post_report(text, text, bigint) to anon, authenticated;

create or replace function public.post_like(p_id text, p_key text, p_post bigint, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  au text;
  ins int := 0;
  rw int := 0;
begin
  perform trade_auth(p_id, p_key);
  select wallet into au from posts where id = p_post and not hidden;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_on then
    insert into post_likes (post_id, wallet) values (p_post, p_id) on conflict do nothing;
    get diagnostics ins = row_count;
    if ins > 0 then
      rw := soc_reward(p_id, 'p:' || p_post, au, 1, null);
    end if;
  else
    delete from post_likes where post_id = p_post and wallet = p_id;
  end if;
  return jsonb_build_object('liked', p_on, 'likes', (select count(*) from post_likes where post_id = p_post), 'reward', rw);
end;
$$;
revoke all on function public.post_like(text, text, bigint, boolean) from public;
grant execute on function public.post_like(text, text, bigint, boolean) to anon, authenticated;

-- 丟スタンプ（每人每則一個，可以換；null＝收回）→ 這則的スタンプ統計
create or replace function public.post_react(p_id text, p_key text, p_post bigint, p_stamp int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  if not exists (select 1 from posts where id = p_post and not hidden) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_stamp is null then
    delete from post_reacts where post_id = p_post and wallet = p_id;
  elsif p_stamp between 0 and 23 then
    insert into post_reacts (post_id, wallet, stamp) values (p_post, p_id, p_stamp)
      on conflict (post_id, wallet) do update set stamp = excluded.stamp, created_at = now();
  else
    raise exception 'bad request' using errcode = '22023';
  end if;
  return soc_post(p_post, p_id);
end;
$$;
revoke all on function public.post_react(text, text, bigint, int) from public;
grant execute on function public.post_react(text, text, bigint, int) to anon, authenticated;

-- 廣場列表：sort＝new／hot（14 天內照讚數）／follow（追蹤的人）／theme（這週主題，照讚數）／author（某個人的）
create or replace function public.feed(p_sort text default 'new', p_theme text default null, p_author text default null, p_viewer text default null, p_vkey text default null, p_limit int default 20, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := soc_viewer(p_viewer, p_vkey);
  lim int := least(greatest(coalesce(p_limit, 20), 1), 40);
  off int := greatest(coalesce(p_offset, 0), 0);
begin
  if p_sort = 'follow' and v is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(soc_post(x.id, v) order by x.rn)
    from (
      select po.id, row_number() over (order by
               case when p_sort in ('hot', 'theme') then (select count(*) from post_likes l where l.post_id = po.id) end desc nulls last,
               po.id desc) as rn
      from posts po
      where not po.hidden
        and (p_sort <> 'hot' or po.created_at > now() - interval '14 days')
        and (p_sort <> 'follow' or po.wallet in (select f.followee from follows f where f.follower = v))
        and (p_sort <> 'theme' or po.theme = p_theme)
        and (p_sort <> 'author' or po.wallet = p_author)
      order by rn
      limit lim offset off
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.feed(text, text, text, text, text, int, int) from public;
grant execute on function public.feed(text, text, text, text, text, int, int) to anon, authenticated;

-- ---------- 大家正在轉（動態） ----------
-- p_m 有給＝這台的（給機台畫面）；沒給＝公開機台的全部；最近 3 天；b＝這次最稀有的（公開摘要裡有 r＝{獎品: 稀有度} 才算得出來）
create or replace function public.activity(p_m text default null, p_after bigint default 0, p_limit int default 20)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'm', l.machine_id, 'mn', m.meta ->> 'n', 'w', l.wallet, 'nm', coalesce(p.name, ''), 'n', l.n, 'pk', l.picks, 't', l.created_at,
      'b', (select max((m.meta -> 'r' ->> x)::int) from unnest(coalesce(l.picks, '{}')) x where (m.meta -> 'r' ->> x) ~ '^[0-3]$'))
    order by l.id desc), '[]'::jsonb)
  from (
    select lg.* from ledger lg join machines mm on mm.id = lg.machine_id
    where lg.kind = 'buy' and lg.id > coalesce(p_after, 0) and lg.created_at > now() - interval '3 days'
      and (case when p_m is null then mm.listed else lg.machine_id = p_m end)
    order by lg.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 40)
  ) l
  join machines m on m.id = l.machine_id
  left join profiles p on p.id = l.wallet;
$$;
revoke all on function public.activity(text, bigint, int) from public;
grant execute on function public.activity(text, bigint, int) to anon, authenticated;

-- ---------- 通知 ----------
-- 別人對我做的事：讚我的機台／貼文、在我的機台留言、追蹤我、丟スタンプ給我的貼文、轉我的機台（最近 30 天、最多 40 則）
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

-- ---------- 每日任務＋連續登入 ----------
-- p_off＝玩家時區比 UTC 快幾分鐘（台灣 480、日本 540）；日期照玩家當地算
create or replace function public.soc_missions(p_id text, p_off int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  off int := least(greatest(coalesce(p_off, 0), -840), 840);
  dy date := ((now() at time zone 'UTC') + make_interval(mins => off))::date;
  d0 timestamptz := (dy::timestamp - make_interval(mins => off)) at time zone 'UTC';
  st int := 0;
  dd date;
  pos int;
  lc int[] := array[10, 15, 20, 25, 30, 35, 60];
  today_login boolean;
  list jsonb := '[]'::jsonb;
  k text;
  dn boolean;
  cl int;
  coins int;
begin
  today_login := exists (select 1 from mission_claims where wallet = p_id and day = dy and mission = 'login');
  dd := case when today_login then dy else dy - 1 end;
  while st < 60 and exists (select 1 from mission_claims where wallet = p_id and day = dd and mission = 'login') loop
    st := st + 1;
    dd := dd - 1;
  end loop;
  -- 今天還沒領：領了以後是第幾天
  pos := ((case when today_login then st else st + 1 end) - 1) % 7 + 1;
  foreach k in array array['login', 'pull', 'like', 'talk', 'post', 'make'] loop
    dn := case k
      when 'login' then true
      when 'pull' then exists (select 1 from ledger where wallet = p_id and kind = 'buy' and created_at >= d0)
      when 'like' then (select count(*) from machine_likes where wallet = p_id and created_at >= d0) + (select count(*) from post_likes where wallet = p_id and created_at >= d0) >= 2
      when 'talk' then exists (select 1 from comments where wallet = p_id and created_at >= d0)
      when 'post' then exists (select 1 from posts where wallet = p_id and created_at >= d0)
      when 'make' then exists (select 1 from machines where owner = p_id and updated_at >= d0)
    end;
    select mc.coins into cl from mission_claims mc where mc.wallet = p_id and mc.day = dy and mc.mission = k;
    coins := case k when 'login' then lc[pos] when 'pull' then 10 when 'like' then 10 when 'talk' then 10 else 15 end;
    list := list || jsonb_build_object('k', k, 'done', dn, 'claimed', cl is not null, 'c', coalesce(cl, coins));
    cl := null;
  end loop;
  return jsonb_build_object('day', dy, 'streak', st, 'pos', pos, 'list', list);
end;
$$;
revoke all on function public.soc_missions(text, int) from public, anon, authenticated;

create or replace function public.missions(p_id text, p_key text, p_off int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trade_auth(p_id, p_key);
  return soc_missions(p_id, p_off);
end;
$$;
revoke all on function public.missions(text, text, int) from public;
grant execute on function public.missions(text, text, int) to anon, authenticated;

-- 領獎：做完了才給，一天一次 → { got, balance, state }
create or replace function public.mission_claim(p_id text, p_key text, p_off int, p_k text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stt jsonb;
  it jsonb;
  ins int;
  got int := 0;
begin
  perform trade_auth(p_id, p_key);
  stt := soc_missions(p_id, p_off);
  select e into it from jsonb_array_elements(stt -> 'list') e where e ->> 'k' = p_k;
  if it is null then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if not (it ->> 'done')::boolean then
    raise exception 'not done' using errcode = 'P0001';
  end if;
  if not (it ->> 'claimed')::boolean then
    insert into mission_claims (wallet, day, mission, coins) values (p_id, (stt ->> 'day')::date, p_k, (it ->> 'c')::int) on conflict do nothing;
    get diagnostics ins = row_count;
    if ins > 0 then
      got := (it ->> 'c')::int;
      update wallets set balance = balance + got where id = p_id;
      insert into ledger (wallet, delta, kind, n) values (p_id, got, 'bonus', 1);
    end if;
  end if;
  return jsonb_build_object('got', got, 'balance', (select balance from wallets where id = p_id), 'state', soc_missions(p_id, p_off));
end;
$$;
revoke all on function public.mission_claim(text, text, int, text) from public;
grant execute on function public.mission_claim(text, text, int, text) to anon, authenticated;
