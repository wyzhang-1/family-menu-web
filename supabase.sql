-- 咕噜咕噜研究院 · Supabase 建表脚本
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query → 粘贴全部 → Run

create table if not exists public.dishes (
  id           text primary key,
  family_id    text not null,
  name         text default '',
  category     text default 'meat',
  emoji        text default '🍽',
  image        text default '',           -- 压缩后的 base64 图片
  description  text default '',
  tags         jsonb default '[]'::jsonb,
  ingredients  jsonb default '[]'::jsonb,
  seasonings   jsonb default '[]'::jsonb,
  steps        jsonb default '[]'::jsonb,
  created_at   bigint default 0,
  updated_at   bigint default 0,
  deleted      boolean default false
);

create table if not exists public.orders (
  id          text primary key,
  family_id   text not null,
  dish_id     text default '',
  name        text default '',
  image       text default '',
  emoji       text default '🍽',
  category    text default 'meat',
  qty         int default 1,
  by_list     jsonb default '[]'::jsonb,
  created_at  bigint default 0,
  updated_at  bigint default 0,
  deleted     boolean default false
);

create index if not exists dishes_family_updated on public.dishes (family_id, updated_at);
create index if not exists orders_family_updated on public.orders (family_id, updated_at);

-- 打开行级安全，然后允许匿名读写（小程序/网页没有登录，靠 family_id 隔离数据）
alter table public.dishes  enable row level security;
alter table public.orders  enable row level security;

drop policy if exists "family dishes access" on public.dishes;
create policy "family dishes access" on public.dishes
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "family orders access" on public.orders;
create policy "family orders access" on public.orders
  for all to anon, authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant all on public.dishes to anon, authenticated;
grant all on public.orders to anon, authenticated;

-- 完成。回到网页，把 Project URL 和 anon key 填进去即可。
