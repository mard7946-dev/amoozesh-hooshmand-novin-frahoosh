-- Audience targeting for school bulletin notices.
-- Existing notices remain visible to all school members for backward compatibility.
alter table public.school_bulletins
  add column if not exists audience_roles text[] not null default array['all']::text[];

update public.school_bulletins
set audience_roles = array['all']::text[]
where audience_roles is null or cardinality(audience_roles) = 0;
