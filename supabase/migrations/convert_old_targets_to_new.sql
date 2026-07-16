-- =====================================================================
-- 구점수(0-120) 목표 → 신점수(1-6) 목표 일괄 변환 (일반 정규과정 36명)
--
-- 배경 (2026-07-16):
--   2026-01-21 개편 후 신청서 목표점수를 일반토플(신점수)/호주토플(구점수)로
--   재구성함. 기존에 구점수로 목표를 기입한 일반과정(regular) 학생들을
--   신점수 목표로 일괄 변환한다. 호주 과정(australia) 학생은 대상 아님.
--
-- 변환 규칙:
--   - Overall: 요구점수를 "보장하는" 더 높은 쪽 레벨
--       (예: 95 요구 → 4.5(=90)로는 불충족 → 5.0(=100))
--       환산: 118→6.0, 110→5.5, 100→5.0, 90→4.5, 80→4.0, 65→3.5
--   - 섹션: 요구점수가 "들어있는 구간"의 레벨 (ETS 공식 섹션 환산표)
--       (예: Speaking 22 요구 → 4.0 구간(20-22)에 포함 → 4.0)
--   - 신점수 목표가 이미 있는 4명(이주은·이채영·이기준·양혜인)은
--     신점수 유지 + 남아있는 구점수만 삭제
-- =====================================================================

-- ── [실행 전 확인용] 대상 36명의 현재 상태 ──────────────────────────
-- SELECT id, name, target_version, target_cutoff_old, target_cutoff_new
-- FROM applications
-- WHERE id IN (
--     '50c2a63c-03ea-4383-8d75-c70677721bd1','355f2610-2f7f-492d-b44d-661eaec2265d',
--     '8db798ea-f9a3-4513-a055-f2c9a36d4e3e','706bb5d0-25f9-451f-8ce1-2403d228edbc',
--     '62488d61-f127-4ffa-a91e-1e01d660cbb5','c3badce0-40ce-4c73-826d-17a307bfad7e',
--     '4fa55d26-4596-49d1-a474-826f53156761','9942271c-e006-44c5-b9be-fda4fd349333',
--     '73ec70f3-ac23-4288-b745-2f52485cc40c','14142fd8-d989-407d-b866-74d4737a1237',
--     'ddf36d46-ba39-4faf-89ed-b521f054175e','fd5db61c-db65-4869-9983-bc38415606ee',
--     'db177b17-2fb6-448f-bf84-cb3a800f4bed','1e02c4f9-b8b1-458a-9b85-21fd4dc26445',
--     'beb56823-8224-4cc2-bc1e-ae9a1275aeb0','be9a60bb-2054-4c68-aba6-3ae793b3f611',
--     'ce0e60fd-e031-4897-8c86-5c39171afaf5','9fbbfc93-9fad-43fc-abda-d6f1e083da65',
--     'df4b8253-88d9-4dd2-9f07-4ca6837770d8','1a25e642-fa02-4218-991e-bd299c655243',
--     'e494ad0b-2d67-4a23-84de-6501c5b74a43','a9f3e929-4302-42cc-a17f-4b459b28a2df',
--     '7ea6d6fd-e080-4593-9c6f-ad16fbec925d','0522d8c9-ea85-4d7b-985b-04a57569dd9f',
--     '2a973996-0981-4978-82a6-5f93c68658e9','e8823a6b-dd72-4362-b673-b8d9ea2fc232',
--     '045ccb6c-a777-485c-bd5a-7102cdcd7a09','f738e109-bf3a-4e03-89f2-a8778ab10e1b',
--     'aa92e6f8-eef5-4a88-96db-e0b3e424eaf8','2817dec6-76ed-4e7e-a9b7-d8565e6df7bb',
--     '8c0feb3b-a2ae-4521-ad3e-1b94e2883892','b89b69f3-d6ff-42f5-939d-391dfa2f2119',
--     '1d7621ca-1e79-4823-9652-b6dbd1889e5f','03e86d80-d69d-44a9-ae2d-cb14d6561270',
--     'dd12c1e5-c2e2-47c5-9a12-3f233d457fd2','e22a37a5-6fb0-47c8-9fe6-d41cb80db03e'
-- );

BEGIN;

-- ── 1) 구점수 → 신점수 변환 (32명) ─────────────────────────────────
UPDATE applications a SET
    target_version       = 'new',
    target_cutoff_new    = v.cutoff,
    target_reading_new   = v.r,
    target_listening_new = v.l,
    target_writing_new   = v.w,
    target_speaking_new  = v.s,
    target_cutoff_old    = NULL,
    target_reading_old   = NULL,
    target_listening_old = NULL,
    target_speaking_old  = NULL,
    target_writing_old   = NULL
