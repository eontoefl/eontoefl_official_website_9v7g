// 입문서 버전 협업 SQL 시험 (PGlite 시험 DB, 운영 DB 미사용)
// 실행: cd tests/book-collab && npm install && node sql.test.mjs
//   운영 읽기 사본으로 시험: BOOK_COLLAB_FIXTURE=<fixture.json 경로> node sql.test.mjs
import crypto from 'node:crypto';
import {
  createTestDb, loadFixture, asRole, rpc, claimsFor,
  TARGET_BOOK as B, OTHER_BOOK, PDF_BOOK, ADMIN_ID, ADMIN_EMAIL, OTHER_ADMIN_ID, OTHER_ADMIN_EMAIL,
} from './testdb.mjs';

const results = [];
let current = '';
function ok(cond, msg) {
  if (!cond) throw new Error('실패: ' + msg);
}
async function test(id, name, fn) {
  current = id;
  try {
    await fn();
    results.push({ id, name, pass: true });
    console.log('PASS', id, name);
  } catch (e) {
    results.push({ id, name, pass: false, error: e.message });
    console.log('FAIL', id, name, '\n   ', e.message);
  }
}
async function rejects(promise, pattern, msg) {
  try {
    await promise;
  } catch (e) {
    ok(pattern.test(e.message), msg + ' (오류 문구: ' + e.message + ')');
    return e;
  }
  throw new Error('실패: ' + msg + ' (거부되지 않음)');
}
const uid = () => crypto.randomUUID();
const ADMIN = claimsFor(ADMIN_ID, ADMIN_EMAIL);
const HELPER = claimsFor(OTHER_ADMIN_ID, OTHER_ADMIN_EMAIL);
const IMG = 'https://qpqjevecjejvbeuogtbx.supabase.co/storage/v1/object/public/guide-images/book-migrations/' + B + '/x.png';

const fixture = loadFixture();
console.log('시험 자료:', fixture.source, '쪽', fixture.pages.length, '옛 쪽별 기록', (fixture.versions || []).length);
const db = await createTestDb({ fixture });

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const livePages = async (book = B) => q(`select id, sort_order, blocks, html, deleted_at from public.tr_book_pages
                                          where book_id = $1 and deleted_at is null order by sort_order`, [book]);
const head = async () => (await q(`select * from public.tr_book_revision_heads where book_id = $1`, [B]))[0];
const call = (fn, args, claims = ADMIN, role = 'authenticated') => rpc(db, role, claims, fn, args);
const page = (id, text, extra = '') => ({
  page_uid: id,
  blocks: [{ id: 'x', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }],
  html: '<p>' + text + '</p>' + extra,
  renderer_version: 'test-1',
});
const commit = (expected, changes, extra = {}) => call('book_collab_commit', {
  p_book: B, p_expected_head: expected, p_request_id: extra.request_id || uid(), p_changes: changes,
  p_title: extra.title || '', p_summary: '', p_source_links: extra.links || [],
});

