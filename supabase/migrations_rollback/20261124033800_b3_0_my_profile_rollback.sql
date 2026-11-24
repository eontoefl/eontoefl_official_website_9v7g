-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 되돌리기
-- 대상: supabase/migrations/20261124033800_b3_0_my_profile.sql 이 만든 것만 지운다 — 함수 public.my_profile() 하나.
--   * 다른 것은 건드리지 않는다. cascade 를 쓰지 않는다(restrict) — 이 함수에 기대는 것이 있으면 그 자리에서 실패하고,
--     한 트랜잭션이므로 아무것도 지워지지 않는다.
--   * 이 함수는 공통 확인 설정(pgrst.db_pre_request)과 무관하다(그 설정이 가리키는 것은 2-가의 함수다).
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다).
--
-- 지우기 전에 스스로 확인하는 것(하나라도 다르면 아무것도 지우지 않고 멈춘다)
--   1. public.my_profile 이라는 이름의 함수가 정확히 하나이고 인자가 없다
--      (하나도 없으면 "지울 것이 없다"고 적고 끝낸다 — 오류가 아니다)
--   2. 그 함수의 모양이 마이그레이션이 만든 것과 같다: plpgsql · jsonb 반환 · volatile · security definer
--   3. 그 함수의 본문이 마이그레이션의 것과 같다. 본문(pg_proc.prosrc)에서 줄 끝의 CR 을 뺀 글자의 md5 를
--      아래 값과 견준다(작업방이 마이그레이션 파일의 본문으로 계산한 값):
--          ea1fd98d18ba93cb4944e7a00c86bc7c
--      SQL 통로가 본문의 글자를 바꿔 보내는 경우(줄 끝 말고)에는 이 값이 맞지 않을 수 있다. 그때만, 마이그레이션을
--      적용한 직후에 지문(supabase/tests/b3_0_my_profile/fingerprint.sql)으로 읽어 적어 둔 body_md5 를 같은 요청에서
--      넘긴다:   set b3_0.applied_body_md5 = '<적어 둔 값>';
--      (넘긴 값이 있으면 그 값과 견준다. 지우기 직전에 읽은 값을 넘기면 이 확인의 뜻이 없어진다 — 절차.md)
-- =====================================================================

begin;

do $b3_0_rb$
declare
  v_expected constant text := 'ea1fd98d18ba93cb4944e7a00c86bc7c';
  v_given    text := coalesce(pg_catalog.current_setting('b3_0.applied_body_md5', true), '');
  v_want     text;
  v_n        bigint;
  v_fn       record;
  v_md5      text;
begin
  if v_given <> '' and v_given !~ '^[0-9a-f]{32}$' then
    raise exception 'b3_0 되돌리기 중단: b3_0.applied_body_md5 의 값이 md5 모양이 아니다. 아무것도 지우지 않았다';
  end if;
  v_want := case when v_given <> '' then v_given else v_expected end;

  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_profile';

  if v_n = 0 then
    raise notice 'b3_0 되돌리기: public.my_profile 이 없다. 지울 것이 없다';
    return;
  end if;
  if v_n <> 1 then
    raise exception 'b3_0 되돌리기 중단: public.my_profile 이라는 이름의 함수가 %개다(하나여야 한다). 아무것도 지우지 않았다', v_n;
  end if;

  select p.oid, p.pronargs, p.prosecdef, p.provolatile, p.prorettype, l.lanname,
         pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) as body_md5
    into v_fn
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.proname = 'my_profile';

  if v_fn.pronargs <> 0 then
    raise exception 'b3_0 되돌리기 중단: 그 함수에 인자가 %개 있다(이 마이그레이션이 만든 것이 아니다). 아무것도 지우지 않았다', v_fn.pronargs;
  end if;
  if v_fn.lanname <> 'plpgsql'
     or v_fn.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype
     or v_fn.provolatile <> 'v'
     or v_fn.prosecdef is not true then
    raise exception 'b3_0 되돌리기 중단: 그 함수의 모양이 마이그레이션이 만든 것과 다르다(언어 % · volatile % · security definer %). 아무것도 지우지 않았다',
      v_fn.lanname, v_fn.provolatile, v_fn.prosecdef;
  end if;
  v_md5 := v_fn.body_md5;
  if v_md5 <> v_want then
    raise exception 'b3_0 되돌리기 중단: 그 함수의 본문이 견줄 값과 다르다(지금 % / 견줄 값 %). 아무것도 지우지 않았다', v_md5, v_want;
  end if;

  drop function public.my_profile() restrict;
end;
$b3_0_rb$;

commit;
