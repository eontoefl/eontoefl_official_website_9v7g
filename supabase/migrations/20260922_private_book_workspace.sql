-- Private book workspace, version 20260922. Run once as postgres.
-- This is deliberately NOT a rerunnable migration: every existing owned-name
-- conflict aborts the transaction. Never replace/adopt existing objects here.
-- No legacy tr_book_* objects, PDFs, auth identities, or other storage policies
-- are changed. Provision admin Auth UUIDs separately through a trusted process.
-- Keep private_book OUT of the API's exposed-schemas configuration. Its schema
-- and membership table also have no client privileges, even if misconfigured.
-- Static tests do not establish live authorization; test anon, non-admin,
-- admin, storage CRUD, and existing application regressions before release.

BEGIN;

DO $preflight$
BEGIN
  IF CURRENT_USER <> 'postgres' THEN
    RAISE EXCEPTION 'Private book installation requires the trusted postgres role';
  END IF;

  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('storage.buckets') IS NULL
     OR pg_catalog.to_regclass('storage.objects') IS NULL
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Required Supabase Auth/Storage objects are missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace AS n
    WHERE n.nspname = 'private_book'
  ) THEN
    RAISE EXCEPTION 'Conflict: private_book schema already exists; installation is run-once';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('pb_book_documents', 'pb_book_pages', 'pb_book_page_versions')
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS t
    JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname IN ('pb_book_documents', 'pb_book_pages', 'pb_book_page_versions')
  ) THEN
    RAISE EXCEPTION 'Conflict: a private book relation or row-type name already exists';
  END IF;

  -- Reject any overload of the reserved helper name, not just its zero-arg form.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'private_book_is_admin'
  ) THEN
    RAISE EXCEPTION 'Conflict: public.private_book_is_admin already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS p
    WHERE p.polname IN (
      'pb_book_documents_admin_all', 'pb_book_pages_admin_all',
      'pb_book_page_versions_admin_all', 'pb_book_private_select',
      'pb_book_private_insert', 'pb_book_private_update', 'pb_book_private_delete'
    )
  ) THEN
    RAISE EXCEPTION 'Conflict: a reserved private book policy name already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.buckets AS b
    WHERE b.id = 'book-private' OR b.name = 'book-private'
  ) THEN
    RAISE EXCEPTION 'Conflict: book-private bucket already exists';
  END IF;
END;
$preflight$;

CREATE SCHEMA private_book AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private_book FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private_book.admins (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE private_book.admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private_book.admins FROM PUBLIC, anon, authenticated, service_role;
-- No policies or client grants on the membership table. The postgres-owned
-- SECURITY DEFINER helper reads it using the owner's RLS bypass, without
-- exposing membership rows or permitting clients to promote themselves.

CREATE FUNCTION public.private_book_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $membership$
  SELECT EXISTS (
    SELECT 1 FROM private_book.admins AS a
    WHERE a.auth_user_id = auth.uid()
  );
$membership$;
ALTER FUNCTION public.private_book_is_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.private_book_is_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.private_book_is_admin() TO authenticated, service_role;

CREATE TABLE public.pb_book_documents (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  storage_path text,
  total_pages integer NOT NULL DEFAULT 0 CHECK (total_pages >= 0),
  toc jsonb NOT NULL DEFAULT '[]'::jsonb,
  kind text NOT NULL DEFAULT 'pages' CHECK (kind = 'pages'),
  role text NOT NULL DEFAULT 'etc',
  audience_mode text DEFAULT 'admin' CHECK (audience_mode IS NULL OR audience_mode = 'admin'),
  is_active boolean NOT NULL DEFAULT false CHECK (is_active = false),
  sort_order integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.pb_book_pages (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.pb_book_documents(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  html text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pb_book_pages_id_book_id_unique UNIQUE (id, book_id)
);

CREATE TABLE public.pb_book_page_versions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  page_id uuid NOT NULL,
  book_id uuid NOT NULL,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  html text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT pb_book_page_versions_page_book_fk
    FOREIGN KEY (page_id, book_id)
    REFERENCES public.pb_book_pages(id, book_id) ON DELETE CASCADE
);

ALTER TABLE public.pb_book_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pb_book_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pb_book_page_versions ENABLE ROW LEVEL SECURITY;

-- Reset any inherited/default object grants before granting only the required
-- CRUD privileges. service_role is intentionally trusted and bypasses RLS.
REVOKE ALL ON TABLE public.pb_book_documents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pb_book_pages FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pb_book_page_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pb_book_documents TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pb_book_pages TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pb_book_page_versions TO authenticated, service_role;

CREATE POLICY pb_book_documents_admin_all ON public.pb_book_documents
  FOR ALL TO authenticated
  USING (public.private_book_is_admin())
  WITH CHECK (public.private_book_is_admin());
CREATE POLICY pb_book_pages_admin_all ON public.pb_book_pages
  FOR ALL TO authenticated
  USING (public.private_book_is_admin())
  WITH CHECK (public.private_book_is_admin());
CREATE POLICY pb_book_page_versions_admin_all ON public.pb_book_page_versions
  FOR ALL TO authenticated
  USING (public.private_book_is_admin())
  WITH CHECK (public.private_book_is_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'book-private', 'book-private', false, 20971520,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
);

-- These are additive, bucket-scoped policies. Existing policies are untouched.
-- This assumes the project's existing policies do not independently permit
-- access to every bucket; policy expressions are permissively OR-combined.
CREATE POLICY pb_book_private_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'book-private' AND public.private_book_is_admin());
CREATE POLICY pb_book_private_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'book-private' AND public.private_book_is_admin());
CREATE POLICY pb_book_private_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'book-private' AND public.private_book_is_admin())
  WITH CHECK (bucket_id = 'book-private' AND public.private_book_is_admin());
CREATE POLICY pb_book_private_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'book-private' AND public.private_book_is_admin());

COMMIT;