FROM (VALUES
    -- (id, overall, reading, listening, writing, speaking)      -- 이름: 구점수 목표
    ('50c2a63c-03ea-4383-8d75-c70677721bd1'::uuid, 5.5::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric), -- 백현: 110
    ('355f2610-2f7f-492d-b44d-661eaec2265d', 5.5, NULL, NULL, NULL, NULL), -- 안담이: 105
    ('8db798ea-f9a3-4513-a055-f2c9a36d4e3e', 5.0, NULL, NULL, NULL, NULL), -- 윤지영: 100
    ('706bb5d0-25f9-451f-8ce1-2403d228edbc', 5.0, NULL, NULL, NULL, 5.0 ), -- 유현우: 100, S26
    ('62488d61-f127-4ffa-a91e-1e01d660cbb5', 5.0, NULL, NULL, NULL, NULL), -- 박시용: 100
    ('c3badce0-40ce-4c73-826d-17a307bfad7e', 5.0, NULL, NULL, NULL, NULL), -- 김다빈: 100
    ('4fa55d26-4596-49d1-a474-826f53156761', 5.0, NULL, NULL, NULL, NULL), -- 최지예: 100
    ('9942271c-e006-44c5-b9be-fda4fd349333', 5.0, NULL, NULL, NULL, NULL), -- 조현승: 100
    ('73ec70f3-ac23-4288-b745-2f52485cc40c', 5.0, NULL, NULL, NULL, NULL), -- 최하나: 100
    ('14142fd8-d989-407d-b866-74d4737a1237', 5.0, NULL, NULL, NULL, NULL), -- 김나예: 95
    ('ddf36d46-ba39-4faf-89ed-b521f054175e', 5.0, NULL, NULL, NULL, NULL), -- 양주영: 93
    ('fd5db61c-db65-4869-9983-bc38415606ee', 4.5, NULL, NULL, NULL, 4.0 ), -- 이희경: 90, S22
    ('db177b17-2fb6-448f-bf84-cb3a800f4bed', 4.5, NULL, NULL, NULL, 5.5 ), -- 이지연: 90, S27
    ('1e02c4f9-b8b1-458a-9b85-21fd4dc26445', 4.5, NULL, NULL, NULL, NULL), -- 김명희: 90
    ('beb56823-8224-4cc2-bc1e-ae9a1275aeb0', 4.5, NULL, 6.0 , NULL, 6.0 ), -- 조은정: 90, L28, S28
    ('be9a60bb-2054-4c68-aba6-3ae793b3f611', 4.5, NULL, NULL, NULL, NULL), -- 김가인: 90
    ('ce0e60fd-e031-4897-8c86-5c39171afaf5', 4.5, 4.0 , 4.5 , 4.5 , 4.0 ), -- 김정숙: 90, R21 L21 W21 S21
    ('9fbbfc93-9fad-43fc-abda-d6f1e083da65', 4.5, 4.5 , 5.0 , 4.5 , NULL), -- 변희성: 90, R23 L23 W21
    ('df4b8253-88d9-4dd2-9f07-4ca6837770d8', 4.5, NULL, NULL, NULL, NULL), -- 김동오: 90
    ('1a25e642-fa02-4218-991e-bd299c655243', 4.5, NULL, NULL, NULL, 4.0 ), -- 고여민: 89, S20
    ('e494ad0b-2d67-4a23-84de-6501c5b74a43', 4.5, NULL, NULL, NULL, NULL), -- 박수인: 85
    ('a9f3e929-4302-42cc-a17f-4b459b28a2df', 4.5, NULL, NULL, NULL, NULL), -- 강수정: 81
    ('7ea6d6fd-e080-4593-9c6f-ad16fbec925d', 4.0, NULL, NULL, NULL, NULL), -- 강채리: 80
    ('0522d8c9-ea85-4d7b-985b-04a57569dd9f', 4.0, NULL, NULL, NULL, NULL), -- 김재인: 80
    ('2a973996-0981-4978-82a6-5f93c68658e9', 4.0, NULL, NULL, NULL, NULL), -- 오수빈: 80
    ('e8823a6b-dd72-4362-b673-b8d9ea2fc232', 4.0, NULL, NULL, NULL, NULL), -- 박가온: 80
    ('045ccb6c-a777-485c-bd5a-7102cdcd7a09', 4.0, 3.5 , 3.0 , 4.5 , 3.5 ), -- 공소현: 79, R13 L12 W21 S18
    ('f738e109-bf3a-4e03-89f2-a8778ab10e1b', 4.0, 3.5 , 4.0 , 4.0 , 3.0 ), -- 서연서: 79, R17 L17 W17 S17
    ('aa92e6f8-eef5-4a88-96db-e0b3e424eaf8', 4.0, NULL, NULL, 4.0 , 4.0 ), -- 김태화: 79, W20 S20
    ('2817dec6-76ed-4e7e-a9b7-d8565e6df7bb', 4.0, NULL, NULL, NULL, NULL), -- 현혜수: 73
    ('8c0feb3b-a2ae-4521-ad3e-1b94e2883892', 4.0, NULL, NULL, NULL, NULL), -- 유시온: 72
    ('b89b69f3-d6ff-42f5-939d-391dfa2f2119', 3.5, NULL, NULL, NULL, NULL)  -- 박수연: 65
) AS v(id, cutoff, r, l, w, s)
WHERE a.id = v.id;

