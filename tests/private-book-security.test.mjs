/**
 * STATIC SQL CONTRACT CHECKS ONLY.
 * These tests read source. They do not connect to Supabase, execute SQL,
 * prove PostgreSQL syntax validity, or demonstrate live RLS enforcement.
 * Parent must live-test anon/non-admin denial, admin access, storage CRUD
 * (including cross-bucket moves), API exposure, and legacy regressions.
 * Run: node --test tests/private-book-security.test.mjs
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260922_private_book_workspace.sql', import.meta.url);
const raw = readFileSync(migrationUrl, 'utf8');
// Narrow source-contract assertions, not a general SQL parser.
assert.doesNotMatch(raw, /\/\*/);
const sql = raw.replace(/--[^\r\n]*/g, '');
const normalized = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const compact = normalized(sql);
const tables = ['pb_book_documents', 'pb_book_pages', 'pb_book_page_versions'];
const qualifiedTables = tables.map((name) => 'public.' + name);
const tableBody = (name) => {
  const escaped = name.replaceAll('.', '\\.');
  const match = sql.match(new RegExp('CREATE TABLE ' + escaped + ' \\(([\\s\\S]*?)\\n\\);', 'i'));
  assert.ok(match, 'Missing table definition: ' + name);
  return normalized(match[1]);
};
const policies = Array.from(sql.matchAll(/CREATE POLICY (\w+) ON (\w+\.\w+)([\s\S]*?);/gi),
  ([, name, target, body]) => ({ name, target, body: normalized(body) }));
const policyByName = (name) => {
  const matches = policies.filter((policy) => policy.name === name);
  assert.equal(matches.length, 1, 'Expected one policy named ' + name);
  return matches[0];
};
const statementList = (keyword) => Array.from(sql.matchAll(new RegExp('\\b' + keyword + '\\s+[^;]+;', 'gi')),
  (match) => normalized(match[0]));

