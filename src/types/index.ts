export type Currency = 'SDG' | 'USD' | 'SAR' | 'AED' | 'EUR' | 'GBP' | 'EGP';

export type CurrencyMode = 'dual' | 'single_sdg' | 'single_usd';

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled' | 'void';

export type PaymentMethod = 'cash' | 'bankak' | 'fawry' | 'bank_transfer' | 'other';

export type MovementType =
  | 'SALE'
  | 'PURCHASE'
  | 'ADJUSTMENT'
  | 'VOID_REVERSAL'
  | 'OPENING_BALANCE'
  | 'RETURN';

// Multi-Tenant RBAC Roles
export type OrgRole = 'Owner' | 'Admin' | 'Accountant' | 'Sales' | 'Cashier' | 'Viewer';

export interface OrgMember {
  uid: string;
  org_id: string;
  email: string;
  display_name: string;
  role: OrgRole;
  joined_at: string;
  invited_by?: string;
  status: 'active' | 'suspended';
}

export interface OrgInvitation {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  created_at: string;
  expires_at: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export interface OrganizationCounters {
  revision?: number;
  invoice_month?: string;
  monthly_invoice_count?: number;
  invoice_count: number;
  customer_count: number;
  product_count: number;
  expense_count: number;
  payment_count: number;
  inventory_movement_count: number;
  last_invoice_number?: number;
  updated_at?: string;
}

export const DEFAULT_ORGANIZATION_COUNTERS: OrganizationCounters = {
  invoice_count: 0,
  customer_count: 0,
  product_count: 0,
  expense_count: 0,
  payment_count: 0,
  inventory_movement_count: 0,
  last_invoice_number: 0,
};

export interface Organization {
  id: string;
  name: string; // Legal / business name
  display_name: string;
  business_activity?: string;
  commercial_registration?: string;
  tax_number?: string;
  base_currency: Currency;
  secondary_currency: Currency;
  timezone: string;
  fiscal_year: string;
  status: 'active' | 'suspended' | 'archived';
  owner_uid: string;
  schema_version: number;
  settings: MerchantSettings;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  org_id: string;
  actor_uid: string;
  actor_email: string;
  action: string;
  entity_type: 'invoice' | 'payment' | 'expense' | 'product' | 'customer' | 'member' | 'settings' | 'migration' | 'backup' | 'account' | 'journal_entry';
  entity_id: string;
  details?: string;
  previous_state?: any;
  new_state?: any;
  created_at: string;
  operation_id?: string;
}

export type SubscriptionPlan = 'Free' | 'Starter' | 'Professional' | 'Business' | 'Enterprise';

export interface OrgSubscription {
  org_id: string;
  plan: SubscriptionPlan;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  max_invoices_per_month: number;
  max_members: number;
  max_customers?: number;
  max_products?: number;
  features: {
    advanced_reports: boolean;
    multi_currency: boolean;
    inventory_tracking: boolean;
    audit_trail: boolean;
    branches: boolean;
  };
  created_at?: string;
  updated_at?: string;
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  product_name: string;
  type: MovementType;
  quantity: number; // positive for addition, negative for deduction
  previous_stock: number;
  resulting_stock: number;
  reference_type: 'invoice' | 'audit_adjustment' | 'manual' | 'void';
  reference_id: string;
  reason?: string;
  created_at: string;
  created_by?: string;
  operation_id?: string;
  org_id?: string;
  branch_id?: string;
  schema_version?: number;
}

export interface IdempotencyRecord {
  id: string; // the operation_id or idempotency_key
  action: 'create_invoice' | 'record_payment' | 'add_expense' | 'void_invoice' | 'stock_adjustment' | 'member_action';
  resource_id: string;
  created_at: string;
  status: 'completed' | 'failed';
  result_summary?: string;
  org_id?: string;
}

export interface CounterRecord {
  last_invoice_number: number;
  updated_at: string;
  org_id?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  preferred_currency: Currency;
  balance_sdg: number;
  balance_usd: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  org_id?: string;
  branch_id?: string;
  created_by?: string;
  schema_version?: number;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  unit: string; // قطعة, كيلو, ساعة, متر, كرتونة, لتر, باقة, خدمة...
  price_sdg: number;
  price_usd: number;
  tax_rate: number; // percentage e.g. 0 or 15
  category?: string;
  is_active: boolean;
  stock_quantity?: number; // الكمية المتوفرة حالياً في المخزن
  min_stock_alert?: number; // حد التنبيه عند انخفاض المخزون
  track_inventory?: boolean; // تفعيل تتبع وجرد المخزون
  created_at: string;
  org_id?: string;
  branch_id?: string;
  created_by?: string;
  schema_version?: number;
}

export interface InvoiceItem {
  id: string;
  product_id?: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number; // in the item's currency or invoice currency
  currency: Currency;
  tax_rate: number;
  discount_percent: number;
  line_total: number;
}

export interface Invoice {
  receivable_currency?: 'SDG' | 'USD';
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  issue_date: string;
  due_date?: string;
  status: InvoiceStatus;
  currency_mode: CurrencyMode;
  exchange_rate_used: number; // سعر الصرف المجمّد وقت إصدار الفاتورة (جنيه لكل دولار)
  items: InvoiceItem[];
  subtotal_sdg: number;
  subtotal_usd: number;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  discount_total_sdg: number;
  discount_total_usd: number;
  tax_total_sdg: number;
  tax_total_usd: number;
  grand_total_sdg: number;
  grand_total_usd: number;
  paid_amount_sdg: number;
  paid_amount_usd: number;
  remaining_sdg: number;
  remaining_usd: number;
  notes?: string;
  payment_instructions?: string; // e.g. رقم حساب بنكك
  operation_id?: string;
  voided_at?: string;
  void_reason?: string;
  voided_by?: string;
  created_at: string;
  updated_at: string;
  org_id?: string;
  branch_id?: string;
  created_by?: string;
  schema_version?: number;
}

export interface Payment {
  settled_amount_sdg?: number;
  settled_amount_usd?: number;
  cash_amount_sdg?: number;
  cash_amount_usd?: number;
  id: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  amount: number;
  currency: Currency;
  exchange_rate_used: number;
  amount_in_other_currency: number;
  payment_method: PaymentMethod;
  reference_number?: string;
  payment_date: string;
  notes?: string;
  operation_id?: string;
  idempotency_key?: string;
  created_at: string;
  org_id?: string;
  branch_id?: string;
  created_by?: string;
  schema_version?: number;
}

export interface Expense {
  voided_at?: string;
  id: string;
  title: string;
  category: string; // إيجار, نقل وترحيل, بضاعة, رواتب ومكافآت, كهرباء وماء, صيانة, أخرى
  amount: number;
  currency: Currency;
  exchange_rate_used?: number;
  date: string;
  notes?: string;
  receipt_image?: string;
  created_at: string;
  org_id?: string;
  branch_id?: string;
  created_by?: string;
  schema_version?: number;
}

export interface MerchantSettings {
  business_name: string;
  phone: string;
  address?: string;
  logo_url?: string; // شعار أو لوقو المتجر (يظهر في الفواتير وسندات القبض)
  bank_details?: string; // مثلاً: حساب بنكك: 1234567 باسم أحمد محمد
  default_exchange_rate: number; // سعر الصرف المعتمد (0 إذا لم يتم تحديده بعد)
  primary_currency: Currency;
  secondary_currency: Currency;
  currencies_configured?: boolean; // يحدد ما إذا كانت المنشأة قد قامت بتهيئة عملاتها وتأكيدها صراحة
  sdg_decimals: number;
  usd_decimals: number;
  rounding_rule: 'round' | 'ceil' | 'floor';
  invoice_prefix: string;
  default_invoice_notes: string;
  commercial_registration?: string;
  tax_number?: string;
  business_activity?: string;
  timezone?: string;
  fiscal_year?: string;
  period_lock_date?: string; // YYYY-MM-DD: أي عملية مؤرخة في هذا التاريخ أو قبله تكون مقفلة محاسبياً
}

export * from './accounting';
