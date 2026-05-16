CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Üretim',
  sub_role TEXT,
  department TEXT,
  language TEXT NOT NULL DEFAULT 'tr',
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('customer','supplier')),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT,
  address TEXT,
  tax_office TEXT,
  tax_no TEXT,
  phone TEXT,
  contact_person TEXT,
  price_list TEXT,
  discount_rate NUMERIC(8,3) NOT NULL DEFAULT 0,
  special_terms TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT NOT NULL UNIQUE,
  customer_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  customer_name TEXT,
  dealer_name TEXT,
  order_date DATE NOT NULL DEFAULT current_date,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'siparis-alindi',
  products JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  delivery_address TEXT,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  stage_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  factory_completed_at TIMESTAMPTZ,
  warehouse_accepted_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  sales_posted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_account ON orders(customer_account_id);

CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'adet',
  critical_level NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE(material_id, name)
);

CREATE TABLE IF NOT EXISTS consumption_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_family TEXT,
  product_type TEXT NOT NULL,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES material_variants(id) ON DELETE SET NULL,
  qty_per_unit NUMERIC(14,3) NOT NULL CHECK (qty_per_unit >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES material_variants(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out','adjustment')),
  qty NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,2),
  reference_type TEXT,
  reference_id UUID,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON stock_movements(variant_id);

CREATE TABLE IF NOT EXISTS production_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('accept','complete','warehouse_accept','ship','reopen')),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  employee_id UUID,
  points NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_events_order ON production_events(order_id);

CREATE TABLE IF NOT EXISTS account_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  vat_rate NUMERIC(8,3) NOT NULL DEFAULT 0,
  document_no TEXT,
  document_date DATE NOT NULL DEFAULT current_date,
  due_date DATE,
  description TEXT,
  related_type TEXT,
  related_id UUID,
  reversed_by UUID REFERENCES account_transactions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_transactions_account ON account_transactions(account_id);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow TEXT NOT NULL CHECK (flow IN ('in','out','transfer')),
  channel TEXT NOT NULL DEFAULT 'cash',
  target_channel TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  document_no TEXT,
  document_date DATE NOT NULL DEFAULT current_date,
  description TEXT,
  account_transaction_id UUID REFERENCES account_transactions(id) ON DELETE SET NULL,
  related_type TEXT,
  related_id UUID,
  reversed_by UUID REFERENCES cash_transactions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_date ON cash_transactions(document_date);

CREATE TABLE IF NOT EXISTS allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_transaction_id UUID NOT NULL REFERENCES account_transactions(id) ON DELETE CASCADE,
  target_transaction_id UUID NOT NULL REFERENCES account_transactions(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  vat_rate NUMERIC(8,3) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','unpaid')),
  cash_transaction_id UUID REFERENCES cash_transactions(id) ON DELETE SET NULL,
  document_no TEXT,
  document_date DATE NOT NULL DEFAULT current_date,
  description TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  role TEXT,
  salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  weekly_target NUMERIC(14,2) NOT NULL DEFAULT 4500,
  monthly_target NUMERIC(14,2) NOT NULL DEFAULT 18000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  check_in_at TIMESTAMPTZ NOT NULL,
  check_out_at TIMESTAMPTZ,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_leave_minutes INTEGER NOT NULL DEFAULT 0,
  penalty_points NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS employee_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('earning','payment','advance','penalty','reversal')),
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  document_no TEXT,
  document_date DATE NOT NULL DEFAULT current_date,
  description TEXT,
  cash_transaction_id UUID REFERENCES cash_transactions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  related_type TEXT,
  related_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_data JSONB,
  after_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

INSERT INTO app_settings(key, value) VALUES
  ('production_targets', '{"weeklyTarget":4500,"monthlyTarget":18000}'::jsonb),
  ('attendance_rules', '{"workStart":"08:00","workEnd":"18:00","lateToleranceMinutes":15,"earlyLeaveToleranceMinutes":10,"penaltyPointsPerMinute":2,"gateQr":"ROOMS-ATTENDANCE-GATE"}'::jsonb),
  ('payroll_rules', '{"performanceTolerancePercent":95,"lossMultiplier":2,"autoApplyPenalty":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
