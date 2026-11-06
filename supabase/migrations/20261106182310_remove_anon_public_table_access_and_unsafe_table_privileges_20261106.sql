-- Anonymous browser requests use narrowly scoped RPCs/Edge Functions.
-- Do not grant direct table access to the unauthenticated anon role.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON TABLE public.app_release_history TO anon;

-- RLS does not govern TRUNCATE; authenticated application users do not need
-- schema-level maintenance privileges on application tables.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Anonymous users must not obtain sequence access that could support writes.
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Keep future objects created by postgres migrations on the same least-privilege
-- baseline, while preserving the public published-release listing.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
