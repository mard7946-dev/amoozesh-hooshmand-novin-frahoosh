-- Bulletin data is accessed only through the authenticated school-bulletin
-- Edge Function, which uses the service role after validating the user session.
-- Remove direct Data API privileges from browser roles as defense in depth.
revoke all on table public.school_bulletins from anon, authenticated;
revoke all on table public.school_bulletin_reads from anon, authenticated;
