-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-1 전환 예행 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 쓰는 곳과 기대값은 절차.md 6단계를 따른다.
-- 운영에는 절대 실행하지 않는다(예행 동안 표 14개에 잠금이 걸린다).
--
-- 모양: 한 요청에 두 문장이다.
--   ① 임시 함수 pg_temp.b2n1_rehearsal(…) 를 만든다(이 접속에서만 보이고 접속이 끝나면 사라진다).
--   ② select pg_temp.b2n1_rehearsal(…) — 이 한 문장(= 한 접속의 한 트랜잭션) 안에서 예행 전부를 하고
--      결과를 jsonb 한 칸으로 돌려준다.
--   두 문장은 반드시 같은 접속으로 가야 한다(①이 다른 접속으로 가면 ②가 "함수가 없다"로 실패한다 — 변화 0).
--
-- ②가 하는 일(순서)
--   0. 전제 확인(읽기): 대상 표시 값, 합성 행, b2n1_ 규칙 27개, 지울 옛 규칙 26개, 합성 계정의 대응·명부·로그인 상태.
--      하나라도 어긋나면 예외로 멈춘다(아무것도 바뀌지 않는다).
--   1. 규칙 지문을 적는다(fp_before).
--   2. 안쪽 블록(세이브포인트) 시작
--      2-1. [applied] 옛 규칙과 새 규칙이 함께 있는 지금 상태에서 대조표를 한 번 판정한다(이 도구가 역할을
--           제대로 바꾸는지 보는 대조군이다. p_include_applied = false 면 건너뛴다).
--      2-2. 옛 규칙 26개를 이름으로 지운다(아래 "지우는 규칙"). aus_intspk 의 넣기 규칙 둘은 남긴다.
--      2-3. [rehearsal] 같은 접속에서 역할을 바꿔(set local role + request.jwt.claims) 대조표를 다시 판정한다.
--      2-4. 안쪽 블록을 일부러 예외로 끝내 2-2·2-3 의 변화를 전부 되돌린다.
--   3. 규칙 지문을 다시 적는다(fp_after). fp_before 와 같아야 한다.
--   * 판정 하나하나(요청 하나)도 자기 세이브포인트 안에서 하고 끝나면 되돌린다. 그래서 거절 오류 하나가
--     뒤 판정을 무효로 만들지 않고, 모든 판정이 같은 처음 값(합성 행의 처음 상태)에서 시작한다.
--   * 저장값은 판정 직후 같은 트랜잭션에서 postgres 로 돌아와 표를 직접 읽은 것이다.
--
-- 지우는 규칙(예행 안에서만, 끝나면 되돌아간다) — 26개
--   문제 표 11개 각각: "Allow update for anon", "Allow delete for anon"            (22개)
--   aus_intspk: "anon update", "anon_read_aus_intspk"                               (2개)
--   note3_store: "anon all"            (한 규칙이 읽기·넣기·수정·삭제 4칸을 맡는다)   (1개)
--   toefl_actual_scores: "Allow all access for anon"   (한 규칙이 4칸을 맡는다)     (1개)
-- 남기는 규칙(지우지 않는다)
--   aus_intspk: "anon insert"(비로그인용 넣기), "Enable insert for authenticated users only"(로그인 역할용 넣기)
--   문제 표 11개: anon_read, anon_insert (모든 역할용 읽기·넣기)
--
-- 자격 7종(+회원 B): anon / member_a / member_b / no_map(대응 없는 계정) / admin_pre(관리자 6자리 전 —
--   자격의 aal 이 aal1) / admin_post(관리자 6자리 후) / service(service_role)
--
-- 실행 전에 채울 것: 맨 아래 select 의 꺾쇠 4개(합성 계정의 로그인 계정 번호 = auth.users.id).
--   회원번호와 로그인 상태 번호는 함수가 대응표와 auth.sessions 에서 스스로 찾는다.
--   A·B·N 은 살아 있는 로그인 상태가 1개 이상, G 는 6자리 확인을 마친(aal2) 로그인 상태가 1개 이상 있어야 한다.
-- =====================================================================

