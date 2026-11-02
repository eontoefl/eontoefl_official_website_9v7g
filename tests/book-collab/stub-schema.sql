-- 시험용: 운영 DB 읽기검증(2026-11-02)에서 확인한 기존 입문서 테이블과 Supabase 기본 권한 흉내
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  test_password text
);

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.tr_book_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'pdf',
  role text default 'etc',
  storage_path text,
  total_pages integer default 0,
  toc jsonb default '[]'::jsonb,
  sort_order integer default 0,
  is_active boolean default true,
  audience_mode text not null default 'all',
  allow_print boolean not null default false,
  view_confirm boolean not null default false,
  description text,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.tr_book_pages (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.tr_book_documents(id) on delete cascade,
  sort_order integer not null default 0,
  html text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.tr_book_page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.tr_book_pages(id) on delete cascade,
  book_id uuid not null references public.tr_book_documents(id) on delete cascade,
  html text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz default now()
);
create table public.tr_book_memos (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  book_id uuid not null references public.tr_book_documents(id) on delete cascade,
  page_number integer,
  page_uid uuid references public.tr_book_pages(id) on delete cascade,
  week integer,
  day text,
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, book_id, page_number)
);
create table public.tr_book_progress (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  book_id uuid not null references public.tr_book_documents(id) on delete cascade,
  last_page integer default 1,
  max_page_reached integer default 1,
  bookmarks jsonb default '[]'::jsonb,
  is_completed boolean default false,
  completed_at timestamptz,
  view_confirmed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, book_id)
);
create table public.tr_book_access (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.tr_book_documents(id) on delete cascade,
  user_id uuid,
  student_name text,
  student_email text,
  created_by text,
  created_at timestamptz default now(),
  unique (book_id, user_id)
);
