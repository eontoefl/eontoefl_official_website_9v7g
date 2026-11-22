-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2a: 실측 전용 임시 규칙 올리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서와 쓰임은 같은 폴더의 절차.md 를 따른다.
-- 운영에는 절대 실행하지 않는다.
--
-- 하는 일: storage.objects 에 임시 규칙 12개를 만든다. 이름은 전부 zz_b2n2a_ 로 시작하고 전부 to authenticated.
--   임시 버킷 5개(전부 비공개)는 measure.mjs 의 probe-buckets 단계가 Storage 버킷 관리 API 로 먼저 만든다.
--   이 파일은 임시 규칙만 다룬다(버킷·객체 행·권한·RLS 설정은 건드리지 않는다).
--
--   올리기 요건 실측용 4개 버킷 — 조건은 "버킷 일치"뿐
--     zz-b2n2a-up-i     올리기만                 zz_b2n2a_i_insert
--     zz-b2n2a-up-is    올리기 + 읽기            zz_b2n2a_is_insert, zz_b2n2a_is_select
--     zz-b2n2a-up-iu    올리기 + 수정            zz_b2n2a_iu_insert, zz_b2n2a_iu_update
--     zz-b2n2a-up-isu   올리기 + 읽기 + 수정     zz_b2n2a_isu_insert, zz_b2n2a_isu_select, zz_b2n2a_isu_update
--   판정 함수 실측용 1개 버킷 — 2-가의 판정 함수 사용
--     zz-b2n2a-fn       올리기·읽기·수정·삭제 각각   zz_b2n2a_fn_insert / _select / _update / _delete
--       회원은 경로의 첫 구간이 자기 회원번호(글자형 도우미 current_member_id_text())와 정확히 같은 폴더에만,
--       관리자(is_current_admin())는 첫 구간이 'admin' 인 폴더에.
--       첫 구간은 storage.foldername(name) 의 첫 원소다(폴더 없이 버킷 바로 아래에 둔 파일은 첫 구간이 없어 거절).
--
-- 실행 방법: 같은 접속에서 먼저  set b2n2a.test_project_ref = 'hmncdheiwqwekdbtijar';
-- 내리기: probe_down.sql
-- =====================================================================

begin;

do $zz_b2n2a_pre$
declare
  v_missing text;
  v_count   bigint;
begin
  if coalesce(pg_catalog.current_setting('b2n2a.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zz_b2n2a 임시 규칙 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b2n2a.test_project_ref 를 먼저 실행할 것';
  end if;

  -- 임시 버킷 5개가 먼저 있어야 하고 전부 비공개여야 한다
  select pg_catalog.string_agg(w.id, ', ' order by w.id)
    into v_missing
    from (
      values ('zz-b2n2a-up-i'::pg_catalog.text), ('zz-b2n2a-up-is'), ('zz-b2n2a-up-iu'), ('zz-b2n2a-up-isu'), ('zz-b2n2a-fn')
    ) as w(id)
   where not exists (select 1 from storage.buckets b where b.id = w.id and b.public is false);
  if v_missing is not null then
    raise exception 'zz_b2n2a 임시 규칙 중단: 임시 버킷이 없거나 비공개가 아니다: % (먼저 measure.mjs --phase probe-buckets)', v_missing;
  end if;

  -- 2-가의 판정 함수와 실행 권한, 경로를 나누는 함수
  if pg_catalog.to_regprocedure('security_private.current_member_id_text()') is null
     or pg_catalog.to_regprocedure('security_private.is_current_admin()') is null then
    raise exception 'zz_b2n2a 임시 규칙 중단: 2-가의 판정 함수(current_member_id_text·is_current_admin)가 없다';
  end if;
  if not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, 'security_private.current_member_id_text()', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, 'security_private.is_current_admin()', 'EXECUTE') then
    raise exception 'zz_b2n2a 임시 규칙 중단: authenticated 에 판정 함수 실행 권한이 없다';
  end if;
  if pg_catalog.to_regprocedure('storage.foldername(text)') is null then
    raise exception 'zz_b2n2a 임시 규칙 중단: storage.foldername(text) 가 없다';
  end if;

  select pg_catalog.count(*) into v_count
    from pg_catalog.pg_policy pol
   where pol.polname::pg_catalog.text like 'zz\_b2n2a\_%';
  if v_count <> 0 then
    raise exception 'zz_b2n2a 임시 규칙 중단: zz_b2n2a_ 규칙이 이미 % 개 있다(먼저 probe_down.sql)', v_count;
  end if;
end;
$zz_b2n2a_pre$;

-- ---------------------------------------------------------------------
-- 1. 올리기 요건 실측용 (조건은 버킷 일치만)
-- ---------------------------------------------------------------------
-- (가) 올리기만
create policy zz_b2n2a_i_insert on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'zz-b2n2a-up-i');

