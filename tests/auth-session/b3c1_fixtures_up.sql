-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-1 화면 시험의 합성 업무 자료 넣기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다(작업방은 Supabase 로 요청을 보내지 않는다).
-- 작업방은 public.applications 의 열 정의를 확인하지 못했다(2026-11-22 의 표 정의 실측 14개에 이 표가 없다).
-- 그래서 넣기 전에 이 파일이 스스로 본다: 필요한 열이 있는가, 채우지 않는 "빈 값 금지·기본값 없음" 열이 있는가.
-- 하나라도 어긋나면 아무것도 넣지 않고 멈춘다(그때는 멈춘 이유에 적힌 열을 보고 이 파일을 고쳐야 한다).
-- 운영에는 절대 실행하지 않는다.
--
-- 넣는 것: 합성 회원 A 의 합성 신청서 한 줄(회원 화면 — 대시보드·신청서 상세·개별분석 — 이 조회할 행).
--   번호  00000000-0000-4000-8000-0000b3c1a001   (실행기의 환경 변수 B3C_APP_A 에 이 값을 준다)
--   이름  zz_b3c1 합성 신청서 A
--   이메일  합성 회원 A 의 이메일(아래 b3c1.email_a 로 준다 — 이 파일에 적지 않는다)
--
-- 실행 방법: 이 파일을 실행하는 같은 접속에서 먼저 두 값을 정한다(없거나 다르면 첫 블록에서 멈춘다).
--   set b3c1.test_project_ref = 'hmncdheiwqwekdbtijar';
--   set b3c1.email_a = '<합성 회원 A 의 이메일 — 실행기의 B3A_EMAIL_A 와 같은 값>';
-- 내리기: b3c1_fixtures_down.sql (넣은 행의 번호·이메일·이름·종류가 전부 맞을 때만 지운다)
-- =====================================================================

begin;

do $zz_b3c1$
declare
  v_ref     text := coalesce(pg_catalog.current_setting('b3c1.test_project_ref', true), '');
  v_email   text := coalesce(pg_catalog.current_setting('b3c1.email_a', true), '');
  v_id      constant text := '00000000-0000-4000-8000-0000b3c1a001';
  v_name    constant text := 'zz_b3c1 합성 신청서 A';
  v_type    constant text := 'challenge';
  v_cols    constant text[] := array['id', 'email', 'name', 'application_type', 'deleted'];
  v_col     text;
  v_missing text;
  v_id_type text;
  v_del_type text;
  v_n       bigint;
begin
  -- 0. 대상 확인(실행하는 사람이 시험 프로젝트임을 직접 적었는지)
  if v_ref <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zz_b3c1 합성 자료 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b3c1.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 먼저 실행할 것';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'zz_b3c1 합성 자료 중단: 합성 회원 A 의 이메일(b3c1.email_a)이 없거나 모양이 맞지 않다';
  end if;

  -- 1. 필요한 열이 있는가
  foreach v_col in array v_cols loop
    perform 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'applications' and c.column_name = v_col;
    if not found then
      raise exception 'zz_b3c1 합성 자료 중단: public.applications 에 % 열이 없다(이 파일이 가정한 열과 다르다)', v_col;
    end if;
  end loop;

  -- 2. 채우지 않는 "빈 값 금지·기본값 없음" 열이 있으면 멈춘다(그 열에 무엇을 넣을지 이 파일은 모른다)
  select pg_catalog.string_agg(c.column_name, ', ' order by c.ordinal_position) into v_missing
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'applications'
     and c.is_nullable = 'NO' and c.column_default is null and c.is_identity = 'NO'
     and not (c.column_name = any (v_cols));
  if v_missing is not null then
    raise exception 'zz_b3c1 합성 자료 중단: 이 파일이 채우지 않는 필수 열이 있다: %', v_missing;
  end if;

  select c.udt_name into v_id_type from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'applications' and c.column_name = 'id';
  select c.udt_name into v_del_type from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'applications' and c.column_name = 'deleted';
  if v_id_type not in ('uuid', 'text', 'varchar') then
    raise exception 'zz_b3c1 합성 자료 중단: applications.id 의 형이 uuid·글자형이 아니다(%)', v_id_type;
  end if;
  if v_del_type not in ('bool', 'text', 'varchar') then
    raise exception 'zz_b3c1 합성 자료 중단: applications.deleted 의 형이 참거짓·글자형이 아니다(%)', v_del_type;
  end if;

  -- 3. 합성 회원 A 가 회원 표에 한 줄 있는가(이 신청서의 주인)
  select pg_catalog.count(*) into v_n from public.users u where u.email = v_email;
  if v_n <> 1 then
    raise exception 'zz_b3c1 합성 자료 중단: 회원 표에 그 이메일의 회원이 한 줄이 아니다(%줄)', v_n;
  end if;

  -- 4. 충돌 검사: 같은 번호의 행이나, 그 이메일로 된 신청서가 이미 있으면 넣지 않는다
  execute pg_catalog.format('select pg_catalog.count(*) from public.applications a where a.id::text = %L', v_id) into v_n;
  if v_n <> 0 then
    raise exception 'zz_b3c1 합성 자료 중단: 같은 번호의 신청서가 이미 있다(앞 실행의 것이 남았는지 확인할 것)';
  end if;
  select pg_catalog.count(*) into v_n from public.applications a where a.email = v_email;
  if v_n <> 0 then
    raise exception 'zz_b3c1 합성 자료 중단: 합성 회원 A 의 이메일로 된 신청서가 이미 있다(%줄) — 합성 자료가 아닌 행과 섞이므로 넣지 않는다', v_n;
  end if;

  -- 5. 넣기(한 줄)
  execute pg_catalog.format(
    'insert into public.applications (id, email, name, application_type, deleted) values (%L::%I, %L, %L, %L, %L::%I)',
    v_id, v_id_type, v_email, v_name, v_type, 'false', v_del_type);
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zz_b3c1 합성 자료 중단: 넣은 줄이 한 줄이 아니다(%줄)', v_n;
  end if;

  -- 6. 다시 조회: 넣은 줄이 기대 값 그대로 한 줄인가
  execute pg_catalog.format(
    'select pg_catalog.count(*) from public.applications a where a.id::text = %L and a.email = %L and a.name = %L and a.application_type = %L',
    v_id, v_email, v_name, v_type) into v_n;
  if v_n <> 1 then
    raise exception 'zz_b3c1 합성 자료 중단: 넣은 뒤 다시 조회한 줄이 기대와 다르다(%줄)', v_n;
  end if;
  raise notice 'zz_b3c1 합성 자료: 합성 신청서 한 줄을 넣음(번호 %). 실행기의 B3C_APP_A 에 이 번호를 줄 것', v_id;
end;
$zz_b3c1$;

commit;
