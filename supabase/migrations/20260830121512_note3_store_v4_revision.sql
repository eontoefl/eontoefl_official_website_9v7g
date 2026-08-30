-- Applied on 2026-08-30 as part of the approved money-distribution repair.
-- main remains the read-only legacy row; the updated client writes main-v4.
alter table if exists public.note3_store
  add column if not exists revision bigint not null default 0;

comment on column public.note3_store.revision is
  'Optimistic concurrency revision for encrypted single-blob rows such as main-v4.';
