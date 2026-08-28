-- Transaction-only regression test. No fixture survives the final rollback.
begin;

insert into public.users(id,email,password,name) values
('99000000-0000-0000-0000-000000000001','candidate-cross@invalid.test','x','교차1'),
('99000000-0000-0000-0000-000000000002','CANDIDATE-CROSS@invalid.test','x','교차2'),
('99000000-0000-0000-0000-000000000003','candidate-normal@invalid.test','x','정상'),
('99000000-0000-0000-0000-000000000004','candidate-resume@invalid.test','x','재개'),
('99000000-0000-0000-0000-000000000005','candidate-contract@invalid.test','x','계약재개'),
('99000000-0000-0000-0000-000000000006','different-member-email@invalid.test','x','불일치'),
('99000000-0000-0000-0000-000000000007','candidate-mismatch@invalid.test','x','정상회원'),
('99000000-0000-0000-0000-000000000008','candidate-deleted@invalid.test','x','삭제회원'),
('99000000-0000-0000-0000-000000000009','CANDIDATE-DELETED@invalid.test','x','정상회원2');

insert into public.applications(
  id,email,name,phone,program,user_id,application_type,deleted,created_at,submitted_date
) values
('99000000-0000-0000-0000-000000000011','candidate-cross@invalid.test','교차1','010','test','99000000-0000-0000-0000-000000000001','book_only',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000012','candidate-cross@invalid.test','교차2','010','test','99000000-0000-0000-0000-000000000002','challenge',false,(extract(epoch from now()-interval '1 day')*1000)::bigint,(now()-interval '1 day')::text),
('99000000-0000-0000-0000-000000000013','candidate-normal@invalid.test','정상','010','test','99000000-0000-0000-0000-000000000003','book_only',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000014','candidate-normal@invalid.test','정상','010','test','99000000-0000-0000-0000-000000000003','challenge',false,(extract(epoch from now()-interval '1 day')*1000)::bigint,(now()-interval '1 day')::text),
('99000000-0000-0000-0000-000000000015','legacy-reply@invalid.test','옛답장','010','test',null,'challenge',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000020','tie-reply@invalid.test','옛신청','010','test',null,'challenge',false,(extract(epoch from now()-interval '3 days')*1000)::bigint,(now()-interval '3 days')::text),
('99000000-0000-0000-0000-000000000016','tie-reply@invalid.test','동률입문','010','test',null,'book_only',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000017','tie-reply@invalid.test','동률내챌','010','test',null,'challenge',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000018','candidate-resume@invalid.test','재개','010','test','99000000-0000-0000-0000-000000000004','challenge',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000019','candidate-contract@invalid.test','계약재개','010','test','99000000-0000-0000-0000-000000000005','challenge',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000024','candidate-resume@invalid.test','새신청','010','test','99000000-0000-0000-0000-000000000004','book_only',false,(extract(epoch from now()-interval '1 hour')*1000)::bigint,(now()-interval '1 hour')::text),
('99000000-0000-0000-0000-000000000031','candidate-mismatch@invalid.test','불일치번호','010','test','99000000-0000-0000-0000-000000000006','book_only',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000032','candidate-mismatch@invalid.test','정상번호','010','test','99000000-0000-0000-0000-000000000007','challenge',false,(extract(epoch from now()-interval '1 day')*1000)::bigint,(now()-interval '1 day')::text),
('99000000-0000-0000-0000-000000000033','candidate-admin@invalid.test','공용번호','010','test','admin-account','book_only',false,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000034','candidate-deleted@invalid.test','삭제신청','010','test','99000000-0000-0000-0000-000000000008','book_only',true,(extract(epoch from now()-interval '2 days')*1000)::bigint,(now()-interval '2 days')::text),
('99000000-0000-0000-0000-000000000035','candidate-deleted@invalid.test','정상신청','010','test','99000000-0000-0000-0000-000000000009','challenge',false,(extract(epoch from now()-interval '1 day')*1000)::bigint,(now()-interval '1 day')::text);

update public.applications
set resume_approved_at=now(), resume_approved_stage='동의',
    analysis_status='승인', analysis_content='시험 분석'
where id='99000000-0000-0000-0000-000000000018';
update public.applications
set resume_approved_at=now(), resume_approved_stage='계약',
    student_agreed_at=now()::text, contract_sent=true,
    contract_sent_at=(extract(epoch from now()-interval '3 days')*1000)::bigint
where id='99000000-0000-0000-0000-000000000019';

insert into public.followup_activity_logs(id,job_id,event,detail,source,source_event_id,occurred_at)
values
('99000000-0000-0000-0000-000000000021',null,'reply',jsonb_build_object('email','legacy-reply@invalid.test','received',(now()-interval '1 day')::text),'gmail','legacy-safe',now()-interval '1 day'),
('99000000-0000-0000-0000-000000000022',null,'reply',jsonb_build_object('email','tie-reply@invalid.test','received',(now()-interval '1 day')::text),'gmail','legacy-tie',now()-interval '1 day'),
('99000000-0000-0000-0000-000000000023',null,'reply',jsonb_build_object('email','tie-reply@invalid.test','received',(now()-interval '60 hours')::text),'gmail','legacy-safe-same-email',now()-interval '60 hours');

-- Simulate issues written by the old arbitrary-link rule. The next full scan
-- must resolve only the safe activity and must clear the ambiguous one's old link.
insert into public.followup_candidate_issues(
  id,issue_key,application_id,normalized_email,issue_type,status,reason,detail,
  first_detected_at,last_detected_at
) values
('99000000-0000-0000-0000-000000000041','candidate:unlinked_reply:99000000-0000-0000-0000-000000000023','99000000-0000-0000-0000-000000000020','tie-reply@invalid.test','unlinked_reply','held','unlinked_reply',jsonb_build_object('activity_log_id','99000000-0000-0000-0000-000000000023'),now(),now()),
('99000000-0000-0000-0000-000000000042','candidate:unlinked_reply:99000000-0000-0000-0000-000000000022','99000000-0000-0000-0000-000000000020','tie-reply@invalid.test','unlinked_reply','held','unlinked_reply',jsonb_build_object('activity_log_id','99000000-0000-0000-0000-000000000022'),now(),now());

create temporary table candidate_preview_test on commit drop as
select * from public.followup_candidate_preview(now());

do $test$
declare
  v_blocked boolean := false;
  v_request_at timestamptz := date_trunc('milliseconds', now());
  v_rows integer;
begin
  if (select count(*) from public.reviews) <> 219 then
    raise exception 'public.reviews is not the protected 219 rows';
  end if;

  if not public.followup_candidate_email_has_multiple_members('candidate-cross@invalid.test') then
    raise exception 'cross-member normalized email was not detected';
  end if;
  if public.followup_candidate_email_has_multiple_members('candidate-normal@invalid.test') then
    raise exception 'normal sequential applications were falsely marked as cross-member';
  end if;
  if public.followup_candidate_email_has_multiple_members('candidate-mismatch@invalid.test') then
    raise exception 'mismatched member email was trusted';
  end if;
  if public.followup_candidate_email_has_multiple_members('candidate-admin@invalid.test') then
    raise exception 'admin-account was trusted as a member';
  end if;
  if public.followup_candidate_email_has_multiple_members('candidate-deleted@invalid.test') then
    raise exception 'deleted application was counted';
  end if;
  if not exists (
    select 1 from candidate_preview_test
    where application_id='99000000-0000-0000-0000-000000000012'
      and decision='held' and reason='member_email_conflict'
  ) then raise exception 'cross-member challenge was not held'; end if;
  if exists (
    select 1 from candidate_preview_test
    where application_id='99000000-0000-0000-0000-000000000014'
      and reason='member_email_conflict'
  ) then raise exception 'normal sequential applications regressed'; end if;

  if public.followup_candidate_reply_application(
    'legacy-reply@invalid.test',now()-interval '1 day'
  ) is distinct from '99000000-0000-0000-0000-000000000015'::uuid then
    raise exception 'safe legacy reply did not link to the unique latest prior application';
  end if;
  if not exists (
    select 1 from candidate_preview_test
    where application_id='99000000-0000-0000-0000-000000000015'
      and decision='excluded' and reason='prior_reply_for_current_flow'
  ) then raise exception 'safe legacy reply was not excluded'; end if;
  if public.followup_candidate_reply_application(
    'tie-reply@invalid.test',now()-interval '1 day'
  ) is not null then raise exception 'tied latest applications were selected arbitrarily'; end if;
  if public.followup_candidate_reply_application(
    'legacy-reply@invalid.test',
    to_timestamp((select created_at from public.applications
      where id='99000000-0000-0000-0000-000000000015') / 1000.0)
  ) is not null then raise exception 'equal application/reply time was treated as safely prior'; end if;

  if not exists (
    select 1 from candidate_preview_test
    where application_id='99000000-0000-0000-0000-000000000018'
      and stage='stage2' and decision='excluded' and reason='resume_approved'
  ) then raise exception 'analysis-stage resume approval did not stop stage2'; end if;
  if exists (
    select 1 from candidate_preview_test
    where application_id='99000000-0000-0000-0000-000000000018'
      and stage<>'stage2' and reason='resume_approved'
  ) then raise exception 'analysis-stage resume approval blocked another stage'; end if;
  if not exists (
    select 1 from candidate_preview_test
    where application_id='99000000-0000-0000-0000-000000000019'
      and stage='stage3a' and decision='excluded' and reason='resume_approved'
  ) then raise exception 'contract-stage resume approval did not stop stage3a'; end if;
  if exists (
    select 1 from candidate_preview_test
    where application_id='99000000-0000-0000-0000-000000000019'
      and stage<>'stage3a' and reason='resume_approved'
  ) then raise exception 'contract-stage resume approval blocked another stage'; end if;
  if public.followup_candidate_resume_approved_for_stage('stage2',now(),'알수없음') then
    raise exception 'unknown resume approval stage was accepted';
  end if;
  if public.followup_candidate_resume_approved_for_stage(
    'stage2',
    (select resume_approved_at from public.applications where id='99000000-0000-0000-0000-000000000024'),
    (select resume_approved_stage from public.applications where id='99000000-0000-0000-0000-000000000024')
  ) then raise exception 'old approval leaked to a new application with the same email'; end if;

  -- The applicant role must not be able to forge or erase approval fields.
  begin
    execute 'set local role authenticated';
    update public.applications
    set resume_approved_at=now(), resume_approved_stage='동의'
    where id='99000000-0000-0000-0000-000000000024';
    execute 'reset role';
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  execute 'reset role';
  if not v_blocked then raise exception 'applicant role changed approval fields'; end if;

  -- This is the same one-statement condition used by the Telegram button.
  update public.applications
  set resume_requested_at=v_request_at, resume_stage='동의'
  where id='99000000-0000-0000-0000-000000000024';
  update public.applications
  set resume_requested_at=null, resume_approved_at=now(), resume_approved_stage='동의'
  where id='99000000-0000-0000-0000-000000000024'
    and resume_requested_at=v_request_at and resume_stage='동의';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'first resume approval did not claim the request'; end if;
  update public.applications
  set resume_requested_at=null, resume_approved_at=now(), resume_approved_stage='동의'
  where id='99000000-0000-0000-0000-000000000024'
    and resume_requested_at=v_request_at and resume_stage='동의';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'duplicate resume approval claimed the same request'; end if;
end;
$test$;

-- Exercise the real recorder, not only its text. All writes roll back.
update public.followup_runtime
set operation_mode='draft_only', test_email=null, send_locked=true;
update public.followup_candidate_state
set last_production_scan_at=now()-interval '1 minute',
    production_baseline_at=coalesce(production_baseline_at,now()-interval '2 minutes');
select public.followup_record_candidates(gen_random_uuid(),clock_timestamp());

do $test$
begin
  if exists (
    select 1 from public.followup_candidate_issues
    where issue_key='candidate:unlinked_reply:99000000-0000-0000-0000-000000000023'
      and status='held'
  ) then raise exception 'safe reply issue remained held'; end if;
  if not exists (
    select 1 from public.followup_candidate_issues
    where issue_key='candidate:unlinked_reply:99000000-0000-0000-0000-000000000022'
      and status='held' and application_id is null
      and detail->>'activity_log_id'='99000000-0000-0000-0000-000000000022'
  ) then raise exception 'ambiguous reply issue was resolved or kept an arbitrary application'; end if;
  if position(
    'application_id = excluded.application_id' in
    pg_get_functiondef('public.followup_record_candidates(uuid,timestamptz)'::regprocedure)
  ) = 0 then raise exception 'unlinked reply issue refresh was not installed'; end if;
end;
$test$;

rollback;
