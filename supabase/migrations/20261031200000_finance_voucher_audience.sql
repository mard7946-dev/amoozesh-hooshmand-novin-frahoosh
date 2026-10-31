-- Add an explicit audience to financial vouchers without changing existing access policies.
ALTER TABLE public.finance_vouchers
  ADD COLUMN IF NOT EXISTS audience_type text NOT NULL DEFAULT 'general';

-- Existing vouchers linked to a student are treated as parent/student statements.
UPDATE public.finance_vouchers AS voucher
SET audience_type = 'parent'
WHERE EXISTS (
  SELECT 1
  FROM public.finance_voucher_lines AS line
  WHERE line.voucher_id = voucher.id
    AND line.student_id IS NOT NULL
)
AND voucher.audience_type = 'general';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_vouchers_audience_type_check'
      AND conrelid = 'public.finance_vouchers'::regclass
  ) THEN
    ALTER TABLE public.finance_vouchers
      ADD CONSTRAINT finance_vouchers_audience_type_check
      CHECK (audience_type IN ('parent', 'general'));
  END IF;
END
$$;

COMMENT ON COLUMN public.finance_vouchers.audience_type IS
  'Financial document audience: parent/student-specific or general school document.';
