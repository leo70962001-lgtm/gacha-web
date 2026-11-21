-- 第 13 步：機台的公開範圍（在 12_reviews.sql 之後跑一次）
-- 使用者 2026-11-21：「增加 限定公開 非公開 或好友公開的 轉蛋機」
--   vis＝public  公開：上「逛機台」，拿到連結的人也能轉（＝以前的 listed）
--        link    限定公開：不上逛機台，拿到連結的人才能轉（＝以前沒勾公開的短連結，預設）
--        friends 好友公開：只有互相追蹤的人（＋店主自己）能打開；好友看店主的個人頁也看得到這台
--        private 非公開：只有店主自己（同一個錢包，或手上有這台的修改鑰匙）能打開
--   listed 照舊跟著 vis（listed ＝ vis = 'public'）→ 逛機台、個人頁、主題、動態那些查詢都不用改
--   好友公開、非公開的機台：網頁不能再直接讀 machines 資料表（RLS 擋掉），要走 machine_get() 帶錢包或修改鑰匙
--   只新增欄位跟函式；set_listed、soc_mrow、profile_get 換成多認 vis 的版本（其他完全一樣）

-- ---------- 欄位 ----------
alter table public.machines add column if not exists vis text not null default 'link';
alter table public.machines drop constraint if exists machines_vis_ok;
alter table public.machines add constraint machines_vis_ok check (vis in ('public', 'link', 'friends', 'private'));
update public.machines set vis = 'public' where listed and vis <> 'public';
update public.machines set vis = 'link' where not listed and vis = 'public';

-- 直接讀資料表：只剩公開、限定公開（舊版網頁讀好友公開、非公開的機台 → 讀不到 → 「找不到這台機台」）
drop policy if exists "machines readable" on public.machines;
create policy "machines readable" on public.machines for select to anon, authenticated using (vis in ('public', 'link'));

