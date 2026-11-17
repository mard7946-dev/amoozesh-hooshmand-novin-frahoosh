-- School cash and bank ledger. Purchase payments can be posted atomically to a selected account.
create table if not exists public.finance_cash_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_type text not null check (account_type in ('cash','bank')),
  bank_name text not null default '',
  account_number_masked text not null default '',
  opening_balance numeric(18,0) not null default 0 check (opening_balance >= 0),
  opening_date text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_school_id uuid not null default private.frahoosh_current_school_id()
    references public.schools(id) on delete cascade,
  constraint finance_cash_account_name_school_uq unique (tenant_school_id,name)
);
create index if not exists finance_cash_accounts_school_active_idx
  on public.finance_cash_accounts(tenant_school_id,is_active,name);

create table if not exists public.finance_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_date text not null,
  transaction_type text not null check (transaction_type in ('income','expense','transfer')),
  amount numeric(18,0) not null check (amount > 0),
  account_id uuid not null references public.finance_cash_accounts(id),
  destination_account_id uuid references public.finance_cash_accounts(id),
  category text not null default '',
  counterparty text not null default '',
  description text not null default '',
  reference_number text not null default '',
  purchase_payment_id uuid unique references public.finance_purchase_payments(id) on delete restrict,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  tenant_school_id uuid not null default private.frahoosh_current_school_id(),
  constraint finance_cash_transfer_shape_check check (
    (transaction_type = 'transfer' and destination_account_id is not null and destination_account_id <> account_id)
    or (transaction_type <> 'transfer' and destination_account_id is null)
  )
);
create index if not exists finance_cash_transactions_school_date_idx
  on public.finance_cash_transactions(tenant_school_id,transaction_date desc,created_at desc);
create index if not exists finance_cash_transactions_account_idx
  on public.finance_cash_transactions(tenant_school_id,account_id,transaction_date);
create index if not exists finance_cash_transactions_destination_idx
  on public.finance_cash_transactions(tenant_school_id,destination_account_id,transaction_date)
  where destination_account_id is not null;

alter table public.finance_cash_accounts enable row level security;
alter table public.finance_cash_transactions enable row level security;

drop policy if exists finance_cash_accounts_accounting_access on public.finance_cash_accounts;
create policy finance_cash_accounts_accounting_access on public.finance_cash_accounts
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

drop policy if exists finance_cash_transactions_accounting_select on public.finance_cash_transactions;
create policy finance_cash_transactions_accounting_select on public.finance_cash_transactions
for select to authenticated
using (
  tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
);
drop policy if exists finance_cash_transactions_accounting_insert on public.finance_cash_transactions;
create policy finance_cash_transactions_accounting_insert on public.finance_cash_transactions
for insert to authenticated
with check (
  tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
  and private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant'])
  and created_by = auth.uid()
);
grant select,insert,update,delete on public.finance_cash_accounts to authenticated;
grant select,insert on public.finance_cash_transactions to authenticated;

create or replace function private.finance_cash_transaction_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_school uuid;
  v_dest_school uuid;
begin
  if auth.uid() is null then raise exception 'نشست معتبر نیست'; end if;
  if new.tenant_school_id <> private.frahoosh_current_school_id()
     or not private.frahoosh_school_access_active(new.tenant_school_id)
     or private.frahoosh_current_role() <> all(array['manager','مدیر','مدیریت','accountant']) then
    raise exception 'دسترسی ثبت گردش مالی برای این مدرسه مجاز نیست';
  end if;
  select a.tenant_school_id into v_source_school
    from public.finance_cash_accounts a where a.id = new.account_id and a.is_active;
  if not found or v_source_school <> new.tenant_school_id then
    raise exception 'حساب مبدأ معتبر یا فعال نیست';
  end if;
  if new.transaction_type = 'transfer' then
    select a.tenant_school_id into v_dest_school
      from public.finance_cash_accounts a where a.id = new.destination_account_id and a.is_active;
    if not found or v_dest_school <> new.tenant_school_id then
      raise exception 'حساب مقصد معتبر یا فعال نیست';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists finance_cash_transaction_guard on public.finance_cash_transactions;
create trigger finance_cash_transaction_guard
before insert on public.finance_cash_transactions
for each row execute function private.finance_cash_transaction_guard();
revoke all on function private.finance_cash_transaction_guard() from public,anon,authenticated;

-- Link each newly recorded supplier payment to its actual cash/bank account in the same DB transaction.
alter table public.finance_purchase_payments
  add column if not exists cash_account_id uuid references public.finance_cash_accounts(id);

create or replace function private.finance_purchase_payment_to_cashbook()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_supplier text;
  v_invoice_number text;
begin
  if new.cash_account_id is null then
    raise exception 'برای ثبت پرداخت فروشنده، حساب صندوق یا بانک را انتخاب کنید';
  end if;
  select i.supplier_name,i.invoice_number into v_supplier,v_invoice_number
    from public.finance_purchase_invoices i
   where i.id = new.invoice_id and i.tenant_school_id = new.tenant_school_id;
  if not found then raise exception 'فاکتور خرید مرتبط یافت نشد'; end if;
  insert into public.finance_cash_transactions(
    transaction_date,transaction_type,amount,account_id,category,counterparty,
    description,reference_number,purchase_payment_id,created_by,tenant_school_id
  ) values (
    new.payment_date,'expense',new.amount,new.cash_account_id,'پرداخت فاکتور خرید',
    v_supplier,'پرداخت فاکتور شماره '||v_invoice_number||case when new.description='' then '' else ' - '||new.description end,
    new.reference_number,new.id,new.created_by,new.tenant_school_id
  );
  return new;
end;
$$;
drop trigger if exists finance_purchase_payment_to_cashbook on public.finance_purchase_payments;
create trigger finance_purchase_payment_to_cashbook
after insert on public.finance_purchase_payments
for each row execute function private.finance_purchase_payment_to_cashbook();
revoke all on function private.finance_purchase_payment_to_cashbook() from public,anon,authenticated;
