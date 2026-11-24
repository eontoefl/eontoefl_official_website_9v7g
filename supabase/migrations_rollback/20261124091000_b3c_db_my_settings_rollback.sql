-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB 되돌리기
-- 대상: supabase/migrations/20261124091000_b3c_db_my_settings.sql 이 만든 것만 지운다 — 공개 함수 다섯.
--     public.my_settings()                       public.my_book_answers()
--     public.my_intro_track_set(text)            public.my_marketing_consent_set(jsonb)
--     public.my_book_answers_hold(jsonb)
--   * 다른 것은 건드리지 않는다(public.my_profile(), 2-가의 객체, 회원 표). cascade 를 쓰지 않는다(restrict) —
--     이 함수들에 기대는 것이 있으면 그 자리에서 실패하고, 한 트랜잭션이므로 아무것도 지워지지 않는다.
--   * 다섯을 한꺼번에: 다섯 모두가 "적용한 그 함수"일 때만 다섯을 지운다. 하나라도 다르면 하나도 지우지 않는다.
--   * 회원 표의 값(이 함수들이 그동안 고친 열의 값)은 되돌리지 않는다 — 함수만 지운다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다).
--
-- 받는 값(같은 요청의 맨 앞). **적용한 직후**에 지문(supabase/tests/b3c_db_my_settings/fingerprint.sql)으로 읽어 적어 둔 값이다.
--     set b3c.applied = '{"my_settings":{"oid":"<oid>","def_md5":"<md5>"},"my_book_answers":{…},"my_intro_track_set":{…},
--                         "my_marketing_consent_set":{…},"my_book_answers_hold":{…}}';
--   (node settings_matrix.mjs --phase set-lines --for rollback --fingerprint <적용 직후의 지문> 이 그 줄을 만들어 준다.)
--   def_md5 는 md5(pg_get_functiondef(oid)). 지우기 직전에 읽은 값을 넘기면 "적용한 그 함수인가"의 확인이 뜻을 잃는다 —
--   적용 직후에 적어 둔 값만 넘긴다.
--
-- 지우기 전에 스스로 확인하는 것(값이 없거나 하나라도 다르면 아무것도 지우지 않고 멈춘다)
--   0. 위 값이 있고 다섯 함수의 oid · def_md5 가 전부 들어 있다(없으면 지우지 않는다)
--   1. 다섯 이름의 함수가 public 에 하나도 없으면 "지울 것이 없다"고 적고 끝낸다(오류가 아니다).
--      일부만 있으면 멈춘다(이 마이그레이션은 다섯을 한꺼번에 만든다 — 일부만 있는 것은 사람이 확인할 상태다)
--   2. 이름마다 함수가 정확히 하나이고, 인자의 형이 마이그레이션이 만든 것과 같다
--   3. 모양이 같다: plpgsql · jsonb 반환 · volatile · security definer
--   4. **oid 와 전체 정의의 md5 가 넘겨받은 값과 둘 다 같다**
--      (누가 같은 이름으로 다시 만들었으면 oid 가, 정의나 설정을 바꿨으면 md5 가 달라진다)
--   5. 본문이 마이그레이션의 것과 같다. 본문(pg_proc.prosrc)에서 줄 끝의 CR 을 뺀 글자의 md5 를 아래 값과 견준다
--      (작업방이 마이그레이션 파일의 본문으로 계산한 값 — node settings_matrix.mjs --phase body-md5 가 같은 계산을 한다):
--          my_settings                1b860ef5b7f7ff1a78492f1206b7a113
--          my_book_answers            da4a5694b1a0e37c9f95524e1f9cb04a
--          my_intro_track_set         9d28cb0a39eaca18e65c517b587802c4
--          my_marketing_consent_set   ec578f66f7a166e3195add7e0af8178f
--          my_book_answers_hold       8db28a1bcf35981ccc44ec27078baf58
--      이 값이 지금의 함수와 다르면 이 파일은 멈춘다. **도구(set-lines --for rollback)도 지문의 body_md5 가 파일에서 계산한
--      값과 다르면 멈추고, 견줄 값을 스스로 바꿔 넘기지 않는다.** 원인을 사람이 확인해야 한다(누가 함수를 바꿨는가,
--      SQL 통로가 본문의 글자를 바꿔 보냈는가).
--      사람이 원인을 확인하고 "적용한 그 함수가 맞다"고 판단한 경우에만, 적용 직후의 지문에서 적어 둔 body_md5 를
--      손으로 같은 요청에 넘길 수 있다(이름 → md5 의 JSON. 넘긴 이름만 그 값으로 견준다). 도구는 이 줄을 만들지 않는다:
--          set b3c.applied_body_md5 = '{"my_settings":"<적어 둔 값>"}';
-- =====================================================================