// ---------------------------------------------------------------------
await test('M0', '마이그레이션 직후: 어떤 책도 바뀌지 않고 기존 쓰기 유지', async () => {
  const st = await call('book_collab_status', { p_book_ids: [B, OTHER_BOOK] }, null, 'anon');
  ok(st[B] === false && st[OTHER_BOOK] === false, '모두 미활성');
  ok((await q(`select count(*)::int n from public.tr_book_revision_heads`))[0].n === 0, 'head 행 없음');
  const before = (await livePages())[0];
  await asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_pages set html = html where id = $1`, [before.id]));
  ok((await q(`select count(*)::int n from public.tr_book_page_versions where book_id = $1`, [B]))[0].n === (fixture.versions || []).length,
    '옛 쪽별 기록 보존');
});

await test('M1', '미활성 책 쓰기 RPC는 행을 만들지 않고 거부(NOT_ENABLED/권한 없음)', async () => {
  await rejects(commit(null, { pages: [] }), /BOOK_COLLAB_FORBIDDEN/, '권한 없는 책');
  ok((await q(`select count(*)::int n from public.tr_book_revision_heads`))[0].n === 0, 'head 자동 생성 없음');
  ok((await q(`select count(*)::int n from public.tr_book_revisions`))[0].n === 0, '이력 생성 없음');
});

await test('A0', '권한 구성: 브라우저 역할의 직접 접근 차단, 실행 역할 미소속', async () => {
  const rows = await q(`select
      has_function_privilege('anon', 'public.book_collab_commit(uuid,uuid,uuid,jsonb,text,text,jsonb)', 'execute') a1,
      has_function_privilege('authenticated', 'public.book_collab_commit(uuid,uuid,uuid,jsonb,text,text,jsonb)', 'execute') a2,
      has_function_privilege('anon', 'public.book_collab_status(uuid[])', 'execute') a3,
      has_function_privilege('authenticated', 'public.book_collab_activate(uuid,uuid[])', 'execute') a4,
      has_function_privilege('service_role', 'public.book_collab_activate(uuid,uuid[])', 'execute') a5,
      has_table_privilege('anon', 'public.tr_book_revisions', 'select') a6,
      has_table_privilege('authenticated', 'public.tr_book_revision_payloads', 'insert') a7,
      has_table_privilege('service_role', 'public.tr_book_revisions', 'update') a8,
      pg_has_role('anon', 'book_collab_writer', 'member') a9,
      pg_has_role('authenticated', 'book_collab_writer', 'member') a10,
      pg_has_role('authenticator', 'book_collab_writer', 'member') a11,
      has_table_privilege('anon', 'public.tr_book_pages', 'truncate') a12,
      has_table_privilege('anon', 'public.tr_book_pages', 'update') a13,
      has_schema_privilege('book_collab_writer', 'public', 'create') a14`);
  const r = rows[0];
  ok(r.a1 === false, 'anon commit 실행 불가');
  ok(r.a2 === true, 'authenticated commit 실행 가능');
  ok(r.a3 === true, 'anon status 가능');
  ok(r.a4 === false && r.a5 === false, '활성화 함수는 브라우저·서비스 역할 실행 불가');
  ok(r.a6 === false && r.a7 === false && r.a8 === false, '새 테이블 직접 접근 불가');
  ok(r.a9 === false && r.a10 === false && r.a11 === false, '실행 역할 미소속');
  ok(r.a12 === false, 'anon TRUNCATE 회수');
  ok(r.a13 === true, '일반 책 정상 REST 쓰기 권한은 유지');
  ok(r.a14 === false, '실행 역할 CREATE 권한 회수');
});

let V1;
await test('T32', '원자 활성화: 그 시점 본문으로 기준본 V1, 옛 기록 보존, 재실행 거부', async () => {
  await rejects(asRole(db, 'authenticated', ADMIN, (tx) => tx.query(`select public.book_collab_activate($1, $2)`, [B, [ADMIN_ID]])),
    /permission denied/, '브라우저 역할의 활성화 거부');
  const res = (await q(`select public.book_collab_activate($1, $2) r`, [B, [ADMIN_ID]]))[0].r;
  ok(res.ok && res.seq === 1, 'V1 생성');
  ok(res.pages_live === fixture.pages.length, '살아 있는 쪽 수 = 자료 쪽 수 (' + res.pages_live + ')');
  ok(res.legacy_versions_kept === (fixture.versions || []).length, '옛 쪽별 기록 수 유지 (' + res.legacy_versions_kept + ')');
  V1 = res.baseline_revision_id;
  const h = await head();
  ok(h.enabled && h.head_revision_id === V1 && h.head_seq === 1, 'head = V1');
  await rejects(q(`select public.book_collab_activate($1, $2)`, [B, [ADMIN_ID]]), /이미 켜져/, '재활성화 거부');
  const st = await call('book_collab_get_state', { p_book: B, p_include_pages: true });
  const live = await livePages();
  ok(st.pages.length === live.length, 'get_state 쪽 수 일치');
  ok(st.pages.every((p, i) => p.id === live[i].id && p.html === live[i].html), 'get_state 본문/순서 = 현재 본문');
});

await test('T33', '활성화 후 옛 REST 직접쓰기·삭제·이동·비우기 차단, 다른 책은 정상', async () => {
  const p = (await livePages())[0];
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_pages set html = '<p>x</p>' where id = $1`, [p.id])),
    /BOOK_COLLAB_PROTECTED/, '쪽 PATCH 거부');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`delete from public.tr_book_pages where id = $1`, [p.id])),
    /BOOK_COLLAB_PROTECTED/, '쪽 DELETE 거부');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`insert into public.tr_book_pages (book_id, sort_order) values ($1, 999)`, [B])),
    /BOOK_COLLAB_PROTECTED/, '쪽 INSERT 거부');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`insert into public.tr_book_page_versions (page_id, book_id) values ($1, $2)`, [p.id, B])),
    /BOOK_COLLAB_PROTECTED/, '옛 버전 INSERT 거부');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_pages set book_id = $2 where id = $1`, [p.id, OTHER_BOOK])),
    /BOOK_COLLAB_PROTECTED/, '다른 책으로 이동 거부');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_pages set book_id = $2 where book_id = $1`, [OTHER_BOOK, B])),
    /BOOK_COLLAB_PROTECTED/, '다른 책 쪽을 협업 책으로 옮기기 거부');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_documents set title = 'x' where id = $1`, [B])),
    /BOOK_COLLAB_PROTECTED/, '책 이름 직접 변경 거부');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`delete from public.tr_book_documents where id = $1`, [B])),
    /BOOK_COLLAB_PROTECTED/, '책 영구삭제 거부');
  await rejects(asRole(db, 'service_role', null, (tx) => tx.query(`delete from public.tr_book_documents where id = $1`, [B])),
    /BOOK_COLLAB_PROTECTED/, 'service_role 직접 삭제도 거부');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`truncate public.tr_book_pages cascade`)),
    /permission denied|BOOK_COLLAB_PROTECTED/, 'anon TRUNCATE 거부');
  await rejects(q(`delete from public.tr_book_page_versions where book_id = $1`, [B]), /BOOK_COLLAB_PROTECTED/, 'DB 소유자 일반 DELETE도 트리거가 거부');
  // 다른 일반 책·PDF는 그대로
  await asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_pages set html = '<p>다른 1 수정</p>' where book_id = $1 and sort_order = 1`, [OTHER_BOOK]));
  await asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_documents set title = 'PDF 자료 2' where id = $1`, [PDF_BOOK]));
  await asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_progress set last_page = 3 where book_id = $1`, [PDF_BOOK]));
  ok((await livePages()).length === fixture.pages.length, '대상 책 쪽 수 그대로');
});

