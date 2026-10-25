-- 第 5 步：我的商店用 — 每台機台賣了多少（錢包「賣出」明細的加總；要錢包鑰匙）
create or replace function public.wallet_sales(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if wallet_key_ok(p_id, p_key) is not true then
    raise exception 'wrong key' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(machine_id, jsonb_build_object('coins', s, 'n', c))
    from (
      select machine_id, sum(delta)::int as s, sum(n)::int as c
      from ledger
      where wallet = p_id and kind = 'sell' and machine_id is not null
      group by machine_id
    ) t
  ), '{}'::jsonb);
end;
$$;
revoke all on function public.wallet_sales(text, text) from public;
grant execute on function public.wallet_sales(text, text) to anon, authenticated;
