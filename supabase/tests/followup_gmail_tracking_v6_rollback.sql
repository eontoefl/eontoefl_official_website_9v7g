begin;

do $$
declare
  v_app uuid := '61000000-0000-0000-0000-000000000001';
  v_job uuid := '62000000-0000-0000-0000-000000000001';
  v_book uuid := '61000000-0000-0000-0000-000000000002';
  v_challenge uuid := '61000000-0000-0000-0000-000000000003';
  v_stage1_job uuid := '62000000-0000-0000-0000-000000000002';
  v_run uuid := '63000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_claim jsonb;
  v_lock uuid;
  v_subject text := '시험님, 개별분석 관련해서 연락드립니다!';
  v_body text := '시험용 발송 직전 검사 본문입니다. :)'||E'\n이온 드림\nhttps://eonfl.com/application-detail.html?id=61000000-0000-0000-0000-000000000001#step2';
  v_machine jsonb := jsonb_build_object('pass',true,'results',(
    select jsonb_agg(jsonb_build_object('check',x,'pass',true,'reason','통과','evidence','가짜 시험 근거') order by ord)
    from unnest(array['길이',':) 필수','이온드림','제목형식','후기id↔숫자','CTA정합','링크형식','점수병기','환산표첨부','본문날짜','금지어·부호·담화예고'])
      with ordinality u(x,ord)));
  v_human jsonb := jsonb_build_object('measured',true,'pass',true,'checks',(
    select jsonb_agg(jsonb_build_object('check',x,'pass',true,'reason','통과','evidence','가짜 사람판단 근거') order by ord)
    from unnest(array['tone','story','duplicate','date_stage','one_to_one']) with ordinality u(x,ord)));
  v_reviews_count bigint;
  v_reviews_digest text;
