import { equityCollections, verifyEquitySources, equityBackupCounts, validateEquityBackup, remapEquityEvents } from './ownerEquitySources';
import { fxRevaluationCollections, verifyFxRevaluationSources, fxRevaluationBackupCounts, validateFxRevaluationBackup, remapFxRevaluations } from './fxRevaluationSources';
import { fxRevaluationTransaction } from './fxRevaluationTransactions';
import { fxQuoteHash } from './fxRevaluationTransactions';
import { fxRevaluationEvidence } from './fxRevaluationSources';
import type { FxRevaluationInput, FxRevaluationSnapshot } from './fxRevaluation';
import { ownerEquityTransaction } from './ownerEquityTransactions';
import { fixedAssetTransaction } from './fixedAssetTransactions';
import { quoteFixedAsset, type FixedAssetPreviewRequest } from './fixedAssetPreview';
import { fixedAssetCollections, fixedAssetBackupCounts, remapFixedAssets, validateFixedAssetBackup, verifyFixedAssetSources } from './fixedAssetSources';
import { remapTaxConfigurations, taxConfigurationBackupCounts, taxConfigurationCollections, taxConfigurationCommand, validateTaxConfigurationBackup, validateTaxConfigurationVersions, verifyTaxConfigurationSources } from './taxConfigurationTransactions';
import { salesTaxSourceQuote } from './salesTaxSources';
import { taxPeriodReport } from './taxReports';
import type { TaxConfiguration } from './taxConfiguration';
import { periodCollections, assertPeriodPosting, assertRecentOwner, validatePeriods, verifyClosedPeriodHashes } from './periodContracts';
import { periodCommand, closeChecklist } from './accountingPeriods';
import { readOpeningPreview } from './openingPreview';
import { openingActions, validateOpeningRequest, openingTransaction, readOpeningFinancialData, assertOpeningFinancialData } from './openingTransactions';
import type { OpeningInput } from './openingBalances';
import type { OpeningTerms } from './openingSources';
import { verifyOpeningSources } from './openingSources';
import { openingCollections } from './openingCollections';
import { hasOpeningSources, openingBackupCounts, remapOpeningCollections, validateOpeningBackup } from './openingIntegration';
import { restoreAuditArchives, verifyAuditArchives } from './auditArchives';
import { correctionDocumentKind, readCorrectionDocument } from './correctionDocuments';
import type { Customer, Product, Account, Invoice, JournalEntry, MerchantSettings, Organization, OrgRole, OrgSubscription, Payment } from '../types';
import BigNumber from 'bignumber.js';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../types';
import { INITIAL_SETTINGS } from '../data/initialData';
import { createDefaultSubscription, subscriptionLimits } from '../lib/plans';
import { loadSubscription, assertSubscriptionActive, assertFeature, invoiceQuotaReached } from './subscriptions';
import { safeAdd, safeSub } from '../lib/currency';
import { getDefaultChartOfAccounts, generateExpenseJournalEntry, calculateTrialBalance, calculateIncomeStatement, calculateBalanceSheet, calculateCashFlowStatement, getAccountCodeForPaymentMethod } from '../services/accountingService';
import { hasPermission, type ActionType } from '../services/rbacService';
import { BusinessError, assertOpenPeriod, dateOnly, ensure, identifier, money, text, validateJournal, validateSettings } from './validation';
import { invoiceFinancials, journal, journalLine, paymentQuote, receiptJournal, receivableCurrency, reverseJournal } from './financial';
import { clean, type Change, type Document, type Store, type Transaction } from './store';
import { acquisitionCost, allocateCost, costFields, costState, issueCost, receiveCost, validateCostState, hasIncompleteInvoiceCosts } from './inventoryCost';
import { payableCommand, payableCollections, readPayableReport } from './payables';
import { cashReconciliationCollections, cashReconciliationCommand, cashReconciliationReports, verifyCashSessionHashes } from './cashReconciliation';
import { cashCollections, cashCommand } from './cashManagement';
import { purchaseCorrectionCollections, purchaseCorrectionCommand } from './purchaseCorrections';
import { salesCorrectionCollections, salesCorrectionCommand, loadSalesSource, salesInvoiceCaches, saveSalesCustomer } from './salesCorrections';
import { classifyAccount } from './accountClassification';
import { merchantDay, operationalPermissions, readOperationalReport, type LedgerQuery, type ReportPeriod, type OperationalReportTypes } from './operationalReports';
import { financialCollections, reconcileFinancialData, type FinancialData } from './reconciliation';
import { buildAccountingHealth } from './accountingHealth';
import { buildAccountingAssistance } from './accountingAssistance';
import { buildOwnerFinancialSummary } from './ownerFinancialSummary';
import { buildAccountingExport } from './accountingExport';
import { branchProfitAndLoss, createDimension, dimensionCollection, dimensionField, dimensionKind, dimensionTags, updateDimension, type ManagementDimension } from './managementDimensions';
import { customerProfitability, productProfitability } from './managementProfitability';
import { budgetVsActual, saveBudget, type BudgetPlan } from './managementBudgets';
import { cashForecast } from './managementCashForecast';
import { saveRecurringCashSource, saveScheduledCashSource } from './managementCashSources';
import { authorizeCreditDecision, customerCreditDecision } from './customerCredit';
import { approvalGate, saveApprovalPolicy } from './approvalPolicies';
import { buildMasterExport, masterExportModule, masterExportPermission } from './masterExport';
import { assertMasterImportPayload, buildMasterImportPreview, masterImportModule, masterImportPermission } from './masterImport';
import { cancelLargeExportJob, requestLargeExportJob, retryLargeExportJob } from './largeExportJobs';

