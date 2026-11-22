-- Durable, short-lived result cache for textbook AI analysis.
-- Stores summaries only (never the extracted source text) so a browser can
-- recover a completed result if the HTTP response is lost in transit.
create table if not exists public.smart_exam_textbook_analysis_cache (
  request_id uuid primary key,
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null check (char_length(btrim(summary)) between 30 and 3000),
  page_reference text not null check (char_length(btrim(page_reference)) between 1 and 120),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists smart_exam_textbook_analysis_cache_expiry_idx
  on public.smart_exam_textbook_analysis_cache (expires_at);

alter table public.smart_exam_textbook_analysis_cache enable row level security;
revoke all on public.smart_exam_textbook_analysis_cache from public, anon, authenticated;
grant all on public.smart_exam_textbook_analysis_cache to service_role;
