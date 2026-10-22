-- 第 2 步：同一條連結可以更新（在 setup.sql 之後跑一次）
-- 每台機器有一把「修改鑰匙」：開店的人第一次產生連結時在瀏覽器裡隨機產生、只存在他自己的裝置
-- 資料庫只存鑰匙的 SHA-256（machine_keys，網頁讀不到）；寫入一律走 save_machine()：
--   id 還沒有人用 → 新增並記下鑰匙；id 已存在且鑰匙對 → 更新；鑰匙不對（或舊的不可改機台）→ 拒絕
alter table public.machines add column if not exists updated_at timestamptz not null default now();

create table if not exists public.machine_keys (
  id text primary key references public.machines (id) on delete cascade,
  key_hash text not null
);
alter table public.machine_keys enable row level security; -- 沒有任何 policy → anon 讀不到也寫不了
revoke all on public.machine_keys from anon, authenticated;

-- 不再開放直接新增（全部走 save_machine）
drop policy if exists "machines insert" on public.machines;
revoke insert, update, delete on public.machines from anon, authenticated;

create or replace function public.save_machine(p_id text, p_key text, p_data text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  h text;
  stored text;
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  h := encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  select key_hash into stored from machine_keys where id = p_id;
  if not found then
    if exists (select 1 from machines where id = p_id) then
      raise exception 'locked' using errcode = '42501';
    end if;
    insert into machines (id, data) values (p_id, p_data);
    insert into machine_keys (id, key_hash) values (p_id, h);
  elsif stored = h then
    update machines set data = p_data, updated_at = now() where id = p_id;
  else
    raise exception 'wrong key' using errcode = '42501';
  end if;
  return p_id;
end;
$$;
revoke all on function public.save_machine(text, text, text) from public;
grant execute on function public.save_machine(text, text, text) to anon, authenticated;