await test('T18', '인증·권한: 익명/비관리자/위조 요청 거부', async () => {
  await rejects(rpc(db, 'anon', ADMIN, 'book_collab_commit', { p_book: B, p_expected_head: V1, p_request_id: uid(), p_changes: { pages: [] },
    p_title: '', p_summary: '', p_source_links: [] }), /permission denied/, 'anon 역할은 claims를 넣어도 실행 불가');
  await rejects(call('book_collab_get_state', { p_book: B, p_include_pages: false }, null), /AUTH_REQUIRED/, 'JWT 없는 authenticated 거부');
  await rejects(call('book_collab_get_state', { p_book: B, p_include_pages: false }, { sub: ADMIN_ID, role: 'anon' }), /AUTH_REQUIRED/, 'claims role 불일치 거부');
  await rejects(call('book_collab_get_state', { p_book: B, p_include_pages: false }, HELPER), /FORBIDDEN/, '목록에 없는 계정 거부');
  await rejects(call('book_collab_get_revision', { p_revision: V1, p_include_all: false }, HELPER), /FORBIDDEN/, '다른 계정 이력 읽기 거부');
  await rejects(asRole(db, 'authenticated', ADMIN, (tx) => tx.query(`select * from public.tr_book_revisions`)), /permission denied/, '이력 테이블 직접 조회 거부');
  await rejects(asRole(db, 'authenticated', ADMIN, (tx) => tx.query(`select book_collab_private.plan_changes($1,$2,'{}'::jsonb)`, [B, V1])),
    /permission denied/, '내부 함수 직접 호출 거부');
});

let V2;
let pagesNow;
await test('T01', '한 쪽 저장: 버전 1개, 범위 밖 300쪽 불변, 작성자·범위 기록', async () => {
  const before = await livePages();
  const target = before[1];
  const res = await commit(V1, { pages: [page(target.id, '수정한 2쪽')] }, { title: '2쪽 수정' });
  ok(res.ok && res.seq === 2 && !res.no_change, 'V2 생성');
  V2 = res.revision_id;
  const after = await livePages();
  ok(after.find((p) => p.id === target.id).html === '<p>수정한 2쪽</p>', '대상 쪽 반영');
  ok(after.every((p, i) => p.id === before[i].id && (p.id === target.id || p.html === before[i].html)), '나머지 쪽 내용·순서 불변');
  const rev = (await q(`select * from public.tr_book_revisions where id = $1`, [V2]))[0];
  ok(rev.submitted_by === ADMIN_ID && rev.author_source === 'admin' && rev.base_revision_id === V1, '작성자·기준');
  ok(JSON.stringify(rev.scope.pages) === JSON.stringify([target.id]), '범위 = 바뀐 쪽만');
  const entries = (await q(`select count(*)::int n from public.tr_book_revision_entries where revision_id = $1`, [V2]))[0].n;
  ok(entries === before.length, '전체 manifest 보관');
  const reused = (await q(`select count(*)::int n from public.tr_book_revision_entries a join public.tr_book_revision_entries b
                             on b.page_uid = a.page_uid and b.revision_id = $2 where a.revision_id = $1 and a.payload_id = b.payload_id`, [V1, V2]))[0].n;
  ok(reused === before.length - 1, '바뀌지 않은 쪽은 같은 내용 자료 재사용');
  pagesNow = after;
});

await test('T02', '19쪽 저장은 버전 1개 / 19번째 쪽 오류면 전부 롤백', async () => {
  const live = await livePages();
  const targets = live.slice(5, 24);
  const bad = targets.map((p, i) => page(p.id, '실패 시험 ' + i, i === 18 ? '<img src="https://evil.example/x.png">' : ''));
  const h0 = await head();
  const revCount0 = (await q(`select count(*)::int n from public.tr_book_revisions`))[0].n;
  await rejects(commit(h0.head_revision_id, { pages: bad }), /UNSAFE_HTML: IMAGE_SOURCE/, '외부 이미지 거부');
  const after = await livePages();
  ok(after.every((p, i) => p.html === live[i].html), '모든 쪽 불변');
  ok((await head()).head_revision_id === h0.head_revision_id, 'head 불변');
  ok((await q(`select count(*)::int n from public.tr_book_revisions`))[0].n === revCount0, '버전 생성 없음');
  const good = targets.map((p, i) => page(p.id, 'W1 정리 ' + i, '<figure><img src="' + IMG + '"><figcaption>사진</figcaption></figure>'));
  const res = await commit(h0.head_revision_id, { pages: good }, { title: '19쪽' });
  ok(res.ok && res.seq === 3 && res.changed_pages.length === 19, '19쪽 = V3 하나');
});

