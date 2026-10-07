export type AccountCategory = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export type AccountNature = 'DEBIT' | 'CREDIT';

export interface Account {
  code: string; // e.g. '1110', '1200', '4100'
  name_ar: string;
  name_en: string;
  type: AccountCategory;
  nature: AccountNature;
  subtype?: string;
  reporting_group?: import("../domain/accountClassification").ReportingGroup;
  cash_flow_category?: import("../domain/accountClassification").CashFlowCategory;
  normal_balance?: AccountNature;
  parent_code?: string;
  is_system: boolean;
  is_active: boolean;
  balance_sdg: number;
  balance_usd: number;
  org_id: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface JournalEntryLine {
  id?: string;
  account_code: string;
  account_name: string;
  debit_sdg: number;
  credit_sdg: number;
  debit_usd: number;
  credit_usd: number;
  notes?: string;
  description?: string;
}

export interface JournalEntry {
  id: string;
  entry_number: string; // e.g. JV-2026-0001
  date: string;
  reference_type: 'invoice' | 'payment' | 'expense' | 'manual' | 'void' | 'opening_balance' | 'inventory' | 'purchase_bill' | 'supplier_payment' | 'internal_transfer' | 'credit_note' | 'customer_refund' | 'purchase_return' | 'supplier_refund';
  reference_id: string;
  description: string;
  lines: JournalEntryLine[];
  total_debit_sdg: number;
  total_credit_sdg: number;
  total_debit_usd: number;
  total_credit_usd: number;
  is_balanced: boolean;
  exchange_rate_used: number;
  org_id: string;
  created_by?: string;
  created_at: string;
}

export interface TrialBalanceItem {
  account_code: string;
  account_name: string;
  type: AccountCategory;
  nature: AccountNature;
  opening_balance_sdg: number;
  total_debit_sdg: number;
  total_credit_sdg: number;
  net_balance_sdg: number;
  opening_balance_usd: number;
  total_debit_usd: number;
  total_credit_usd: number;
  net_balance_usd: number;
}

export interface IncomeStatementSummary {
  costs_complete?: boolean;
  sales_revenue_sdg: number;
  sales_revenue_usd: number;
  cogs_sdg: number;
  cogs_usd: number;
  gross_profit_sdg: number;
  gross_profit_usd: number;
  total_operating_expenses_sdg: number;
  total_operating_expenses_usd: number;
  net_operating_profit_sdg: number;
  net_operating_profit_usd: number;
  fx_gain_loss_sdg: number;
  fx_gain_loss_usd: number;
  net_profit_sdg: number;
  net_profit_usd: number;
}

export interface BalanceSheetItem {
  code: string;
  name: string;
  amount_sdg: number;
  amount_usd: number;
  account_code?: string;
  account_name?: string;
  balance_sdg?: number;
  balance_usd?: number;
}

export interface BalanceSheetSummary {
  assets: BalanceSheetItem[];
  total_assets_sdg: number;
  total_assets_usd: number;

  liabilities: BalanceSheetItem[];
  total_liabilities_sdg: number;
  total_liabilities_usd: number;

  equity_items: BalanceSheetItem[];
  equity: BalanceSheetItem[];
  current_period_profit_sdg: number;
  current_period_profit_usd: number;
  total_equity_sdg: number;
  total_equity_usd: number;

  total_liabilities_and_equity_sdg: number;
  total_liabilities_and_equity_usd: number;
  is_balanced: boolean;
  variance_sdg: number;
  variance_usd?: number;
  difference_sdg?: number;
}

export interface CashFlowActivityItem {
  title: string;
  amount_sdg: number;
  amount_usd: number;
}

export interface CashFlowSummary {
  operating_activities: CashFlowActivityItem[];
  net_cash_operating_sdg: number;
  net_cash_operating_usd: number;
  net_operating_sdg: number;
  net_operating_usd: number;
  operating_inflows_sdg: number;
  operating_outflows_sdg: number;

  investing_activities: CashFlowActivityItem[];
  net_cash_investing_sdg: number;
  net_cash_investing_usd: number;
  net_investing_sdg: number;
  net_investing_usd: number;

  financing_activities: CashFlowActivityItem[];
  net_cash_financing_sdg: number;
  net_cash_financing_usd: number;
  net_financing_sdg: number;
  net_financing_usd: number;

  net_change_in_cash_sdg: number;
  net_change_in_cash_usd: number;

  beginning_cash_sdg: number;
  beginning_cash_usd: number;
  ending_cash_sdg: number;
  ending_cash_usd: number;
}