// A green suite is not a live authorization result.
describe('private book migration [STATIC SQL ONLY, no live authorization claim]', () => {
  it('uses one transaction and deliberately rejects reruns', () => {
    assert.match(sql, /^\s*BEGIN;/);
    assert.match(sql, /COMMIT;\s*$/);
    assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
    assert.equal((sql.match(/\bCOMMIT\s*;/gi) || []).length, 1);
    assert.doesNotMatch(sql, /\b(?:ROLLBACK|SAVEPOINT)\b/i);
    assert.doesNotMatch(sql, /\bIF\s+NOT\s+EXISTS\b|\bCREATE\s+OR\s+REPLACE\b|\bON\s+CONFLICT\b/i);
    assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
    assert.ok(sql.indexOf('$preflight$;') < sql.indexOf('CREATE SCHEMA'));
    assert.equal((sql.match(/\bDO\s+\$/g) || []).length, 1);
  });

  it('preflights trusted role, dependencies, schema, tables/types, helper overloads, policies and bucket', () => {
    const preflight = normalized(sql.match(/DO \$preflight\$([\s\S]*?)\$preflight\$;/)[1]);
    assert.ok(preflight.includes("if current_user <> 'postgres' then raise exception"));
    for (const dependency of ['auth.users', 'storage.buckets', 'storage.objects']) {
      assert.ok(preflight.includes("pg_catalog.to_regclass('" + dependency + "') is null"));
    }
    assert.ok(preflight.includes("pg_catalog.to_regprocedure('auth.uid()') is null"));
    assert.ok(preflight.includes("n.nspname = 'private_book'"));
    for (const catalog of ['pg_namespace', 'pg_class', 'pg_type', 'pg_proc', 'pg_policy']) {
      assert.ok(preflight.includes('pg_catalog.' + catalog));
    }
    for (const name of tables) assert.ok(preflight.includes("'" + name + "'"));
    assert.ok(preflight.includes("p.proname = 'private_book_is_admin'"));
    assert.doesNotMatch(preflight, /pronargs|proargtypes/);
    for (const policy of policies) assert.ok(preflight.includes("'" + policy.name + "'"));
    assert.ok(preflight.includes("b.id = 'book-private' or b.name = 'book-private'"));
    assert.equal((preflight.match(/raise exception/g) || []).length, 7);
  });

  it('creates exactly the reserved schema, four tables, and one helper', () => {
    assert.deepEqual(Array.from(sql.matchAll(/CREATE SCHEMA (\w+) AUTHORIZATION (\w+);/g),
      ([, name, owner]) => [name, owner]), [['private_book', 'postgres']]);
    assert.deepEqual(Array.from(sql.matchAll(/CREATE TABLE (\w+\.\w+)/g), ([, name]) => name),
      ['private_book.admins', ...qualifiedTables]);
    assert.deepEqual(Array.from(sql.matchAll(/CREATE FUNCTION (\w+\.\w+)\(\)/g), ([, name]) => name),
      ['public.private_book_is_admin']);
    assert.doesNotMatch(sql, /\bCREATE\s+(?:VIEW|MATERIALIZED|EXTENSION|TRIGGER|PROCEDURE|ROLE|USER)\b/i);
  });

  it('keeps membership private, client-inaccessible, and tied to Auth UUID deletion', () => {
    assert.equal(tableBody('private_book.admins'),
      'auth_user_id uuid primary key references auth.users(id) on delete cascade');
    assert.ok(compact.includes('alter table private_book.admins enable row level security;'));
    assert.ok(compact.includes('revoke all on schema private_book from public, anon, authenticated, service_role;'));
    assert.ok(compact.includes('revoke all on table private_book.admins from public, anon, authenticated, service_role;'));
    assert.equal(policies.filter((policy) => policy.target.startsWith('private_book.')).length, 0);
    assert.doesNotMatch(sql, /\bGRANT\s+[^;]*\bprivate_book\./i);
    assert.doesNotMatch(sql, /\bGRANT\s+[^;]*\bSCHEMA\s+private_book\b/i);
    assert.match(raw, /Keep private_book OUT of the API's exposed-schemas configuration/);
  });

  it('uses a postgres-owned, stable SECURITY DEFINER helper with empty search_path', () => {
    const helper = sql.match(/CREATE FUNCTION public\.private_book_is_admin\(\)([\s\S]*?\$membership\$;)/);
    assert.ok(helper);
    assert.equal(normalized(helper[1]), normalized(
      "RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' " +
      'AS $membership$ SELECT EXISTS ( SELECT 1 FROM private_book.admins AS a ' +
      'WHERE a.auth_user_id = auth.uid() ); $membership$;'));
    assert.ok(compact.includes('alter function public.private_book_is_admin() owner to postgres;'));
    assert.ok(compact.includes('revoke all on function public.private_book_is_admin() from public, anon, authenticated, service_role;'));
    assert.ok(compact.includes('grant execute on function public.private_book_is_admin() to authenticated, service_role;'));
    assert.doesNotMatch(sql, /\b(?:auth\.jwt|user_metadata|app_metadata|current_setting)\s*\(/i);
  });

  it('retains required document fields while forbidding published or non-page books', () => {
    const body = tableBody('public.pb_book_documents');
    const required = [
      'id uuid primary key default pg_catalog.gen_random_uuid()',
      'title text not null', "description text not null default ''", 'storage_path text',
      'total_pages integer not null default 0 check (total_pages >= 0)',
      "toc jsonb not null default '[]'::jsonb",
      "kind text not null default 'pages' check (kind = 'pages')",
      "role text not null default 'etc'",
      "audience_mode text default 'admin' check (audience_mode is null or audience_mode = 'admin')",
      'is_active boolean not null default false check (is_active = false)',
      'sort_order integer not null default 0', 'deleted_at timestamptz',
      'created_at timestamptz not null default pg_catalog.now()',
      'updated_at timestamptz not null default pg_catalog.now()',
    ];
    for (const fragment of required) assert.ok(body.includes(fragment), 'Missing document constraint: ' + fragment);
  });

  it('binds pages to documents and versions to the exact page/book pair', () => {
    const pages = tableBody('public.pb_book_pages');
    const versions = tableBody('public.pb_book_page_versions');
    assert.ok(pages.includes('book_id uuid not null references public.pb_book_documents(id) on delete cascade'));
    assert.ok(pages.includes('unique (id, book_id)'));
    for (const body of [pages, versions]) {
      assert.ok(body.includes('id uuid primary key default pg_catalog.gen_random_uuid()'));
      assert.ok(body.includes("blocks jsonb not null default '[]'::jsonb"));
      assert.ok(body.includes("html text not null default ''"));
      assert.ok(body.includes('created_at timestamptz not null default pg_catalog.now()'));
    }
    assert.ok(pages.includes('sort_order integer not null default 0'));
    assert.ok(pages.includes('updated_at timestamptz not null default pg_catalog.now()'));
    assert.ok(versions.includes('page_id uuid not null'));
    assert.ok(versions.includes('book_id uuid not null'));
    assert.ok(versions.includes('foreign key (page_id, book_id) references public.pb_book_pages(id, book_id) on delete cascade'));
    assert.ok(versions.includes('created_by uuid default auth.uid() references auth.users(id) on delete set null'));
  });

  it('enables RLS on all four new tables and alters no existing tables', () => {
    assert.deepEqual(Array.from(sql.matchAll(/ALTER TABLE (\w+\.\w+) ([^;]+);/g),
      ([, name, change]) => [name, normalized(change)]),
      ['private_book.admins', ...qualifiedTables].map((name) => [name, 'enable row level security']));
    assert.doesNotMatch(sql, /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b|\bBYPASSRLS\b/i);
    assert.equal((sql.match(/\bALTER\b/gi) || []).length, 5);
  });

  it('has an exact least-privilege GRANT and REVOKE allowlist', () => {
    assert.deepEqual(statementList('grant'), [
      'grant execute on function public.private_book_is_admin() to authenticated, service_role;',
      ...qualifiedTables.map((name) => 'grant select, insert, update, delete on table ' + name + ' to authenticated, service_role;'),
    ]);
    assert.deepEqual(statementList('revoke'), [
      'revoke all on schema private_book from public, anon, authenticated, service_role;',
      'revoke all on table private_book.admins from public, anon, authenticated, service_role;',
      'revoke all on function public.private_book_is_admin() from public, anon, authenticated, service_role;',
      ...qualifiedTables.map((name) => 'revoke all on table ' + name + ' from public, anon, authenticated, service_role;'),
    ]);
    assert.doesNotMatch(sql, /\bGRANT\s+[^;]*\b(?:anon|PUBLIC)\s*;/i);
  });

  it('requires admin membership on old and new rows for all public-table operations', () => {
    for (const name of tables) {
      const policy = policyByName(name + '_admin_all');
      assert.equal(policy.target, 'public.' + name);
      assert.equal(policy.body,
        'for all to authenticated using (public.private_book_is_admin()) with check (public.private_book_is_admin())');
    }
    assert.equal(policies.length, 7);
  });

  it('creates only the private 20 MiB PNG/JPEG/WebP bucket without adopting existing data', () => {
    const insert = sql.match(/INSERT INTO storage\.buckets[\s\S]*?;/);
    assert.ok(insert);
    assert.equal(normalized(insert[0]), normalized(
      'INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) ' +
      "VALUES ( 'book-private', 'book-private', false, 20971520, " +
      "ARRAY['image/png', 'image/jpeg', 'image/webp']::text[] );"));
    assert.equal(20971520, 20 * 1024 * 1024);
    assert.deepEqual(Array.from(sql.matchAll(/\bINSERT INTO (\w+\.\w+)/g), ([, name]) => name), ['storage.buckets']);
  });

  it('scopes every storage operation to authenticated admins and exactly one bucket', () => {
    const boundary = "bucket_id = 'book-private' and public.private_book_is_admin()";
    const expected = {
      select: 'for select to authenticated using (' + boundary + ')',
      insert: 'for insert to authenticated with check (' + boundary + ')',
      update: 'for update to authenticated using (' + boundary + ') with check (' + boundary + ')',
      delete: 'for delete to authenticated using (' + boundary + ')',
    };
    for (const [operation, expression] of Object.entries(expected)) {
      const policy = policyByName('pb_book_private_' + operation);
      assert.equal(policy.target, 'storage.objects');
      assert.equal(policy.body, expression);
    }
    assert.equal(policies.filter((policy) => policy.target === 'storage.objects').length, 4);
  });

  it('does not alter legacy/auth/storage objects, other policies, configuration, or data', () => {
    assert.doesNotMatch(sql, /\btr_book_\w*/i);
    assert.doesNotMatch(sql, /\b(?:ALTER|DROP)\s+POLICY\b/i);
    assert.doesNotMatch(sql, /\bALTER\s+(?:ROLE|USER|DATABASE|SYSTEM|SCHEMA|DEFAULT PRIVILEGES)\b/i);
    assert.doesNotMatch(sql, /^\s*(?:UPDATE|DELETE\s+FROM|MERGE|COPY|CALL|EXECUTE|TRUNCATE)\b/gim);
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE)\s+auth\./i);
    assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+(?:private_book\.|public\.)/i);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+storage\./i);
    assert.doesNotMatch(sql, /\b(?:http|net|dblink)\./i);
    assert.doesNotMatch(sql, /\bSET\s+(?:ROLE|SESSION|LOCAL|row_security|session_replication_role)\b/i);
    assert.doesNotMatch(sql, /\bCREATE\s+PUBLICATION\b|\bALTER\s+PUBLICATION\b/i);
  });

  it('contains no hardcoded credentials, Auth UUIDs, remote requests, or content imports', () => {
    assert.doesNotMatch(raw, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    assert.doesNotMatch(raw, /\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+/);
    assert.doesNotMatch(raw, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    assert.doesNotMatch(raw, /postgres(?:ql)?:\/\/|https?:\/\//i);
    assert.doesNotMatch(raw, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
    assert.doesNotMatch(sql, /\b(?:password|apikey|api_key|access_token|refresh_token)\b/i);
  });
});