await test('T03', '변경 없는 저장은 새 버전 없음, 같은 요청 두 번은 중복 없음', async () => {
  const h0 = await head();
  const live = await livePages();
  const same = await commit(h0.head_revision_id, { pages: [{ page_uid: live[1].id, blocks: live[1].blocks, html: live[1].html, renderer_version: 'test-1' }] });
  ok(same.ok && same.no_change, '변경 없음');
  ok((await head()).head_seq === h0.head_seq, 'head 그대로');
  const rid = uid();
  const a = await commit(h0.head_revision_id, { pages: [page(live[3].id, '두 번 클릭')] }, { request_id: rid });
  const b = await commit(h0.head_revision_id, { pages: [page(live[3].id, '두 번 클릭')] }, { request_id: rid });
  ok(a.revision_id === b.revision_id && b.replayed === true, '같은 결과 재반환');
  ok((await q(`select count(*)::int n from public.tr_book_revisions where kind = 'save' and scope->'pages' ? $1`, [live[3].id]))[0].n === 1, '버전 1개');
});

await test('T04/T29', '응답 유실 재조회·재시도, 더 새 head가 있어도 가짜 재기준화 없음, 같은 번호 다른 내용 거부', async () => {
  const h0 = await head();
  const live = await livePages();
  const rid = uid();
  const first = await commit(h0.head_revision_id, { pages: [page(live[4].id, '응답 유실')] }, { request_id: rid });
  const later = await commit(first.revision_id, { pages: [page(live[6].id, '그 뒤 다른 저장')] });
  const look = await call('book_collab_get_request_result', { p_book: B, p_request_id: rid });
  ok(look.found && look.result.revision_id === first.revision_id, '원래 결과 조회');
  ok(look.current_head_seq === later.seq && look.result.seq === first.seq, '원래 버전과 현재 head를 구분');
  const retry = await commit(h0.head_revision_id, { pages: [page(live[4].id, '응답 유실')] }, { request_id: rid });
  ok(retry.replayed && retry.revision_id === first.revision_id && retry.current_head_seq === later.seq, '재시도는 원래 결과 + 현재 head');
  await rejects(commit(h0.head_revision_id, { pages: [page(live[4].id, '다른 내용')] }, { request_id: rid }), /REQUEST_REUSED/, '다른 내용 거부');
  const none = await call('book_collab_get_request_result', { p_book: B, p_request_id: uid() });
  ok(none.found === false, '없는 요청은 found=false');
  const other = await call('book_collab_get_request_result', { p_book: B, p_request_id: rid }, HELPER).catch((e) => e);
  ok(other instanceof Error && /FORBIDDEN/.test(other.message), '다른 계정은 조회 불가');
});

await test('T13/T14', '기준이 오래된 저장은 쓰기 0건으로 CONFLICT', async () => {
  const live = await livePages();
  const revCount0 = (await q(`select count(*)::int n from public.tr_book_revisions`))[0].n;
  const res = await commit(V2, { pages: [page(live[0].id, '오래된 기준')] });
  ok(res.ok === false && res.code === 'CONFLICT' && res.current_head_seq === (await head()).head_seq, 'CONFLICT');
  ok((await livePages())[0].html === live[0].html, '본문 불변');
  ok((await q(`select count(*)::int n from public.tr_book_revisions`))[0].n === revCount0, '이력 불변');
  ok((await q(`select count(*)::int n from public.tr_book_revision_requests where result->>'code' = 'CONFLICT'`))[0].n === 0,
    '충돌은 요청 기록으로 남기지 않아 새 기준으로 다시 시도 가능');
});

let P1;
let P2;
await test('T05', 'Aside 19쪽 수정안: head·본문·공개 상태 불변, 미확인 1개', async () => {
  const h0 = await head();
  const live = await livePages();
  const doc0 = (await q(`select is_active, updated_at from public.tr_book_documents where id = $1`, [B]))[0];
  const changes = { pages: live.slice(20, 39).map((p, i) => page(p.id, 'Aside 제안 ' + i)) };
  const res = await call('book_collab_submit_proposal', { p_book: B, p_base_revision: h0.head_revision_id, p_request_id: uid(),
    p_title: '문장 배열 설명 정리', p_summary: 'W1 19쪽', p_changes: changes, p_author_source: 'aside', p_meta: null });
  ok(res.ok && res.kind === 'proposal', '수정안 생성');
  P1 = res.revision_id;
  ok((await head()).head_revision_id === h0.head_revision_id, 'head 불변');
  ok((await livePages()).every((p, i) => p.html === live[i].html), '본문 불변');
  const doc1 = (await q(`select is_active, updated_at from public.tr_book_documents where id = $1`, [B]))[0];
  ok(doc1.is_active === doc0.is_active && String(doc1.updated_at) === String(doc0.updated_at), '공개 상태·수정시각 불변');
  const st = await call('book_collab_get_state', { p_book: B, p_include_pages: false });
  ok(st.unread_proposals === 1, '미확인 1');
  const rev = (await q(`select author_source, submitted_by, seq, manifest_complete from public.tr_book_revisions where id = $1`, [P1]))[0];
  ok(rev.author_source === 'aside' && rev.submitted_by === ADMIN_ID && rev.seq === null && !rev.manifest_complete,
    '출처=aside, 제출자=검증된 계정, 저장 번호 없음');
  const det = await call('book_collab_get_revision', { p_revision: P1, p_include_all: false });
  ok(det.pages.length === 19 && det.base_seq === h0.head_seq, '상세: 19쪽 본문과 기준 번호');
  ok(det.seen === false, '상세 조회만으로 읽음 처리 안 됨');
});