create or replace function pg_temp.b2n1_rehearsal(
  p_ref             text,
  p_a_auth          uuid,
  p_b_auth          uuid,
  p_n_auth          uuid,
  p_g_auth          uuid,
  p_include_applied boolean default true
)
returns jsonb
language plpgsql
as $b2n1_fn$
declare
  c_tr8 constant text[] := array[
    'tr_listening_announcement', 'tr_listening_conversation', 'tr_listening_lecture',
    'tr_reading_academic', 'tr_speaking_interview', 'tr_speaking_repeat',
    'tr_writing_discussion', 'tr_writing_email'
  ];
  c_tr10 constant text[] := array[
    'tr_listening_announcement', 'tr_listening_conversation', 'tr_listening_lecture',
    'tr_reading_academic', 'tr_speaking_interview', 'tr_speaking_repeat',
    'tr_writing_discussion', 'tr_writing_email',
    'tr_listening_response', 'tr_writing_arrange'
  ];
  c_tr11 constant text[] := array[
    'tr_listening_announcement', 'tr_listening_conversation', 'tr_listening_lecture',
    'tr_reading_academic', 'tr_speaking_interview', 'tr_speaking_repeat',
    'tr_writing_discussion', 'tr_writing_email',
    'tr_listening_response', 'tr_writing_arrange', 'tr_writing_ko_data'
  ];
  c_all14 constant text[] := array[
    'tr_listening_announcement', 'tr_listening_conversation', 'tr_listening_lecture',
    'tr_reading_academic', 'tr_speaking_interview', 'tr_speaking_repeat',
    'tr_writing_discussion', 'tr_writing_email',
    'tr_listening_response', 'tr_writing_arrange', 'tr_writing_ko_data',
    'aus_intspk', 'toefl_actual_scores', 'note3_store'
  ];
  c_not_given constant text[] := array[
    'tr_listening_response UPDATE', 'tr_writing_arrange UPDATE',
    'tr_writing_ko_data UPDATE', 'tr_writing_ko_data DELETE', 'aus_intspk UPDATE'
  ];

  v_a_member uuid;
  v_b_member uuid;
  v_a_sid    uuid;
  v_b_sid    uuid;
  v_n_sid    uuid;
  v_g1_sid   uuid;
  v_g2_sid   uuid;
  v_g1_note  text;

  v_labels text[];
  v_roles  text[];
  v_claims text[];

  v_n          bigint;
  v_n_before   bigint;
  v_fp_before  text;
  v_n_dropped  bigint;
  v_fp_dropped text;
  v_n_after    bigint;
  v_fp_after   text;
  v_dropped    jsonb := '[]'::jsonb;
  v_kept       jsonb;

  v_phases  text[];
  v_phase   text;
  r         record;
  v_t       text;
  v_ai      integer;
  v_label   text;
  v_role    text;
  v_claim   text;
  v_uid     uuid;

  v_k1      text;
  v_k2      text;
  v_kn      text;
  v_valexpr text;
  v_state   text;
  v_xnew    text;
  v_ins_new text;
  v_ins_k1  text;

  v_ops      text[];
  v_variants text[];
  v_kinds    text[];
  v_sqls     text[];
  v_sql2s    text[];
  v_tgts     text[];
  v_oi       integer;
  v_op       text;
  v_kind     text;
  v_tgt      text;
  v_variant  text;
  v_tgt_i    text;
  v_tgt_lit  text;

  v_is_tr       boolean;
  v_cell        text;
  v_class       text;
  v_expect      text;
  v_exp_visible jsonb;
  v_actual      text;
  v_match       boolean;

  v_before   jsonb;
  v_after    jsonb;
  v_visible  jsonb;
  v_rows     bigint;
  v_rows2    bigint;
  v_sqlstate text;
  v_msg      text;

  v_results jsonb := '[]'::jsonb;
  v_valid   jsonb := '{}'::jsonb;
  v_summary jsonb;
