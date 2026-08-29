-- 단계별 샘플 기능을 폐기한다. 실제 followup_jobs와 public.reviews는 건드리지 않는다.
drop table if exists public.followup_sample_previews;