await test('T06', '상세를 연 수정안만 읽음, 다른 수정안은 그대로', async () => {
  const h0 = await head();
  const live = await livePages();
  P2 = (await call('book_collab_submit_proposal', { p_book: B, p_base_revision: h0.head_revision_id, p_request_id: uid(),
    p_title: '두 번째', p_summary: '', p_changes: { pages: [page(live[live.length - 1].id, '두 번째 제안')] },
    p_author_source: 'aside', p_meta: null })).revision_id;
  await call('book_collab_mark_seen', { p_revision: P1 });
  await call('book_collab_mark_seen', { p_revision: P1 });
  const list = await call('book_collab_list_revisions', { p_book: B, p_limit: 50 });
  ok(list.find((r) => r.id === P1).seen === true && list.find((r) => r.id === P2).seen === false, '읽음 분리');
  ok(list[0].id === P2, '최신순');
  const st = await call('book_collab_get_state', { p_book: B, p_include_pages: false });
  ok(st.unread_proposals === 1, '미확인 1');
});

await test('T12', '오래된 기준 수정안: 기준 이후 바뀐 대상 쪽을 표시', async () => {
  const live = await livePages();
  const target = (await call('book_collab_get_revision', { p_revision: P1, p_include_all: false })).pages[0].page_uid;
  const h0 = await head();
  await commit(h0.head_revision_id, { pages: [page(target, '대표가 먼저 고친 쪽')] });
  const det = await call('book_collab_get_revision', { p_revision: P1, p_include_all: false });
  ok(det.changed_since_base.length === 1 && det.changed_since_base[0] === target, '바뀐 쪽 1개 표시');
  ok(live.length > 0, '');
});

await test('T25', '두 수정안 출처를 한 저장에 기록, 그대로/수정 후 구분과 사용 이력', async () => {
  const h0 = await head();
  const p1 = await call('book_collab_get_revision', { p_revision: P1, p_include_all: false });
  const p2 = await call('book_collab_get_revision', { p_revision: P2, p_include_all: false });
  const changes = { pages: [
    ...p1.pages.slice(0, 3).map((x) => ({ page_uid: x.page_uid, blocks: x.blocks, html: x.html, renderer_version: x.renderer_version })),
    page(p2.pages[0].page_uid, '두 번째 제안을 대표가 고침'),
  ] };
  const links = [
    { revision_id: P1, pages: p1.pages.slice(0, 3).map((x) => x.page_uid), mode: 'as_is' },
    { revision_id: P2, pages: [p2.pages[0].page_uid], mode: 'edited' },
  ];
  const res = await commit(h0.head_revision_id, changes, { links });
  ok(res.ok && !res.no_change, '저장');
  const list = await call('book_collab_list_revisions', { p_book: B, p_limit: 50 });
  const u1 = list.find((r) => r.id === P1).used_in;
  const u2 = list.find((r) => r.id === P2).used_in;
  ok(u1.length === 1 && u1[0].seq === res.seq && u1[0].links[0].mode === 'as_is', '수정안1 그대로 반영 V' + res.seq);
  ok(u2.length === 1 && u2[0].links[0].mode === 'edited', '수정안2 수정 후 반영');
  await rejects(commit(res.revision_id, { pages: [] }, { links: [{ revision_id: uid() }] }), /출처 버전/, '없는 출처 거부');
});

await test('T15/T34', '쪽 추가·복제·삭제·순서·되살리기를 한 버전으로, 범위 밖 내용·상대 순서 불변', async () => {
  const h0 = await head();
  const before = await livePages();
  const n = before.length;
  const newId = uid();
  const dupId = uid();
  const del = before[10].id;
  const mov = before[3].id;
  const changes = {
    structure: [
      { op: 'add', page_uid: newId, after: before[0].id },
      { op: 'add', page_uid: dupId, after: before[20].id },
      { op: 'delete', page_uid: del },
      { op: 'move', page_uid: mov, after: before[n - 1].id },
    ],
    pages: [page(newId, '새 쪽'), { page_uid: dupId, blocks: before[20].blocks, html: before[20].html, renderer_version: 'test-1' }],
  };
  const res = await commit(h0.head_revision_id, changes, { title: '구조 변경' });
  ok(res.ok && res.structure_changed && res.total_pages === n + 1, '한 버전, 쪽 수 +1');
  const after = await livePages();
  ok(after[1].id === newId && after[after.length - 1].id === mov, '추가·이동 위치');
  ok(!after.some((p) => p.id === del), '삭제 쪽 제외');
  const delRow = (await q(`select deleted_at from public.tr_book_pages where id = $1`, [del]))[0];
  ok(delRow && delRow.deleted_at, '삭제는 논리삭제(행 보존)');
  const stableBefore = before.map((p) => p.id).filter((id) => id !== del && id !== mov);
  const stableAfter = after.map((p) => p.id).filter((id) => stableBefore.includes(id));
  ok(JSON.stringify(stableBefore) === JSON.stringify(stableAfter), '나머지 쪽의 상대 순서 불변');
  ok(after.filter((p) => stableBefore.includes(p.id)).every((p) => p.html === before.find((b) => b.id === p.id).html), '나머지 쪽 내용 불변');
  ok(after.every((p, i) => p.sort_order === i + 1), '표시 순서 1..N');
  ok((await q(`select total_pages from public.tr_book_documents where id = $1`, [B]))[0].total_pages === n + 1, '쪽 수 갱신');
  // 되살리기: 같은 UUID, 옛 쪽별 기록 보존
  const res2 = await commit(res.revision_id, { structure: [{ op: 'restore', page_uid: del, after: after[9].id }] });
  const after2 = await livePages();
  ok(res2.ok && after2[10].id === del, '같은 ID로 원래 근처에 되살림');
  ok((await q(`select deleted_at from public.tr_book_pages where id = $1`, [del]))[0].deleted_at === null, 'deleted_at 해제');
  ok((await q(`select count(*)::int n from public.tr_book_page_versions where book_id = $1`, [B]))[0].n === (fixture.versions || []).length,
    '옛 쪽별 기록 수 그대로');
  // 구조 없는 저장: 범위 밖 payload/순서 완전 불변
  const h1 = await head();
  const entriesBefore = await q(`select page_uid, payload_id, sort_order from public.tr_book_revision_entries where revision_id = $1 order by page_uid`, [h1.head_revision_id]);
  const res3 = await commit(h1.head_revision_id, { pages: [page(after2[2].id, '구조 없는 저장')] });
  const entriesAfter = await q(`select page_uid, payload_id, sort_order from public.tr_book_revision_entries where revision_id = $1 order by page_uid`, [res3.revision_id]);
  ok(entriesAfter.length === entriesBefore.length, 'manifest 크기 같음');
  ok(entriesAfter.every((e, i) => e.page_uid === entriesBefore[i].page_uid && e.sort_order === entriesBefore[i].sort_order
     && (e.page_uid === after2[2].id || e.payload_id === entriesBefore[i].payload_id)), '범위 밖 payload·순서 완전 불변');
});

