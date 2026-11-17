-- School purchase invoices, supplier balances, and payment history.
-- All records are tenant-scoped and restricted to school accounting roles.
create table if not exists public.finance_purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  invoice_date text not null,
  fiscal_year text not null default '۱۴۰۶-۱۴۰۵',
  supplier_name text not null,
  supplier_phone text not null default '',
  category text not null,
  description text not null default '',
  subtotal numeric(18,0) not null check (subtotal >= 0),
  discount_amount numeric(18,0) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(18,0) not null default 0 check (tax_amount >= 0),
  total_amount numeric(18,0) not null check (total_amount > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_school_id uuid not null default private.frahoosh_current_school_id()
    references public.schools(id) on delete cascade,
  constraint finance_purchase_invoice_total_check
    check (total_amount = subtotal - discount_amount + tax_amount and total_amount > 0)
);
create unique index if not exists finance_purchase_invoice_number_school_uq
  on public.finance_purchase_invoices(tenant_school_id, invoice_number);
create index if not exists finance_purchase_invoice_date_idx
  on public.finance_purchase_invoices(tenant_school_id, invoice_date desc);

create table if not exists public.finance_purchase_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_purchase_invoices(id) on delete cascade,
  payment_date text not null,
  amount numeric(18,0) not null check (amount > 0),
  payment_method text not null check (payment_method in ('نقدی','کارت‌خوان','کارت‌به‌کارت','حواله بانکی','چک','سایر')),
  reference_number text not null default '',
  description text not null default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  tenant_school_id uuid not null default private.frahoosh_current_school_id()
    references public.schools(id) on delete cascade
);
create index if not exists finance_purchase_payments_invoice_idx
  on public.finance_purchase_payments(tenant_school_id, invoice_id, payment_date);

create table if not exists public.finance_purchase_attachments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_purchase_invoices(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  storage_path text not null unique,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  tenant_school_id uuid not null default private.frahoosh_current_school_id()
    references public.schools(id) on delete cascade
);

alter table public.finance_purchase_invoices enable row level security;
alter table public.finance_purchase_payments enable row level security;
alter table public.finance_purchase_attachments enable row level security;

drop policy if exists finance_purchase_invoices_accounting_access on public.finance_purchase_invoices;
create policy finance_purchase_invoices_accounting_access on public.finance_purchase_invoices
for all to authenticated
using (
  tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
)
with check (
  tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and created_by = auth.uid()
);

drop policy if exists finance_purchase_payments_accounting_access on public.finance_purchase_payments;
create policy finance_purchase_payments_accounting_access on public.finance_purchase_payments
for all to authenticated
using (
  tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and exists (
    select 1 from public.finance_purchase_invoices i
    where i.id = finance_purchase_payments.invoice_id and i.tenant_school_id = finance_purchase_payments.tenant_school_id
  )
)
with check (
  tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and created_by = auth.uid()
  and exists (
    select 1 from public.finance_purchase_invoices i
    where i.id = finance_purchase_payments.invoice_id and i.tenant_school_id = finance_purchase_payments.tenant_school_id
  )
);

drop policy if exists finance_purchase_attachments_accounting_access on public.finance_purchase_attachments;
create policy finance_purchase_attachments_accounting_access on public.finance_purchase_attachments
for all to authenticated
using (
  tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and exists (
    select 1 from public.finance_purchase_invoices i
    where i.id = finance_purchase_attachments.invoice_id and i.tenant_school_id = finance_purchase_attachments.tenant_school_id
  )
)
with check (
  tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and created_by = auth.uid()
  and exists (
    select 1 from public.finance_purchase_invoices i
    where i.id = finance_purchase_attachments.invoice_id and i.tenant_school_id = finance_purchase_attachments.tenant_school_id
  )
);

grant select, insert, update, delete on public.finance_purchase_invoices to authenticated;
grant select, insert, update, delete on public.finance_purchase_payments to authenticated;
grant select, insert, update, delete on public.finance_purchase_attachments to authenticated;

-- Keep purchase documents private; invoice UUID is the first storage folder.
drop policy if exists finance_purchase_docs_insert on storage.objects;
create policy finance_purchase_docs_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'finance-documents'
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and exists (
    select 1 from public.finance_purchase_invoices i
    where i.id::text = (storage.foldername(name))[1]
      and i.tenant_school_id = private.frahoosh_current_school_id()
      and private.frahoosh_school_access_active(i.tenant_school_id)
  )
);
drop policy if exists finance_purchase_docs_select on storage.objects;
create policy finance_purchase_docs_select on storage.objects
for select to authenticated
using (
  bucket_id = 'finance-documents'
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and exists (
    select 1 from public.finance_purchase_invoices i
    where i.id::text = (storage.foldername(name))[1]
      and i.tenant_school_id = private.frahoosh_current_school_id()
      and private.frahoosh_school_access_active(i.tenant_school_id)
  )
);
drop policy if exists finance_purchase_docs_delete on storage.objects;
create policy finance_purchase_docs_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'finance-documents'
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and exists (
    select 1 from public.finance_purchase_invoices i
    where i.id::text = (storage.foldername(name))[1]
      and i.tenant_school_id = private.frahoosh_current_school_id()
      and private.frahoosh_school_access_active(i.tenant_school_id)
  )
);

-- Serialize supplier payment inserts against the invoice row so concurrent
-- payments cannot make the paid total exceed the invoice amount.
create or replace function private.finance_purchase_payment_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total numeric(18,0);
  v_school uuid;
  v_paid numeric(18,0);
begin
  if auth.uid() is null then raise exception 'نشست معتبر نیست'; end if;
  select i.total_amount,i.tenant_school_id
    into v_total,v_school
  from public.finance_purchase_invoices i
  where i.id = new.invoice_id
  for update;
  if not found then raise exception 'فاکتور خرید پیدا نشد'; end if;
  if v_school <> private.frahoosh_current_school_id()
     or new.tenant_school_id <> v_school
     or not private.frahoosh_school_access_active(v_school) then
    raise exception 'فاکتور متعلق به مدرسه فعال نیست';
  end if;
  if private.frahoosh_current_role() <> all(array['manager','مدیر','مدیریت','accountant']) then
    raise exception 'فقط مدیر یا حسابدار مجاز به ثبت پرداخت است';
  end if;
  select coalesce(sum(p.amount),0) into v_paid
  from public.finance_purchase_payments p
  where p.invoice_id = new.invoice_id;
  if v_paid + new.amount > v_total then
    raise exception 'مبلغ پرداخت از مانده فاکتور بیشتر است';
  end if;
  return new;
end;
$$;
drop trigger if exists finance_purchase_payment_guard on public.finance_purchase_payments;
create trigger finance_purchase_payment_guard
before insert on public.finance_purchase_payments
for each row execute function private.finance_purchase_payment_guard();
revoke all on function private.finance_purchase_payment_guard() from public, anon, authenticated;