-- ---------- 小工具（網頁叫不到） ----------
-- 好友＝互相追蹤；自己跟自己也算
create or replace function public.soc_friends(a text, b text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a is not null and b is not null and (a = b or (
    exists (select 1 from follows f where f.follower = a and f.followee = b) and
    exists (select 1 from follows f where f.follower = b and f.followee = a)));
$$;
revoke all on function public.soc_friends(text, text) from public, anon, authenticated;

-- ---------- 讀機台 ----------
-- p_viewer／p_vkey＝看的人的錢包；p_mkey＝這台的修改鑰匙（店主自己的裝置上有）
-- 能看 → { vis, data, shared }；不能看 → { vis, locked: true, o 店主, on 店主暱稱, i_follow 我追蹤他了沒, f_me 他追蹤我了沒 }
--   （非公開的不告訴是誰的）；沒有這台 → P0002
create or replace function public.machine_get(p_id text, p_viewer text default null, p_vkey text default null, p_mkey text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v text;
begin
  if p_id is null or p_id !~ '^[0-9A-Za-z]{10}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  select id, data, stock, vis, owner into m from machines where id = p_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if m.vis not in ('public', 'link') then
    v := soc_viewer(p_viewer, p_vkey);
    -- coalesce：店主是 null（很舊、沒帶錢包存的機台）時 v = owner 是 null，不能讓 not null 變成放行
    if not coalesce((v is not null and m.owner is not null and v = m.owner)
            or (p_mkey is not null and p_mkey ~ '^[A-Za-z0-9_-]{20,64}$' and machine_key_ok(p_id, p_mkey) is true)
            or (m.vis = 'friends' and soc_friends(v, m.owner)), false) then
      if m.vis = 'private' then
        return jsonb_build_object('vis', m.vis, 'locked', true);
      end if;
      return jsonb_build_object('vis', m.vis, 'locked', true, 'o', m.owner,
        'on', coalesce((select pr.name from profiles pr where pr.id = m.owner), ''),
        'i_follow', v is not null and exists (select 1 from follows f where f.follower = v and f.followee = m.owner),
        'f_me', v is not null and exists (select 1 from follows f where f.follower = m.owner and f.followee = v));
    end if;
  end if;
  return jsonb_build_object('vis', m.vis, 'data', m.data, 'shared', m.stock is not null and m.stock <> '{}'::jsonb);
end;
$$;
revoke all on function public.machine_get(text, text, text, text) from public;
grant execute on function public.machine_get(text, text, text, text) to anon, authenticated;

-- ---------- 改公開範圍（要機台的修改鑰匙）；p_meta 有給就順便更新摘要（好友在個人頁看到的卡片用） ----------
create or replace function public.set_vis(p_id text, p_key text, p_vis text, p_meta jsonb default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' or coalesce(p_vis, '') not in ('public', 'link', 'friends', 'private') then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if machine_key_ok(p_id, p_key) is not true then
    raise exception 'wrong key' using errcode = '42501';
  end if;
  if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or octet_length(p_meta::text) > 80000) then
    raise exception 'bad request' using errcode = '22023';
  end if;
  update machines
    set vis = p_vis,
        listed = (p_vis = 'public'),
        meta = coalesce(p_meta, meta),
        listed_at = case when p_vis = 'public' and not listed then now() else listed_at end
    where id = p_id;
  return p_vis;
end;
$$;
revoke all on function public.set_vis(text, text, text, jsonb) from public;
grant execute on function public.set_vis(text, text, text, jsonb) to anon, authenticated;

-- 舊的公開開關（07_browse.sql）：照舊能用，順便改 vis（取消公開 → 限定公開；好友公開、非公開的機台按「取消公開」不動）
create or replace function public.set_listed(p_id text, p_key text, p_listed boolean, p_meta jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if machine_key_ok(p_id, p_key) is not true then
    raise exception 'wrong key' using errcode = '42501';
  end if;
  if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or octet_length(p_meta::text) > 80000) then
    raise exception 'bad request' using errcode = '22023';
  end if;
  update machines
    set listed = p_listed,
        vis = case when p_listed then 'public' when vis = 'public' then 'link' else vis end,
        meta = coalesce(p_meta, meta),
        listed_at = case when p_listed and not listed then now() else listed_at end
    where id = p_id;
  return p_listed;
end;
$$;
revoke all on function public.set_listed(text, text, boolean, jsonb) from public;
grant execute on function public.set_listed(text, text, boolean, jsonb) to anon, authenticated;

-- ---------- 機台卡多一欄 vis（逛機台、個人頁共用；其他跟 10_social.sql 一樣） ----------
create or replace function public.soc_mrow(p_mid text, v text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id, 'meta', m.meta, 't', m.updated_at, 'vis', m.vis,
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

-- ---------- 個人頁：好友（互相追蹤）也看得到好友公開的機台；多回 f_me（他有沒有追蹤我） ----------
create or replace function public.profile_get(p_id text, p_viewer text default null, p_vkey text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := soc_viewer(p_viewer, p_vkey);
  fr boolean;
  res jsonb;
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  fr := soc_friends(v, p_id);
  select jsonb_build_object(
    'id', w.id, 'since', w.created_at,
    'name', coalesce(p.name, ''), 'bio', p.bio, 'avatar', p.avatar, 'showcase', p.showcase, 'badges', p.badges,
    'followers', (select count(*) from follows f where f.followee = w.id),
    'following', (select count(*) from follows f where f.follower = w.id),
    'i_follow', v is not null and exists (select 1 from follows f where f.follower = v and f.followee = w.id),
    'f_me', v is not null and exists (select 1 from follows f where f.follower = w.id and f.followee = v),
    'me', v = w.id,
    'sold', coalesce((select sum(l.n) from ledger l where l.wallet = w.id and l.kind = 'sell'), 0),
    'pulled', coalesce((select sum(l.n) from ledger l where l.wallet = w.id and l.kind = 'buy'), 0),
    'likes', (select count(*) from machine_likes l join machines m on m.id = l.machine_id where m.owner = w.id)
           + (select count(*) from post_likes l join posts po on po.id = l.post_id where po.wallet = w.id),
    'posts_n', (select count(*) from posts po where po.wallet = w.id and not po.hidden),
    'machines', coalesce((
      select jsonb_agg(soc_mrow(m.id, v) order by m.updated_at desc)
      from (select id, updated_at from machines
            where owner = w.id and meta is not null and (listed or (fr and vis = 'friends'))
            order by updated_at desc limit 24) m
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