-- ── 2) 신점수 목표가 이미 있는 4명: 신점수 유지, 구점수만 삭제 ──────
UPDATE applications SET
    target_version       = 'new',
    target_cutoff_old    = NULL,
    target_reading_old   = NULL,
    target_listening_old = NULL,
    target_speaking_old  = NULL,
    target_writing_old   = NULL
WHERE id IN (
    '1d7621ca-1e79-4823-9652-b6dbd1889e5f', -- 이주은: 신 4.0 유지, 구 80 삭제
    '03e86d80-d69d-44a9-ae2d-cb14d6561270', -- 이채영: 신 5.0 유지, 구 100+섹션 삭제
    'dd12c1e5-c2e2-47c5-9a12-3f233d457fd2', -- 이기준: 신 3.5 유지, 구 70 삭제
    'e22a37a5-6fb0-47c8-9fe6-d41cb80db03e'  -- 양혜인: 신 4.5 유지, 구 85 삭제
);

COMMIT;

-- ── [실행 후 확인] 구점수 목표가 남은 일반과정 학생 = 0명이어야 함 ──
SELECT id, name, course_track, target_version, target_cutoff_old, target_cutoff_new
FROM applications
WHERE course_track = 'regular'
  AND deleted IS NOT TRUE
  AND (target_cutoff_old IS NOT NULL
       OR target_reading_old IS NOT NULL
       OR target_listening_old IS NOT NULL
       OR target_speaking_old IS NOT NULL
       OR target_writing_old IS NOT NULL);

-- =====================================================================
-- [2차] 실행 후 확인에서 발견된 잔여 2명 (구점수 Overall 없이 섹션만 남은 케이스)
--   - 김민정: 신점수 목표 완비. target_reading_old=1은 오입력 잔재 → 삭제만
--   - 이선영: 신 Overall 5.0 있음. 구점수 섹션(전영역 21)을 규칙대로 변환
--             R21→4.0(18-21), L21→4.5(20-21), W21→4.5(21-23), S21→4.0(20-22)
-- =====================================================================

BEGIN;

-- 김민정: 오입력 잔재 삭제
UPDATE applications SET
    target_version     = 'new',
    target_reading_old = NULL
WHERE id = '159ecadf-9dbc-4fd9-8fe5-f014aebb5750';

-- 이선영: 구점수 섹션 → 신점수 섹션 변환
UPDATE applications SET
    target_version       = 'new',
    target_reading_new   = 4.0,
    target_listening_new = 4.5,
    target_writing_new   = 4.5,
    target_speaking_new  = 4.0,
    target_reading_old   = NULL,
    target_listening_old = NULL,
    target_speaking_old  = NULL,
    target_writing_old   = NULL
WHERE id = '6dec5f79-6a9d-40b2-a769-16e0b06c0275';

COMMIT;

-- [2차 실행 후 확인] 이제 진짜 0명이어야 함
SELECT id, name, course_track, target_version, target_cutoff_old, target_cutoff_new
FROM applications
WHERE course_track = 'regular'
  AND deleted IS NOT TRUE
  AND (target_cutoff_old IS NOT NULL
       OR target_reading_old IS NOT NULL
       OR target_listening_old IS NOT NULL
       OR target_speaking_old IS NOT NULL
       OR target_writing_old IS NOT NULL);
