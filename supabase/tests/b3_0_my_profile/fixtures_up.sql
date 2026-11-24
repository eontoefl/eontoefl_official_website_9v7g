-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 합성 회원 자료 올리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   운영(qpqjevecjejvbeuogtbx)에서 실행하지 않는다(회원 표에 합성 회원 행이 생긴다).
--   실행 직전에 절차.md 의 대상 확인을 한다: SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 여야 한다.
--   아래의 대상 확인 값(set b3_0.test_project_ref)은 그 확인을 대신하지 않는다 — DB 는 자기 ref 를 스스로 알지 못한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서와 기대 결과는 절차.md 를 따른다.
--
-- 먼저 있어야 하는 것(브레인방이 로그인 서버로 만든다): 합성 로그인 계정 8개. 이메일의 @ 앞이 정확히 아래와 같아야 한다
--   (@ 뒤는 아무 것이나). 이 파일은 그 이름으로 계정을 찾는다.
--     zzb3p0_a   zzb3p0_b   zzb3p0_n   zzb3p0_g   zzb3p0_gm   zzb3p0_blk   zzb3p0_wd   zzb3p0_bw
--
-- 만드는 것(전부 표식 zzb3p0 이 있는 합성 행)
--   public.users 7행                       a · b · gm · blk · wd · bw   (n 과 g 는 대응하는 회원 행이 없다) + 함정 행 1
--     id        새로 만든 값(로그인 계정 번호와 다른 값)
--     email     zzb3p0_<이름>@member.zzb3p0.invalid   (로그인 계정의 이메일과 다른 값)
--     password  zzb3p0-pwcol-<이름>-<무작위 10자>      옛 비밀번호 열에 넣는 합성 표식이다(로그인 비밀번호가 아니다).
--               응답에 이 글자가 실리지 않는지 찾는 데 쓴다
--     blk: blocked = true / wd: withdrawal_requested_at 있음 / bw: 둘 다(차단을 먼저 보는지)
--     gm : nickname·phone 이 NULL(없는 값이 null 로 오는지)
--     함정 행(trap): 회원번호(id)가 대응 없는 계정 n 의 "로그인 계정 번호"와 같은 회원 행. 대응표에는 넣지 않는다.
--                    함수가 로그인 계정 번호를 회원번호로 쓰면 n 에게 이 행이 나간다 — n 의 기대값은 no_member 다
--   security_private.member_identity 6행    위 여섯 계정 ↔ 회원
--   security_private.admin_principal 2행    g · gm
-- 덮어쓰지 않는다: 표식 있는 회원 행·그 계정의 대응·명부 행이 이미 하나라도 있으면 멈춘다.
--
-- 실행 방법: 같은 요청(같은 접속)의 맨 앞에  set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';  를 두고 이 파일 전체.
-- 마지막 결과(한 칸 jsonb): 합성 계정별 로그인 계정 번호·회원 값·기대 상태. expect.json 으로 저장해 도구에 넘긴다(--expect).
-- 내리기: fixtures_down.sql
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_labels constant text[] := array['a', 'b', 'n', 'g', 'gm', 'blk', 'wd', 'bw'];
  v_label  text;
  v_n      bigint;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 합성 자료 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b3_0.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;

  -- 이 DB 가 운영이 아니라는 DB 안의 증거: 파일 객체가 하나도 없다(시험 프로젝트의 지금 상태. 운영에는 수천 개가 있다)
  select pg_catalog.count(*) into v_n from storage.objects;
  if v_n <> 0 then
    raise exception 'zzb3p0 합성 자료 중단: storage.objects 에 객체가 %개 있다 — 시험 프로젝트의 시작 상태가 아니다(운영일 수 있다). 아무것도 바꾸지 않았다', v_n;
  end if;

  if pg_catalog.to_regclass('security_private.member_identity') is null
     or pg_catalog.to_regclass('security_private.admin_principal') is null then
    raise exception 'zzb3p0 합성 자료 중단: 2-가(b2a_identity_gate)가 적용돼 있지 않다';
  end if;

  foreach v_label in array v_labels loop
    select pg_catalog.count(*) into v_n
      from auth.users au
     where pg_catalog.split_part(au.email, '@', 1) = 'zzb3p0_' || v_label;
    if v_n <> 1 then
      raise exception 'zzb3p0 합성 자료 중단: 이메일의 @ 앞이 zzb3p0_% 인 로그인 계정이 %개다(하나여야 한다). 아무것도 바꾸지 않았다', v_label, v_n;
    end if;
  end loop;

  select pg_catalog.count(*) into v_n from public.users u where u.email like 'zzb3p0\_%';
  if v_n <> 0 then
    raise exception 'zzb3p0 합성 자료 중단: 표식 있는 회원 행이 이미 %개 있다. 덮어쓰지 않는다(fixtures_down.sql 을 먼저)', v_n;
  end if;
  select pg_catalog.count(*) into v_n
    from security_private.member_identity mi
   where mi.auth_user_id in (select au.id from auth.users au where au.email like 'zzb3p0\_%');
  if v_n <> 0 then
    raise exception 'zzb3p0 합성 자료 중단: 합성 로그인 계정의 대응 행이 이미 %개 있다. 덮어쓰지 않는다', v_n;
  end if;
  select pg_catalog.count(*) into v_n
    from security_private.admin_principal ap
   where ap.auth_user_id in (select au.id from auth.users au where au.email like 'zzb3p0\_%');
  if v_n <> 0 then
    raise exception 'zzb3p0 합성 자료 중단: 합성 로그인 계정의 관리자 명부 행이 이미 %개 있다. 덮어쓰지 않는다', v_n;
  end if;
