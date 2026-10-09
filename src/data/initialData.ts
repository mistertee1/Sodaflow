import { Customer, Product, Invoice, Expense, MerchantSettings } from '../types';

export const INITIAL_SETTINGS: MerchantSettings = {
  business_name: '',
  phone: '',
  address: '',
  logo_url: '',
  bank_details: '',
  default_exchange_rate: 0, // No hardcoded exchange rate; must be explicitly configured by organization
  manual_exchange_rate: 0, // سعر صرف يدوي اختياري يتم تحديده يدوياً من الإعدادات
  freeze_exchange_rate: true, // تفعيل خيار تجميد سعر الصرف للفواتير لحماية العمليات المحاسبية
  freeze_invoice_exchange_rate: true, // مرادف متوافق
  primary_currency: 'SDG',
  secondary_currency: 'USD',
  currencies_configured: false, // Organization must explicitly review and confirm currency configuration
  sdg_decimals: 0,
  usd_decimals: 2,
  rounding_rule: 'round',
  invoice_prefix: 'INV-2026-',
  default_invoice_notes: '',
};

export const INITIAL_CUSTOMERS: Customer[] = [];

export const INITIAL_PRODUCTS: Product[] = [];

export const INITIAL_INVOICES: Invoice[] = [];

export const INITIAL_EXPENSES: Expense[] = [];
