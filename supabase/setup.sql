-- Clatter 轉蛋鋪：短連結＋影音分享用的 Supabase 設定（在 SQL Editor 跑一次）
-- 機台：id＝內容雜湊（10 字 base62）、data＝原本放在連結裡的 g1z.… 字串
-- 只開放「讀」跟「新增」：存過的機台不能改、不能刪 → 發出去的連結永遠是同一台
create table if not exists public.machines (
  id text primary key check (id ~ '^[0-9A-Za-z]{10}$'),
  data text not null check (length(data) between 8 and 600000 and data ~ '^g1[zn]\.[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now()
);
alter table public.machines enable row level security;
grant select, insert on public.machines to anon, authenticated;
drop policy if exists "machines readable" on public.machines;
create policy "machines readable" on public.machines for select to anon, authenticated using (true);
drop policy if exists "machines insert" on public.machines;
create policy "machines insert" on public.machines for insert to anon, authenticated with check (true);

-- 上傳的音樂／影片：公開讀取的 media 桶，單檔 50 MB，只收音樂、影片
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['audio/*', 'video/*'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "media upload" on storage.objects;
create policy "media upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'media');
