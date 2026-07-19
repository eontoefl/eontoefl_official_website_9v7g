-- correction_deadline_extensions: 연장 대상 차수(1차/2차) 구분
--
-- 기존에는 관리자 모달에서 1차/2차를 고를 수 있었지만 저장되지 않아
-- 어느 쪽을 고르든 1차·2차 마감이 함께 연장되었다.
--
-- 기존 행은 draft_round = NULL 로 남으며, NULL 은 "둘 다"로 해석한다.
-- (지금까지의 동작과 동일 → 이미 나간 연장이 바뀌지 않는다)

alter table public.correction_deadline_extensions
    add column if not exists draft_round smallint;

comment on column public.correction_deadline_extensions.draft_round is
    '연장 대상 차수: 1=1차만, 2=2차만, NULL=둘 다(마이그레이션 이전 행)';

alter table public.correction_deadline_extensions
    drop constraint if exists correction_deadline_extensions_draft_round_check;

alter table public.correction_deadline_extensions
    add constraint correction_deadline_extensions_draft_round_check
    check (draft_round is null or draft_round in (1, 2));