begin
  select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),''))
  into v_reviews_count,v_reviews_digest from public.reviews r;
  if v_reviews_count<>219 then raise exception 'reviews baseline mismatch'; end if;

  update public.followup_runtime set operation_mode='test_one',send_locked=false,
    test_email='fake-v6-send@example.invalid',missed_run_monitor_enabled=false
  where singleton_id=1;

  insert into public.applications(id,email,name,phone,program,deleted,application_type,
    analysis_status,analysis_content,analysis_first_saved_at,student_program_agreed,student_agreed_at)
  values(v_app,'fake-v6-send@example.invalid','김시험','000','fake',false,'challenge',
    '승인','가짜 개별분석입니다.',(extract(epoch from now()-interval '68 hours')*1000)::bigint,false,'');

  insert into public.followup_jobs(id,application_id,email,stage,status,scheduled_at,deadline_snapshot,
    review_started_at,review_deadline_at,next_action_at,eligible_at,draft_due_at,fresh_until_at,
    candidate_first_seen_at,candidate_basis,rule_version)
  values(v_job,v_app,'fake-v6-send@example.invalid','stage2','awaiting_review',now(),now()-interval '44 hours',
    now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 minute',now()-interval '8 hours',
    now()-interval '9 hours',now()+interval '4 hours',now()-interval '9 hours','{}'::jsonb,'v6-test');
  insert into public.followup_messages(job_id,subject,body,review_status,rule_version,revision,
    validation_evidence,validation_passed_at)
  values(v_job,v_subject,v_body,'pending','v6-test',1,'{}'::jsonb,now()-interval '1 hour');

  perform public.followup_start_run(v_run,'v6-rollback-test');
  v_result:=public.followup_record_send_validation(v_job,
    '64000000-0000-0000-0000-000000000001',jsonb_build_object(
      'passed',true,'checked_at',now(),'gmail_reply_checked_at',now(),
      'content_hash',md5(v_subject||E'\n'||v_body),'machine',v_machine,'human',v_human));
  if v_result->>'outcome'<>'passed' then raise exception 'send validation did not pass: %',v_result; end if;

  v_claim:=public.followup_claim_send_v6(v_job,v_run,'v6-rollback-test',600);
  if v_claim->>'outcome'<>'claimed' then raise exception 'send claim failed: %',v_claim; end if;
  v_lock:=(v_claim#>>'{job,lock_token}')::uuid;
  perform public.followup_reserve_gmail_send(v_job,v_lock,'v6-idempotency-1');
  perform public.followup_attach_gmail_draft(v_job,v_lock,'v6-idempotency-1','v6-draft-1');
  v_result:=public.followup_final_send_check(v_job,v_lock);
  if coalesce((v_result->>'ready')::boolean,false) is not true then
    raise exception 'final send check failed: %',v_result;
  end if;
  perform public.followup_mark_sent(v_job,v_lock,'v6-message-1','v6-thread-1');
  if (select status from public.followup_jobs where id=v_job)<>'sent' then raise exception 'mark sent failed'; end if;

  v_result:=public.followup_claim_send_v6(v_job,
    '63000000-0000-0000-0000-000000000002','second-worker',600);
  if v_result->>'outcome'<>'not_claimed' then raise exception 'second claim was not blocked: %',v_result; end if;

  v_result:=public.followup_record_gmail_reply('v6-thread-1','v6-reply-1',
    'fake-v6-send@example.invalid',now(),'human','{}'::jsonb,v_run);
  if coalesce((v_result->>'recorded')::boolean,false) is not true
     or coalesce((v_result->>'attributed')::boolean,false) is not true then
    raise exception 'human reply was not attributed: %',v_result;
  end if;
  v_result:=public.followup_record_gmail_reply('v6-thread-1','v6-reply-1',
    'fake-v6-send@example.invalid',now(),'human','{}'::jsonb,v_run);
  if v_result->>'reason'<>'duplicate' then raise exception 'reply idempotency failed: %',v_result; end if;
  v_result:=public.followup_record_gmail_reply('v6-thread-1','v6-auto-1',
    'fake-v6-send@example.invalid',now(),'auto_reply','{}'::jsonb,v_run);
  if v_result->>'classification'<>'auto_reply' or coalesce((v_result->>'canceled')::boolean,true) then
    raise exception 'auto reply handling failed: %',v_result;
  end if;

  insert into public.applications(id,email,name,phone,program,deleted,application_type,created_at)
  values(v_book,'fake-v6-outcome@example.invalid','이성과','000','fake',false,'book_only',
      (extract(epoch from now()-interval '10 days')*1000)::bigint),
    (v_challenge,'fake-v6-outcome@example.invalid','이성과','000','fake',false,'challenge',
      (extract(epoch from now()-interval '1 hour')*1000)::bigint);
  insert into public.followup_jobs(id,application_id,email,stage,status,scheduled_at,sent_at,
    gmail_message_id,gmail_thread_id,candidate_first_seen_at,candidate_basis)
  values(v_stage1_job,v_book,'fake-v6-outcome@example.invalid','stage1','sent',now()-interval '2 hours',
    now()-interval '2 hours','v6-message-2','v6-thread-2',now()-interval '3 hours','{}'::jsonb);
  insert into public.followup_messages(job_id,subject,body,review_status,revision)
  values(v_stage1_job,'성과 시험','성과 시험 본문','pending',1);

  v_result:=public.followup_record_student_outcome(v_challenge,'application','v6-application-exact-7d',
    (select sent_at+interval '7 days' from public.followup_jobs where id=v_stage1_job),'{}'::jsonb,v_run);
  if coalesce((v_result->>'recorded')::boolean,false) is not true
     or coalesce((v_result->>'attributed')::boolean,false) is not true then
    raise exception 'exact seven-day attribution failed: %',v_result;
  end if;
  v_result:=public.followup_record_student_outcome(v_challenge,'contract_consent','v6-contract-after-7d',
    (select sent_at+interval '7 days 1 second' from public.followup_jobs where id=v_stage1_job),'{}'::jsonb,v_run);
  if coalesce((v_result->>'recorded')::boolean,false) is not true
     or coalesce((v_result->>'attributed')::boolean,true) is not false then
    raise exception 'after-seven-day history handling failed: %',v_result;
  end if;

  update public.followup_tracking_state set last_student_scan_at=now()-interval '2 hours' where singleton_id=1;
  v_result:=public.followup_sync_student_outcomes(v_run,now());
  if (v_result->>'recorded')::integer<1 then raise exception 'student outcome sync recorded nothing: %',v_result; end if;
  v_result:=public.followup_sync_student_outcomes(v_run,now());
  if (v_result->>'recorded')::integer<>0 then raise exception 'student outcome sync duplicated events: %',v_result; end if;

  perform public.followup_advance_gmail_scan(now()-interval '1 hour',now());
  if (select last_gmail_scan_at from public.followup_tracking_state where singleton_id=1)<now()-interval '1 minute' then
    raise exception 'Gmail scan cursor did not advance';
  end if;

  perform public.followup_finish_run(v_run,true,null);
  if (select count(*) from public.reviews)<>v_reviews_count
     or (select md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from public.reviews r)<>v_reviews_digest then
    raise exception 'public.reviews changed';
  end if;
end $$;

rollback;