begin;

do $b3c_rb$
declare
  v_names  constant text[] := array[
    'my_settings', 'my_book_answers', 'my_intro_track_set', 'my_marketing_consent_set', 'my_book_answers_hold'];
  v_args   constant text[] := array['', '', 'text', 'jsonb', 'jsonb'];   -- pg_get_function_identity_arguments 에서 인자 이름을 뺀 것
  v_bodies constant text[] := array[
    '1b860ef5b7f7ff1a78492f1206b7a113',
    'da4a5694b1a0e37c9f95524e1f9cb04a',
    '9d28cb0a39eaca18e65c517b587802c4',
    'ec578f66f7a166e3195add7e0af8178f',
    '8db28a1bcf35981ccc44ec27078baf58'];
  v_raw_applied text := coalesce(pg_catalog.current_setting('b3c.applied', true), '');
  v_raw_bodies  text := coalesce(pg_catalog.current_setting('b3c.applied_body_md5', true), '');
  v_applied     jsonb;
  v_given       jsonb := '{}'::pg_catalog.jsonb;
  v_name        text;
  v_want_oid    text;
  v_want_def    text;
  v_want_body   text;
  v_total       bigint;
  v_n           bigint;
  v_fn          record;
begin
  -- 0. 받은 값
  if v_raw_applied = '' then
    raise exception 'b3c 되돌리기 중단: 적용 직후의 함수 oid 와 전체 정의 md5 를 받지 못했다. 같은 요청의 맨 앞에 set b3c.applied = ''{…}''; 를 둘 것(settings_matrix.mjs --phase set-lines --for rollback). 아무것도 지우지 않았다';
  end if;
  begin
    v_applied := v_raw_applied::pg_catalog.jsonb;
  exception when others then
    raise exception 'b3c 되돌리기 중단: b3c.applied 의 값이 JSON 이 아니다. 아무것도 지우지 않았다';
  end;
  if pg_catalog.jsonb_typeof(v_applied) is distinct from 'object' then
    raise exception 'b3c 되돌리기 중단: b3c.applied 의 값이 객체가 아니다. 아무것도 지우지 않았다';
  end if;
  if v_raw_bodies <> '' then
    begin
      v_given := v_raw_bodies::pg_catalog.jsonb;
    exception when others then
      raise exception 'b3c 되돌리기 중단: b3c.applied_body_md5 의 값이 JSON 이 아니다. 아무것도 지우지 않았다';
    end;
    if pg_catalog.jsonb_typeof(v_given) is distinct from 'object' then
      raise exception 'b3c 되돌리기 중단: b3c.applied_body_md5 의 값이 객체가 아니다. 아무것도 지우지 않았다';
    end if;
  end if;
  for i in 1 .. 5 loop
    v_name := v_names[i];
    v_want_oid := coalesce(v_applied -> v_name ->> 'oid', '');
    v_want_def := coalesce(v_applied -> v_name ->> 'def_md5', '');
    if v_want_oid !~ '^[0-9]{1,10}$' or v_want_def !~ '^[0-9a-f]{32}$' then
      raise exception 'b3c 되돌리기 중단: b3c.applied 에 % 의 oid · def_md5 가 없거나 모양이 틀리다. 아무것도 지우지 않았다', v_name;
    end if;
    if (v_given -> v_name) is not null and coalesce(v_given ->> v_name, '') !~ '^[0-9a-f]{32}$' then
      raise exception 'b3c 되돌리기 중단: b3c.applied_body_md5 의 % 값이 md5 모양이 아니다. 아무것도 지우지 않았다', v_name;
    end if;
  end loop;

  -- 1. 다섯 이름의 함수가 몇 개 있는가
  select pg_catalog.count(*) into v_total
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (v_names);
  if v_total = 0 then
    raise notice 'b3c 되돌리기: 다섯 이름의 함수가 public 에 하나도 없다. 지울 것이 없다';
    return;
  end if;

  -- 2~5. 이름마다 확인(하나라도 다르면 여기서 예외 — 아무것도 지우지 않는다)
  for i in 1 .. 5 loop
    v_name := v_names[i];
    select pg_catalog.count(*) into v_n
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_n <> 1 then
      raise exception 'b3c 되돌리기 중단: public.% 이라는 이름의 함수가 %개다(하나여야 한다 — 다섯 이름 전체로는 %개). 아무것도 지우지 않았다', v_name, v_n, v_total;
    end if;

    select p.oid::pg_catalog.text as oid_text, p.prosecdef, p.provolatile, p.prorettype, l.lanname,
           pg_catalog.oidvectortypes(p.proargtypes) as arg_types,
           pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as def_md5,
           pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) as body_md5
      into v_fn
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      join pg_catalog.pg_language l on l.oid = p.prolang
     where n.nspname = 'public' and p.proname = v_name;

    if v_fn.arg_types is distinct from v_args[i] then
      raise exception 'b3c 되돌리기 중단: public.% 의 인자 형이 "%" 이다(이 마이그레이션이 만든 것은 "%"). 아무것도 지우지 않았다', v_name, v_fn.arg_types, v_args[i];
    end if;
    if v_fn.lanname <> 'plpgsql'
       or v_fn.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype
       or v_fn.provolatile <> 'v'
       or v_fn.prosecdef is not true then
      raise exception 'b3c 되돌리기 중단: public.% 의 모양이 마이그레이션이 만든 것과 다르다(언어 % · volatile % · security definer %). 아무것도 지우지 않았다',
        v_name, v_fn.lanname, v_fn.provolatile, v_fn.prosecdef;
    end if;

    v_want_oid := v_applied -> v_name ->> 'oid';
    v_want_def := v_applied -> v_name ->> 'def_md5';
    if v_fn.oid_text <> v_want_oid or v_fn.def_md5 <> v_want_def then
      raise exception 'b3c 되돌리기 중단: 지금의 public.% 이 적용 직후의 것과 다르다(지금 oid % · 정의 md5 % / 받은 oid % · md5 %). 아무것도 지우지 않았다',
        v_name, v_fn.oid_text, v_fn.def_md5, v_want_oid, v_want_def;
    end if;

    v_want_body := coalesce(v_given ->> v_name, v_bodies[i]);
    if v_fn.body_md5 <> v_want_body then
      raise exception 'b3c 되돌리기 중단: public.% 의 본문이 견줄 값과 다르다(지금 % / 견줄 값 %). 아무것도 지우지 않았다', v_name, v_fn.body_md5, v_want_body;
    end if;
  end loop;

  -- 다섯 모두 확인됐다. 다섯을 지운다(이름을 적은 정적 문장)
  drop function public.my_book_answers_hold(jsonb) restrict;
  drop function public.my_marketing_consent_set(jsonb) restrict;
  drop function public.my_intro_track_set(text) restrict;
  drop function public.my_book_answers() restrict;
  drop function public.my_settings() restrict;
end;
$b3c_rb$;

commit;