await test('T16/T23', '구조 기준 불일치·삭제 쪽 대상·없는 앵커·중복 UUID는 자동 처리 없이 거부', async () => {
  const h0 = await head();
  const live = await livePages();
  const deletedId = (await q(`select id from public.tr_book_pages where book_id = $1 and deleted_at is null order by sort_order offset 5 limit 1`, [B]))[0].id;
  const r = await commit(h0.head_revision_id, { structure: [{ op: 'delete', page_uid: deletedId }] });
  const h1 = await head();
  await rejects(commit(h1.head_revision_id, { pages: [page(deletedId, '삭제 쪽 수정')] }), /PAGE_NOT_LIVE/, '삭제 쪽 내용 수정 거부(자동 부활 없음)');
  await rejects(commit(h1.head_revision_id, { structure: [{ op: 'move', page_uid: live[0].id, after: deletedId }] }), /CONFLICT_ANCHOR/, '없어진 앵커 거부');
  await rejects(commit(h1.head_revision_id, { structure: [{ op: 'add', page_uid: live[0].id, after: null }] }), /CONFLICT_UUID/, '기존 UUID 추가 거부');
  await rejects(commit(h1.head_revision_id, { structure: [{ op: 'add', page_uid: deletedId, after: null }] }), /CONFLICT_UUID/, '삭제 쪽 UUID 재추가 거부');
  await rejects(commit(h1.head_revision_id, { structure: [{ op: 'restore', page_uid: live[0].id, after: null }] }), /CONFLICT_RESTORE/, '살아 있는 쪽 되살리기 거부');
  const otherPage = 'd0d0d0d0-0000-4000-8000-000000000001';
  await rejects(commit(h1.head_revision_id, { structure: [{ op: 'restore', page_uid: otherPage, after: null }] }), /CONFLICT_RESTORE/, '다른 책 쪽 되살리기 거부');
  await rejects(commit(h1.head_revision_id, { pages: [page(otherPage, '다른 책 쪽')] }), /PAGE_NOT_LIVE/, '다른 책 쪽 수정 거부');
  ok(r.ok, '');
  // 수정안이 기준 manifest에 없는 앵커를 쓰면 등록 단계에서 거부
  await rejects(call('book_collab_submit_proposal', { p_book: B, p_base_revision: h1.head_revision_id, p_request_id: uid(), p_title: '', p_summary: '',
    p_changes: { structure: [{ op: 'move', page_uid: live[1].id, after: uid() }] }, p_author_source: 'aside', p_meta: null }), /CONFLICT_ANCHOR/, '수정안 검증');
  // 마지막 한 쪽 삭제 금지
  const all = (await livePages()).map((p) => ({ op: 'delete', page_uid: p.id }));
  await rejects(commit(h1.head_revision_id, { structure: all }), /최소 한 쪽/, '빈 책 금지');
});

