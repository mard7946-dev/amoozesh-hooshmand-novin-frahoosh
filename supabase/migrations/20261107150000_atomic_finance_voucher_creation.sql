-- Create a voucher header and all journal lines atomically.
-- Posting remains a separate, server-validated action.
create or replace function public.finance_create_voucher_draft(p_voucher jsonb,p_lines jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_school uuid;
  v_voucher_id uuid;
  v_line_count integer;
  v_debit numeric(18,0);
  v_credit numeric(18,0);
  v_document_number text;
  v_fiscal_year text;
  v_voucher_date text;
  v_voucher_type text;
  v_description text;
  v_counterparty text;
begin
  v_school := private.frahoosh_current_school_id();
  if auth.uid() is null then raise exception 'نشست معتبر نیست'; end if;
  if not coalesce(private.frahoosh_current_role() = any(array['manager','مدیر','مدیریت','accountant']), false) then
    raise exception 'فقط مدیر یا حسابدار مجاز به ثبت سند است';
  end if;
  if v_school is null or not private.frahoosh_school_access_active(v_school) then raise exception 'دسترسی مدرسه فعال نیست'; end if;
  if jsonb_typeof(p_voucher) <> 'object' or jsonb_typeof(p_lines) <> 'array' then raise exception 'ساختار سند یا ردیف‌ها معتبر نیست'; end if;

  v_document_number := nullif(btrim(p_voucher->>'document_number'), '');
  v_fiscal_year := nullif(btrim(p_voucher->>'fiscal_year'), '');
  v_voucher_date := nullif(btrim(p_voucher->>'voucher_date'), '');
  v_voucher_type := nullif(btrim(p_voucher->>'voucher_type'), '');
  v_description := coalesce(p_voucher->>'description', '');
  v_counterparty := coalesce(p_voucher->>'counterparty', '');
  if v_document_number is null or v_fiscal_year is null or v_voucher_date is null then raise exception 'شماره سند، سال مالی و تاریخ الزامی است'; end if;
  if v_voucher_type is null or v_voucher_type not in ('دریافت','پرداخت','انتقال','اصلاحیه','افتتاحیه','اختتامیه') then raise exception 'نوع سند معتبر نیست'; end if;

  select count(*),coalesce(sum(x.debit),0),coalesce(sum(x.credit),0)
    into v_line_count,v_debit,v_credit
  from jsonb_to_recordset(p_lines) as x(account_code text,account_title text,debit numeric,credit numeric,student_id integer,description text);
  if v_line_count < 2 or v_debit <= 0 or v_debit <> v_credit then raise exception 'سند نامتوازن است؛ حداقل دو ردیف و جمع برابر بدهکار و بستانکار لازم است'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as x(account_code text,account_title text,debit numeric,credit numeric,student_id integer,description text)
    where nullif(btrim(x.account_title),'') is null or x.debit is null or x.credit is null
       or x.debit < 0 or x.credit < 0 or x.debit <> trunc(x.debit) or x.credit <> trunc(x.credit)
       or not ((x.debit > 0 and x.credit = 0) or (x.credit > 0 and x.debit = 0))
  ) then raise exception 'هر ردیف باید عنوان حساب و فقط یک مبلغ صحیح و مثبت در ستون بدهکار یا بستانکار داشته باشد'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as x(account_code text,account_title text,debit numeric,credit numeric,student_id integer,description text)
    where x.student_id is not null and not exists (
      select 1 from public.students s where s.id=x.student_id and s.tenant_school_id=v_school
    )
  ) then raise exception 'دانش‌آموز انتخاب‌شده متعلق به این مدرسه نیست'; end if;

  insert into public.finance_vouchers(document_number,fiscal_year,voucher_date,voucher_type,description,counterparty,status,created_by,tenant_school_id)
  values(v_document_number,v_fiscal_year,v_voucher_date,v_voucher_type,v_description,v_counterparty,'draft',coalesce(auth.jwt()->>'email','unknown'),v_school)
  returning id into v_voucher_id;

  insert into public.finance_voucher_lines(voucher_id,line_no,account_code,account_title,debit,credit,student_id,student_name,parent_name,description,tenant_school_id)
  select v_voucher_id,e.ordinality::integer,coalesce(x.account_code,''),btrim(x.account_title),x.debit,x.credit,x.student_id,
         case when s.id is null then '' else concat_ws(' ',s.first_name,s.last_name) end,
         coalesce(s.father_name,''),coalesce(x.description,''),v_school
  from jsonb_array_elements(p_lines) with ordinality as e(item,ordinality)
  cross join lateral jsonb_to_record(e.item) as x(account_code text,account_title text,debit numeric,credit numeric,student_id integer,description text)
  left join public.students s on s.id=x.student_id and s.tenant_school_id=v_school;

  return jsonb_build_object('id',v_voucher_id,'document_number',v_document_number,'tenant_school_id',v_school,'status','draft','line_count',v_line_count,'total_debit',v_debit,'total_credit',v_credit);
end;
$$;

revoke all on function public.finance_create_voucher_draft(jsonb,jsonb) from public, anon;
grant execute on function public.finance_create_voucher_draft(jsonb,jsonb) to authenticated;
