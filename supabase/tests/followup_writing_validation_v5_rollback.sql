begin;

do $$
declare
  v_book_attach uuid := '51000000-0000-0000-0000-000000000001';
  v_book_level uuid := '51000000-0000-0000-0000-000000000002';
  v_challenge uuid := '51000000-0000-0000-0000-000000000003';
  v_retry_app uuid := '51000000-0000-0000-0000-000000000004';
  v_human_app uuid := '51000000-0000-0000-0000-000000000005';
  v_check_app uuid := '51000000-0000-0000-0000-000000000006';
  v_space_app uuid := '51000000-0000-0000-0000-000000000007';
  v_invalid_app uuid := '51000000-0000-0000-0000-000000000008';
  v_job_attach uuid := '52000000-0000-0000-0000-000000000001';
  v_job_level uuid := '52000000-0000-0000-0000-000000000002';
  v_job_s2 uuid := '52000000-0000-0000-0000-000000000003';
  v_job_s3a uuid := '52000000-0000-0000-0000-000000000004';
  v_job_s3b uuid := '52000000-0000-0000-0000-000000000005';
  v_job_retry uuid := '52000000-0000-0000-0000-000000000006';
  v_job_human uuid := '52000000-0000-0000-0000-000000000007';
  v_job_check uuid := '52000000-0000-0000-0000-000000000008';
  v_job_space uuid := '52000000-0000-0000-0000-000000000009';
  v_job_invalid uuid := '52000000-0000-0000-0000-000000000010';
  v_context jsonb;
  v_context2 jsonb;
  v_result jsonb;
  v_review record;
  v_rejected boolean;
  v_machine_pass jsonb := jsonb_build_object('pass',true,'results',(
    select jsonb_agg(jsonb_build_object(
      'check',x,'pass',true,'reason','통과','evidence','가짜 시험 근거') order by ord)
    from unnest(array['길이',':) 필수','이온드림','제목형식','후기id↔숫자','CTA정합','링크형식','점수병기','환산표첨부','본문날짜','금지어·부호·담화예고'])
      with ordinality u(x,ord)));
  v_machine_fail jsonb := jsonb_build_object('pass',false,'results',(
    select jsonb_agg(jsonb_build_object(
      'check',x,'pass',x<>'길이','reason',case when x='길이' then '길이 실패' else '통과' end,
      'evidence','가짜 시험 근거') order by ord)
    from unnest(array['길이',':) 필수','이온드림','제목형식','후기id↔숫자','CTA정합','링크형식','점수병기','환산표첨부','본문날짜','금지어·부호·담화예고'])
      with ordinality u(x,ord)));
  v_machine_missing jsonb := jsonb_build_object('pass',true,'results',(
    select jsonb_agg(jsonb_build_object(
      'check',x,'pass',true,'reason','통과','evidence',case when ord=1 then '' else '가짜 시험 근거' end) order by ord)
    from unnest(array['길이',':) 필수','이온드림','제목형식','후기id↔숫자','CTA정합','링크형식','점수병기','환산표첨부','본문날짜','금지어·부호·담화예고'])
      with ordinality u(x,ord)));
  v_machine_bad_names jsonb := jsonb_build_object('pass',true,'results',(
    select jsonb_agg(jsonb_build_object(
      'check',x,'pass',true,'reason','통과','evidence','가짜 시험 근거') order by ord)
    from unnest(array['길이',':) 필수','이온드림','제목형식','후기id↔숫자','CTA정합','링크형식','점수병기','환산표첨부','본문날짜','금지어·부호·담화예고','길이','추가검사'])
      with ordinality u(x,ord)));
  v_human_pass jsonb := jsonb_build_object('measured',true,'pass',true,'checks',(
    select jsonb_agg(jsonb_build_object(
      'check',x,'pass',true,'reason','통과','evidence','가짜 사람판단 근거') order by ord)
    from unnest(array['tone','story','duplicate','date_stage','one_to_one']) with ordinality u(x,ord)));
  v_human_fail jsonb := jsonb_build_object('measured',true,'pass',false,'checks',(
    select jsonb_agg(jsonb_build_object(
      'check',x,'pass',x<>'tone','reason',case when x='tone' then '말투 실패' else '통과' end,
      'evidence','가짜 사람판단 근거') order by ord)
    from unnest(array['tone','story','duplicate','date_stage','one_to_one']) with ordinality u(x,ord)));
  v_human_missing jsonb := jsonb_build_object('measured',true,'pass',true,'checks',(
    select jsonb_agg(jsonb_build_object(
      'check',x,'pass',true,'reason',case when ord=1 then '' else '통과' end,
      'evidence','가짜 사람판단 근거') order by ord)
    from unnest(array['tone','story','duplicate','date_stage','one_to_one']) with ordinality u(x,ord)));
  v_human_bad_names jsonb := jsonb_build_object('measured',true,'pass',true,'checks',(
    select jsonb_agg(jsonb_build_object(
      'check',x,'pass',true,'reason','통과','evidence','가짜 사람판단 근거') order by ord)
    from unnest(array['tone','story','duplicate','date_stage','one_to_one','tone','extra']) with ordinality u(x,ord)));
  v_subject text;
  v_body text;
  v_started timestamptz;
  v_deadline timestamptz;
  v_reviews_before bigint;
  v_reviews_after bigint;
  v_reviews_digest_before text;
  v_reviews_digest_after text;