await test('T19', '악성 HTML·잘못된 블록·범위 밖 ID 거부, 기존 자료는 모두 통과', async () => {
  const h0 = await head();
  const id = (await livePages())[0].id;
  const bads = [
    ['<script>alert(1)</script>', /FORBIDDEN_TAG/],
    ['<p onclick="x()">a</p>', /EVENT_ATTRIBUTE/],
    ['<img src="' + IMG + '" onerror="x()">', /EVENT_ATTRIBUTE/],
    ['<a href="javascript:alert(1)">a</a>', /SCRIPT_URL/],
    ['<iframe src="https://x"></iframe>', /FORBIDDEN_TAG/],
    ['<svg><circle/></svg>', /FORBIDDEN_TAG/],
    ['<img src=\'' + IMG + '\'>', /IMAGE_SOURCE/],
    ['<img src="' + IMG + '?x=1">', /IMAGE_SOURCE/],
    ['<img src="https://qpqjevecjejvbeuogtbx.supabase.co/storage/v1/object/public/guide-images/book-migrations/' + OTHER_BOOK + '/a.png">', /IMAGE_SOURCE/],
    ['<p style="width:expression(alert(1))">a</p>', /STYLE_EXPRESSION/],
  ];
  for (const [html, re] of bads) {
    await rejects(commit(h0.head_revision_id, { pages: [{ page_uid: id, blocks: [], html }] }), re, html.slice(0, 40));
  }
  await rejects(commit(h0.head_revision_id, { pages: [{ page_uid: id, blocks: {}, html: '' }] }), /형식/, 'blocks 객체 거부');
  await rejects(commit(h0.head_revision_id, { pages: [{ page_uid: id, blocks: [], html: '<p>a</p>' }, { page_uid: id, blocks: [], html: '<p>b</p>' }] }),
    /중복/, '같은 쪽 두 번 거부');
  await rejects(commit(h0.head_revision_id, { pages: [{ page_uid: 'not-a-uuid', blocks: [], html: '' }] }), /형식/, 'ID 형식 거부');
  await rejects(commit(h0.head_revision_id, { pages: [{ page_uid: id, blocks: [{ props: { url: 'javascript:alert(1)' } }], html: '<p>a</p>' }] }),
    /SCRIPT_URL/, 'blocks 안 스크립트 URL 거부');
  const problems = await q(`select p.id, book_collab_private.html_problem(p.html, p.book_id) pr from public.tr_book_pages p
                             where p.book_id = $1 and book_collab_private.html_problem(p.html, p.book_id) is not null`, [B]);
  ok(problems.length === 0, '기존 자료 ' + fixture.pages.length + '쪽 모두 서버 검사 통과 (실패: ' + JSON.stringify(problems.slice(0, 3)) + ')');
});

await test('T28', '공개 중·학생 기록이 있으면 구조 저장 차단, 내용 저장은 허용', async () => {
  const live = await livePages();
  const meta = await call('book_collab_update_metadata', { p_book: B, p_request_id: uid(), p_patch: { is_active: true } });
  ok(meta.ok && meta.book.is_active === true, '공개 전환(시험 DB)');
  let h0 = await head();
  await rejects(commit(h0.head_revision_id, { structure: [{ op: 'move', page_uid: live[0].id, after: live[2].id }] }), /STRUCTURE_BLOCKED/, '공개 중 구조 차단');
  const c = await commit(h0.head_revision_id, { pages: [page(live[0].id, '공개 중 내용 수정')] });
  ok(c.ok, '공개 중 내용 저장 허용');
  await call('book_collab_update_metadata', { p_book: B, p_request_id: uid(), p_patch: { is_active: false } });
  await q(`insert into public.tr_book_memos (user_id, book_id, page_uid, content) values ('student-9', $1, $2, '메모')`, [B, live[1].id]);
  h0 = await head();
  await rejects(commit(h0.head_revision_id, { structure: [{ op: 'delete', page_uid: live[1].id }] }), /STRUCTURE_BLOCKED/, '학생 메모 있으면 구조 차단');
  const st = await call('book_collab_get_state', { p_book: B, p_include_pages: false });
  ok(st.structure_allowed === false, '상태에 구조 저장 불가 표시');
  ok((await q(`select count(*)::int n from public.tr_book_memos where book_id = $1`, [B]))[0].n === 1, '학생 메모 보존');
  await q(`delete from public.tr_book_memos where book_id = $1`, [B]);
});

await test('T27', '협업 책 휴지통: 메타데이터 RPC로 이동/복원, 직접 영구삭제 불가, 이력 보존', async () => {
  const revs0 = (await q(`select count(*)::int n from public.tr_book_revisions where book_id = $1`, [B]))[0].n;
  const t = await call('book_collab_update_metadata', { p_book: B, p_request_id: uid(), p_patch: { trash: true } });
  ok(t.book.deleted_at && t.book.is_active === false, '휴지통 이동 + 숨김');
  await rejects(asRole(db, 'anon', null, (tx) => tx.query(`delete from public.tr_book_documents where id = $1`, [B])), /BOOK_COLLAB_PROTECTED/,
    '30일 자동정리 경로의 DELETE 거부');
  await rejects(q(`delete from public.tr_book_documents where id = $1`, [B]), /BOOK_COLLAB_PROTECTED/, 'DB 소유자 DELETE도 트리거 거부');
  const r = await call('book_collab_update_metadata', { p_book: B, p_request_id: uid(), p_patch: { trash: false } });
  ok(r.book.deleted_at === null, '복원');
  ok((await q(`select count(*)::int n from public.tr_book_revisions where book_id = $1`, [B]))[0].n === revs0, '이력 보존');
  await rejects(call('book_collab_update_metadata', { p_book: B, p_request_id: uid(), p_patch: { kind: 'pdf' } }), /바꿀 수 없는/, '허용 외 항목 거부');
  // 일반 책 휴지통 정책은 그대로 (직접 삭제 가능)
  await asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_documents set deleted_at = now() where id = $1`, [OTHER_BOOK]));
  await asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_documents set deleted_at = null where id = $1`, [OTHER_BOOK]));
});