end;
$zz_b3p0$;

-- 1. 회원 행 6개
insert into public.users
  (id, email, password, name, nickname, phone, timezone, blocked, withdrawal_requested_at, withdrawal_reason, withdrawal_reason_detail)
select pg_catalog.gen_random_uuid(),
       'zzb3p0_' || t.label || '@member.zzb3p0.invalid',
       'zzb3p0-pwcol-' || t.label || '-' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::pg_catalog.text), 1, 10),
       t.member_name,
       t.nickname,
       t.phone,
       t.tz,
       t.is_blocked,
       case when t.is_withdrawing then pg_catalog.now() end,
       case when t.is_withdrawing then 'zzb3p0-reason-' || t.label end,
       case when t.is_withdrawing then 'zzb3p0-reason-detail-' || t.label end
  from (
    values
      ('a'::pg_catalog.text,   'zzb3p0 회원 에이'::pg_catalog.text,   'zzb3p0_nick_a'::pg_catalog.text,   '01000003001'::pg_catalog.text, 'Asia/Seoul'::pg_catalog.text,       false, false),
      ('b',                    'zzb3p0 회원 비',                      'zzb3p0_nick_b',                    '01000003002',                  'Australia/Sydney',                  false, false),
      ('gm',                   'zzb3p0 관리자겸회원 지엠',             null,                               null,                           'Asia/Seoul',                        false, false),
      ('blk',                  'zzb3p0 차단회원',                     'zzb3p0_nick_blk',                  '01000003004',                  'Asia/Seoul',                        true,  false),
      ('wd',                   'zzb3p0 탈퇴처리중회원',                'zzb3p0_nick_wd',                   '01000003005',                  'Asia/Seoul',                        false, true),
      ('bw',                   'zzb3p0 차단이고탈퇴처리중',            'zzb3p0_nick_bw',                   '01000003006',                  'Asia/Seoul',                        true,  true)
  ) as t(label, member_name, nickname, phone, tz, is_blocked, is_withdrawing);

-- 1-가. 함정 행: 회원번호가 계정 n 의 로그인 계정 번호와 같다(대응표에는 넣지 않는다)
insert into public.users (id, email, password, name, nickname, phone, timezone)
select au.id,
       'zzb3p0_trap@member.zzb3p0.invalid',
       'zzb3p0-pwcol-trap-' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::pg_catalog.text), 1, 10),
       'zzb3p0 함정행 계정번호와같은회원번호',
       'zzb3p0_nick_trap',
       '01000003009',
       'Asia/Seoul'
  from auth.users au
 where pg_catalog.split_part(au.email, '@', 1) = 'zzb3p0_n';

-- 2. 로그인 계정 ↔ 회원 대응 6개(이메일의 @ 앞이 같은 것끼리)
insert into security_private.member_identity (auth_user_id, member_id)
select au.id, u.id
  from auth.users au
  join public.users u
    on u.email = pg_catalog.split_part(au.email, '@', 1) || '@member.zzb3p0.invalid'
 where pg_catalog.split_part(au.email, '@', 1) in ('zzb3p0_a', 'zzb3p0_b', 'zzb3p0_gm', 'zzb3p0_blk', 'zzb3p0_wd', 'zzb3p0_bw');

