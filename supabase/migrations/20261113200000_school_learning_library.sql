insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('school-library-files','school-library-files',false,26214400,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.school_library_resources (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete restrict,
 title text not null check (char_length(title) between 2 and 240),
 description text not null default '',
 resource_type text not null check (resource_type in ('textbook','handout','lesson','worksheet','other')),
 subject text not null default '',
 grade text not null default '',
 chapter text not null default '',
 storage_path text,
 source_url text,
 source_title text not null default '',
 source_license text not null default '',
 permission_confirmed boolean not null default false,
 status text not null default 'published' check (status in ('draft','published','archived')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint school_library_resource_location check (
   (storage_path is not null and source_url is null) or
   (storage_path is null and source_url is not null)
 )
);
create index if not exists school_library_school_status_idx on public.school_library_resources(school_id,status,resource_type,subject,grade);
alter table public.school_library_resources enable row level security;
revoke all on public.school_library_resources from anon,authenticated;
grant all on public.school_library_resources to service_role;
