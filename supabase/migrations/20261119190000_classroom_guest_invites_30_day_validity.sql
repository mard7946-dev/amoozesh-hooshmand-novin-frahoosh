-- Guest invitations are reusable for 30 days by default.
-- The meeting remains independently controlled by its active/ended status.
alter table public.classroom_guest_invites
  alter column expires_at set default (now() + interval '30 days');

-- Extend existing non-revoked invitations to the same 30-day-from-creation policy.
update public.classroom_guest_invites
   set expires_at = created_at + interval '30 days'
 where revoked_at is null;

-- A guest link is governed by its own expiry/revocation and the meeting's
-- active status. The meeting's planned end time does not consume the invite.
create or replace function public.claim_classroom_guest_invite(p_token_hash text)
returns setof public.classroom_guest_invites
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.classroom_guest_invites
     set use_count = use_count + 1
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > now()
     and use_count < max_uses
     and exists (
       select 1 from public.classroom_ad_hoc_meetings m
        where m.id = classroom_guest_invites.meeting_id
          and m.tenant_school_id = classroom_guest_invites.tenant_school_id
          and m.status = 'active'
     )
  returning *;
$$;

revoke all on function public.claim_classroom_guest_invite(text) from public, anon, authenticated;
grant execute on function public.claim_classroom_guest_invite(text) to service_role;

comment on column public.classroom_guest_invites.expires_at is
  'Guest link expiry; defaults to 30 days after creation and can be shortened by a school manager via revoked_at.';
