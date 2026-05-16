-- Purchase documents separate commercial document layer from stock movements.
CREATE TABLE IF NOT EXISTS purchase_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  document_no TEXT,
  document_date DATE NOT NULL DEFAULT current_date,
  due_date DATE,
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_rate NUMERIC(8,3) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid','unpaid','partial')),
  notes TEXT,
  account_transaction_id UUID REFERENCES account_transactions(id) ON DELETE SET NULL,
  payment_account_transaction_id UUID REFERENCES account_transactions(id) ON DELETE SET NULL,
  cash_transaction_id UUID REFERENCES cash_transactions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_supplier ON purchase_documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_date ON purchase_documents(document_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_document_id UUID NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES material_variants(id) ON DELETE SET NULL,
  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_rate NUMERIC(8,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_document ON purchase_items(purchase_document_id);

-- Make payroll periods idempotent and race-safe.
ALTER TABLE employee_transactions ADD COLUMN IF NOT EXISTS payroll_year INTEGER;
ALTER TABLE employee_transactions ADD COLUMN IF NOT EXISTS payroll_month INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_employee_payroll_period
  ON employee_transactions(employee_id, payroll_year, payroll_month)
  WHERE type='earning' AND payroll_year IS NOT NULL AND payroll_month IS NOT NULL;

-- Useful indexes for production/payroll/accounting summaries.
CREATE INDEX IF NOT EXISTS idx_production_events_employee_period ON production_events(employee_id, created_at) WHERE event_type='complete';
CREATE INDEX IF NOT EXISTS idx_attendance_employee_period ON attendance_logs(employee_id, check_in_at);
CREATE INDEX IF NOT EXISTS idx_employee_transactions_period ON employee_transactions(employee_id, document_date);
CREATE INDEX IF NOT EXISTS idx_account_transactions_type_date ON account_transactions(type, document_date) WHERE reversed_by IS NULL;

-- Strengthen default settings without overwriting user changes except when key is missing.
INSERT INTO app_settings(key, value) VALUES
  ('business_timezone', '"Europe/Istanbul"'::jsonb),
  ('payroll_rules', '{"performanceTolerancePercent":95,"lossMultiplier":2,"attendancePenaltyValuePerPoint":0.1,"autoApplyPenalty":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