-- 3. 관리자 명부 2개
insert into security_private.admin_principal (auth_user_id)
select au.id
  from auth.users au
 where pg_catalog.split_part(au.email, '@', 1) in ('zzb3p0_g', 'zzb3p0_gm');

-- 4. 만든 수 확인(다르면 전체가 되돌아간다)
do $zz_b3p0$
declare
  v_users bigint;
  v_maps  bigint;
  v_admin bigint;
  v_same  bigint;
begin
  select pg_catalog.count(*) into v_users from public.users u where u.email like 'zzb3p0\_%@member.zzb3p0.invalid';
  select pg_catalog.count(*) into v_maps
    from security_private.member_identity mi
   where mi.member_id in (select u.id from public.users u where u.email like 'zzb3p0\_%@member.zzb3p0.invalid');
  select pg_catalog.count(*) into v_admin
    from security_private.admin_principal ap
   where ap.auth_user_id in (select au.id from auth.users au where pg_catalog.split_part(au.email, '@', 1) in ('zzb3p0_g', 'zzb3p0_gm'));
  -- 회원번호가 로그인 계정 번호와 같아서는 안 된다(무엇으로 견주는지 가려지지 않는다)
  select pg_catalog.count(*) into v_same from security_private.member_identity mi
   where mi.auth_user_id = mi.member_id
     and mi.member_id in (select u.id from public.users u where u.email like 'zzb3p0\_%@member.zzb3p0.invalid');
  if v_users <> 7 or v_maps <> 6 or v_admin <> 2 or v_same <> 0 then
    raise exception 'zzb3p0 합성 자료 실패: 회원 행 % (7) · 대응 % (6) · 명부 % (2) · 대응표에서 회원번호=계정번호 % (0). 전부 되돌린다', v_users, v_maps, v_admin, v_same;
  end if;
  -- 함정 행이 계정 n 의 번호를 회원번호로 가졌고, n 에는 대응이 없는가
  select pg_catalog.count(*) into v_same
    from public.users u
    join auth.users au on au.id = u.id
   where u.email = 'zzb3p0_trap@member.zzb3p0.invalid'
     and pg_catalog.split_part(au.email, '@', 1) = 'zzb3p0_n'
     and not exists (select 1 from security_private.member_identity mi where mi.auth_user_id = au.id or mi.member_id = u.id);
  if v_same <> 1 then
    raise exception 'zzb3p0 합성 자료 실패: 함정 행이 기대한 모양이 아니다. 전부 되돌린다';
  end if;
end;
$zz_b3p0$;

commit;

reset b3_0.test_project_ref;

-- 도구에 넘길 기대 자료(expect.json). password_column_marker 는 옛 비밀번호 열의 합성 표식이다(로그인 비밀번호가 아니다).
select pg_catalog.jsonb_build_object(
  'marker', 'zzb3p0',
  'read_at', pg_catalog.now(),
  'trap', (
    select pg_catalog.jsonb_build_object(
             'meaning', '회원번호가 계정 n 의 로그인 계정 번호와 같은 회원 행(대응 없음). 어느 응답에도 나오면 안 된다',
             'id', u.id, 'name', u.name, 'nickname', u.nickname, 'email', u.email, 'phone', u.phone,
             'password_column_marker', u.password)
      from public.users u
     where u.email = 'zzb3p0_trap@member.zzb3p0.invalid'
  ),
  'accounts', (
    select pg_catalog.jsonb_object_agg(
             pg_catalog.substr(pg_catalog.split_part(au.email, '@', 1), 8),
             pg_catalog.jsonb_build_object(
               'auth_user_id', au.id,
               'listed_admin', exists (select 1 from security_private.admin_principal ap where ap.auth_user_id = au.id and ap.enabled),
               'member', case when u.id is null then null else pg_catalog.jsonb_build_object(
                           'id', u.id, 'name', u.name, 'nickname', u.nickname,
                           'email', u.email, 'phone', u.phone, 'timezone', u.timezone) end,
               'expected_state', case
                                   when u.id is null then 'no_member'
                                   when u.blocked is true then 'blocked'
                                   when u.withdrawal_requested_at is not null then 'withdrawal_pending'
                                   else 'ok' end,
               'password_column_marker', u.password,
               'withdrawal_markers', case when u.id is null then null
                                          else pg_catalog.jsonb_build_array(u.withdrawal_reason, u.withdrawal_reason_detail) end
             ))
      from auth.users au
      left join security_private.member_identity mi on mi.auth_user_id = au.id
      left join public.users u on u.id = mi.member_id
     where au.email like 'zzb3p0\_%'
  )
) as result;