-- (나) 올리기 + 읽기
create policy zz_b2n2a_is_insert on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'zz-b2n2a-up-is');
create policy zz_b2n2a_is_select on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'zz-b2n2a-up-is');

-- (다) 올리기 + 수정
create policy zz_b2n2a_iu_insert on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'zz-b2n2a-up-iu');
create policy zz_b2n2a_iu_update on storage.objects
  as permissive for update to authenticated
  using (bucket_id = 'zz-b2n2a-up-iu')
  with check (bucket_id = 'zz-b2n2a-up-iu');

-- (라) 올리기 + 읽기 + 수정
create policy zz_b2n2a_isu_insert on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'zz-b2n2a-up-isu');
create policy zz_b2n2a_isu_select on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'zz-b2n2a-up-isu');
create policy zz_b2n2a_isu_update on storage.objects
  as permissive for update to authenticated
  using (bucket_id = 'zz-b2n2a-up-isu')
  with check (bucket_id = 'zz-b2n2a-up-isu');

-- ---------------------------------------------------------------------
-- 2. 판정 함수 실측용 (2-가의 함수를 (select …) 꼴로)
--    회원: 첫 구간 = 자기 회원번호(글자) / 관리자: 첫 구간 = 'admin'
-- ---------------------------------------------------------------------
create policy zz_b2n2a_fn_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'zz-b2n2a-fn'
    and (
      (storage.foldername(name))[1] = (select security_private.current_member_id_text())
      or ((storage.foldername(name))[1] = 'admin' and (select security_private.is_current_admin()))
    )
  );

create policy zz_b2n2a_fn_select on storage.objects
  as permissive for select to authenticated
  using (
    bucket_id = 'zz-b2n2a-fn'
    and (
      (storage.foldername(name))[1] = (select security_private.current_member_id_text())
      or ((storage.foldername(name))[1] = 'admin' and (select security_private.is_current_admin()))
    )
  );

create policy zz_b2n2a_fn_update on storage.objects
  as permissive for update to authenticated
  using (
    bucket_id = 'zz-b2n2a-fn'
    and (
      (storage.foldername(name))[1] = (select security_private.current_member_id_text())
      or ((storage.foldername(name))[1] = 'admin' and (select security_private.is_current_admin()))
    )
  )
  with check (
    bucket_id = 'zz-b2n2a-fn'
    and (
      (storage.foldername(name))[1] = (select security_private.current_member_id_text())
      or ((storage.foldername(name))[1] = 'admin' and (select security_private.is_current_admin()))
    )
  );

create policy zz_b2n2a_fn_delete on storage.objects
  as permissive for delete to authenticated
  using (
    bucket_id = 'zz-b2n2a-fn'
    and (
      (storage.foldername(name))[1] = (select security_private.current_member_id_text())
      or ((storage.foldername(name))[1] = 'admin' and (select security_private.is_current_admin()))
    )
  );

-- ---------------------------------------------------------------------
-- 3. 자기 점검: 임시 규칙이 정확히 12개이고 전부 storage.objects·authenticated 하나
-- ---------------------------------------------------------------------
do $zz_b2n2a_check$
declare
  v_count bigint;
  v_bad   bigint;
begin
  select pg_catalog.count(*),
         pg_catalog.count(*) filter (
           where pol.polrelid <> 'storage.objects'::pg_catalog.regclass
              or pol.polpermissive is not true
              or coalesce((select pg_catalog.array_agg(r.rolname::pg_catalog.text order by r.rolname::pg_catalog.text)
                             from pg_catalog.pg_roles r where r.oid = any (pol.polroles)), '{}'::pg_catalog.text[])::pg_catalog.text <> '{authenticated}'
              or (0::pg_catalog.oid = any (pol.polroles))
         )
    into v_count, v_bad
    from pg_catalog.pg_policy pol
   where pol.polname::pg_catalog.text like 'zz\_b2n2a\_%';
  if v_count <> 12 then
    raise exception 'zz_b2n2a 임시 규칙 자기 점검 실패: zz_b2n2a_ 규칙이 % 개(12여야 함)', v_count;
  end if;
  if v_bad <> 0 then
    raise exception 'zz_b2n2a 임시 규칙 자기 점검 실패: storage.objects·authenticated 전용이 아닌 규칙이 % 개', v_bad;
  end if;
end;
$zz_b2n2a_check$;

commit;
