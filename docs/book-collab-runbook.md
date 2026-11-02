# 입문서 버전 협업 — 운영 적용 절차서 (2026-11-02 작성, 아직 미실행)

이 문서의 단계는 모두 **대표의 명시적 승인 후** 실행한다. 작성 시점에는 운영 DB·배포·계정을 바꾸지 않았다.

## 브랜치와 커밋
- 공홈 `feat/book-collab-versions` (기준 main 43bde16)
  - 75bece5 DB 마이그레이션 + 시험 DB 테스트
  - ef99bb5 편집기 협업 화면·작업본 보관·목록/미리보기 호환
  - a1b3d91 **관리자 로그인 서버 인증 연결 (단독으로 배포 보류)**
  - 6d272c1 로컬 검수 서버·테스트 갱신·문구 수정
- 테스트룸 `feat/book-collab-versions` (기준 main 5484d45)
  - 1c0bcc2 학생 뷰어 삭제 쪽 제외 조회

## 적용 순서
1. **사전 확인** (읽기만)
   - 공홈·테스트룸 main이 위 기준 커밋 뒤로 바뀌었는지 확인하고, 바뀌었으면 다시 합쳐 시험한다.
   - 대상 책 쪽 수·옛 쪽별 기록 수·메모/진도/지정 학생 0건을 다시 조회한다(조사 시점 301쪽, 447개, 0건).
2. **백업**: 대상 책의 `tr_book_documents`·`tr_book_pages`·`tr_book_page_versions` 행을 내보내 보관하고, 시험 DB에 복원해 본다. 외부 PITR 여부는 확인되지 않았으므로 기대지 않는다.
3. **마이그레이션 적용**: `supabase/migrations/20261102120000_book_collab_versions.sql`을 SQL 편집기에서 실행(한 트랜잭션).
   - 이 단계만으로는 어떤 책도 바뀌지 않는다(head 행 없음 = 기존 방식). 실행 뒤 `select public.book_collab_status(array['<책 UUID>']::uuid[]);` → false 확인.
   - 브라우저 역할 권한 점검: `tests/book-collab/sql.test.mjs`의 A0 항목과 같은 `has_function_privilege`·`has_table_privilege` 조회를 운영에서 실행해 같은 결과인지 본다.
4. **화면 코드 배포 (로그인 커밋 제외)**: 75bece5·ef99bb5·6d272c1만 main에 반영(로그인 커밋 a1b3d91은 빼고). 테스트룸 1c0bcc2도 반영.
   - 협업이 꺼진 동안 모든 책은 기존 편집기로 동작한다(로컬 검수에서 확인).
5. **관리자 Auth 계정 준비**: 대표가 실제로 쓰는 관리자 이메일이 `users`(role=admin)와 Supabase Auth 둘 다에 있고, 대표가 그 Auth 비밀번호로 로그인할 수 있는지 확인한다. 기존 Auth 계정 2개 중 어느 것이 대표 것인지는 아직 모른다. 계정 생성·비밀번호 설정이 필요하면 별도 승인.
6. **로그인 커밋 배포 (a1b3d91)**: 5가 확인된 뒤에만. 배포 후 고정 `admin` 계정 로그인은 막히고, 관리자는 이메일+Auth 비밀번호로만 들어온다. 실패하면 즉시 되돌린다(협업은 아직 꺼져 있음).
7. **활성화 (쓰기 정지 구간)**: 열린 편집기·교재 목록 창을 모두 닫은 뒤 SQL 편집기에서
   ```sql
   select public.book_collab_activate('<책 UUID>', array['<대표 Auth user id>']::uuid[]);
   ```
   - 결과의 `pages_live`·`legacy_versions_kept`가 1의 숫자와 같은지 본다. 실패하면 전체 롤백되어 꺼진 상태로 남는다.
8. **활성화 후 확인**: 편집기에서 "서버 저장본 V1" 표시, 한 쪽 저장 → V2, 옛 편집기 탭의 저장이 막히는지(`BOOK_COLLAB_PROTECTED`).

## 비상 정지
```sql
select public.book_collab_deactivate('<책 UUID>');
```
협업 저장을 멈추고 옛 편집기 쓰기를 다시 허용한다. 이력은 남는다. 다시 켜면 그 시점 본문으로 새 기준본을 만든다. 새 테이블·이력을 지우는 되돌리기는 하지 않는다.

## Aside가 수정안을 보내는 방법
대표가 로그인한 브라우저에서 편집기를 `...&author=aside`로 열고 편집한 뒤 "버전 → 현재 변경을 수정안으로 보내기", 또는 같은 화면에서 `BookCollab.api.submitProposal({title, summary, pages:[{page_uid, blocks}]})`. 저장 버튼은 누르지 않는다. 등록 계정은 대표 계정이며 `author_source=aside`는 작성 출처 표시다.

## 로컬 검수 재현
```
cd tests/book-collab && npm install
node sql.test.mjs                        # 합성 자료
BOOK_COLLAB_FIXTURE=<읽기 사본> node sql.test.mjs
BOOK_COLLAB_FIXTURE=<읽기 사본> node dev-server.mjs --testroom <테스트룸 경로>
```
검수 계정: owner@example.test / owner-pass (시험 DB 전용). 읽기 사본은 비공개 교재 내용이므로 저장소에 넣지 않는다.

## 검증하지 못한 것
- 실제 Supabase(여러 연결)에서의 동시 저장 경쟁, 활성화 순간 대기 중이던 옛 요청 거부 (시험 DB는 연결 1개).
- 운영 Auth 계정 로그인, 운영 권한(기본 권한·역할 소속)이 시험 DB 흉내와 같은지.
- 로컬 검수 서버에서 이미지 업로드 후 저장 (로컬 주소라 서버 이미지 검사에 걸림 — 운영 주소에서는 통과 대상).
- 닫힌 다른 작업창의 작업본을 백업해 불러오는 화면 흐름 (코드는 있으나 브라우저 검수 미실행).

## 2026-11-02 변경: 기존 관리자 로그인 수준('site')으로 사용
- 대표 결정: 사이트 보안 작업을 따로 하므로 지금은 서버 로그인을 요구하지 않는다. 로그인 커밋(a1b3d91)은 배포하지 않고 보관.
- 마이그레이션 20261102130000_book_collab_site_auth.sql: 책별 auth_mode('site'|'jwt'). 활성화 때 관리자 목록을 비우면 'site'.
- 활성화: select public.book_collab_activate('<책 UUID>', '{}'::uuid[]);
- 보안 작업 뒤: 관리자 Auth 계정을 tr_book_revision_admins에 넣고 auth_mode를 'jwt'로 바꾼다(편집기는 서버 로그인 세션을 그대로 사용).
