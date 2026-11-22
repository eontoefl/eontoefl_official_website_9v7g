-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2a: 파일 기준선 내리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서는 같은 폴더의 절차.md 를 따른다.
-- 운영에는 절대 실행하지 않는다(운영의 실제 파일 규칙 26개와 이름이 같다 — 운영에서 실행하면 그 규칙이 지워진다).
--
--   * baseline_up.sql 이 만든 규칙 26개만 이름으로 지운다. if exists 를 쓰지 않는다 —
--     하나라도 없으면 그 자리에서 실패하고, 한 트랜잭션이므로 아무것도 지워지지 않는다.
--   * 버킷은 지우지 않는다. 버킷 지우기는 measure.mjs 의 baseline-buckets-remove 단계가 API 로 한다
--     (객체가 남아 있는 버킷은 지우지 않고 멈춘다).
--   * 임시 규칙(zz_b2n2a_)은 probe_down.sql 이 지운다. storage.objects 의 행·권한·RLS 설정은 건드리지 않는다.
--   * 이 조각의 정상 절차는 기준선을 남긴다(다음 조각 2-나-2b 가 쓴다). 이 파일은 기준선을 다시 만들거나
--     걷어내야 할 때만 쓴다.
--
-- 실행 방법: 같은 접속에서 먼저  set b2n2a.test_project_ref = 'hmncdheiwqwekdbtijar';
-- =====================================================================

begin;

do $b2n2a_pre$
begin
  if coalesce(pg_catalog.current_setting('b2n2a.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'b2n2a 기준선 내리기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b2n2a.test_project_ref 를 먼저 실행할 것';
  end if;
end;
$b2n2a_pre$;

drop policy "Allow Upload b9j0vg_0" on storage.objects;
drop policy "Allow authenticated read on books" on storage.objects;
drop policy "Allow public read" on storage.objects;
drop policy "Allow public upload" on storage.objects;
drop policy "Allow read from correction-audio" on storage.objects;
drop policy "Allow update in correction-audio" on storage.objects;
drop policy "Allow upload to correction-audio" on storage.objects;
drop policy "Public Read b9j0vg_0" on storage.objects;
drop policy "allow public read iqdobt_0" on storage.objects;
drop policy "allow public upload og9vps_0" on storage.objects;
drop policy "allow public upload og9vps_1" on storage.objects;
drop policy "allow public upload og9vps_2" on storage.objects;
drop policy "allow public upload og9vps_3" on storage.objects;
drop policy "allow upload iqdobt_0" on storage.objects;
drop policy "allow_public_select" on storage.objects;
drop policy "allow_public_upload" on storage.objects;
drop policy "board-images public insert" on storage.objects;
drop policy "board-images public read" on storage.objects;
drop policy "board-images public update" on storage.objects;
drop policy "pb_book_private_delete" on storage.objects;
drop policy "pb_book_private_insert" on storage.objects;
drop policy "pb_book_private_select" on storage.objects;
drop policy "pb_book_private_update" on storage.objects;
drop policy "toefl_scores_delete" on storage.objects;
drop policy "toefl_scores_read" on storage.objects;
drop policy "toefl_scores_upload" on storage.objects;

commit;