begin
  if not exists(select 1 from public.followup_runtime where singleton_id=1 and operation_mode='observe' and send_locked) then
    raise exception 'runtime safety lock mismatch';
  end if;
  select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),''))
    into v_reviews_before,v_reviews_digest_before from public.reviews r;
  if v_reviews_before<>219 then
    raise exception 'public.reviews starting count is not 219: %',v_reviews_before;
  end if;

  insert into public.applications(id,email,name,phone,program,deleted,application_type,current_score,target_score,
    referral_source,stuck_area,analysis_status,analysis_content)
  values
    (v_book_attach,'fake-v5-attach@example.invalid','김첨부','000','fake',false,'book_only',68,null,'블로그','리딩',null,null),
    (v_book_level,'fake-v5-level@example.invalid','이비첨','000','fake',false,'book_only',81,'5.0','검색','스피킹',null,null),
    (v_challenge,'fake-v5-flow@example.invalid','박흐름','000','fake',false,'challenge',null,null,null,null,'승인','스피킹 답변에서 필러가 반복되어 전달이 끊긴다는 분석입니다.'),
    (v_retry_app,'fake-v5-retry@example.invalid','최재작','000','fake',false,'challenge',null,null,null,null,'승인','가짜 검사 실패 자료입니다.'),
    (v_human_app,'fake-v5-human@example.invalid','정사람','000','fake',false,'challenge',null,null,null,null,'승인','가짜 사람 판단 실패 자료입니다.'),
    (v_check_app,'fake-v5-check@example.invalid','한검사','000','fake',false,'challenge',null,null,null,null,'승인','검사 형식 반대 시험 자료입니다.'),
    (v_space_app,'fake-v5-space@example.invalid','Jane Doe','000','fake',false,'challenge',null,null,null,null,'승인','공백 이름 시험 자료입니다.'),
    (v_invalid_app,'fake-v5-invalid@example.invalid','Cher','000','fake',false,'book_only',70,90,null,'리딩',null,null);

  insert into public.followup_jobs(id,application_id,email,stage,status,progress_percent,scheduled_at,deadline_snapshot,
    eligible_at,draft_due_at,fresh_until_at,candidate_first_seen_at,candidate_basis)
  values
    (v_job_attach,v_book_attach,'fake-v5-attach@example.invalid','stage1','scheduled',40,now()+interval '2 days',null,now()-interval '1 hour',now()-interval '1 minute',now()+interval '7 days',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at',now()+interval '2 days')),
    (v_job_level,v_book_level,'fake-v5-level@example.invalid','stage1','scheduled',40,now()+interval '2 days',null,now()-interval '1 hour',now()-interval '1 minute',now()+interval '7 days',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at',now()+interval '2 days')),
    (v_job_s2,v_challenge,'fake-v5-flow@example.invalid','stage2','scheduled',null,now()+interval '2 days',now()+interval '1 day',now()-interval '1 hour',now()-interval '1 minute',now()+interval '4 days',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at',now()+interval '2 days')),
    (v_job_s3a,v_challenge,'fake-v5-flow@example.invalid','stage3a','scheduled',null,'2026-12-29T11:00:00+09','2026-12-30T11:00:00+09','2026-12-28T11:00:00+09',now()-interval '1 minute','2027-01-05T11:00:00+09',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at','2026-12-29T11:00:00+09')),
    (v_job_s3b,v_challenge,'fake-v5-flow@example.invalid','stage3b','scheduled',null,now()+interval '2 days',now()+interval '1 day',now()-interval '1 hour',now()-interval '1 minute',now()+interval '4 days',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at',now()+interval '2 days')),
    (v_job_retry,v_retry_app,'fake-v5-retry@example.invalid','stage3a','scheduled',null,now()+interval '2 days',now()+interval '1 day',now()-interval '1 hour',now()-interval '1 minute',now()+interval '4 days',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at',now()+interval '2 days')),
    (v_job_human,v_human_app,'fake-v5-human@example.invalid','stage3b','scheduled',null,now()+interval '2 days',now()+interval '1 day',now()-interval '1 hour',now()+interval '1 hour',now()+interval '4 days',now(),jsonb_build_object('draft_due_at',now()+interval '1 hour','scheduled_at',now()+interval '2 days')),
    (v_job_check,v_check_app,'fake-v5-check@example.invalid','stage3b','scheduled',null,now()+interval '2 days',now()+interval '1 day',now()-interval '1 hour',now()-interval '1 minute',now()+interval '4 days',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at',now()+interval '2 days')),
    (v_job_space,v_space_app,'fake-v5-space@example.invalid','stage3a','scheduled',null,now()+interval '2 days',now()+interval '1 day',now()-interval '1 hour',now()-interval '1 minute',now()+interval '4 days',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at',now()+interval '2 days')),
    (v_job_invalid,v_invalid_app,'fake-v5-invalid@example.invalid','stage1','scheduled',40,now()+interval '2 days',null,now()-interval '1 hour',now()-interval '1 minute',now()+interval '7 days',now(),jsonb_build_object('draft_due_at',now()-interval '1 minute','scheduled_at',now()+interval '2 days'));

  v_rejected:=false;
  begin
    perform public.followup_get_writing_context(v_job_human);
  exception when others then
    v_rejected:=true;
  end;
  if not v_rejected or exists(select 1 from public.followup_writing_inputs where job_id=v_job_human) then
    raise exception 'before-due context was not rejected';
  end if;
  update public.followup_jobs
    set draft_due_at=now()-interval '1 minute',
        candidate_basis=jsonb_set(candidate_basis,'{draft_due_at}',to_jsonb(now()-interval '1 minute'))
    where id=v_job_human;

  v_context:=public.followup_get_writing_context(v_job_attach);
  v_context2:=public.followup_get_writing_context(v_job_attach);
  if v_context->>'context_hash'<>v_context2->>'context_hash'
     or v_context2->>'outcome'<>'ready' or (v_context2->>'next_attempt')::integer<>1
     or v_context->>'name'<>'첨부'
     or v_context#>>'{attachment,asset_id}'<>'score-conversion-2026-v1'
     or jsonb_array_length(v_context->'materials')<>2
     or v_context#>>'{materials,0,gwang}'<>'A'
     or v_context#>>'{materials,1,gwang}'<>'B' then
    raise exception 'context idempotency, call-name, attachment, or material slot failed';
  end if;
  update public.followup_jobs set fresh_until_at=now()-interval '1 second' where id=v_job_attach;
  v_result:=public.followup_get_writing_context(v_job_attach);
  if v_result->>'outcome'<>'held' or v_result->>'reason'<>'writing_window_expired'
     or exists(select 1 from public.followup_messages where job_id=v_job_attach)
     or exists(select 1 from public.followup_draft_attempts where job_id=v_job_attach) then
    raise exception 'expired existing context was reusable or saved';
  end if;

  v_context:=public.followup_get_writing_context(v_job_level);
  if v_context->>'name'<>'비첨' or v_context->'attachment'<>'null'::jsonb then
    raise exception 'three-character call-name or level attachment failed';
  end if;
  update public.followup_jobs set draft_due_at=now()+interval '1 hour' where id=v_job_level;
  v_rejected:=false;
  begin
    perform public.followup_record_writing_attempt(v_job_level,'53000000-0000-0000-0000-000000000098',1,
      '비첨님, 이온입니다','아직 이른 시험 :)'||E'\n이온 드림\n'||(v_context->>'cta_url'),
      '{}',v_machine_pass,v_human_pass);
  exception when others then
    v_rejected:=true;
  end;
  if not v_rejected or exists(select 1 from public.followup_draft_attempts where job_id=v_job_level) then
    raise exception 'before-due attempt was not rejected';
  end if;
  update public.followup_jobs set draft_due_at=now()-interval '1 minute' where id=v_job_level;
  v_result:=public.followup_record_writing_attempt(v_job_level,'53000000-0000-0000-0000-000000000099',1,
    '비첨님, 이온입니다','핵심은 거짓 통과시킨 본문 :)'||E'\n이온 드림\n'||(v_context->>'cta_url'),
    '{}',v_machine_pass,v_human_pass);
  if v_result->>'outcome'<>'rewrite' or not ((v_result->'server_failed')::text like '%lexicon:%') then
    raise exception 'false machine pass was trusted: %',v_result;
  end if;
  v_context2:=public.followup_get_writing_context(v_job_level);
  if v_context2->>'outcome'<>'ready' or (v_context2->>'next_attempt')::integer<>2 then
    raise exception 'restart did not return next attempt 2: %',v_context2;
  end if;

  select * into v_review from public.followup_select_review(
    v_book_attach,'72','94',null,now()-interval '1 day',now()+interval '2 days');
  if not exists(select 1 from public.followup_review_assets r
      where r.review_id=v_review.review_id and abs(r.start_score-72)<=5 and r.final_score>=94) then
    raise exception 'plus-minus-5 review priority failed: %',v_review.review_id;
  end if;
  select * into v_review from public.followup_select_review(
    v_book_level,'79','96',null,now()-interval '1 day',now()+interval '2 days');
  if not exists(select 1 from public.followup_review_assets r
      where r.review_id=v_review.review_id and abs(r.start_score-79) between 6 and 10 and r.final_score>=96) then
    raise exception 'plus-minus-10 review fallback failed: %',v_review.review_id;
  end if;
  select * into v_review from public.followup_select_review(
    v_challenge,'117','110',null,now()-interval '1 day',now()+interval '2 days');
  if v_review.reached_target or not exists(select 1 from public.followup_review_assets r
      where r.review_id=v_review.review_id and r.band='90+'
        and abs(r.start_score-117)=(select min(abs(x.start_score-117))
          from public.followup_review_assets x where x.band='90+')) then
    raise exception 'outside-10 review did not use masked minimum-distance fallback: %',v_review.review_id;
  end if;
  select * into v_review from public.followup_select_review(
    v_retry_app,'75',null,null,now()-interval '1 day',now()+interval '2 days');
  if not exists(select 1 from public.followup_review_assets r
      where r.review_id=v_review.review_id and r.band='70s'
        and abs(r.start_score-75)=(select min(abs(x.start_score-75))
          from public.followup_review_assets x where x.band='70s')) then
    raise exception 'no-target minimum-distance tie failed: %',v_review.review_id;
  end if;
  select * into v_review from public.followup_select_review(
    v_human_app,null,'118',null,now()-interval '1 day',now()+interval '2 days');
  if not exists(select 1 from public.followup_review_assets r
      where r.review_id=v_review.review_id and r.band='무점수'
        and abs(r.final_score-118)=(select min(abs(x.final_score-118))
          from public.followup_review_assets x where x.band='무점수')) then
    raise exception 'unscored fallback minimum-distance tie failed: %',v_review.review_id;
  end if;

  if public.followup_call_name('김철수')<>'철수'
     or public.followup_call_name('남궁민')<>'민'
     or public.followup_call_name('남궁민수')<>'민수'
     or public.followup_call_name('김민')<>'민'
     or public.followup_call_name('Jane Doe') is not null then
    raise exception 'safe call-name parsing failed';
  end if;
  v_result:=public.followup_get_writing_context(v_job_space);
  if v_result->>'outcome'<>'held' or v_result->>'reason'<>'call_name_invalid' then
    raise exception 'spaced name was guessed instead of held';
  end if;
  v_result:=public.followup_get_writing_context(v_job_invalid);
  if v_result->>'outcome'<>'held' or v_result->>'reason'<>'call_name_invalid' then
    raise exception 'unsupported name format was not held';
  end if;

  v_context:=public.followup_get_writing_context(v_job_s2);
  v_subject:='흐름님, 개별분석 관련해서 연락드립니다!';
  v_body:='흐름님 안녕하세요, 이온입니다! :) 검사 가능한 가짜 본문입니다.'||E'\n이온 드림\n'||(v_context->>'cta_url');
  v_result:=public.followup_record_writing_attempt(v_job_s2,'53000000-0000-0000-0000-000000000001',1,
    v_subject,v_body,'{}',v_machine_pass,v_human_pass);
  if v_result->>'outcome'<>'awaiting_review' then raise exception 'pass did not reach awaiting_review'; end if;
  select review_started_at,review_deadline_at into v_started,v_deadline from public.followup_jobs where id=v_job_s2;
  if v_deadline-v_started<>interval '1 hour' then raise exception 'review window is not exactly one hour'; end if;
  v_context2:=public.followup_get_writing_context(v_job_s2);
  if v_context2->>'outcome'<>'awaiting_review' then
    raise exception 'saved context did not report awaiting_review';
  end if;
  update public.followup_jobs set fresh_until_at=now()-interval '1 second' where id=v_job_s2;
  v_context2:=public.followup_get_writing_context(v_job_s2);
  if v_context2->>'outcome'<>'awaiting_review'
     or (select status from public.followup_jobs where id=v_job_s2)<>'awaiting_review' then
    raise exception 'expired terminal context changed awaiting_review state';
  end if;
  v_result:=public.followup_record_writing_attempt(v_job_s2,'53000000-0000-0000-0000-000000000001',1,
    v_subject,v_body,'{}',v_machine_pass,v_human_pass);
  if v_result->>'outcome'<>'awaiting_review' then
    raise exception 'same request did not preserve original result after expiry';
  end if;
  v_result:=public.followup_record_writing_attempt(v_job_s2,'53000000-0000-0000-0000-000000000011',2,
    v_subject,v_body,'{}',v_machine_pass,v_human_pass);
  if v_result->>'outcome'<>'awaiting_review'
     or (select status from public.followup_jobs where id=v_job_s2)<>'awaiting_review' then
    raise exception 'new request changed expired terminal job';
  end if;

  v_context:=public.followup_get_writing_context(v_job_s3a);
  v_result:=public.followup_record_writing_attempt(v_job_s3a,'53000000-0000-0000-0000-000000000002',1,
    '흐름님, 계약서 관련해서 연락드립니다!','1월 3일 시작 안내입니다 :)'||E'\n이온 드림\n'||(v_context->>'cta_url'),
    '{}',v_machine_pass,v_human_pass);
  if v_result->>'outcome'<>'awaiting_review' then raise exception 'year rollover date was treated as past: %',v_result; end if;

  v_context:=public.followup_get_writing_context(v_job_s3b);
  update public.followup_jobs set fresh_until_at=now()-interval '1 second' where id=v_job_s3b;
  v_result:=public.followup_record_writing_attempt(v_job_s3b,'53000000-0000-0000-0000-000000000003',1,
    '흐름님, 등록 관련해서 연락드립니다!','만료 반대 시험입니다 :)'||E'\n이온 드림\n'||(v_context->>'cta_url'),
    '{}',v_machine_pass,v_human_pass);
  if v_result->>'outcome'<>'held' or v_result->>'reason'<>'writing_window_expired'
     or exists(select 1 from public.followup_messages where job_id=v_job_s3b)
     or exists(select 1 from public.followup_draft_attempts where job_id=v_job_s3b) then
    raise exception 'post-context expiry attempt was saved';
  end if;

  v_context:=public.followup_get_writing_context(v_job_check);
  v_subject:='검사님, 등록 관련해서 연락드립니다!';
  v_body:='검사님 안녕하세요, 확인 부탁드립니다! :)'||E'\n이온 드림\n'||(v_context->>'cta_url');
  begin
    v_result:=public.followup_record_writing_attempt(v_job_check,'56000000-0000-0000-0000-000000000001',1,
      v_subject,v_body,'{}',v_machine_missing,v_human_pass);
    if v_result->>'outcome'<>'rewrite' then raise exception 'blank machine evidence passed'; end if;
    raise exception using errcode='Z1001',message='rollback expected negative case';
  exception when sqlstate 'Z1001' then null;
  end;
  begin
    v_result:=public.followup_record_writing_attempt(v_job_check,'56000000-0000-0000-0000-000000000002',1,
      v_subject,v_body,'{}',v_machine_bad_names,v_human_pass);
    if v_result->>'outcome'<>'rewrite' then raise exception 'duplicate or extra machine names passed'; end if;
    raise exception using errcode='Z1001',message='rollback expected negative case';
  exception when sqlstate 'Z1001' then null;
  end;
  begin
    v_result:=public.followup_record_writing_attempt(v_job_check,'56000000-0000-0000-0000-000000000003',1,
      v_subject,v_body,'{}',v_machine_pass,v_human_missing);
    if v_result->>'outcome'<>'held' then raise exception 'blank human reason passed'; end if;
    raise exception using errcode='Z1001',message='rollback expected negative case';
  exception when sqlstate 'Z1001' then null;
  end;
  begin
    v_result:=public.followup_record_writing_attempt(v_job_check,'56000000-0000-0000-0000-000000000004',1,
      v_subject,v_body,'{}',v_machine_pass,v_human_bad_names);
    if v_result->>'outcome'<>'held' then raise exception 'duplicate or extra human names passed'; end if;
    raise exception using errcode='Z1001',message='rollback expected negative case';
  exception when sqlstate 'Z1001' then null;
  end;

  perform public.followup_get_writing_context(v_job_retry);
  for i in 1..4 loop
    v_result:=public.followup_record_writing_attempt(v_job_retry,
      ('54000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,i,
      '재작님, 계약서 관련해서 연락드립니다!','실패', '{}',v_machine_fail,v_human_pass);
  end loop;
  if v_result->>'outcome'<>'held' or (select status from public.followup_jobs where id=v_job_retry)<>'held' then
    raise exception 'four failures did not hold';
  end if;
  update public.followup_jobs set fresh_until_at=now()-interval '1 second' where id=v_job_retry;
  v_context2:=public.followup_get_writing_context(v_job_retry);
  if v_context2->>'outcome'<>'held'
     or (select status from public.followup_jobs where id=v_job_retry)<>'held' then
    raise exception 'expired terminal context changed held state';
  end if;

  perform public.followup_get_writing_context(v_job_human);
  v_result:=public.followup_record_writing_attempt(v_job_human,'55000000-0000-0000-0000-000000000001',1,
    '사람님, 등록 관련해서 연락드립니다!','사람 판단 실패 :)'||E'\n이온 드림\nhttps://eonfl.com/application-detail.html?id='||v_human_app||'#step4',
    '{}',v_machine_pass,v_human_fail);
  if v_result->>'outcome'<>'held' then raise exception 'human failure did not hold'; end if;

  if (select count(*) from public.rule_bundles)<>8 or (select count(*) from public.followup_review_assets)<>52
     or (select count(*) from public.story_materials)<>38 or (select count(*) from public.score_table)<>9
     or (select count(*) from public.lexicon)<>69 or (select count(*) from public.review_combo)<>30 then
    raise exception 'seed counts mismatch';
  end if;
  select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),''))
    into v_reviews_after,v_reviews_digest_after from public.reviews r;
  if v_reviews_before<>219 or v_reviews_after<>219
     or v_reviews_before<>v_reviews_after or v_reviews_digest_before<>v_reviews_digest_after then
    raise exception 'public.reviews changed: %/% -> %/%',
      v_reviews_before,v_reviews_digest_before,v_reviews_after,v_reviews_digest_after;
  end if;
end $$;

rollback;
