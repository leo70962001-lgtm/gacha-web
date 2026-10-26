-- 第 7 步：逛機台（在 03_stock.sql、04_wallet.sql 之後跑一次）
-- 使用者 2026-10-26：「追加用戶做好的機器的瀏覽頁面」
-- 店家自己按「公開到逛機台」才會出現（listed）；沒公開的機台還是只有拿到連結的人看得到
-- 列表只用小的摘要 meta（名稱、店名、種類、價錢、獎品數、機台封面小圖、獎品小圖），不用讀整台的資料
alter table public.machines add column if not exists listed boolean not null default false;
alter table public.machines add column if not exists meta jsonb;
alter table public.machines add column if not exists listed_at timestamptz;
create index if not exists machines_listed on public.machines (updated_at desc) where listed;

-- 公開／取消公開（要機台的修改鑰匙）；p_meta 有給就順便更新摘要
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
        meta = coalesce(p_meta, meta),
        listed_at = case when p_listed and not listed then now() else listed_at end
    where id = p_id;
  return p_listed;
end;
$$;
revoke all on function public.set_listed(text, text, boolean, jsonb) from public;
grant execute on function public.set_listed(text, text, boolean, jsonb) to anon, authenticated;

-- 列表：p_sort＝new（最近更新）或 hot（被轉最多次）；一次最多 48 台
create or replace function public.browse_machines(p_sort text default 'new', p_limit int default 24, p_offset int default 0)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'meta', t.meta, 'pulls', t.pulls, 'total', t.total, 't', t.updated_at)
                            order by t.ord1 desc nulls last, t.updated_at desc), '[]'::jsonb)
  from (
    select m.id, m.meta, m.updated_at,
           coalesce((select sum(p.n) from pulls p where p.machine_id = m.id), 0) as pulls,
           coalesce((select sum((e.value)::int) from jsonb_each_text(m.stock) e where e.value ~ '^[0-9]+$'), 0) as total,
           case when p_sort = 'hot' then coalesce((select sum(p.n) from pulls p where p.machine_id = m.id), 0) end as ord1
    from machines m
    where m.listed and m.meta is not null
    order by case when p_sort = 'hot' then coalesce((select sum(p.n) from pulls p where p.machine_id = m.id), 0) end desc nulls last, m.updated_at desc
    limit least(greatest(coalesce(p_limit, 24), 1), 48) offset greatest(coalesce(p_offset, 0), 0)
  ) t;
$$;
revoke all on function public.browse_machines(text, int, int) from public;
grant execute on function public.browse_machines(text, int, int) to anon, authenticated;