export interface Actor { uid: string; email: string; emailVerified: boolean; name?: string; superAdmin?: boolean; authTime?: number; }
export interface Command { action: string; operationId: string; data: Document; }
export interface OperationResult { result: Document; changes: Change[]; }
const actions: Record<string, ActionType> = {
  'approvalPolicy.create':'approvals:manage','approvalPolicy.update':'approvals:manage',
  'budget.create':'budget:manage','budget.update':'budget:manage',
  'recurringCashSource.create':'budget:manage','recurringCashSource.update':'budget:manage','scheduledCashSource.create':'budget:manage','scheduledCashSource.update':'budget:manage',
  'dimension.create':'dimensions:manage','dimension.update':'dimensions:manage',
  'taxConfiguration.create':'tax:manage','taxConfiguration.update':'tax:manage',
  'fixedAsset.register':'journal:create','fixedAsset.depreciate':'periods:adjust',
  'fxRevaluation.create':'periods:adjust',
  'ownerEquity.create':'equity:write',
  'opening.commit':'opening:write', 'openingSettlement.create':'opening:settle',
  'period.create':'periods:manage', 'period.softClose':'periods:manage', 'period.close':'periods:manage', 'period.reopen':'periods:reopen',
  'purchaseReturn.create': 'payables:write', 'supplierRefund.create': 'payables:write', 'creditNote.create': 'journal:create', 'customerRefund.create': 'journal:create',
  'bankReconciliation.create': 'journal:create', 'cashCount.create': 'journal:create',
  'financialAccount.create': 'accounts:create', 'financialAccount.update': 'accounts:update', 'cashTransfer.create': 'journal:create',
  'correctionDocument.export': 'backup:export', 'operational.export': 'backup:export', 'payables.export': 'backup:export', 'supplier.create': 'payables:write', 'supplier.update': 'payables:write', 'purchase.create': 'payables:write', 'supplierPayment.create': 'payables:write',
  'masterExport.create': 'org:read', 'accountingExport.create': 'export:accounting', 'companyExport.record':'export:company',
  'exportPreset.save':'export:accounting', 'exportPreset.delete':'export:accounting',
  'largeExport.request':'export:accounting', 'largeExport.cancel':'export:accounting', 'largeExport.retry':'export:accounting',
  'masterImport.stage': 'org:read',
  'customer.create': 'customers:create', 'customer.update': 'customers:update', 'customer.delete': 'customers:delete',
  'product.create': 'products:create', 'product.update': 'products:update', 'product.delete': 'products:delete', 'product.stock': 'products:stock_adjustment',
  'accounting.activate': 'org:update_settings', 'product.cost.establish': 'products:stock_adjustment', 'inventory.receive': 'products:stock_adjustment',
  'invoice.create': 'invoices:create', 'invoice.update': 'invoices:update', 'invoice.void': 'invoices:void',
  'payment.create': 'payments:create', 'expense.create': 'expenses:create', 'expense.void': 'expenses:delete',
  'journal.create': 'journal:create', 'account.create': 'accounts:create', 'account.update': 'accounts:update', 'account.reset': 'accounts:update',
  'settings.update': 'org:update_settings', 'subscription.request': 'org:update_settings',
  'member.update': 'members:update_role', 'member.remove': 'members:remove',
  'invitation.create': 'members:invite', 'invitation.revoke': 'members:invite', 'backup.restore': 'backup:restore',
};
export const readPermissions: Record<string, ActionType> = { branches:'dimensions:read',cost_centers:'dimensions:read',projects:'dimensions:read',tax_configurations:'tax:read',tax_configuration_versions:'tax:read',fixed_assets:'journal:read',fixed_asset_depreciations:'journal:read',fx_revaluations:'journal:read', owner_equity_events:'journal:read', ...Object.fromEntries(openingCollections.map(name=>[name,'journal:read' as const])), accounting_periods:'periods:read', audit_archives: 'audit_logs:view', purchase_returns: 'payables:read', supplier_refunds: 'payables:read', credit_notes: 'journal:read', customer_refunds: 'journal:read', bank_reconciliations: 'journal:read', cash_reconciliations: 'journal:read', financial_accounts: 'journal:read', internal_transfers: 'journal:read', suppliers: 'payables:read', purchase_bills: 'payables:read', supplier_payments: 'payables:read', customers: 'customers:read', products: 'products:read', invoices: 'invoices:read', payments: 'payments:read', expenses: 'expenses:read', inventory_movements: 'products:stock_adjustment', accounts: 'accounts:read', journal_entries: 'journal:read', members: 'members:view', audit_logs: 'audit_logs:view', invitations: 'members:invite' };
readPermissions.export_presets = 'export:accounting';
readPermissions.accounting_export_jobs = 'export:accounting';
readPermissions.company_export_jobs = 'export:company';
readPermissions.approval_policies = 'approvals:read';
readPermissions.budgets = 'budget:read';
readPermissions.recurring_cash_sources = 'budget:read';
readPermissions.scheduled_cash_sources = 'budget:read';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function membership(tx: Transaction, orgId: string, actor: Actor, allowInactive = false) {
  ensure(actor.emailVerified === true, 'أكّد بريدك الإلكتروني قبل الوصول إلى بيانات المؤسسة.', 403);
  const org = await tx.get(`organizations/${identifier(orgId)}`) as Organization | undefined;
  ensure(org && (allowInactive || org.status === 'active'), 'المؤسسة غير متاحة أو معلقة.', 403);
  const member = await tx.get(`organizations/${orgId}/members/${identifier(actor.uid)}`);
  const role: OrgRole = org.owner_uid === actor.uid ? 'Owner' : member?.role;
  ensure(org.owner_uid === actor.uid || member?.status === 'active', 'لا توجد عضوية نشطة في هذه المؤسسة.', 403);
  ensure(org.owner_uid === actor.uid || member?.role !== 'Owner', 'صفة المالك تتحدد من مالك المؤسسة الفعلي.', 403);
  ensure(hasPermission(role, 'org:read'), 'صلاحية المؤسسة غير متاحة.', 403);
  return { org, role, member };
}
const pick = (value: Document, keys: string[]): Document => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
function monthKey(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}
export class Operations {
  constructor(public store: Store, private now: () => Date = () => new Date(), private subscriptionPolicy: (saved: Document | undefined, orgId: string) => OrgSubscription = (_saved, orgId) => createDefaultSubscription(orgId), private verifyCostingSecurity?: () => Promise<void>) {}
  async openingPreview(orgId:string,actor:Actor,request:{input:OpeningInput;terms:OpeningTerms[]}) {
    ensure(request && typeof request==='object' && !Array.isArray(request) && Object.keys(request).every(key=>['input','terms'].includes(key)),'حقول طلب معاينة الأرصدة غير صالحة أو محمية.');
    ensure(request.input && typeof request.input==='object' && !Array.isArray(request.input) && Array.isArray(request.terms) && request.terms.length<=97,'بيانات الأرصدة والاستحقاقات مطلوبة للمعاينة.');
    return this.store.transaction(async tx=>{
      const {org,role}=await membership(tx,orgId,actor);ensure(hasPermission(role,'opening:preview'),'معاينة الأرصدة متاحة للمالك والمحاسب فقط.',403);
      const now=this.now(),subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');
      ensure(org.accounting_version===2,'معاينة الأرصدة تتطلب محاسبة V2.',409);
      if(request.input?.currency_policy==='dual')assertFeature(subscription,'multi_currency');
      if(request.input?.inventory?.length)assertFeature(subscription,'inventory_tracking');
      if(this.store.authority==='browser')throw new BusinessError('معاينة الأرصدة المحمية تتطلب خدمة الخادم.',403,'accounting_server_required');
      if(this.store.authority==='server'){
        if(!this.verifyCostingSecurity)throw new BusinessError('تعذر تأكيد قواعد حماية V2 المنشورة.',503,'accounting_rules_not_verified');
        await this.verifyCostingSecurity();
      }
      return readOpeningPreview(tx,`organizations/${orgId}`,orgId,org.accounting_version,role,org.settings,now,request);
    });
  }
  async fxRevaluationPreview(orgId:string,actor:Actor,input:FxRevaluationInput) {
    return this.store.transaction(async tx=>{
      const {org,role}=await membership(tx,orgId,actor);ensure(['Owner','Accountant'].includes(role),'معاينة إعادة التقييم متاحة للمالك والمحاسب فقط.',403);
      const now=this.now(),subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');assertFeature(subscription,'multi_currency');
      ensure(org.accounting_version===2,'إعادة التقييم تتطلب محاسبة V2.',409);
      if(this.store.authority==='browser')throw new BusinessError('معاينة إعادة التقييم المحمية تتطلب خدمة الخادم.',403,'accounting_server_required');
      if(this.store.authority==='server'){if(!this.verifyCostingSecurity)throw new BusinessError('تعذر تأكيد قواعد حماية V2 المنشورة.',503,'accounting_rules_not_verified');await this.verifyCostingSecurity();}
      const data=await readOpeningFinancialData(tx,`organizations/${orgId}`,orgId);await assertOpeningFinancialData(data,org.settings);verifyFxRevaluationSources(data,orgId);
      const evidence=fxRevaluationEvidence(input,{...data,org_id:orgId,accounts:data.accounts as Account[],journal_entries:data.journal_entries as JournalEntry[],settings:org.settings} as unknown as FxRevaluationSnapshot,{operation_id:'preview',created_by:actor.uid,created_at:now.toISOString(),sequence:data.fx_revaluations.length+1});
      return{organizationId:orgId,quote:evidence.event.quote,quote_hash:await fxQuoteHash(evidence.event.quote)};
    });
  }
  async fixedAssetPreview(orgId: string, actor: Actor, request: FixedAssetPreviewRequest) {
    return this.store.transaction(async tx => {
      const {org, role} = await membership(tx, orgId, actor);
      ensure(['Owner', 'Accountant'].includes(role), 'معاينة الأصول متاحة للمالك والمحاسب فقط.', 403);
      ensure(request && ['fixedAsset.register', 'fixedAsset.depreciate'].includes(request.action), 'عملية معاينة الأصل غير صالحة.');
      ensure(hasPermission(role, actions[request.action]), 'صلاحية معاينة الأصل غير متاحة.', 403);
      const now = this.now(), subscription = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
      assertSubscriptionActive(subscription); assertFeature(subscription, 'accounting');
      ensure(org.accounting_version === 2, 'الأصول الثابتة تتطلب محاسبة V2.', 409);
      if (this.store.authority === 'browser') throw new BusinessError('معاينة الأصول المحمية تتطلب خدمة الخادم.', 403, 'accounting_server_required');
      if (this.store.authority === 'server') {
        if (!this.verifyCostingSecurity) throw new BusinessError('تعذر تأكيد قواعد حماية V2 المنشورة.', 503, 'accounting_rules_not_verified');
        await this.verifyCostingSecurity();
      }
      const data = await readOpeningFinancialData(tx, `organizations/${orgId}`, orgId);
      await assertOpeningFinancialData(data, org.settings); verifyFixedAssetSources(data, orgId);
      if (request.action === 'fixedAsset.depreciate') {
        const periods = validatePeriods(data.accounting_periods, orgId), date = dateOnly(request.input?.date);
        ensure(periods.length > 0 && date === request.input.date && date <= merchantDay(now, org.settings.timezone || 'Africa/Khartoum'), 'تاريخ الإهلاك غير صالح أو مستقبلي؛ أنشئ فترة تغطيه.', 409);
        assertOpenPeriod(date, org.settings); assertPeriodPosting(periods, date, role, false, request.input.reason);
      }
      return quoteFixedAsset(request, data, orgId);
    });
  }
  async advancedReports(orgId: string, actor: Actor, period: { start?: string; end?: string } = {}, comparison?: { start?: string; end?: string }) {
    return this.store.transaction(async tx => {
      const { org, role } = await membership(tx, orgId, actor);
      ensure(hasPermission(role, 'reports:advanced'), 'التقارير المتقدمة غير مسموحة لهذا الدور.', 403);
      const subscription = await loadSubscription(tx, orgId, org, this.now(), this.subscriptionPolicy);
      assertSubscriptionActive(subscription); assertFeature(subscription, 'accounting'); assertFeature(subscription, 'advanced_reports');
      const accounts = await tx.list(`organizations/${orgId}/accounts`) as Account[], entries = await tx.list(`organizations/${orgId}/journal_entries`) as JournalEntry[];
      const invoices = await tx.list(`organizations/${orgId}/invoices`) as Invoice[], products = await tx.list(`organizations/${orgId}/products`) as Product[];
      const reports=(range:{start?:string;end?:string})=>({trialBalance:calculateTrialBalance(accounts,entries,range),incomeStatement:{...calculateIncomeStatement(entries,accounts,range),costs_complete:!hasIncompleteInvoiceCosts(invoices,products,entries,range)},balanceSheet:calculateBalanceSheet(accounts,entries,range),cashFlow:calculateCashFlowStatement(accounts,entries,range)});
      const current=reports(period);return {organizationId:orgId,generatedAt:this.now().toISOString(),period,...current,...(comparison?{comparison:{period:comparison,...reports(comparison)}}:{})};
    });
  }
  async accountingHealth(orgId:string,actor:Actor,asOfInput?:string){
    return this.store.transaction(async tx=>{const {org,role}=await membership(tx,orgId,actor);ensure(hasPermission(role,'reports:advanced')&&hasPermission(role,'journal:read'),'ليس لديك صلاحية مركز صحة المحاسبة.',403);const now=this.now(),subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');assertFeature(subscription,'advanced_reports');ensure(org.accounting_version===2,'مركز صحة المحاسبة يتطلب محاسبة V2.',409);const asOf=asOfInput?dateOnly(asOfInput):merchantDay(now,org.settings.timezone||'Africa/Khartoum'),data=await readOpeningFinancialData(tx,`organizations/${orgId}`,orgId);return{organizationId:orgId,generatedAt:now.toISOString(),...buildAccountingHealth(data,org.settings,asOf)};});
  }
  async accountingAssistance(orgId:string,actor:Actor,asOfInput?:string){
    return this.store.transaction(async tx=>{const {org,role}=await membership(tx,orgId,actor);ensure(hasPermission(role,'reports:advanced')&&hasPermission(role,'journal:read'),'ليس لديك صلاحية مساعد المحاسبة.',403);const now=this.now(),subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');assertFeature(subscription,'advanced_reports');ensure(org.accounting_version===2,'مساعد المحاسبة يتطلب محاسبة V2.',409);const asOf=asOfInput?dateOnly(asOfInput):merchantDay(now,org.settings.timezone||'Africa/Khartoum'),root=`organizations/${orgId}`,data=await readOpeningFinancialData(tx,root,orgId),period=(data.accounting_periods||[]).filter(row=>typeof row.end_date==='string'&&dateOnly(row.end_date)<asOf&&row.status!=='CLOSED').sort((a,b)=>String(b.end_date).localeCompare(String(a.end_date)))[0],checklist=period?await closeChecklist(tx,root,period,org.settings,now.toISOString()):undefined;return{organizationId:orgId,generatedAt:now.toISOString(),...buildAccountingAssistance(data,org.settings,asOf,checklist)};});
  }
  async ownerFinancialSummary(orgId:string,actor:Actor,asOfInput?:string){
    return this.store.transaction(async tx=>{const {org,role}=await membership(tx,orgId,actor);ensure(role==='Owner'&&org.owner_uid===actor.uid,'الملخص المالي مخصص لمالك المؤسسة الفعلي.',403);const now=this.now(),subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');assertFeature(subscription,'advanced_reports');ensure(org.accounting_version===2,'ملخص المالك يتطلب محاسبة V2.',409);const root=`organizations/${orgId}`,asOf=asOfInput?dateOnly(asOfInput):merchantDay(now,org.settings.timezone||'Africa/Khartoum'),data=await readOpeningFinancialData(tx,root,orgId),receivables=await readOperationalReport(tx,root,'receivables',{end:asOf},asOf),payables=await readPayableReport(tx,root,{end:asOf},asOf);return{organizationId:orgId,generatedAt:now.toISOString(),...buildOwnerFinancialSummary({orgId,asOf,accounts:data.accounts as Account[],journalEntries:data.journal_entries as JournalEntry[],receivables:receivables.aging,payables:payables.aging,recurringExpenses:await tx.list(`${root}/recurring_cash_sources`) as never,fixedAssets:data.fixed_assets||[]})};});
  }
  async branchProfitAndLoss(orgId:string,actor:Actor,branchId:string,period:{start?:string;end?:string}={}) {
    return this.store.transaction(async tx=>{const {org,role}=await membership(tx,orgId,actor);ensure(hasPermission(role,'reports:advanced')&&hasPermission(role,'dimensions:read'),'ليس لديك صلاحية تقرير الفرع.',403);const subscription=await loadSubscription(tx,orgId,org,this.now(),this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');assertFeature(subscription,'advanced_reports');assertFeature(subscription,'branches');ensure(org.accounting_version===2,'تقارير الفروع تتطلب محاسبة V2.',409);const branch=await tx.get(`organizations/${orgId}/branches/${identifier(branchId)}`) as ManagementDimension|undefined;ensure(branch&&branch.org_id===orgId,'الفرع غير موجود.',404);const accounts=await tx.list(`organizations/${orgId}/accounts`) as Account[],entries=await tx.list(`organizations/${orgId}/journal_entries`) as JournalEntry[];return{organizationId:orgId,generatedAt:this.now().toISOString(),...branchProfitAndLoss(accounts,entries,branch,period)};});
  }
  async productProfitability(orgId:string,actor:Actor,period:{start?:string;end?:string}={}) {
    return this.store.transaction(async tx=>{const {org,role}=await membership(tx,orgId,actor);ensure(hasPermission(role,'reports:advanced')&&hasPermission(role,'products:read'),'ليس لديك صلاحية تقرير ربحية المنتجات.',403);const subscription=await loadSubscription(tx,orgId,org,this.now(),this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');assertFeature(subscription,'advanced_reports');ensure(org.accounting_version===2,'ربحية المنتجات تتطلب محاسبة V2.',409);const root=`organizations/${orgId}`;return{organizationId:orgId,generatedAt:this.now().toISOString(),...productProfitability({orgId,period,products:await tx.list(`${root}/products`) as Product[],invoices:await tx.list(`${root}/invoices`) as Invoice[],creditNotes:await tx.list(`${root}/credit_notes`),entries:await tx.list(`${root}/journal_entries`) as JournalEntry[],inventoryMovements:await tx.list(`${root}/inventory_movements`)})};});
  }
  async customerProfitability(orgId:string,actor:Actor,period:{start?:string;end?:string}={}) {
    return this.store.transaction(async tx=>{const {org,role}=await membership(tx,orgId,actor);ensure(['reports:advanced','customers:read','invoices:read','payments:read'].every(permission=>hasPermission(role,permission as ActionType)),'ليس لديك صلاحية تقرير ربحية العملاء.',403);const now=this.now(),subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');assertFeature(subscription,'advanced_reports');ensure(org.accounting_version===2,'ربحية العملاء تتطلب محاسبة V2.',409);const root=`organizations/${orgId}`,receivables=await readOperationalReport(tx,root,'receivables',period.end?{end:period.end}:{},merchantDay(now,org.settings.timezone||'Africa/Khartoum'));return{organizationId:orgId,generatedAt:now.toISOString(),...customerProfitability({orgId,period,customers:await tx.list(`${root}/customers`) as Customer[],invoices:await tx.list(`${root}/invoices`) as Invoice[],payments:await tx.list(`${root}/payments`) as Payment[],creditNotes:await tx.list(`${root}/credit_notes`),entries:await tx.list(`${root}/journal_entries`) as JournalEntry[],outstanding:receivables.statements})};});
  }
  async payableReports(orgId: string, actor: Actor, period: { start?: string; end?: string } = {}) {
    return this.store.transaction(async tx => {
      const { org, role } = await membership(tx, orgId, actor);
      ensure(hasPermission(role, 'payables:read'), 'ليس لديك صلاحية ذمم الموردين.', 403);
      const subscription = await loadSubscription(tx, orgId, org, this.now(), this.subscriptionPolicy);
      assertSubscriptionActive(subscription); assertFeature(subscription, 'accounting');
      const root = `organizations/${orgId}`;
      return { organizationId: orgId, generatedAt: this.now().toISOString(), ...await readPayableReport(tx,root,period,this.now().toISOString()) };
    });
  }
  async taxReports(orgId: string, actor: Actor, period: { start?: string; end?: string } = {}) {
    return this.store.transaction(async tx => {
      const {org,role}=await membership(tx,orgId,actor);ensure(hasPermission(role,'tax:read'),'ليس لديك صلاحية تقارير الضرائب.',403);
      const now=this.now(),subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');
      ensure(org.accounting_version===2,'تقارير الضرائب تتطلب محاسبة V2.',409);
      const root=`organizations/${orgId}`,configurations=await tx.list(`${root}/tax_configurations`) as TaxConfiguration[],entries=await tx.list(`${root}/journal_entries`) as JournalEntry[];
      return {organizationId:orgId,generatedAt:now.toISOString(),...taxPeriodReport(configurations,entries,period)};
    });
  }
  async operationalReport<View extends keyof OperationalReportTypes>(orgId: string, actor: Actor, view: View, query: ReportPeriod & Partial<LedgerQuery> = {}): Promise<{ organizationId: string; generatedAt: string; view: View } & OperationalReportTypes[View]> {
    return this.store.transaction(async tx => {
      const { org, role } = await membership(tx, orgId, actor);
      ensure(operationalPermissions(view).every(permission => hasPermission(role, permission)), 'ليس لديك صلاحية هذا التقرير.', 403);
      const now = this.now(), subscription = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
      assertSubscriptionActive(subscription); assertFeature(subscription, 'accounting');
      const report = await readOperationalReport(tx, `organizations/${orgId}`, view, query, merchantDay(now, org.settings.timezone || 'Africa/Khartoum'));
      return { organizationId: orgId, generatedAt: now.toISOString(), view, ...report } as { organizationId: string; generatedAt: string; view: View } & OperationalReportTypes[View];
    });
  }
  async cashReconciliationReports(orgId: string, actor: Actor, asOf?: string) {
    return this.store.transaction(async tx => {
      const { org, role } = await membership(tx, orgId, actor); ensure(operationalPermissions('cash').every(permission=>hasPermission(role,permission)), 'ليس لديك صلاحية المطابقة.',403);
      const now=this.now(), subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');
      return {organizationId:orgId,generatedAt:now.toISOString(),...await cashReconciliationReports(tx,`organizations/