-- 第 3 步：庫存大家共用、記錄被轉走幾個；只有開店的人能補貨（在 02_editable.sql 之後跑一次）
-- machines.stock：{ 獎品 key: 放進機台的數量 }（save_machine 跟機台內容一起存）
-- pulls：每個獎品被轉走幾個；剩下＝stock − pulls
-- pull()：買家投完幣 → 伺服器照剩下的數量抽（鎖住這台機器，不會兩個人抽到同一顆最後的）
-- restock()：開店的人（鑰匙對）把被轉走的紀錄歸零＝補滿
alter table public.machines add column if not exists stock jsonb not null default '{}'::jsonb;

create table if not exists public.pulls (
  machine_id text not null references public.machines (id) on delete cascade,
  item text not null check (length(item) between 1 and 40),
  n int not null default 0 check (n >= 0),
  primary key (machine_id, item)
);
alter table public.pulls enable row level security;
revoke all on public.pulls from anon, authenticated;
grant select on public.pulls to anon, authenticated;
drop policy if exists "pulls readable" on public.pulls;
create policy "pulls readable" on public.pulls for select to anon, authenticated using (true);

-- 鑰匙檢查（save_machine、restock 共用）：null＝還沒有這台、true＝對、false＝不對
create or replace function public.machine_key_ok(p_id text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  select key_hash into stored from machine_keys where id = p_id;
  if not found then
    return null;
  end if;
  return stored = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
end;
$$;
revoke all on function public.machine_key_ok(text, text) from public, anon, authenticated;

drop function if exists public.save_machine(text, text, text);
create or replace function public.save_machine(p_id text, p_key text, p_data text, p_stock jsonb default '{}'::jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  k text;
begin
  if p_id !~ '^[0-9A-Za-z]{10}$' or p_key !~ '^[A-Za-z0-9_-]{20,64}$' or jsonb_typeof(p_stock) <> 'object' then
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
  ok := machine_key_ok(p_id, p_key);
  if ok is null then
    if exists (select 1 from machines where id = p_id) then
      raise exception 'locked' using errcode = '42501';
    end if;
    insert into machines (id, data, stock) values (p_id, p_data, p_stock);
    insert into machine_keys (id, key_hash) values (p_id, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'));
  elsif ok then
    update machines set data = p_data, stock = p_stock, updated_at = now() where id = p_id;
  else
    raise exception 'wrong key' using errcode = '42501';
  end if;
  return p_id;
end;
$$;
revoke all on function public.save_machine(text, text, text, jsonb) from public;
grant execute on function public.save_machine(text, text, text, jsonb) to anon, authenticated;

create or replace function public.pull(p_id text, p_n int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  st jsonb;
  rem jsonb := '{}'::jsonb;
  keys text[];
  k text;
  total int := 0;
  cnt int;
  r int;
  acc int;
  picks text[] := '{}';
begin
  if p_n is null or p_n < 1 or p_n > 10 then
    raise exception 'bad request' using errcode = '22023';
  end if;
  select stock into st from machines where id = p_id for update; -- 同一台機器一次只讓一個人抽
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(x order by x), '{}') into keys from jsonb_object_keys(st) as x;
  foreach k in array keys loop
    cnt := greatest(0, (st ->> k)::int - coalesce((select n from pulls where machine_id = p_id and item = k), 0));
    rem := rem || jsonb_build_object(k, cnt);
    total := total + cnt;
  end loop;
  for i in 1 .. least(p_n, total) loop
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
  return jsonb_build_object('picks', to_jsonb(picks), 'remaining', rem);
end;
$$;
revoke all on function public.pull(text, int) from public;
grant execute on function public.pull(text, int) to anon, authenticated;

create or replace function public.restock(p_id text, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if machine_key_ok(p_id, p_key) is not true then
    raise exception 'wrong key' using errcode = '42501';
  end if;
  delete from pulls where machine_id = p_id;
end;
$$;
revoke all on function public.restock(text, text) from public;
grant execute on function public.restock(text, text) to anon, authenticated;