begin
  -- ------------------------------------------------------------------
  -- 0. 전제 확인 (읽기만. 어긋나면 멈춘다)
  -- ------------------------------------------------------------------
  if p_ref is distinct from 'hmncdheiwqwekdbtijar' then
    raise exception 'b2n1 예행 중단: 대상 표시 값이 시험 프로젝트가 아니다';
  end if;
  if current_user <> 'postgres' then
    raise exception 'b2n1 예행 중단: postgres 로 실행해야 한다(지금 %)', current_user;
  end if;

  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_policies p
   where p.policyname like 'b2n1\_%';
  if v_n <> 27 then
    raise exception 'b2n1 예행 중단: b2n1_ 규칙이 % 개다(27개가 적용된 상태에서만 예행한다)', v_n;
  end if;

  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and (
          (p.tablename::pg_catalog.text = any (c_tr11) and p.policyname::pg_catalog.text in ('Allow update for anon', 'Allow delete for anon'))
       or (p.tablename::pg_catalog.text = 'aus_intspk' and p.policyname::pg_catalog.text in ('anon update', 'anon_read_aus_intspk'))
       or (p.tablename::pg_catalog.text = 'note3_store' and p.policyname::pg_catalog.text = 'anon all')
       or (p.tablename::pg_catalog.text = 'toefl_actual_scores' and p.policyname::pg_catalog.text = 'Allow all access for anon')
     );
  if v_n <> 26 then
    raise exception 'b2n1 예행 중단: 지울 옛 규칙이 % 개다(26개여야 한다 — 이름이 바뀌었거나 이미 지워졌다)', v_n;
  end if;

  select mi.member_id into v_a_member from security_private.member_identity mi where mi.auth_user_id = p_a_auth;
  select mi.member_id into v_b_member from security_private.member_identity mi where mi.auth_user_id = p_b_auth;
  if v_a_member is null or v_b_member is null then
    raise exception 'b2n1 예행 중단: 회원 A 또는 B 가 대응표(member_identity)에 없다';
  end if;
  if exists (select 1 from security_private.member_identity mi where mi.auth_user_id = p_n_auth)
     or exists (select 1 from security_private.admin_principal ap where ap.auth_user_id = p_n_auth) then
    raise exception 'b2n1 예행 중단: 대응 없는 계정 N 이 대응표나 명부에 들어 있다';
  end if;
  if not exists (select 1 from security_private.admin_principal ap where ap.auth_user_id = p_g_auth and ap.enabled) then
    raise exception 'b2n1 예행 중단: 관리자 G 가 명부(admin_principal)에 enabled 로 없다';
  end if;
  if exists (select 1 from security_private.member_identity mi where mi.auth_user_id = p_g_auth) then
    raise exception 'b2n1 예행 중단: 관리자 G 가 대응표에도 들어 있다(이 대조표는 G 를 회원이 아닌 관리자로 본다)';
  end if;

  select s.id into v_a_sid from auth.sessions s
   where s.user_id = p_a_auth and (s.not_after is null or s.not_after > pg_catalog.now())
   order by s.created_at desc limit 1;
  select s.id into v_b_sid from auth.sessions s
   where s.user_id = p_b_auth and (s.not_after is null or s.not_after > pg_catalog.now())
   order by s.created_at desc limit 1;
  select s.id into v_n_sid from auth.sessions s
   where s.user_id = p_n_auth and (s.not_after is null or s.not_after > pg_catalog.now())
   order by s.created_at desc limit 1;
  select s.id into v_g2_sid from auth.sessions s
   where s.user_id = p_g_auth and s.aal::pg_catalog.text = 'aal2'
     and (s.not_after is null or s.not_after > pg_catalog.now())
   order by s.created_at desc limit 1;
  select s.id into v_g1_sid from auth.sessions s
   where s.user_id = p_g_auth and s.aal::pg_catalog.text = 'aal1'
     and (s.not_after is null or s.not_after > pg_catalog.now())
   order by s.created_at desc limit 1;
  if v_a_sid is null or v_b_sid is null or v_n_sid is null then
    raise exception 'b2n1 예행 중단: A·B·N 중 살아 있는 로그인 상태가 없는 계정이 있다(먼저 로그인)';
  end if;
  if v_g2_sid is null then
    raise exception 'b2n1 예행 중단: 관리자 G 에 6자리 확인을 마친(aal2) 로그인 상태가 없다';
  end if;
  if v_g1_sid is null then
    -- 6자리 전 로그인 상태가 따로 없으면, 6자리 후 로그인 상태에 "자격의 aal 이 aal1"인 옛 자격을 흉내 낸다.
    v_g1_sid  := v_g2_sid;
    v_g1_note := 'aal2 로그인 상태 + 자격의 aal=aal1(6자리 전에 받은 옛 자격)';
  else
    v_g1_note := 'aal1 로그인 상태 + 자격의 aal=aal1';
  end if;

  v_labels := array['anon', 'member_a', 'member_b', 'no_map', 'admin_pre', 'admin_post', 'service'];
  v_roles  := array['anon', 'authenticated', 'authenticated', 'authenticated', 'authenticated', 'authenticated', 'service_role'];
  v_claims := array[
    pg_catalog.jsonb_build_object('role', 'anon')::pg_catalog.text,
    pg_catalog.jsonb_build_object('role', 'authenticated', 'aal', 'aal1', 'sub', p_a_auth, 'session_id', v_a_sid)::pg_catalog.text,
    pg_catalog.jsonb_build_object('role', 'authenticated', 'aal', 'aal1', 'sub', p_b_auth, 'session_id', v_b_sid)::pg_catalog.text,
    pg_catalog.jsonb_build_object('role', 'authenticated', 'aal', 'aal1', 'sub', p_n_auth, 'session_id', v_n_sid)::pg_catalog.text,
    pg_catalog.jsonb_build_object('role', 'authenticated', 'aal', 'aal1', 'sub', p_g_auth, 'session_id', v_g1_sid)::pg_catalog.text,
    pg_catalog.jsonb_build_object('role', 'authenticated', 'aal', 'aal2', 'sub', p_g_auth, 'session_id', v_g2_sid)::pg_catalog.text,
    pg_catalog.jsonb_build_object('role', 'service_role')::pg_catalog.text
  ];

  -- 합성 행의 처음 상태: 성적 두 행의 회원번호가 A·B 의 것과 같아야 한다
  if not exists (select 1 from public.toefl_actual_scores s
                  where s.id = 'b2b2b2b2-0000-4000-8000-0000000000a1'::pg_catalog.uuid and s.user_id = v_a_member and s.memo = 'init')
     or not exists (select 1 from public.toefl_actual_scores s
                  where s.id = 'b2b2b2b2-0000-4000-8000-0000000000b1'::pg_catalog.uuid and s.user_id = v_b_member and s.memo = 'init') then
    raise exception 'b2n1 예행 중단: 성적 합성 행이 없거나 회원번호·처음 값이 다르다(fixtures_up.sql 을 다시 볼 것)';
  end if;

  -- ------------------------------------------------------------------
  -- 1. 예행 전 규칙 지문
  -- ------------------------------------------------------------------
  select pg_catalog.count(*),
         pg_catalog.md5(coalesce(pg_catalog.string_agg(
           p.tablename::pg_catalog.text || '|' || p.policyname::pg_catalog.text || '|' || p.permissive || '|' || p.roles::pg_catalog.text || '|'
           || p.cmd || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''),
           E'\n' order by p.tablename::pg_catalog.text, p.policyname::pg_catalog.text), ''))
    into v_n_before, v_fp_before
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename::pg_catalog.text = any (c_all14);

  if p_include_applied then
    v_phases := array['applied', 'rehearsal'];
  else
    v_phases := array['rehearsal'];
  end if;

  -- ------------------------------------------------------------------
  -- 2. 안쪽 블록: 여기서 생긴 변화는 끝에서 전부 되돌린다
  -- ------------------------------------------------------------------
  begin
    foreach v_phase in array v_phases loop

      if v_phase = 'rehearsal' then
        -- 2-2. 옛 규칙 26개를 이름으로 지운다
        foreach v_t in array c_tr11 loop
          execute pg_catalog.format('drop policy %I on public.%I', 'Allow update for anon', v_t);
          execute pg_catalog.format('drop policy %I on public.%I', 'Allow delete for anon', v_t);
          v_dropped := v_dropped || pg_catalog.to_jsonb(v_t || ': Allow update for anon') || pg_catalog.to_jsonb(v_t || ': Allow delete for anon');
        end loop;
        drop policy "anon update" on public.aus_intspk;
        drop policy "anon_read_aus_intspk" on public.aus_intspk;
        drop policy "anon all" on public.note3_store;
        drop policy "Allow all access for anon" on public.toefl_actual_scores;
        v_dropped := v_dropped
          || pg_catalog.to_jsonb('aus_intspk: anon update'::pg_catalog.text)
          || pg_catalog.to_jsonb('aus_intspk: anon_read_aus_intspk'::pg_catalog.text)
          || pg_catalog.to_jsonb('note3_store: anon all'::pg_catalog.text)
          || pg_catalog.to_jsonb('toefl_actual_scores: Allow all access for anon'::pg_catalog.text);

        select pg_catalog.count(*),
               pg_catalog.md5(coalesce(pg_catalog.string_agg(
                 p.tablename::pg_catalog.text || '|' || p.policyname::pg_catalog.text || '|' || p.permissive || '|' || p.roles::pg_catalog.text || '|'
                 || p.cmd || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''),
                 E'\n' order by p.tablename::pg_catalog.text, p.policyname::pg_catalog.text), '')),
               coalesce(pg_catalog.jsonb_agg(
                 (p.tablename::pg_catalog.text || ': ' || p.policyname::pg_catalog.text || ' [' || p.cmd || ' ' || p.roles::pg_catalog.text || ']')
                 order by p.tablename::pg_catalog.text, p.policyname::pg_catalog.text)
                 filter (where p.policyname not like 'b2n1\_%'), '[]'::pg_catalog.jsonb)
          into v_n_dropped, v_fp_dropped, v_kept
          from pg_catalog.pg_policies p
         where p.schemaname = 'public' and p.tablename::pg_catalog.text = any (c_all14);
      end if;

      -- 표마다
      for r in
        select t.tbl, t.idkind, t.k1t, t.k2t, t.knt, t.mcol, t.xcols, t.xvals_k1, t.xvals_new
          from (
            values
              ('tr_listening_announcement'::pg_catalog.text, 'text'::pg_catalog.text, 'zz-b2n1-la-1'::pg_catalog.text, 'zz-b2n1-la-2'::pg_catalog.text, 'zz-b2n1-la-new'::pg_catalog.text, 'script'::pg_catalog.text, ''::pg_catalog.text, ''::pg_catalog.text, ''::pg_catalog.text),
              ('tr_listening_conversation', 'text', 'zz-b2n1-lc-1', 'zz-b2n1-lc-2', 'zz-b2n1-lc-new', 'script', '', '', ''),
              ('tr_listening_lecture',      'text', 'zz-b2n1-ll-1', 'zz-b2n1-ll-2', 'zz-b2n1-ll-new', 'script', '', '', ''),
              ('tr_listening_response',     'text', 'zz-b2n1-lr-1', 'zz-b2n1-lr-2', 'zz-b2n1-lr-new', 'script',
                 'set_id, question_num, ', $q$'zz-b2n1-set', 1, $q$, $q$'zz-b2n1-set', 9, $q$),
              ('tr_reading_academic',       'text', 'zz-b2n1-ra-1', 'zz-b2n1-ra-2', 'zz-b2n1-ra-new', 'main_title', '', '', ''),
              ('tr_speaking_interview',     'text', 'zz-b2n1-si-1', 'zz-b2n1-si-2', 'zz-b2n1-si-new', 'context_text', '', '', ''),
              ('tr_speaking_repeat',        'text', 'zz-b2n1-sr-1', 'zz-b2n1-sr-2', 'zz-b2n1-sr-new', 'context_text', '', '', ''),
              ('tr_writing_arrange',        'text', 'zz-b2n1-wa-1', 'zz-b2n1-wa-2', 'zz-b2n1-wa-new', 'explanation',
                 'set_id, question_num, ', $q$'zz-b2n1-set', 1, $q$, $q$'zz-b2n1-set', 9, $q$),
              ('tr_writing_discussion',     'text', 'zz-b2n1-wd-1', 'zz-b2n1-wd-2', 'zz-b2n1-wd-new', 'topic', '', '', ''),
              ('tr_writing_email',          'text', 'zz-b2n1-we-1', 'zz-b2n1-we-2', 'zz-b2n1-we-new', 'subject', '', '', ''),
              ('tr_writing_ko_data',        'text', 'zz-b2n1-wk-1', 'zz-b2n1-wk-2', 'zz-b2n1-wk-new', 'ko_text',
                 'type, set_id, ', $q$'zz-b2n1', 'zz-b2n1-set', $q$, $q$'zz-b2n1', 'zz-b2n1-set', $q$),
              ('aus_intspk',                'int',  '990000001', '990000002', '990000009', 'passage',
                 'type, title, ', $q$2, 'zz-b2n1-int-1', $q$, $q$2, 'zz-b2n1-int-new', $q$),
              ('toefl_actual_scores',       'uuid', 'b2b2b2b2-0000-4000-8000-0000000000a1', 'b2b2b2b2-0000-4000-8000-0000000000b1', 'b2b2b2b2-0000-4000-8000-0000000000c9', 'memo',
                 'user_id, user_name, reading, listening, speaking, writing, overall, test_date, ', '', ''),
              ('note3_store',               'text', 'zz-b2n1-note-1', 'zz-b2n1-note-2', 'zz-b2n1-note-new', 'data', '', '', '')
          ) as t(tbl, idkind, k1t, k2t, knt, mcol, xcols, xvals_k1, xvals_new)
      loop
        v_is_tr := (r.tbl = any (c_tr11));

        -- 키를 SQL 글자로
        if r.idkind = 'int' then
          v_k1 := r.k1t; v_k2 := r.k2t; v_kn := r.knt;
        elsif r.idkind = 'uuid' then
          v_k1 := pg_catalog.quote_literal(r.k1t) || '::pg_catalog.uuid';
          v_k2 := pg_catalog.quote_literal(r.k2t) || '::pg_catalog.uuid';
          v_kn := pg_catalog.quote_literal(r.knt) || '::pg_catalog.uuid';
        else
          v_k1 := pg_catalog.quote_literal(r.k1t);
          v_k2 := pg_catalog.quote_literal(r.k2t);
          v_kn := pg_catalog.quote_literal(r.knt);
        end if;

        -- 저장값을 읽는 문장(postgres 로 직접 읽는다): {id: 값}
        if r.tbl = 'toefl_actual_scores' then
          v_valexpr := $q$(memo || '|' || user_id::pg_catalog.text)$q$;
        else
          v_valexpr := pg_catalog.quote_ident(r.mcol);
        end if;
        v_state := pg_catalog.format(
          'select coalesce(pg_catalog.jsonb_object_agg(id::pg_catalog.text, %s), ''{}''::pg_catalog.jsonb) from public.%I where id in (%s, %s, %s)',
          v_valexpr, r.tbl, v_k1, v_k2, v_kn);

        -- 시험 전 확인: 대상 행·대조군 행이 있고 처음 값이며, 넣을 키는 비어 있다
        execute v_state into v_before;
        if not (v_before ? r.k1t) or not (v_before ? r.k2t) or (v_before ? r.knt)
           or not pg_catalog.starts_with(coalesce(v_before ->> r.k1t, ''), 'init')
           or not pg_catalog.starts_with(coalesce(v_before ->> r.k2t, ''), 'init') then
          raise exception 'b2n1 예행 중단: % 의 합성 행이 처음 상태가 아니다(%)', r.tbl, v_before;
        end if;

        -- 자격마다
        for v_ai in 1 .. 7 loop
          v_label := v_labels[v_ai];
          v_role  := v_roles[v_ai];
          v_claim := v_claims[v_ai];

          -- "넣기"에 쓸 문장(같은 입력이 권한 있는 자격으로는 들어가는 유효한 값이어야 한다)
          if r.tbl = 'toefl_actual_scores' then
            if v_label = 'member_b' then v_uid := v_b_member; else v_uid := v_a_member; end if;
            v_xnew := pg_catalog.format($q$%L::pg_catalog.uuid, 'zz-b2n1-new', 3.0, 3.0, 3.0, 3.0, 3.0, date '2026-01-01', $q$, v_uid);
          else
            v_xnew := r.xvals_new;
          end if;
          v_ins_new := pg_catalog.format('insert into public.%I (id, %s%I) values (%s, %s%L)',
                                         r.tbl, r.xcols, r.mcol, v_kn, v_xnew, 'init-new');
          v_ins_k1  := pg_catalog.format('insert into public.%I (id, %s%I) values (%s, %s%L)',
                                         r.tbl, r.xcols, r.mcol, v_k1, r.xvals_k1, 'reinserted');

          if v_label = 'anon' then
            -- 넣기 입력의 유효성: postgres 로 넣어 보고 되돌린다(권한과 무관하게 들어가는 값인지)
            begin
              execute v_ins_new;
              raise exception using errcode = 'B2N1R', message = 'b2n1 rollback';
            exception
              when sqlstate 'B2N1R' then
                v_valid := v_valid || pg_catalog.jsonb_build_object(v_phase || ' ' || r.tbl, true);
              when others then
                raise exception 'b2n1 예행 중단: % 의 넣기 입력이 유효하지 않다(% %)', r.tbl, sqlstate, sqlerrm;
            end;
          end if;

          -- 이 표·이 자격으로 할 요청 목록
          v_ops := '{}'; v_variants := '{}'; v_kinds := '{}'; v_sqls := '{}'; v_sql2s := '{}'; v_tgts := '{}';

          v_ops := v_ops || 'SELECT'::pg_catalog.text; v_variants := v_variants || ''::pg_catalog.text; v_kinds := v_kinds || 'select'::pg_catalog.text;
          v_sqls := v_sqls || pg_catalog.format(
            'select coalesce(pg_catalog.jsonb_agg(x.k order by x.k), ''[]''::pg_catalog.jsonb) from (select id::pg_catalog.text as k from public.%I where id in (%s, %s)) x',
            r.tbl, v_k1, v_k2);
          v_sql2s := v_sql2s || ''::pg_catalog.text; v_tgts := v_tgts || ''::pg_catalog.text;

          v_ops := v_ops || 'INSERT'::pg_catalog.text; v_variants := v_variants || ''::pg_catalog.text; v_kinds := v_kinds || 'insert'::pg_catalog.text;
          v_sqls := v_sqls || v_ins_new; v_sql2s := v_sql2s || ''::pg_catalog.text; v_tgts := v_tgts || r.knt;

          -- 수정·삭제의 대상 행: 성적 표는 A의 행과 B의 행 둘 다, 그 밖의 표는 대상 행 하나
          foreach v_tgt_i in array (case when r.tbl = 'toefl_actual_scores' then array[r.k1t, r.k2t] else array[r.k1t] end) loop
            if r.idkind = 'int' then
              v_tgt_lit := v_tgt_i;
            elsif r.idkind = 'uuid' then
              v_tgt_lit := pg_catalog.quote_literal(v_tgt_i) || '::pg_catalog.uuid';
            else
              v_tgt_lit := pg_catalog.quote_literal(v_tgt_i);
            end if;
            if r.tbl = 'toefl_actual_scores' then
              v_variant := case
                when v_label = 'member_a' and v_tgt_i = r.k1t then '자기 행'
                when v_label = 'member_b' and v_tgt_i = r.k2t then '자기 행'
                when v_tgt_i = r.k1t then 'A의 행'
                else 'B의 행' end;
            else
              v_variant := '';
            end if;

            v_ops := v_ops || 'UPDATE'::pg_catalog.text; v_variants := v_variants || v_variant; v_kinds := v_kinds || 'update'::pg_catalog.text;
            v_sqls := v_sqls || pg_catalog.format('update public.%I set %I = %L where id = %s', r.tbl, r.mcol, 'changed', v_tgt_lit);
            v_sql2s := v_sql2s || ''::pg_catalog.text; v_tgts := v_tgts || v_tgt_i;

            v_ops := v_ops || 'DELETE'::pg_catalog.text; v_variants := v_variants || v_variant; v_kinds := v_kinds || 'delete'::pg_catalog.text;
            v_sqls := v_sqls || pg_catalog.format('delete from public.%I where id = %s', r.tbl, v_tgt_lit);
            v_sql2s := v_sql2s || ''::pg_catalog.text; v_tgts := v_tgts || v_tgt_i;
          end loop;

          -- 성적: 관리자가 아닌 회원이 "조건을 통과하는 값으로 바꿔 보내기"(남의 행의 회원번호를 자기 것으로)
          if r.tbl = 'toefl_actual_scores' and v_label in ('member_a', 'member_b') then
            v_ops := v_ops || 'UPDATE'::pg_catalog.text;
            v_variants := v_variants || '남의 행의 user_id 를 자기 번호로 바꿔 보내기'::pg_catalog.text;
            v_kinds := v_kinds || 'reassign'::pg_catalog.text;
            if v_label = 'member_a' then
              v_sqls := v_sqls || pg_catalog.format('update public.toefl_actual_scores set user_id = %L::pg_catalog.uuid where id = %s', v_a_member, v_k2);
              v_tgts := v_tgts || r.k2t;
            else
              v_sqls := v_sqls || pg_catalog.format('update public.toefl_actual_scores set user_id = %L::pg_catalog.uuid where id = %s', v_b_member, v_k1);
              v_tgts := v_tgts || r.k1t;
            end if;
            v_sql2s := v_sql2s || ''::pg_catalog.text;
          end if;

          -- tr_listening_response·tr_writing_arrange: 관리자 6자리 후의 "삭제 → 다시 넣기" 한 세트
          if r.tbl in ('tr_listening_response', 'tr_writing_arrange') and v_label = 'admin_post' then
            v_ops := v_ops || 'DELETE+INSERT'::pg_catalog.text;
            v_variants := v_variants || '삭제 뒤 다시 넣기 한 세트'::pg_catalog.text;
            v_kinds := v_kinds || 'set'::pg_catalog.text;
            v_sqls := v_sqls || pg_catalog.format('delete from public.%I where id = %s', r.tbl, v_k1);
            v_sql2s := v_sql2s || v_ins_k1;
            v_tgts := v_tgts || r.k1t;
          end if;

          -- 요청마다
          for v_oi in 1 .. pg_catalog.cardinality(v_ops) loop
            v_op      := v_ops[v_oi];
            v_kind    := v_kinds[v_oi];
            v_tgt     := v_tgts[v_oi];
            v_variant := v_variants[v_oi];
            v_cell    := r.tbl || ' ' || v_op;

            -- 칸의 분류
            if (v_is_tr and v_op in ('SELECT', 'INSERT')) or (r.tbl = 'aus_intspk' and v_op = 'INSERT') then
              v_class := 'open_existing';       -- 이미 모든 역할에 열린 동작(통과로 세지 않는다)
            elsif r.tbl = 'aus_intspk' and v_op = 'DELETE' then
              v_class := 'no_rule';             -- 지금도 규칙이 없는 칸
            elsif v_op = 'DELETE+INSERT' then
              v_class := 'set';
            else
              v_class := 'target32';            -- 이 계약의 32칸
            end if;

            -- 기대값
            if v_label = 'service' then
              v_expect := 'allow';
            elsif v_label = 'anon' then
              if v_class = 'open_existing' then
                v_expect := 'allow';
              elsif v_class = 'no_rule' then
                v_expect := 'deny';
              elsif v_phase = 'applied' then
                v_expect := 'allow';
              else
                v_expect := 'deny';
              end if;
            else
              if v_kind = 'reassign' then
                v_expect := 'deny';
              elsif v_kind = 'set' then
                v_expect := 'allow';
              elsif v_is_tr then
                if v_op in ('SELECT', 'INSERT') then
                  v_expect := 'allow';
                elsif v_op = 'UPDATE' then
                  v_expect := case when v_label = 'admin_post' and r.tbl = any (c_tr8) then 'allow' else 'deny' end;
                else
                  v_expect := case when v_label = 'admin_post' and r.tbl = any (c_tr10) then 'allow' else 'deny' end;
                end if;
              elsif r.tbl = 'aus_intspk' then
                if v_op = 'SELECT' then
                  v_expect := case when v_label in ('member_a', 'member_b', 'admin_post') then 'allow' else 'deny' end;
                elsif v_op = 'INSERT' then
                  v_expect := 'allow';
                else
                  v_expect := 'deny';
                end if;
              elsif r.tbl = 'toefl_actual_scores' then
                if v_op = 'SELECT' then
                  v_expect := case
                    when v_label = 'admin_post' then 'allow'
                    when v_label = 'member_a' then 'own_a'
                    when v_label = 'member_b' then 'own_b'
                    else 'deny' end;
                else
                  v_expect := case when v_label = 'admin_post' then 'allow' else 'deny' end;
                end if;
              else
                v_expect := case when v_label = 'admin_post' then 'allow' else 'deny' end;
              end if;
            end if;

            if v_kind = 'select' then
              v_exp_visible := case v_expect
                when 'allow' then pg_catalog.jsonb_build_array(r.k1t, r.k2t)
                when 'own_a' then pg_catalog.jsonb_build_array(r.k1t)
                when 'own_b' then pg_catalog.jsonb_build_array(r.k2t)
                else '[]'::pg_catalog.jsonb end;
            else
              v_exp_visible := null;
            end if;

            -- 요청 하나 = 세이브포인트 하나. 끝나면 되돌려 다음 요청이 같은 처음 값에서 시작한다.
            v_sqlstate := null; v_msg := null; v_rows := null; v_rows2 := null;
            v_visible := null; v_before := null; v_after := null;
            begin
              execute v_state into v_before;

              perform pg_catalog.set_config('request.jwt.claims', v_claim, true);
              execute pg_catalog.format('set local role %I', v_role);

              begin
                if v_kind = 'select' then
                  execute v_sqls[v_oi] into v_visible;
                else
                  execute v_sqls[v_oi];
                  get diagnostics v_rows = row_count;
                  if v_kind = 'set' then
                    execute v_sql2s[v_oi];
                    get diagnostics v_rows2 = row_count;
                  end if;
                end if;
              exception when others then
                v_sqlstate := sqlstate;
                v_msg := sqlerrm;
              end;

              execute 'set local role none';
              perform pg_catalog.set_config('request.jwt.claims', '', true);

              execute v_state into v_after;

              raise exception using errcode = 'B2N1R', message = 'b2n1 rollback';
            exception when sqlstate 'B2N1R' then
              null;
            end;

            -- 판정
            if v_kind = 'select' then
              if v_sqlstate is not null then
                v_actual := 'error';
              elsif v_visible = pg_catalog.jsonb_build_array(r.k1t, r.k2t) then
                v_actual := 'allow';
              elsif v_visible = pg_catalog.jsonb_build_array(r.k1t) then
                v_actual := 'own_a';
              elsif v_visible = pg_catalog.jsonb_build_array(r.k2t) then
                v_actual := 'own_b';
              elsif v_visible = '[]'::pg_catalog.jsonb then
                v_actual := 'deny';
              else
                v_actual := 'anomaly';
              end if;
              v_match := (v_sqlstate is null and v_visible = v_exp_visible and v_after = v_before);
            elsif v_kind = 'insert' then
              if v_sqlstate = '42501' and v_after = v_before then
                v_actual := 'deny';
              elsif v_sqlstate is not null then
                v_actual := 'error';      -- 중복 키·필수 열 누락·제약 위반 등은 권한 거절로 세지 않는다
              elsif (v_after ? v_tgt) and (v_after - v_tgt) = v_before then
                v_actual := 'allow';
              else
                v_actual := 'anomaly';
              end if;
              v_match := (v_actual = v_expect);
            elsif v_kind = 'update' then
              if v_sqlstate is null and v_rows = 1
                 and pg_catalog.starts_with(coalesce(v_after ->> v_tgt, ''), 'changed')
                 and (v_after - v_tgt) = (v_before - v_tgt) then
                v_actual := 'allow';
              elsif ((v_sqlstate is null and v_rows = 0) or v_sqlstate = '42501') and v_after = v_before then
                v_actual := 'deny';
              elsif v_sqlstate is not null then
                v_actual := 'error';
              else
                v_actual := 'anomaly';
              end if;
              v_match := (v_actual = v_expect);
            elsif v_kind = 'reassign' then
              if ((v_sqlstate is null and v_rows = 0) or v_sqlstate = '42501') and v_after = v_before then
                v_actual := 'deny';
              elsif v_sqlstate is null and v_rows = 1 then
                v_actual := 'allow';
              elsif v_sqlstate is not null then
                v_actual := 'error';
              else
                v_actual := 'anomaly';
              end if;
              v_match := (v_actual = v_expect);
            elsif v_kind = 'delete' then
              if v_sqlstate is null and v_rows = 1 and not (v_after ? v_tgt) and v_after = (v_before - v_tgt) then
                v_actual := 'allow';
              elsif ((v_sqlstate is null and v_rows = 0) or v_sqlstate = '42501') and v_after = v_before then
                v_actual := 'deny';
              elsif v_sqlstate is not null then
                v_actual := 'error';
              else
                v_actual := 'anomaly';
              end if;
              v_match := (v_actual = v_expect);
            else  -- set: 삭제 → 다시 넣기
              if v_sqlstate is null and v_rows = 1 and v_rows2 = 1
                 and pg_catalog.starts_with(coalesce(v_after ->> v_tgt, ''), 'reinserted')
                 and (v_after - v_tgt) = (v_before - v_tgt) then
                v_actual := 'allow';
              elsif v_after = v_before then
                v_actual := 'deny';
              elsif v_sqlstate is not null then
                v_actual := 'error';
              else
                v_actual := 'anomaly';
              end if;
              v_match := (v_actual = v_expect);
            end if;

            v_results := v_results || pg_catalog.jsonb_build_object(
              'phase', v_phase,
              'tbl', r.tbl,
              'op', v_op,
              'actor', v_label,
              'variant', v_variant,
              'class', v_class,
              'not_given5', (v_cell = any (c_not_given)),
              'expect', v_expect,
              'actual', v_actual,
              'match', coalesce(v_match, false),
              'rows', v_rows,
              'rows2', v_rows2,
              'sqlstate', v_sqlstate,
              'msg', v_msg,
              'visible', v_visible,
              'before', v_before,
              'after', case when v_after = v_before then pg_catalog.to_jsonb('= before'::pg_catalog.text) else v_after end
            );
          end loop;  -- 요청
        end loop;    -- 자격
      end loop;      -- 표
    end loop;        -- 단계

    -- 2-4. 여기까지의 변화(옛 규칙 삭제 포함)를 전부 되돌린다
    raise exception using errcode = 'B2N1X', message = 'b2n1 rehearsal rollback';
  exception when sqlstate 'B2N1X' then
    null;
  end;

  -- ------------------------------------------------------------------
  -- 3. 되돌린 뒤 규칙 지문
  -- ------------------------------------------------------------------
  select pg_catalog.count(*),
         pg_catalog.md5(coalesce(pg_catalog.string_agg(
           p.tablename::pg_catalog.text || '|' || p.policyname::pg_catalog.text || '|' || p.permissive || '|' || p.roles::pg_catalog.text || '|'
           || p.cmd || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''),
           E'\n' order by p.tablename::pg_catalog.text, p.policyname::pg_catalog.text), ''))
    into v_n_after, v_fp_after
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename::pg_catalog.text = any (c_all14);

  -- ------------------------------------------------------------------
  -- 4. 요약
  -- ------------------------------------------------------------------
  select pg_catalog.jsonb_build_object(
    'total', pg_catalog.count(*),
    'mismatch', pg_catalog.count(*) filter (where not (e ->> 'match')::pg_catalog.bool),
    'by_phase', (
      select pg_catalog.jsonb_object_agg(x.phase, x.j)
        from (
          select e2 ->> 'phase' as phase,
                 pg_catalog.jsonb_build_object(
                   'total', pg_catalog.count(*),
                   'mismatch', pg_catalog.count(*) filter (where not (e2 ->> 'match')::pg_catalog.bool)) as j
            from pg_catalog.jsonb_array_elements(v_results) as e2
           group by e2 ->> 'phase'
        ) x
    ),
    -- 예행: 비로그인이 거절된 32칸(표·동작). 정확히 32여야 한다.
    'rehearsal_anon_denied_target32_cells', (
      select pg_catalog.count(*)
        from (
          select (e3 ->> 'tbl') || ' ' || (e3 ->> 'op') as cell
            from pg_catalog.jsonb_array_elements(v_results) as e3
           where e3 ->> 'phase' = 'rehearsal' and e3 ->> 'actor' = 'anon' and e3 ->> 'class' = 'target32'
           group by 1
          having pg_catalog.bool_and(e3 ->> 'actual' = 'deny')
        ) y
    ),
    -- 예행: 남은 허용(이미 모든 역할에 열린 동작 — 통과로 세지 않는다). 비로그인 기준 23칸이어야 한다.
    'rehearsal_anon_remaining_open_cells', (
      select coalesce(pg_catalog.jsonb_agg(z.cell order by z.cell), '[]'::pg_catalog.jsonb)
        from (
          select distinct (e4 ->> 'tbl') || ' ' || (e4 ->> 'op') as cell
            from pg_catalog.jsonb_array_elements(v_results) as e4
           where e4 ->> 'phase' = 'rehearsal' and e4 ->> 'actor' = 'anon' and e4 ->> 'actual' = 'allow'
        ) z
    ),
    -- 예행: 일부러 규칙을 주지 않은 5칸의 관리자 6자리 후 결과(전부 deny 여야 한다)
    'rehearsal_not_given5_admin_post', (
      select coalesce(pg_catalog.jsonb_object_agg((e5 ->> 'tbl') || ' ' || (e5 ->> 'op'), e5 ->> 'actual'), '{}'::pg_catalog.jsonb)
        from pg_catalog.jsonb_array_elements(v_results) as e5
       where e5 ->> 'phase' = 'rehearsal' and e5 ->> 'actor' = 'admin_post' and (e5 ->> 'not_given5')::pg_catalog.bool
    ),
    -- 예행: aus_intspk 넣기(남긴 규칙 둘)의 역할별 결과 — 둘 다 allow 가 기대값(기존 노출로 기록)
    'rehearsal_aus_intspk_insert', (
      select coalesce(pg_catalog.jsonb_object_agg(e6 ->> 'actor', e6 ->> 'actual'), '{}'::pg_catalog.jsonb)
        from pg_catalog.jsonb_array_elements(v_results) as e6
       where e6 ->> 'phase' = 'rehearsal' and e6 ->> 'tbl' = 'aus_intspk' and e6 ->> 'op' = 'INSERT'
    )
  )
    into v_summary
    from pg_catalog.jsonb_array_elements(v_results) as e;

  return pg_catalog.jsonb_build_object(
    'ran_at', pg_catalog.now(),
    'ref_asserted', p_ref,
    'actors', pg_catalog.jsonb_build_object(
      'member_a', v_a_member, 'member_b', v_b_member,
      'admin_pre', v_g1_note,
      'sessions_found', pg_catalog.jsonb_build_object('a', v_a_sid is not null, 'b', v_b_sid is not null, 'n', v_n_sid is not null, 'g_aal2', v_g2_sid is not null)
    ),
    'policy_fp', pg_catalog.jsonb_build_object(
      'before_n', v_n_before, 'before', v_fp_before,
      'during_rehearsal_n', v_n_dropped, 'during_rehearsal', v_fp_dropped,
      'after_n', v_n_after, 'after', v_fp_after,
      'restored', (v_fp_after is not distinct from v_fp_before and v_n_after is not distinct from v_n_before)
    ),
    'dropped_in_rehearsal', v_dropped,
    'old_policies_kept_in_rehearsal', v_kept,
    'insert_payload_valid', v_valid,
    'summary', v_summary,
    'results', v_results
  );
end;
$b2n1_fn$;

-- 꺾쇠 4개를 합성 계정의 로그인 계정 번호(auth.users.id)로 바꾼 뒤, 위 create function 과 함께 한 요청으로 보낸다.
-- 마지막 인자: true = 옛·새 규칙이 함께 있는 상태의 판정(applied)도 함께 / false = 예행(rehearsal)만.
select pg_temp.b2n1_rehearsal(
  'hmncdheiwqwekdbtijar',
  '<A_계정번호>'::uuid,
  '<B_계정번호>'::uuid,
  '<N_계정번호>'::uuid,
  '<G_계정번호>'::uuid,
  true
) as result;
