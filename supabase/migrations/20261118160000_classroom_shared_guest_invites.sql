-- Make guest invitation links shareable by up to ten guests for the full meeting.
-- Upgrade still-active invitations created by the earlier single-use implementation.
alter table public.classroom_guest_invites
  alter column max_uses set default 10;

update public.classroom_guest_invites as invite
   set max_uses = 10,
       expires_at = meeting.expires_at
  from public.classroom_ad_hoc_meetings as meeting
 where meeting.id = invite.meeting_id
   and meeting.tenant_school_id = invite.tenant_school_id
   and meeting.status = 'active'
   and meeting.expires_at > now()
   and invite.revoked_at is null;

comment on table public.classroom_guest_invites is
  'Hashed, shareable guest tokens for a single active ad-hoc meeting. Each link permits up to ten guest entries and expires with its meeting. Raw invitation tokens are returned once and never stored.';
