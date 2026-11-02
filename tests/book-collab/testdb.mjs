// 시험 DB (PGlite = WebAssembly PostgreSQL 17). 운영 DB에 연결하지 않는다.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');
export const MIGRATION = path.join(REPO, 'supabase', 'migrations', '20261102120000_book_collab_versions.sql');
export const TARGET_BOOK = 'e660266e-1b01-4d11-9254-81ea7e613344';
export const OTHER_BOOK = '0b0b0b0b-0000-4000-8000-000000000001';
export const PDF_BOOK = '0b0b0b0b-0000-4000-8000-000000000002';
export const ADMIN_ID = 'a0a0a0a0-0000-4000-8000-0000000000a1';
export const ADMIN_EMAIL = 'owner@example.test';
export const OTHER_ADMIN_ID = 'a0a0a0a0-0000-4000-8000-0000000000a2';
export const OTHER_ADMIN_EMAIL = 'helper@example.test';
const IMG = 'https://qpqjevecjejvbeuogtbx.supabase.co/storage/v1/object/public/guide-images/book-migrations/' + TARGET_BOOK + '/';

function uuidFrom(n) {
  return 'c0c0c0c0-0000-4000-8000-' + String(n).padStart(12, '0');
}

// 운영 자료가 없으면 합성 자료(40쪽). 운영 읽기 사본은 BOOK_COLLAB_FIXTURE 경로로만 주입(저장소에 넣지 않음).
export function loadFixture() {
  const p = process.env.BOOK_COLLAB_FIXTURE;
  if (p && fs.existsSync(p)) {
    const f = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...f, source: 'fixture:' + path.basename(p) };
  }
  const pages = [];
  for (let i = 1; i <= 40; i++) {
    const text = '합성 ' + i + '쪽';
    const blocks = [{ id: 'b' + i, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }];
    let html = '<p>' + text + '</p>';
    if (i % 10 === 0) html += '<figure><img src="' + IMG + 'p' + i + '.png" alt=""><figcaption>그림</figcaption></figure>';
    pages.push({ id: uuidFrom(i), book_id: TARGET_BOOK, sort_order: i, blocks, html,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
  }
  const versions = pages.slice(0, 12).map((pg, i) => ({ id: uuidFrom(1000 + i), page_id: pg.id, book_id: TARGET_BOOK,
    created_by: 'admin', created_at: '2026-10-02T00:00:00Z' }));
  return {
    doc: { id: TARGET_BOOK, title: '이온토플 입문서(합성)', kind: 'pages', is_active: false, total_pages: 40, sort_order: 1,
      audience_mode: 'all', allow_print: false, view_confirm: false, role: 'regular' },
    pages, versions, source: 'synthetic',
  };
}

export async function createTestDb({ fixture = loadFixture(), migrate = true } = {}) {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(here, 'stub-schema.sql'), 'utf8'));
  await db.query(`insert into auth.users (id, email, test_password) values ($1, $2, 'owner-pass'), ($3, $4, 'helper-pass')`,
    [ADMIN_ID, ADMIN_EMAIL, OTHER_ADMIN_ID, OTHER_ADMIN_EMAIL]);
  const d = fixture.doc;
  await db.query(`insert into public.tr_book_documents (id, title, kind, is_active, total_pages, sort_order, audience_mode,
                    allow_print, view_confirm, role, description, created_at, updated_at)
                  values ($1,$2,'pages',$3,$4,$5,$6,$7,$8,$9,$10, now(), now())`,
    [d.id, d.title, !!d.is_active, d.total_pages || fixture.pages.length, d.sort_order || 1, d.audience_mode || 'all',
     !!d.allow_print, !!d.view_confirm, d.role || 'regular', d.description || null]);
  await db.query(`insert into public.tr_book_pages (id, book_id, sort_order, blocks, html, created_at, updated_at)
                  select id, book_id, sort_order, coalesce(blocks, '[]'::jsonb), coalesce(html, ''), created_at, updated_at
                    from jsonb_to_recordset($1::jsonb) as x(id uuid, book_id uuid, sort_order int, blocks jsonb, html text,
                                                           created_at timestamptz, updated_at timestamptz)`,
    [JSON.stringify(fixture.pages)]);
  await db.query(`insert into public.tr_book_page_versions (id, page_id, book_id, created_by, created_at)
                  select id, page_id, book_id, created_by, created_at
                    from jsonb_to_recordset($1::jsonb) as x(id uuid, page_id uuid, book_id uuid, created_by text, created_at timestamptz)`,
    [JSON.stringify(fixture.versions || [])]);
  // 다른 책(일반 편집기 유지 대상)과 PDF 책
  await db.query(`insert into public.tr_book_documents (id, title, kind, is_active, total_pages) values
                  ($1, '다른 입문서', 'pages', true, 2), ($2, 'PDF 자료', 'pdf', true, 10)`, [OTHER_BOOK, PDF_BOOK]);
  await db.query(`insert into public.tr_book_pages (id, book_id, sort_order, html) values
                  ($1, $3, 1, '<p>다른 1</p>'), ($2, $3, 2, '<p>다른 2</p>')`,
    ['d0d0d0d0-0000-4000-8000-000000000001', 'd0d0d0d0-0000-4000-8000-000000000002', OTHER_BOOK]);
  await db.query(`insert into public.tr_book_memos (user_id, book_id, page_uid, content) values ('student-1', $1, $2, '다른 책 메모')`,
    [OTHER_BOOK, 'd0d0d0d0-0000-4000-8000-000000000001']);
  await db.query(`insert into public.tr_book_progress (user_id, book_id, last_page) values ('student-1', $1, 2)`, [PDF_BOOK]);
  if (migrate) await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  return db;
}

export function claimsFor(id, email) {
  return { sub: id, role: 'authenticated', email };
}

// PostgREST처럼 요청마다 트랜잭션 + set local role + JWT claims
export async function asRole(db, role, claims, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : '']);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

export async function rpc(db, role, claims, fn, args) {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' && !Array.isArray(args[k])) || (Array.isArray(args[k]) && args[k].some((x) => typeof x === 'object'))
    ? JSON.stringify(args[k]) : args[k]);
  return asRole(db, role, claims, async (tx) => (await tx.query(sql, vals)).rows[0].r);
}