await test('IMM', '이력은 고치거나 지울 수 없음', async () => {
  await rejects(q(`update public.tr_book_revisions set title = 'x' where id = $1`, [V1]), /IMMUTABLE/, 'UPDATE 거부');
  await rejects(q(`delete from public.tr_book_revision_payloads`), /IMMUTABLE/, 'DELETE 거부');
  await rejects(q(`truncate public.tr_book_revision_entries`), /IMMUTABLE/, 'TRUNCATE 거부');
});

await test('T31', '불러오기 기록: 같은 번호 재전송은 1건, 다른 내용은 거부', async () => {
  const ev = uid();
  const h0 = await head();
  const live = await livePages();
  const bk = await call('book_collab_create_backup', { p_book: B, p_base_revision: h0.head_revision_id, p_request_id: uid(),
    p_title: '교체 전 백업', p_changes: { pages: [page(live[0].id, '미저장 작업')] }, p_meta: { tab: 't1' } });
  ok(bk.ok && bk.kind === 'backup', '백업');
  ok((await head()).head_revision_id === h0.head_revision_id, '백업은 head 불변');
  ok((await livePages())[0].html === live[0].html, '백업은 본문 불변');
  const a = await call('book_collab_record_load', { p_book: B, p_event_id: ev, p_revision: P1, p_backup_revision: bk.revision_id,
    p_working_copy_id: 'w', p_device_id: 'd', p_tab_id: 't' });
  const b = await call('book_collab_record_load', { p_book: B, p_event_id: ev, p_revision: P1, p_backup_revision: bk.revision_id,
    p_working_copy_id: 'w', p_device_id: 'd', p_tab_id: 't' });
  ok(a.ok && !a.replayed && b.replayed, '재전송 1건');
  await rejects(call('book_collab_record_load', { p_book: B, p_event_id: ev, p_revision: P2, p_backup_revision: null,
    p_working_copy_id: 'w', p_device_id: 'd', p_tab_id: 't' }), /REQUEST_REUSED/, '다른 내용 거부');
  ok((await q(`select count(*)::int n from public.tr_book_revision_load_events where id = $1`, [ev]))[0].n === 1, '1건');
  const list = await call('book_collab_list_revisions', { p_book: B, p_limit: 80 });
  ok(list.find((r) => r.id === P1).loaded_by_me === 1, '불러온 횟수 표시');
});

await test('CONS', '여러 저장 뒤에도 get_state = 현재 본문 = head manifest', async () => {
  const st = await call('book_collab_get_state', { p_book: B, p_include_pages: true });
  const live = await livePages();
  ok(st.pages.length === live.length && st.pages.every((p, i) => p.id === live[i].id && p.html === live[i].html
     && JSON.stringify(p.blocks) === JSON.stringify(live[i].blocks)), '일치');
  const doc = (await q(`select total_pages from public.tr_book_documents where id = $1`, [B]))[0];
  ok(doc.total_pages === live.length, '쪽 수 일치');
  const seqs = (await q(`select seq from public.tr_book_revisions where book_id = $1 and seq is not null order by seq`, [B])).map((r) => r.seq);
  ok(seqs.every((s, i) => s === i + 1), '저장 번호 연속');
});

await test('T22', '비상 정지·재활성화: 옛 쓰기 복귀, 다시 켜면 새 기준본, 이력 유지', async () => {
  const h0 = await head();
  await q(`select public.book_collab_deactivate($1)`, [B]);
  const p = (await livePages())[0];
  await asRole(db, 'anon', null, (tx) => tx.query(`update public.tr_book_pages set html = '<p>정지 중 옛 편집기 저장</p>' where id = $1`, [p.id]));
  await rejects(commit(h0.head_revision_id, { pages: [] }), /NOT_ENABLED/, '정지 중 협업 저장 거부');
  const res = (await q(`select public.book_collab_activate($1, $2) r`, [B, [ADMIN_ID]]))[0].r;
  ok(res.seq === h0.head_seq + 1, '새 기준본 번호 이어짐');
  const st = await call('book_collab_get_state', { p_book: B, p_include_pages: true });
  ok(st.pages[0].html === '<p>정지 중 옛 편집기 저장</p>', '정지 중 변경을 새 기준본에 반영');
  const base = (await q(`select base_revision_id from public.tr_book_revisions where id = $1`, [res.baseline_revision_id]))[0];
  ok(base.base_revision_id === h0.head_revision_id, '이전 head와 연결');
});

await test('ACT', '공개 중·학생 기록 있는 책은 초기 활성화 거부', async () => {
  await rejects(q(`select public.book_collab_activate($1, $2)`, [OTHER_BOOK, [ADMIN_ID]]), /학생 기록/, '다른 책(공개·메모) 거부');
  await rejects(q(`select public.book_collab_activate($1, $2)`, [PDF_BOOK, [ADMIN_ID]]), /페이지형/, 'PDF 거부');
  ok((await q(`select count(*)::int n from public.tr_book_revision_heads where book_id = any($1)`, [[OTHER_BOOK, PDF_BOOK]]))[0].n === 0, 'head 미생성');
});

const failed = results.filter((r) => !r.pass);
console.log('\n합계', results.length, '통과', results.length - failed.length, '실패', failed.length, '(자료:', fixture.source + ')');
process.exitCode = failed.length ? 1 : 0;
