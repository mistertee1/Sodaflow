import type { Account, AccountCategory, AccountNature } from '../types';
import { ensure, text } from './validation';

export type ReportingGroup = 'cash_bank' | 'receivables' | 'inventory' | 'fixed_assets' | 'other_assets' | 'payables' | 'tax_payable' | 'other_liabilities' | 'capital' | 'drawings' | 'retained_earnings' | 'sales' | 'other_revenue' | 'fx_gain' | 'cogs' | 'operating_expense' | 'fx_loss';
export type CashFlowCategory = 'operating' | 'investing' | 'financing' | 'cash';
export interface AccountClassification { subtype: string; reporting_group: ReportingGroup; cash_flow_category: CashFlowCategory; normal_balance: AccountNature; }
const groups: Record<AccountCategory, ReportingGroup[]> = {
  ASSET: ['cash_bank', 'receivables', 'inventory', 'fixed_assets', 'other_assets'],
  LIABILITY: ['payables', 'tax_payable', 'other_liabilities'], EQUITY: ['capital', 'drawings', 'retained_earnings'],
  REVENUE: ['sales', 'other_revenue', 'fx_gain'], EXPENSE: ['cogs', 'operating_expense', 'fx_loss'],
};
const defaults: Record<AccountCategory, ReportingGroup> = { ASSET: 'other_assets', LIABILITY: 'other_liabilities', EQUITY: 'capital', REVENUE: 'sales', EXPENSE: 'operating_expense' };
const systemGroups: Record<string, ReportingGroup> = { '1110': 'cash_bank', '1120': 'cash_bank', '1130': 'cash_bank', '1140': 'cash_bank', '1150': 'cash_bank', '1200': 'receivables', '1300': 'inventory', '2110': 'payables', '2140': 'payables', '2120': 'other_liabilities', '2130': 'tax_payable', '3100': 'capital', '3200': 'drawings', '3300': 'retained_earnings', '4100': 'sales', '4200': 'fx_gain', '4300': 'other_revenue', '5100': 'cogs', '5500': 'fx_loss' };
Object.assign(systemGroups, { '4210': 'fx_gain', '5510': 'fx_loss' });
export const reportingGroupLabels: Record<ReportingGroup, string> = { cash_bank: 'نقدية وبنوك', receivables: 'ذمم العملاء', inventory: 'المخزون', fixed_assets: 'أصول ثابتة', other_assets: 'أصول أخرى', payables: 'ذمم دائنة', tax_payable: 'ضرائب مستحقة', other_liabilities: 'التزامات أخرى', capital: 'رأس المال', drawings: 'المسحوبات', retained_earnings: 'أرباح محتجزة', sales: 'إيرادات النشاط', other_revenue: 'إيرادات أخرى', fx_gain: 'أرباح الصرف', cogs: 'تكلفة البضاعة المباعة', operating_expense: 'مصروفات تشغيلية', fx_loss: 'خسائر الصرف' };
export const reportingGroupsFor = (type: AccountCategory) => groups[type] || [];
/** Explicit system-code mapping is a migration default; custom accounts use their declared type. */
export function classifyAccount(account: Pick<Account, 'code' | 'type' | 'nature'> & Partial<Account>): AccountClassification {
  ensure(groups[account.type]?.length, 'تصنيف الحساب غير صالح.');
  const mapped = systemGroups[account.code];
  const group = account.reporting_group || (mapped && groups[account.type].includes(mapped) ? mapped : defaults[account.type]);
  ensure(groups[account.type].includes(group), 'مجموعة التقرير لا تطابق نوع الحساب.');
  const flow: CashFlowCategory = account.cash_flow_category || (group === 'cash_bank' ? 'cash' : group === 'fixed_assets' ? 'investing' : account.type === 'EQUITY' ? 'financing' : 'operating');
  ensure(['operating', 'investing', 'financing', 'cash'].includes(flow) && (flow === 'cash') === (group === 'cash_bank'), 'تصنيف التدفق النقدي غير صالح.');
  const normal = account.normal_balance || account.nature;
  ensure(['DEBIT', 'CREDIT'].includes(normal) && normal === account.nature, 'طبيعة الحساب لا تطابق رصيده الطبيعي.');
  const subtype = account.subtype || group;
  text(subtype, 100, true);
  return { subtype, reporting_group: group, cash_flow_category: flow, normal_balance: normal };
}
