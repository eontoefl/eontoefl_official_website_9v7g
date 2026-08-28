begin;

do $$
declare
  v_app uuid := '61000000-0000-0000-0000-000000000001';
  v_job uuid := '62000000-0000-0000-0000-000000000001';
  v_save_request uuid := '63000000-0000-0000-0000-000000000001';
  v_release_request uuid := '63000000-0000-0000-0000-000000000002';
  v_claim_one uuid := '64000000-0000-0000-0000-000000000001';
  v_claim_two uuid := '64000000-0000-0000-0000-000000000002';
  v_claim_three uuid := '64000000-0000-0000-0000-000000000003';
  v_claim_four uuid := '64000000-0000-0000-0000-000000000004';
  v_result jsonb;
  v_evidence jsonb;
  v_revision integer;
  v_reviews_before bigint;
  v_reviews_after bigint;
  v_reviews_digest_before text;
  v_reviews_digest_after text;
begin
  select count(*), md5(coalesce(string_agg(to_jsonb(r)::text, E'\n' order by to_jsonb(r)::text), ''))
    into v_reviews_before, v_reviews_digest_before
    from public.reviews r;
  if v_reviews_before <> 219 then
    raise exception 'public.reviews starting count is not 219: %', v_reviews_before;
  end if;

  insert into public.applications(id, email, name, phone, program, deleted, application_type)
  values(v_app, 'fake-admin-v6@example.invalid', '관리화면시험', '000', 'fake', false, 'book_only');

  insert into public.followup_jobs(
    id, application_id, email, stage, status, scheduled_at,
    review_started_at, review_deadline_at, next_action_at,
    attachment_asset_id, rule_version
  ) values(
    v_job, v_app, 'fake-admin-v6@example.invalid', 'stage1', 'awaiting_review', now() + interval '1 hour',
    now(), now() + interval '1 hour', now() + interval '1 hour',
    'score-conversion-2026-v1', 'followup-writing-v5'
  );

  insert into public.followup_messages(
    job_id, subject, body, review_status, attachment_asset_id, rule_version,
    validation_evidence, validation_passed_at
  ) values(
    v_job, '수정 전 제목', '수정 전 본문', 'approved', 'score-conversion-2026-v1', 'followup-writing-v5',
    '{"passed":true}'::jsonb, now()
  );

  v_result := public.followup_save_revision(
    v_job, v_save_request, '수정한 제목', '수정한 본문',
    'score-conversion-2026-v1', 'followup-writing-v5', 'representative'
  );

  if v_result->>'status' <> 'held'
     or v_result->>'held_kind' <> 'validation'
     or v_result->>'held_reason' <> '대표 수정본 재검사 대기'
     or v_result->'review_deadline_at' <> 'null'::jsonb then
    raise exception 'edited message did not move to safe revalidation hold: %', v_result;
  end if;

  select revision into v_revision from public.followup_messages where job_id = v_job;
  if v_revision <> 1
     or not exists(
       select 1 from public.followup_messages
        where job_id = v_job
          and subject = '수정한 제목'
          and body = '수정한 본문'
          and review_status = 'pending'
          and validation_evidence is null
          and validation_passed_at is null
     ) then
    raise exception 'edited message validation state mismatch';
  end if;

  perform public.followup_save_revision(
    v_job, v_save_request, '중복 요청의 다른 제목', '중복 요청의 다른 본문',
    'score-conversion-2026-v1', 'followup-writing-v5', 'representative'
  );
  if (select revision from public.followup_messages where job_id = v_job) <> 1 then
    raise exception 'same save request was applied twice';
  end if;

  v_evidence := jsonb_build_object(
    'passed', true,
    'checked_at', now(),
    'rule_version', 'followup-writing-v5',
    'content_hash', md5('수정한 제목' || E'\n' || '수정한 본문')
  );
  v_result := public.followup_release_held_revision(
    v_job, v_release_request, '수정한 제목', '수정한 본문',
    'score-conversion-2026-v1', 'followup-writing-v5', v_evidence, 'codex'
  );
  if v_result->>'status' <> 'awaiting_review'
     or (v_result->>'review_deadline_at')::timestamptz < now() + interval '59 minutes'
     or (v_result->>'review_deadline_at')::timestamptz > now() + interval '61 minutes' then
    raise exception 'passed revision did not receive a new one-hour review: %', v_result;
  end if;

  v_result := public.followup_claim_alert('test:v6:sent', 'test', '{}'::jsonb, v_claim_one);
  if not (v_result @> '{"claimed":true,"status":"claimed"}'::jsonb) then
    raise exception 'first alert claim failed: %', v_result;
  end if;
  v_result := public.followup_claim_alert('test:v6:sent', 'test', '{}'::jsonb, v_claim_two);
  if v_result->>'claimed' <> 'false' or v_result->>'status' <> 'claimed' then
    raise exception 'duplicate in-progress alert claim was not blocked: %', v_result;
  end if;
  if public.followup_finish_alert('test:v6:sent', v_claim_two, true, null) then
    raise exception 'wrong alert claim token finalized the alert';
  end if;
  if not public.followup_finish_alert('test:v6:sent', v_claim_one, true, null) then
    raise exception 'valid alert claim could not be finalized';
  end if;
  v_result := public.followup_claim_alert('test:v6:sent', 'test', '{}'::jsonb, v_claim_two);
  if v_result->>'claimed' <> 'false' or v_result->>'status' <> 'sent' then
    raise exception 'sent alert was claimable again: %', v_result;
  end if;

  v_result := public.followup_claim_alert('test:v6:retry', 'test', '{}'::jsonb, v_claim_three);
  if v_result->>'claimed' <> 'true'
     or not public.followup_finish_alert('test:v6:retry', v_claim_three, false, 'explicit Telegram rejection') then
    raise exception 'retryable alert setup failed: %', v_result;
  end if;
  v_result := public.followup_claim_alert('test:v6:retry', 'test', '{}'::jsonb, v_claim_four);
  if v_result->>'claimed' <> 'true'
     or (select attempt_count from public.followup_alert_log where alert_key = 'test:v6:retry') <> 2 then
    raise exception 'retryable alert could not be claimed once more: %', v_result;
  end if;

  select count(*), md5(coalesce(string_agg(to_jsonb(r)::text, E'\n' order by to_jsonb(r)::text), ''))
    into v_reviews_after, v_reviews_digest_after
    from public.reviews r;
  if v_reviews_after <> v_reviews_before or v_reviews_digest_after <> v_reviews_digest_before then
    raise exception 'public.reviews changed during admin v6 test';
  end if;
end;
$$;

rollback;
