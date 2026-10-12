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
import type { Product, Account, Invoice, JournalEntry, MerchantSettings, Organization, OrgRole, OrgSubscription, Payment } from '../types';
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

export interface Actor { uid: string; email: string; emailVerified: boolean; name?: string; superAdmin?: boolean; authTime?: number; }
export interface Command { action: string; operationId: string; data: Document; }
export interface OperationResult { result: Document; changes: Change[]; }
const actions: Record<string, ActionType> = {
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
export const readPermissions: Record<string, ActionType> = { tax_configurations:'tax:read',tax_configuration_versions:'tax:read',fixed_assets:'journal:read',fixed_asset_depreciations:'journal:read',fx_revaluations:'journal:read', owner_equity_events:'journal:read', ...Object.fromEntries(openingCollections.map(name=>[name,'journal:read' as const])), accounting_periods:'periods:read', audit_archives: 'audit_logs:view', purchase_returns: 'payables:read', supplier_refunds: 'payables:read', credit_notes: 'journal:read', customer_refunds: 'journal:read', bank_reconciliations: 'journal:read', cash_reconciliations: 'journal:read', financial_accounts: 'journal:read', internal_transfers: 'journal:read', suppliers: 'payables:read', purchase_bills: 'payables:read', supplier_payments: 'payables:read', customers: 'customers:read', products: 'products:read', invoices: 'invoices:read', payments: 'payments:read', expenses: 'expenses:read', inventory_movements: 'products:stock_adjustment', accounts: 'accounts:read', journal_entries: 'journal:read', members: 'members:view', audit_logs: 'audit_logs:view', invitations: 'members:invite' };
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
  async advancedReports(orgId: string, actor: Actor, period: { start?: string; end?: string } = {}) {
    return this.store.transaction(async tx => {
      const { org, role } = await membership(tx, orgId, actor);
      ensure(hasPermission(role, 'reports:advanced'), 'التقارير المتقدمة غير مسموحة لهذا الدور.', 403);
      const subscription = await loadSubscription(tx, orgId, org, this.now(), this.subscriptionPolicy);
      assertSubscriptionActive(subscription); assertFeature(subscription, 'accounting'); assertFeature(subscription, 'advanced_reports');
      const accounts = await tx.list(`organizations/${orgId}/accounts`) as Account[], entries = await tx.list(`organizations/${orgId}/journal_entries`) as JournalEntry[];
      const invoices = await tx.list(`organizations/${orgId}/invoices`) as Invoice[], products = await tx.list(`organizations/${orgId}/products`) as Product[];
      return { organizationId: orgId, generatedAt: this.now().toISOString(), period, trialBalance: calculateTrialBalance(accounts, entries, period), incomeStatement: { ...calculateIncomeStatement(entries, accounts, period), costs_complete: !hasIncompleteInvoiceCosts(invoices, products, entries, period) }, balanceSheet: calculateBalanceSheet(accounts, entries, period), cashFlow: calculateCashFlowStatement(accounts, entries, period) };
    });
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
      return {organizationId:orgId,generatedAt:now.toISOString(),...await cashReconciliationReports(tx,`organizations/${orgId}`,asOf||merchantDay(now,org.settings.timezone||'Africa/Khartoum'))};
    });
  }
  async periodReports(orgId:string,actor:Actor,periodId?:string) {
    return this.store.transaction(async tx=>{
      const {org,role}=await membership(tx,orgId,actor);ensure(hasPermission(role,'periods:read'),'ليس لديك صلاحية الفترات.',403);
      const now=this.now(),subscription=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');
      const root=`organizations/${orgId}`,periods=validatePeriods(await tx.list(`${root}/accounting_periods`),orgId);
      await verifyClosedPeriodHashes(periods,await tx.list(`${root}/journal_entries`));
      const period=periodId?periods.find(row=>row.id===identifier(periodId)):undefined;ensure(!periodId||period,'الفترة غير موجودة.',404);
      const checklist=period?await closeChecklist(tx,root,period,org.settings,now.toISOString()):undefined;
      return {organizationId:orgId,generatedAt:now.toISOString(),periods,...(checklist?{checklist}:{})};
    });
  }
  async snapshot(orgId: string, actor: Actor, backup = false) {
    return this.store.transaction(async tx => {
      const { org, role, member } = await membership(tx, orgId, actor, true);
      ensure(!backup || hasPermission(role, 'backup:export'), 'تصدير النسخة الاحتياطية غير مسموح.', 403);
      const root = `organizations/${orgId}`;
      const subscription = await loadSubscription(tx, orgId, org, this.now(), this.subscriptionPolicy);
      if (backup) { ensure(org.status === 'active', 'المؤسسة متوقفة؛ التصدير المحمي غير متاح.', 403); assertSubscriptionActive(subscription); }
      const collections: Record<string, Document[]> = {};
      for (const [name, permission] of Object.entries(readPermissions)) {
        const feature = ['audit_logs','audit_archives'].includes(name) ? 'audit_trail' : name === 'inventory_movements' ? 'inventory_tracking' : ['accounts', 'journal_entries', ...fixedAssetCollections,...payableCollections, ...cashCollections, ...cashReconciliationCollections, ...salesCorrectionCollections, ...purchaseCorrectionCollections, ...periodCollections, ...openingCollections, ...equityCollections,...fxRevaluationCollections].includes(name) ? 'accounting' : null;
        const activeSubscription = ['active', 'trial'].includes(subscription.effective_status || subscription.status) && org.status === 'active';
        collections[name] = hasPermission(role, permission) && (backup || !feature || activeSubscription && subscription.features[feature] === true) ? await tx.list(`${root}/${name}`) : [];
      }
      if (backup) { await verifyTaxConfigurationSources(collections,orgId);verifyFixedAssetSources(collections,orgId);verifyFxRevaluationSources(collections,orgId);verifyEquitySources(collections,orgId); await verifyAuditArchives(collections.audit_archives); await verifyClosedPeriodHashes(collections.accounting_periods,collections.journal_entries,collections); if(hasOpeningSources(collections))verifyOpeningSources(collections,orgId); }
      const counters = { ...DEFAULT_ORGANIZATION_COUNTERS, ...await tx.get(`${root}/meta/counters`) };
      if (backup) { ensure((counters.audit_archive_count || 0) === collections.audit_archives.length, 'عدد أرشيف التدقيق لا يطابق السجل المحفوظ.', 409); counters.audit_event_count = collections.audit_logs.length; counters.accounting_period_count=collections.accounting_periods.length; Object.assign(counters,openingBackupCounts(collections),equityBackupCounts(collections),fxRevaluationBackupCounts(collections),fixedAssetBackupCounts(collections),taxConfigurationBackupCounts(collections)); }
      const currentMonth = monthKey(this.now(), org.settings.timezone || 'Africa/Khartoum');
      counters.invoice_month = currentMonth;
      counters.monthly_invoice_count = (collections.invoices || []).filter(i => Number.isFinite(new Date(i.created_at).getTime()) && monthKey(new Date(i.created_at), org.settings.timezone || 'Africa/Khartoum') === currentMonth).length;
      const usage = await tx.get(`${root}/meta/usage`);
      counters.lifetime_invoice_count = Math.max(usage?.lifetimeInvoiceCount || 0, counters.invoice_count || 0, collections.invoices.length);
      return { schema_version: 3, ...(backup ? { audit_schema_version: 1, tax_configuration_schema_version:1, period_schema_version: 1, opening_schema_version:1, owner_equity_schema_version:1,fx_revaluation_schema_version:1,fixed_asset_schema_version:1 } : {}), org, role, member, settings: { ...INITIAL_SETTINGS, ...org.settings }, collections, counters, subscription, exported_at: this.now().toISOString() };
    });
  }
  async execute(orgId: string, actor: Actor, command: Command): Promise<OperationResult> {
    identifier(orgId); identifier(actor.uid); identifier(command.operationId); ensure(command.operationId.length <= 64, 'معرّف العملية طويل جداً.');
    ensure(command.data && typeof command.data === 'object' && !Array.isArray(command.data), 'بيانات العملية غير صالحة.');
    const now = this.now(), iso = now.toISOString(), root = `organizations/${orgId}`;
    const serialized = canonical({ action: command.action, data: command.data });
    ensure(serialized.length <= 750000, 'حجم العملية كبير جداً.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const fingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    return this.store.transaction(async tx => {
      const { org, role } = await membership(tx, orgId, actor, command.action === 'subscription.request');
      ensure(actions[command.action] && hasPermission(role, actions[command.action]), 'ليس لديك صلاحية هذه العملية.', 403);
      if (command.action === 'operational.export') {
        ensure(operationalPermissions(command.data.view).every(permission => hasPermission(role, permission)), 'ليس لديك صلاحية هذا التقرير.', 403);
        const entitlement = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
        assertSubscriptionActive(entitlement); assertFeature(entitlement, 'accounting');
      }
      if (command.action === 'correctionDocument.export') {
        const kind = correctionDocumentKind(command.data.kind);
        ensure(hasPermission(role, kind === 'credit_note' || kind === 'customer_refund' ? 'journal:read' : 'payables:read'), 'ليس لديك صلاحية مستند التصحيح.', 403);
        const entitlement = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
        assertSubscriptionActive(entitlement); assertFeature(entitlement, 'accounting');
        ensure(org.accounting_version === 2, 'مستند التصحيح يتطلب محاسبة V2.', 409);
      }
      let securityChecked = false;
      const requireCostAuthority = async () => {
        if (this.store.authority === 'browser') throw new BusinessError('هذه العملية المالية تتطلب خدمة الخادم.', 403, 'accounting_server_required');
        if (this.store.authority === 'server' && !securityChecked) {
          if (!this.verifyCostingSecurity) throw new BusinessError('تعذر تأكيد قواعد حماية V2 المنشورة.', 503, 'accounting_rules_not_verified');
          await this.verifyCostingSecurity(); securityChecked = true;
        }
      };
      if (org.accounting_version === 2 || ['taxConfiguration.create','taxConfiguration.update','fixedAsset.register','fixedAsset.depreciate','fxRevaluation.create','ownerEquity.create', ...openingActions, 'accounting.activate', 'product.cost.establish', 'inventory.receive', 'purchase.create', 'supplierPayment.create', 'cashTransfer.create', 'bankReconciliation.create', 'cashCount.create', 'creditNote.create', 'customerRefund.create', 'purchaseReturn.create', 'supplierRefund.create'].includes(command.action)) await requireCostAuthority();
      if (['bankReconciliation.create', 'cashCount.create'].includes(command.action)) {
        const entitlement = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
        assertSubscriptionActive(entitlement); assertFeature(entitlement, 'accounting');
        ensure(org.accounting_version === 2, 'المطابقة والجرد يتطلبان محاسبة V2.', 409);
        const account = await tx.get(`${root}/financial_accounts/${identifier(command.data.financial_account_id)}`);
        if (account?.currency === 'USD') assertFeature(entitlement, 'multi_currency');
      }
      if (['creditNote.create', 'customerRefund.create'].includes(command.action)) {
        const entitlement = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
        assertSubscriptionActive(entitlement); assertFeature(entitlement, 'accounting');
        assertOpenPeriod(command.data.date, org.settings);
        ensure(org.accounting_version === 2, 'التصحيحات والردود تتطلب محاسبة V2.', 409);
        const invoice = await tx.get(`${root}/invoices/${identifier(command.data.invoice_id)}`);
        if (invoice && (invoice.currency_mode !== 'single_sdg' || invoice.grand_total_usd > 0)) assertFeature(entitlement, 'multi_currency');
        if (command.data.kind === 'sales_return') assertFeature(entitlement, 'inventory_tracking');
        if (command.action === 'customerRefund.create') {
          const account = await tx.get(`${root}/financial_accounts/${identifier(command.data.financial_account_id)}`);
          if (account?.currency === 'USD') assertFeature(entitlement, 'multi_currency');
        }
      }
      if (['purchaseReturn.create','supplierRefund.create','supplierPayment.create'].includes(command.action)) {
        const entitlement = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy); assertSubscriptionActive(entitlement); assertFeature(entitlement,'accounting'); assertOpenPeriod(command.action==='supplierPayment.create'?command.data.payment_date:command.data.date,org.settings);
        ensure(org.accounting_version===2,'تصحيحات المورد تتطلب محاسبة V2.',409); if(command.action==='purchaseReturn.create') assertFeature(entitlement,'inventory_tracking');
        const bill=await tx.get(`${root}/purchase_bills/${identifier(command.data.bill_id)}`); if(bill?.currency==='USD'||command.data.currency==='USD') assertFeature(entitlement,'multi_currency');
        if(command.action==='supplierRefund.create') {const account=await tx.get(`${root}/financial_accounts/${identifier(command.data.financial_account_id)}`); if(account?.currency==='USD') assertFeature(entitlement,'multi_currency');}
      }
      const periods=validatePeriods(await tx.list(`${root}/accounting_periods`),orgId);
      const adjusting=command.action==='fxRevaluation.create'||command.action==='journal.create' && command.data.reference_type==='manual' && command.data.adjusting===true;
      const guardPeriod=(value:unknown)=>{ assertOpenPeriod(value,org.settings); assertPeriodPosting(periods,value,role,adjusting,command.data.reason); };
      if(command.action.startsWith('period.') || periods.length) await requireCostAuthority();
      if(command.action.startsWith('period.')) {
        const entitlement=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(entitlement);assertFeature(entitlement,'accounting');ensure(org.accounting_version===2,'الفترات تتطلب محاسبة V2.',409);
        text(command.data.reason,1000,true);if(command.action==='period.reopen')assertRecentOwner(role,actor.authTime,now);
      }
      const dates:unknown[]=[];
      if(['invoice.create','purchase.create'].includes(command.action))dates.push(command.data.issue_date);
      if(['creditNote.create','customerRefund.create','purchaseReturn.create','supplierRefund.create','cashTransfer.create','expense.create','journal.create'].includes(command.action))dates.push(command.data.date);
      if(command.action==='supplierPayment.create')dates.push(command.data.payment_date);
      if(['product.stock','product.cost.establish','inventory.receive','payment.create'].includes(command.action) || command.action==='product.create' && command.data.track_inventory)dates.push(iso);
      if(['invoice.update','invoice.void','expense.void'].includes(command.action)) {
        const source=await tx.get(`${root}/${command.action==='expense.void'?'expenses':'invoices'}/${identifier(command.data.id)}`);
        if(source)dates.push(command.action==='expense.void'?source.date:source.issue_date);
        if(command.action!=='invoice.update')dates.push(iso);
      }
      if(dates.length) { const entitlement=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(entitlement);for(const date of dates)guardPeriod(date); }
      if(command.action==='settings.update' && org.settings.period_lock_date && Object.prototype.hasOwnProperty.call(command.data.updates||{},'period_lock_date') && (command.data.updates.period_lock_date||'')<org.settings.period_lock_date) {assertRecentOwner(role,actor.authTime,now);text(command.data.reason,1000,true);}
      const isOpening=openingActions.some(action=>action===command.action);
      if(isOpening) {
        const date=validateOpeningRequest(command.action,command.data),entitlement=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);
        assertSubscriptionActive(entitlement);assertFeature(entitlement,'accounting');ensure(org.accounting_version===2,'الأرصدة والتسويات تتطلب محاسبة V2.',409);
        ensure(periods.length>0,'أنشئ فترة محاسبية مفتوحة تغطي تاريخ الأرصدة أولاً.',409);
        ensure(dateOnly(date)===date && date<=merchantDay(now,org.settings.timezone||'Africa/Khartoum'),'حدد تاريخاً صحيحاً لا يقع في المستقبل.',409);guardPeriod(date);
        if(command.action==='opening.commit') {
          assertRecentOwner(role,actor.authTime,now,'اعتماد الأرصدة الافتتاحية');
          if(command.data.input.currency_policy==='dual')assertFeature(entitlement,'multi_currency');
          if(command.data.input.inventory?.length)assertFeature(entitlement,'inventory_tracking');
        } else {
          const lot=await tx.get(`${root}/opening_lots/${command.data.lot_id}`);ensure(lot && lot.org_id===orgId,'مصدر الرصيد غير موجود.',404);
          const batch=await tx.get(`${root}/opening_batches/${identifier(lot.batch_id)}`);ensure(batch && batch.org_id===orgId,'دفعة الرصيد غير موجودة.',409);
          if(batch.input?.currency_policy==='dual' || command.data.currency==='USD')assertFeature(entitlement,'multi_currency');
          const financial=await tx.get(`${root}/financial_accounts/${command.data.financial_account_id}`);ensure(financial && financial.org_id===orgId && financial.status==='active','حساب التسوية غير متاح.',409);
        }
      }
      const isEquity=command.action==='ownerEquity.create';
      if(isEquity) {
        assertRecentOwner(role,actor.authTime,now,'حركة رأس المال والمسحوبات');
        ensure(org.accounting_version===2,'حركات المالك تتطلب محاسبة V2.',409);
        const entitlement=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(entitlement);assertFeature(entitlement,'accounting');
        if(command.data.currency_policy==='dual')assertFeature(entitlement,'multi_currency');
        ensure(periods.length>0,'أنشئ فترة محاسبية أولاً.',409);const date=dateOnly(command.data.date);ensure(date===command.data.date&&date<=merchantDay(now,org.settings.timezone||'Africa/Khartoum'),'تاريخ حركة المالك غير صالح أو مستقبلي.',409);guardPeriod(date);
        const cash=await tx.get(`${root}/financial_accounts/${identifier(command.data.financial_account_id)}`);ensure(cash&&cash.org_id===orgId&&cash.status==='active','حساب حركة المالك غير متاح.',409);
      }
      const isFx=command.action==='fxRevaluation.create';
      if(isFx){ensure(org.accounting_version===2,'إعادة تقييم العملة تتطلب محاسبة V2.',409);const entitlement=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(entitlement);assertFeature(entitlement,'accounting');assertFeature(entitlement,'multi_currency');ensure(['Owner','Accountant'].includes(role),'ترحيل إعادة التقييم متاح للمالك والمحاسب فقط.',403);ensure(periods.length>0,'أنشئ فترة محاسبية أولاً.',409);const date=dateOnly(command.data.date);ensure(date===command.data.date&&date<=merchantDay(now,org.settings.timezone||'Africa/Khartoum'),'تاريخ إعادة التقييم غير صالح أو مستقبلي.',409);guardPeriod(date);}
      const isFixed=command.action==='fixedAsset.register'||command.action==='fixedAsset.depreciate';
      if(isFixed){ensure(org.accounting_version===2,'الأصول الثابتة تتطلب محاسبة V2.',409);const entitlement=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(entitlement);assertFeature(entitlement,'accounting');ensure(['Owner','Accountant'].includes(role),'إدارة الأصول متاحة للمالك والمحاسب فقط.',403);if(command.action==='fixedAsset.depreciate'){ensure(periods.length>0,'أنشئ فترة محاسبية أولاً.',409);const date=dateOnly(command.data.date);ensure(date===command.data.date&&date<=merchantDay(now,org.settings.timezone||'Africa/Khartoum'),'تاريخ الإهلاك غير صالح أو مستقبلي.',409);guardPeriod(date);}}
      const isTaxConfiguration=command.action==='taxConfiguration.create'||command.action==='taxConfiguration.update';
      if(isTaxConfiguration){ensure(org.accounting_version===2,'إعدادات الضرائب تتطلب محاسبة V2.',409);ensure(role==='Owner','إعدادات الضرائب متاحة للمالك فقط.',403);assertRecentOwner(role,actor.authTime,now,'تعديل إعدادات الضرائب');text(command.data.reason,1000,true);const entitlement=await loadSubscription(tx,orgId,org,now,this.subscriptionPolicy);assertSubscriptionActive(entitlement);assertFeature(entitlement,'accounting');}
      const operationPath = `${root}/idempotency/${command.operationId}`;
      const previous = await tx.get(operationPath);
      if (previous) {
        ensure(previous.actor_uid === actor.uid && previous.fingerprint === fingerprint, 'معرّف العملية مستخدم لطلب مختلف.', 409);
        if(command.action.startsWith('period.')) {const current=periods.find(row=>row.id===command.data.id);ensure(current && current.revision===previous.response.result.revision && current.status===previous.response.result.status,'الفترة تغيرت بعد العملية المحفوظة؛ حدث الحالة.',409);}
        if(isTaxConfiguration) {const current=await tx.get(`${root}/tax_configurations/${identifier(command.data.id)}`),saved=previous.response?.result;ensure(current && saved && current.revision===saved.revision && current.operation_id===command.operationId,'إعداد الضريبة تغير بعد العملية المحفوظة؛ حدّث البيانات بدلاً من إعادة نتيجة قديمة.',409);const version=await tx.get(`${root}/tax_configuration_versions/${saved.id}-r${saved.revision}`);ensure(version && version.operation_id===command.operationId,'دليل إصدار العملية المحفوظة لم يعد مطابقاً.',409);}
        if(isOpening || isEquity || isFx || isFixed) {
          const current=await tx.get(`${root}/meta/counters`),saved=previous.response?.changes?.find((row:Change)=>row.path===`${root}/meta/counters`)?.value;
          ensure(saved && current?.revision===saved.revision,'حالة المؤسسة تغيرت بعد العملية المحفوظة؛ حدّث البيانات بدلاً من إعادة نتائج قديمة.',409);
          const sources=await readOpeningFinancialData(tx,root,orgId);await assertOpeningFinancialData(sources,org.settings);
          const source=(isFixed?(command.action==='fixedAsset.register'?sources.fixed_assets:sources.fixed_asset_depreciations):isFx?sources.fx_revaluations:isEquity?sources.owner_equity_events:command.action==='opening.commit'?sources.opening_batches:sources.opening_settlements).find(row=>row.id===previous.response.result.id);
          ensure(source && source.operation_id===command.operationId && source.created_by===actor.uid,'مصدر العملية المحفوظة لم يعد مطابقاً.',409);
          const cashIds=isFx||isFixed?[]:isEquity?[source.input.financial_account_id]:command.action==='opening.commit'?source.quote.sources.filter((row:Document)=>row.kind==='cash').map((row:Document)=>row.source_id):[source.input.financial_account_id];
          for(const id of cashIds) {const cash=sources.financial_accounts.find(row=>row.id===id);ensure(cash && cash.status==='active' && (await tx.get(`${root}/financial_account_mappings/${identifier(cash.account_code)}`))?.id===id,'ربط نقدية العملية المحفوظة تغير؛ حدّث الحالة.',409);}

        }
        return previous.response as OperationResult;
      }
      const changes: Change[] = [];
      const ratePath = `${root}/rate_limits/${actor.uid}`, rate = await tx.get(ratePath), minute = iso.slice(0, 16);
      ensure(rate?.minute !== minute || rate.count < 120, 'طلبات كثيرة. حاول بعد دقيقة.', 429);
      tx.set(ratePath, { minute, count: rate?.minute === minute ? rate.count + 1 : 1 });
      const set = (path: string, value: Document) => { const data = clean(value); tx.set(path, data); changes.push({ path, value: data }); };
      const remove = (path: string) => { tx.delete(path); changes.push({ path, value: null }); };
      const data = command.data;
      const settings = { ...INITIAL_SETTINGS, ...org.settings };
      const storedCounters = await tx.get(`${root}/meta/counters`);
      const counters: Document = { ...DEFAULT_ORGANIZATION_COUNTERS, ...storedCounters };
      const subscription = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
      const plan = subscriptionLimits(subscription);
      if (command.action === 'subscription.request') ensure(role === 'Owner', 'طلب تغيير الباقة متاح لمالك الشركة فقط.', 403);
      if (command.action !== 'subscription.request') assertSubscriptionActive(subscription);
      if (['product.stock', 'product.cost.establish', 'inventory.receive'].includes(command.action) || command.action === 'product.create' && data.track_inventory) assertFeature(subscription, 'inventory_tracking');
      if (command.action.startsWith('financialAccount.') || ['cashTransfer.create','bankReconciliation.create','cashCount.create'].includes(command.action)) assertFeature(subscription, 'accounting');
      if (command.action === 'financialAccount.create' && data.currency === 'USD') assertFeature(subscription, 'multi_currency');
      if (['cashTransfer.create','bankReconciliation.create','cashCount.create'].includes(command.action)) ensure(org.accounting_version === 2, 'التحويل المالي يتطلب محاسبة V2.', 409);
      if (command.action.startsWith('account.') || command.action === 'journal.create' || command.action === 'fxRevaluation.create' || command.action === 'accounting.activate') assertFeature(subscription, 'accounting');
      if (command.action === 'operational.export' || command.action === 'payables.export' || command.action.startsWith('supplier.') || ['purchase.create', 'supplierPayment.create'].includes(command.action)) assertFeature(subscription, 'accounting');
      if (command.action === 'supplierPayment.create') ensure(org.accounting_version === 2, 'سداد الموردين يتطلب محاسبة V2.', 409);
      if (command.action === 'purchase.create') { assertFeature(subscription, 'inventory_tracking'); ensure(org.accounting_version === 2, 'فعّل أساس تكلفة V2 قبل فواتير الموردين.', 409); }
      if (['purchase.create', 'supplierPayment.create'].includes(command.action) && command.data.currency === 'USD') assertFeature(subscription, 'multi_currency');
      if (command.action === 'invoice.create' && data.currency_mode !== 'single_sdg') assertFeature(subscription, 'multi_currency');
      const counterAdd = (key: string, delta: number) => { counters[key] = Math.max(0, (counters[key] || 0) + delta); };
      const beforeValues = new Map<string, Document>([[root, org]]);
      const required = async (collection: string, id: string) => {
        const record = await tx.get(`${root}/${collection}/${identifier(id)}`);
        ensure(record, 'السجل المطلوب غير موجود.', 404); beforeValues.set(`${root}/${collection}/${id}`, record); return record;
      };
      const post = async (entry: JournalEntry) => {
        guardPeriod(entry.date);
        validateJournal(entry.lines, settings);
        for (const line of entry.lines) {
          const account = await tx.get(`${root}/accounts/${identifier(line.account_code)}`);
          const system = getDefaultChartOfAccounts(orgId).find(a => a.code === line.account_code);
          ensure(account?.is_active || (!account && system), 'حساب القيد غير موجود أو غير نشط.');
          if (!account && system) set(`${root}/accounts/${system.code}`, system);
        }
        ensure(!await tx.get(`${root}/journal_entries/${entry.id}`), 'القيد موجود مسبقاً.', 409);
        set(`${root}/journal_entries/${entry.id}`, entry);
      };
      const inventoryPosting = async (id: string, reference: string, description: string, delta: { sdg: number; usd: number }, creditCode: string, rate = 0) => {
        if (!delta.sdg && !delta.usd) return undefined;
        const positive = delta.sdg >= 0 && delta.usd >= 0;
        ensure(positive || delta.sdg <= 0 && delta.usd <= 0, 'فروق قيمة المخزون يجب أن تحمل نفس اتجاه الحركة في العملتين.');
        const lines = positive ? [journalLine('1300', 'المخزون', delta.sdg, 0, delta.usd, 0), journalLine(creditCode, 'مقابل حركة المخزون', 0, delta.sdg, 0, delta.usd)] : [journalLine(creditCode, 'مقابل حركة المخزون', -delta.sdg, 0, -delta.usd, 0), journalLine('1300', 'المخزون', 0, -delta.sdg, 0, -delta.usd)];
        const entry = journal(id, orgId, actor.uid, iso, 'inventory', reference, description, lines, rate); await post(entry); return entry.id;
      };
      const inventoryControl = async () => {
        const products = await tx.list(`${root}/products`), entries = await tx.list(`${root}/journal_entries`), accounts = await tx.list(`${root}/accounts`);
        const codes = new Set(['1300', ...accounts.filter(a => classifyAccount(a as Account).reporting_group === 'inventory').map(a => a.code)]);
        for (const currency of ['sdg', 'usd'] as const) {
          const valuation = products.filter(p => p.track_inventory && p.cost_status === 'valued').reduce((sum, p) => sum.plus(validateCostState(p as Product)[`inventory_value_${currency}`]), new BigNumber(0));
          const balance = entries.flatMap(e => e.lines || []).filter(l => codes.has(l.account_code)).reduce((sum, l) => sum.plus(l[`debit_${currency}`]).minus(l[`credit_${currency}`]), new BigNumber(0));
          ensure(balance.eq(valuation), 'قيمة المخزون لا تطابق دفتر الأستاذ؛ راجع الأرصدة قبل إثبات التكلفة أو تفعيل V2.', 409);
        }
      };
      const costEvidence = pick(data, ['cost_currency', 'unit_cost', 'unit_cost_sdg', 'unit_cost_usd', 'exchange_rate_used', 'zero_cost_reason']);
      const stamp = { org_id: orgId, created_by: actor.uid, schema_version: 3, created_at: iso };
      let result: Document = {};
      let openingProof: Document | undefined;
      switch (command.action) {
        case 'taxConfiguration.create': case 'taxConfiguration.update': {
          const proposed=await taxConfigurationCommand(command.action,data,{tx,root,orgId,actor:actor.uid,operationId:command.operationId,iso});
          if(proposed.before)beforeValues.set(`${root}/tax_configurations/${proposed.result.id}`,proposed.before);
          for(const change of proposed.changes)set(change.path,change.value);
          counters.tax_configuration_count=(await tx.list(`${root}/tax_configurations`)).filter(row=>row.id!==proposed.result.id).length+1;
          counters.tax_configuration_version_count=(await tx.list(`${root}/tax_configuration_versions`)).filter(row=>row.id!==`${proposed.result.id}-r${proposed.result.revision}`).length+1;
          result=proposed.result;break;
        }
        case 'fixedAsset.register': case 'fixedAsset.depreciate': {
          const proposed=await fixedAssetTransaction(command.action,data,{tx,root,orgId,settings,actor:actor.uid,operationId:command.operationId,now});
          for(const change of proposed.changes) change.path.includes('/journal_entries/')?await post(change.value as JournalEntry):set(change.path,change.value!);
          counters.fixed_asset_count=command.action==='fixedAsset.register'?(await tx.list(`${root}/fixed_assets`)).filter(row=>row.id!==proposed.result.id).length+1:(await tx.list(`${root}/fixed_assets`)).length;
          counters.fixed_asset_depreciation_count=command.action==='fixedAsset.depreciate'?(await tx.list(`${root}/fixed_asset_depreciations`)).filter(row=>row.id!==proposed.result.id).length+1:(await tx.list(`${root}/fixed_asset_depreciations`)).length;
          result=proposed.result;break;
        }
        case 'fxRevaluation.create': {
          const proposed=await fxRevaluationTransaction(data,{tx,root,orgId,settings,actor:actor.uid,operationId:command.operationId,now});set(`${root}/fx_revaluations/${proposed.event.id}`,proposed.event);await post(proposed.entry);counters.fx_revaluation_count=(await tx.list(`${root}/fx_revaluations`)).filter(row=>row.id!==proposed.event.id).length+1;result=proposed.event;break;
        }
        case 'ownerEquity.create': {
          const proposed=await ownerEquityTransaction(data,{tx,root,orgId,settings,actor:actor.uid,operationId:command.operationId,now});
          beforeValues.set(`${root}/financial_accounts/${proposed.cash.id}`,proposed.cash);
          set(`${root}/owner_equity_events/${proposed.event.id}`,proposed.event);await post(proposed.entry);
          set(`${root}/financial_accounts/${proposed.cash.id}`,proposed.updated);
          counters.owner_equity_event_count=(await tx.list(`${root}/owner_equity_events`)).filter(row=>row.id!==proposed.event.id).length+1;
          result=proposed.event;break;
        }

        case 'opening.commit': case 'openingSettlement.create': {
          const proposed=await openingTransaction(command.action,data,{tx,root,orgId,version:org.accounting_version!,role,settings:org.settings,now,actor:actor.uid,operationId:command.operationId});
          for(const [path,value] of proposed.before)beforeValues.set(path,value);
          for(const change of proposed.changes) {
            if(change.path.includes('/journal_entries/'))await post(change.value as JournalEntry);
            else set(change.path,change.value!);
          }
          Object.assign(counters,proposed.counters);result=proposed.result;openingProof=proposed.proof;break;
        }

        case 'period.create': case 'period.softClose': case 'period.close': case 'period.reopen': {
          result=await periodCommand(command.action,data,{tx,root,orgId,actor:actor.uid,role,iso,operationId:command.operationId,settings,set,required});break;
        }
        case 'correctionDocument.export': {
          result = await readCorrectionDocument(tx, root, data, settings, iso);
          ensure(new TextEncoder().encode(JSON.stringify(result)).length <= 650000, 'المستند أكبر من حد التصدير؛ يلزم تصدير مضبوط.', 413);
          break;
        }

        case 'purchaseReturn.create': case 'supplierRefund.create': {
          result = await purchaseCorrectionCommand(command.action,data,{tx,root,orgId,actor:actor.uid,iso,operationId:command.operationId,settings,set,required,post,counterAdd}); break;
        }
        case 'creditNote.create': case 'customerRefund.create': {
          result = await salesCorrectionCommand(command.action, data, { tx, root, orgId, actor: actor.uid, iso, operationId: command.operationId, settings, set, required, post, counterAdd }); break;
        }
        case 'bankReconciliation.create': case 'cashCount.create': {
          const source = await required('financial_accounts', data.financial_account_id); if (source.currency === 'USD') assertFeature(subscription, 'multi_currency');
          result = await cashReconciliationCommand(command.action, data, { tx, root, orgId, actor: actor.uid, iso, operationId: command.operationId, settings, set, required, post, counterAdd }); break;
        }
        case 'financialAccount.create': case 'financialAccount.update': case 'cashTransfer.create': {
          if (command.action === 'cashTransfer.create') { const source = await required('financial_accounts', data.from_id); if (source.currency === 'USD') assertFeature(subscription, 'multi_currency'); }
          result = await cashCommand(command.action, data, { tx, root, orgId, actor: actor.uid, iso, operationId: command.operationId, settings, set, required, post, counterAdd }); break;
        }
        case 'operational.export': {
          const report = await readOperationalReport(tx, root, data.view, data.query || {}, merchantDay(now, settings.timezone || 'Africa/Khartoum'));
          result = { organizationId: orgId, generatedAt: iso, view: data.view, ...report };
          ensure(new TextEncoder().encode(JSON.stringify(result)).length <= 650000, 'حجم التصدير كبير؛ اختر فترة أقصر أو حساباً محدداً.', 413);
          break;
        }
        case 'payables.export': {
          result = { organizationId: orgId, generatedAt: iso, ...await readPayableReport(tx,root,data.period||{},iso) }; break;
        }
        case 'supplier.create': case 'supplier.update': case 'purchase.create': case 'supplierPayment.create': {
          result = await payableCommand(command.action, data, { tx, root, orgId, actor: actor.uid, iso, operationId: command.operationId, settings, set, required, post, counterAdd }); break;
        }
        case 'customer.create': case 'customer.update': {
          const updating = command.action.endsWith('update');
          const id = updating ? identifier(data.id) : `cus-${command.operationId}`;
          const old = updating ? await required('customers', id) : {};
          ensure(updating || !await tx.get(`${root}/customers/${id}`), 'معرّف العميل موجود مسبقاً.', 409);
          const input = updating ? data.updates : data;
          ensure(input && typeof input === 'object', 'بيانات العميل غير صالحة.');
          ensure(!['balance_sdg', 'balance_usd'].some(k => input[k] !== undefined && input[k] !== (old[k] || 0)), 'أرصدة العملاء تتغير بالسندات والقيود فقط.');
          if (!updating) { const count = (await tx.list(`${root}/customers`)).length; ensure(count < plan.max_customers, 'تم بلوغ حد العملاء في الباقة.'); counters.customer_count = count; counterAdd('customer_count', 1); }
          result = { ...old, ...pick(input, ['name', 'phone', 'email', 'address', 'preferred_currency', 'notes']), ...(!updating ? stamp : {}), id, balance_sdg: old.balance_sdg || 0, balance_usd: old.balance_usd || 0, updated_at: iso };
          result.phone ??= ''; result.preferred_currency ??= 'SDG';
          text(result.name, 200, true); text(result.phone ?? '', 100);
          ensure(['SDG', 'USD'].includes(result.preferred_currency || 'SDG'), 'عملة العميل غير مدعومة.');
          set(`${root}/customers/${id}`, result); break;
        }
        case 'customer.delete': {
          const customer = await required('customers', data.id);
          ensure(!(await tx.list(`${root}/opening_lots`)).some(row=>row.kind==='receivable' && row.party_id===data.id) && !(await tx.list(`${root}/opening_batches`)).some(row=>row.quote?.sources?.some((source:Document)=>source.kind==='receivable' && source.source_id===data.id)),'العميل مرتبط بمصدر افتتاحي؛ احتفظ بالسجل بعد التسوية.',409);
          ensure(!(customer.balance_sdg || customer.balance_usd) && !(await tx.list(`${root}/invoices`)).some(i => i.customer_id === data.id), 'العميل مرتبط بعمليات مالية. احتفظ بسجله.');
          remove(`${root}/customers/${data.id}`); counterAdd('customer_count', -1); break;
        }
        case 'product.create': case 'product.update': {
          const updating = command.action.endsWith('update'), id = updating ? identifier(data.id) : `prd-${command.operationId}`;
          const old = updating ? await required('products', id) : {};
          ensure(updating || !await tx.get(`${root}/products/${id}`), 'معرّف المنتج موجود مسبقاً.', 409);
          const input = updating ? data.updates : data;
          ensure(input && typeof input === 'object', 'بيانات المنتج غير صالحة.');
          ensure(!costFields.some(k => input[k] !== undefined), 'حقول التكلفة تتغير بعملية تكلفة موثقة فقط.');
          if (input.stock_quantity !== undefined) money(input.stock_quantity, 6);
          ensure(!updating || input.stock_quantity === undefined || input.stock_quantity === old.stock_quantity, 'تعديل الكمية يتطلب عملية تسوية مخزون.');
          ensure(!updating || input.track_inventory === undefined || input.track_inventory === old.track_inventory, 'غيّر تتبع المخزون عبر إنشاء منتج مستقل للحفاظ على الجرد.');
          if (!updating) { const count = (await tx.list(`${root}/products`)).length; ensure(count < plan.max_products, 'تم بلوغ حد المنتجات في الباقة.'); counters.product_count = count; counterAdd('product_count', 1); }
          result = { ...old, ...pick(input, ['name', 'description', 'unit', 'price_sdg', 'price_usd', 'tax_rate', 'category', 'is_active', 'min_stock_alert', 'track_inventory']), ...(!updating ? { ...stamp, stock_quantity: input.stock_quantity || 0 } : {}), id };
          text(result.name, 200, true); text(result.unit || '', 50, true);
          money(result.price_sdg, 0); money(result.price_usd, 2); money(result.tax_rate ?? 0, 4); ensure((result.tax_rate || 0) <= 100, 'نسبة الضريبة غير صالحة.');
          money(result.stock_quantity ?? 0, 6); money(result.min_stock_alert ?? 0, 6);
          ensure(typeof result.is_active === 'boolean' && (result.track_inventory === undefined || typeof result.track_inventory === 'boolean'), 'حالة المنتج غير صالحة.');
          let openingValue: Document = {};
          if (!updating && result.track_inventory && org.accounting_version === 2) {
            const quantity = result.stock_quantity;
            const delta = quantity ? acquisitionCost(quantity, input) : { sdg: 0, usd: 0 };
            Object.assign(result, costState(quantity, delta.sdg, delta.usd, iso));
            const journalId = await inventoryPosting(`jv-stock-${command.operationId}`, `mov-${command.operationId}`, 'رصيد مخزون افتتاحي موثق', delta, '3900');
            openingValue = { value_delta_sdg: delta.sdg, value_delta_usd: delta.usd, costing_version: 2, journal_id: journalId };
          }
          set(`${root}/products/${id}`, result);
          if (!updating && result.track_inventory) {
            const movement = { ...stamp, ...openingValue, ...costEvidence, id: `mov-${command.operationId}`, product_id: id, product_name: result.name, type: 'OPENING_BALANCE', quantity: result.stock_quantity, previous_stock: 0, resulting_stock: result.stock_quantity, reference_type: 'manual', reference_id: id, operation_id: command.operationId };
            set(`${root}/inventory_movements/${movement.id}`, movement); counterAdd('inventory_movement_count', 1);
          }
          break;
        }
        case 'product.delete': {
          const product = await required('products', data.id);
          ensure(!(await tx.list(`${root}/invoices`)).some(i => i.items.some((l: Document) => l.product_id === data.id)) && !(await tx.list(`${root}/inventory_movements`)).some(m => m.product_id === data.id), 'المنتج مرتبط بحركات. عطّله بدلاً من حذف سجل الجرد.');
          remove(`${root}/products/${product.id}`); counterAdd('product_count', -1); break;
        }
        case 'product.stock': {
          const product = await required('products', data.id); ensure(product.track_inventory, 'تتبع مخزون المنتج غير مفعّل.');
          money(data.newStock, 6); text(data.reason || '', 500, true);
          assertOpenPeriod(iso, settings);
          const movement = { ...stamp, id: `mov-${command.operationId}`, product_id: product.id, product_name: product.name, type: 'ADJUSTMENT', quantity: safeSub(data.newStock, product.stock_quantity || 0, 6), previous_stock: product.stock_quantity || 0, resulting_stock: data.newStock, reference_type: 'audit_adjustment', reference_id: product.id, reason: data.reason, operation_id: command.operationId };
          result = { ...product, stock_quantity: data.newStock };
          if (product.cost_status === 'valued' || org.accounting_version === 2) {
            await requireCostAuthority();
            const before = validateCostState(product as Product), quantity = new BigNumber(data.newStock).minus(before.stock_quantity).toNumber();
            let after;
            if (quantity > 0) { const delta = acquisitionCost(quantity, data); after = receiveCost(product as Product, quantity, delta, iso); }
            else if (quantity < 0) after = issueCost(product as Product, -quantity, iso).after;
            else after = before;
            Object.assign(result, after);
            const delta = { sdg: new BigNumber(after.inventory_value_sdg).minus(before.inventory_value_sdg).toNumber(), usd: new BigNumber(after.inventory_value_usd).minus(before.inventory_value_usd).toNumber() };
            Object.assign(movement, { value_delta_sdg: delta.sdg, value_delta_usd: delta.usd, costing_version: 2, journal_id: await inventoryPosting(`jv-stock-${command.operationId}`, movement.id, `تسوية المخزون: ${data.reason}`, delta, '5900') });
          }
          set(`${root}/products/${product.id}`, result); set(`${root}/inventory_movements/${movement.id}`, movement); counterAdd('inventory_movement_count', 1); break;
        }
        case 'product.cost.establish': {
          ensure(role === 'Owner', 'إثبات تكلفة تاريخية متاح للمالك فقط.', 403); assertOpenPeriod(iso, settings); text(data.reason, 500, true);
          const product = await required('products', data.id);
          ensure(product.track_inventory && product.cost_status !== 'valued', 'التكلفة مثبتة مسبقاً أو المنتج غير متتبع.', 409);
          await inventoryControl();
          const quantity = product.stock_quantity || 0, delta = quantity ? acquisitionCost(quantity, data) : { sdg: 0, usd: 0 }, movementId = `mov-${command.operationId}`;
          result = { ...product, ...costState(quantity, delta.sdg, delta.usd, iso) };
          const journalId = await inventoryPosting(`jv-cost-${command.operationId}`, movementId, `إثبات تكلفة افتتاحية: ${data.reason}`, delta, '3900');
          set(`${root}/products/${product.id}`, result);
          set(`${root}/inventory_movements/${movementId}`, { ...stamp, ...costEvidence, id: movementId, product_id: product.id, product_name: product.name, type: 'COST_ESTABLISHMENT', quantity: 0, previous_stock: quantity, resulting_stock: quantity, reference_type: 'manual', reference_id: product.id, value_delta_sdg: delta.sdg, value_delta_usd: delta.usd, costing_version: 2, journal_id: journalId, reason: data.reason, operation_id: command.operationId }); counterAdd('inventory_movement_count', 1); break;
        }
        case 'inventory.receive': {
          assertOpenPeriod(iso, settings); text(data.reason, 500, true);
          const product = await required('products', data.id); ensure(product.is_active, 'المنتج غير نشط.');
          const before = validateCostState(product as Product), delta = acquisitionCost(data.quantity, data), after = receiveCost(product as Product, data.quantity, delta, iso), movementId = `mov-${command.operationId}`;
          const method = data.payment_method || 'cash'; ensure(method !== 'custom' || data.payment_account_code, 'اختر حساب السداد المخصص.'); ensure(['cash', 'bankak', 'fawry', 'bank_transfer', 'other', 'custom'].includes(method), 'استلام المخزون في A2 يتطلب حساب سداد نقدي/بنكي؛ فاتورة المورد الآجلة ضمن المرحلة B.');
          const code = data.payment_account_code || getAccountCodeForPaymentMethod(method, data.cost_currency || 'SDG');
          const account = await tx.get(`${root}/accounts/${identifier(code)}`) || getDefaultChartOfAccounts(orgId).find(a => a.code === code);
          ensure(account?.is_active && classifyAccount(account as Account).reporting_group === 'cash_bank', 'حساب سداد المخزون يجب أن يكون نقدياً/بنكياً نشطاً.');
          const journalId = await inventoryPosting(`jv-receive-${command.operationId}`, movementId, `استلام مخزون: ${data.reason}`, delta, code, data.exchange_rate_used || 0);
          result = { ...product, ...after }; set(`${root}/products/${product.id}`, result);
          set(`${root}/inventory_movements/${movementId}`, { ...stamp, ...costEvidence, id: movementId, product_id: product.id, product_name: product.name, type: 'PURCHASE', quantity: data.quantity, previous_stock: before.stock_quantity, resulting_stock: after.stock_quantity, reference_type: 'manual', reference_id: product.id, value_delta_sdg: delta.sdg, value_delta_usd: delta.usd, costing_version: 2, journal_id: journalId, payment_account_code: code, reason: data.reason, operation_id: command.operationId }); counterAdd('inventory_movement_count', 1); break;
        }
        case 'accounting.activate': {
          ensure(role === 'Owner', 'تفعيل V2 متاح للمالك فقط.', 403); text(data.reason, 500, true);
          ensure(org.accounting_version !== 2, 'V2 مفعّل بالفعل.', 409); await inventoryControl();
          const collections = Object.fromEntries(await Promise.all(financialCollections.map(async name => [name, await tx.list(`${root}/${name}`)]))) as FinancialData;
          ensure(collections.products.filter(p => p.track_inventory).every(p => p.cost_status === 'valued'), 'أثبت تكلفة جميع المنتجات المتتبعة قبل التفعيل.', 409);
          ensure(!reconcileFinancialData(collections, settings, { requireCosting: true }).length, 'توجد فروقات مالية؛ عالجها قبل تفعيل V2.', 409);
          result = { ...org, accounting_version: 2, accounting_activated_at: iso, updated_at: iso }; set(root, result); break;
        }
        case 'invoice.create': {
          assertOpenPeriod(data.issue_date, settings);
          ensure(['dual', 'single_sdg', 'single_usd'].includes(data.currency_mode), 'نمط العملة غير صالح.');
          if (data.due_date) ensure(dateOnly(data.due_date) >= dateOnly(data.issue_date), 'تاريخ الاستحقاق قبل الإصدار.');
          ensure(!(data.paid_amount_sdg || data.paid_amount_usd), 'سجّل التحصيل بسند قبض بعد إصدار الفاتورة.');
          const customer = await required('customers', data.customer_id);
          const baseFinancials = invoiceFinancials(data, settings);
          let taxEvidence: Document | undefined;
          if (data.tax_configuration_id !== undefined || data.expected_tax_configuration_revision !== undefined) {
            ensure(data.tax_configuration_id && data.expected_tax_configuration_revision, 'معرف وإصدار إعداد الضريبة مطلوبان معاً.');
            const current = await required('tax_configurations', data.tax_configuration_id);
            await validateTaxConfigurationVersions(tx, root, orgId, current);
            const configuration = pick(current, ['schema_version','id','org_id','revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active']);
            taxEvidence = salesTaxSourceQuote({configuration_id:data.tax_configuration_id,expected_configuration_revision:data.expected_tax_configuration_revision,issue_date:data.issue_date,currency_mode:data.currency_mode,exchange_rate_used:data.exchange_rate_used||0,discount_type:data.discount_type,discount_value:data.discount_value||0,items:data.items}, {org_id:orgId,configurations:[configuration as any],accounts:await tx.list(`${root}/accounts`) as Account[]}, settings);
            taxEvidence.configuration_version_hash = current.version_hash;
          }
          const financials = taxEvidence ? {...baseFinancials,
            subtotal_sdg:safeAdd(taxEvidence.sdg.base,baseFinancials.discount_total_sdg,0),subtotal_usd:safeAdd(taxEvidence.usd.base,baseFinancials.discount_total_usd,2),
            tax_total_sdg:taxEvidence.sdg.tax,tax_total_usd:taxEvidence.usd.tax,grand_total_sdg:taxEvidence.sdg.total,grand_total_usd:taxEvidence.usd.total,
            remaining_sdg:taxEvidence.sdg.total,remaining_usd:taxEvidence.usd.total} : baseFinancials;
          const month = monthKey(now, settings.timezone || 'Africa/Khartoum');
          // Legacy counters are repaired from authoritative documents inside the same transaction.
          const existing = counters.invoice_month === month ? undefined : await tx.list(`${root}/invoices`);
          const monthCount = counters.invoice_month === month ? (counters.monthly_invoice_count || 0) : existing!.filter(i => Number.isFinite(new Date(i.created_at).getTime()) && monthKey(new Date(i.created_at), settings.timezone || 'Africa/Khartoum') === month).length;
          const usage = await tx.get(`${root}/meta/usage`);
          const lifetime = Math.max(usage?.lifetimeInvoiceCount || 0, counters.lifetime_invoice_count || 0, counters.invoice_count || 0, usage ? 0 : (existing || await tx.list(`${root}/invoices`)).length);
          ensure(!invoiceQuotaReached(subscription, lifetime, monthCount), subscription.invoice_period === 'lifetime' ? `تم بلوغ حد الباقة (${subscription.max_invoices_total} فاتورة إجمالاً). اطلب ترقية لإصدار فواتير جديدة؛ فواتيرك السابقة محفوظة.` : 'تم بلوغ حد الفواتير الشهري في الباقة.', 403);
          const historical = counters.numbering_version === 3 ? [] : (existing || await tx.list(`${root}/invoices`));
          const prefix = settings.invoice_prefix;
          const previousNumber = Number.isSafeInteger(counters.last_invoice_number) && counters.last_invoice_number >= 0 ? counters.last_invoice_number : 0;
          let number = historical.reduce((max, i) => { const value = i.invoice_number?.startsWith(prefix) ? Number(i.invoice_number.slice(prefix.length)) : 0; return Number.isSafeInteger(value) && value >= 0 ? Math.max(max, value) : max; }, previousNumber) + 1;
          ensure(Number.isSafeInteger(number) && number <= 999999999, 'تسلسل الفواتير يحتاج مراجعة قبل إصدار رقم جديد.');
          let numberKey = `${root}/invoice_numbers/${encodeURIComponent(`${prefix}${String(number).padStart(4, '0')}`)}`;
          while (await tx.get(numberKey)) { number++; numberKey = `${root}/invoice_numbers/${encodeURIComponent(`${prefix}${String(number).padStart(4, '0')}`)}`; }
          ensure(Number.isSafeInteger(number) && number <= 999999999, 'تسلسل الفواتير يحتاج مراجعة.');
          const id = `inv-${command.operationId}`;
          const invoice: Invoice = { ...pick(data, ['issue_date', 'due_date', 'currency_mode', 'discount_type', 'discount_value', 'notes', 'payment_instructions']), ...stamp, id, invoice_number: `${prefix}${String(number).padStart(4, '0')}`, customer_id: customer.id, customer_name: customer.name, customer_phone: customer.phone, customer_address: customer.address || '', ...financials, ...(taxEvidence?{tax_evidence:taxEvidence}:{}), paid_amount_sdg: 0, paid_amount_usd: 0, status: 'sent', operation_id: command.operationId, updated_at: iso } as Invoice;
          invoice.receivable_currency = receivableCurrency(invoice);
          let cogsSdg = 0, cogsUsd = 0;
          for (const item of invoice.items) item.cost_status = item.product_id ? 'unknown' : 'not_tracked';
          const quantities = new Map<string, number>();
          for (const item of invoice.items) if (item.product_id) quantities.set(identifier(item.product_id), safeAdd(quantities.get(item.product_id) || 0, item.quantity, 6));
          for (const [productId, quantity] of quantities) {
            const product = await required('products', productId); ensure(product.is_active, 'منتج الفاتورة غير نشط.');
            if (!product.track_inventory) { invoice.items.filter(item => item.product_id === productId).forEach(item => { item.cost_status = 'not_tracked'; }); continue; }
            assertFeature(subscription, 'inventory_tracking');
            const previousStock = product.stock_quantity || 0; ensure(previousStock >= quantity, `المخزون غير كافٍ للمنتج: ${product.name}`, 409);
            const resultingStock = safeSub(previousStock, quantity, 6), movementId = `mov-${command.operationId}-${productId}`;
            let productUpdate = { ...product, stock_quantity: resultingStock }, costMovement: Document = {};
            if (product.cost_status === 'valued' || org.accounting_version === 2) {
            await requireCostAuthority();
              const cost = issueCost(product as Product, quantity, data.issue_date), items = invoice.items.filter(item => item.product_id === productId), allocated = allocateCost(cost.delta, items.map(item => item.quantity));
              items.forEach((item, index) => Object.assign(item, { cost_status: 'valued', unit_cost_sdg: cost.unit_sdg, unit_cost_usd: cost.unit_usd, total_cost_sdg: allocated[index].sdg, total_cost_usd: allocated[index].usd, cost_recorded_at: iso }));
              productUpdate = { ...product, ...cost.after }; cogsSdg = safeAdd(cogsSdg, cost.delta.sdg, 0); cogsUsd = safeAdd(cogsUsd, cost.delta.usd, 2);
              costMovement = { value_delta_sdg: -cost.delta.sdg, value_delta_usd: -cost.delta.usd, unit_cost_sdg: cost.unit_sdg, unit_cost_usd: cost.unit_usd, costing_version: 2, journal_id: `jv-inv-${id}` };
            }
            set(`${root}/products/${productId}`, productUpdate);
            set(`${root}/inventory_movements/${movementId}`, { ...stamp, ...costMovement, id: movementId, product_id: productId, product_name: product.name, type: 'SALE', quantity: -quantity, previous_stock: previousStock, resulting_stock: resultingStock, reference_type: 'invoice', reference_id: id, operation_id: command.operationId }); counterAdd('inventory_movement_count', 1);
          }
          const lines = [journalLine('1200', 'ذمم العملاء', invoice.grand_total_sdg, 0, invoice.grand_total_usd, 0)];
          const revenueSdg = safeSub(invoice.grand_total_sdg, invoice.tax_total_sdg, 0), revenueUsd = safeSub(invoice.grand_total_usd, invoice.tax_total_usd, 2);
          if (revenueSdg || revenueUsd) lines.push(journalLine('4100', 'إيراد المبيعات', 0, revenueSdg, 0, revenueUsd));
          if (invoice.tax_total_sdg || invoice.tax_total_usd) lines.push(journalLine(taxEvidence?.tax_account_code||'2130', 'ضريبة المبيعات المستحقة', 0, invoice.tax_total_sdg, 0, invoice.tax_total_usd));
          invoice.costing_status = invoice.items.some(item => item.cost_status === 'unknown') ? 'incomplete' : 'complete';
          invoice.costing_version = 2; invoice.cogs_sdg = cogsSdg; invoice.cogs_usd = cogsUsd;
          if (cogsSdg || cogsUsd) lines.push(journalLine('5100', 'تكلفة البضاعة المباعة', cogsSdg, 0, cogsUsd, 0), journalLine('1300', 'المخزون', 0, cogsSdg, 0, cogsUsd));
          await post(journal(`jv-inv-${id}`, orgId, actor.uid, data.issue_date, 'invoice', id, `إصدار الفاتورة ${invoice.invoice_number}`, lines, invoice.exchange_rate_used));
          if (org.accounting_version === 2) await saveSalesCustomer({ tx, root, orgId, actor: actor.uid, iso, operationId: command.operationId, settings, set, required, post, counterAdd }, customer, invoice);
          else set(`${root}/customers/${customer.id}`, { ...customer, balance_sdg: safeAdd(customer.balance_sdg || 0, invoice.remaining_sdg, 0), balance_usd: safeAdd(customer.balance_usd || 0, invoice.remaining_usd, 2), updated_at: iso });
          set(`${root}/invoices/${id}`, invoice); set(numberKey, { invoice_id: id }); result = invoice;
          counters.invoice_count = (existing?.length ?? counters.invoice_count) + 1; counters.last_invoice_number = number; counters.numbering_version = 3; counters.invoice_month = month; counters.monthly_invoice_count = monthCount + 1;
          counters.lifetime_invoice_count = lifetime + 1;
          set(`${root}/meta/usage`, { ...usage, lifetimeInvoiceCount: lifetime + 1, firstActualUseAt: usage?.firstActualUseAt || iso, updatedAt: iso }); break;
        }
        case 'payment.create': {
          const invoice = await required('invoices', data.invoice_id) as Invoice;
          ensure(!['void', 'cancelled', 'draft', 'paid'].includes(invoice.status), 'لا يمكن تحصيل هذه الفاتورة.');
          assertOpenPeriod(iso, settings);
          const sourceState = org.accounting_version === 2 ? await loadSalesSource(tx, root, invoice) : undefined;
          if (sourceState) ensure(dateOnly(iso) >= sourceState.lastDate, 'التحصيل يسبق آخر حركة للمصدر.', 409);
          const previousPayments = await tx.find(`${root}/payments`, 'invoice_id', invoice.id);
          const linkedEntries = await tx.find(`${root}/journal_entries`, 'reference_id', invoice.id);
          ensure(linkedEntries.filter(e => e.reference_type === 'invoice').length === 1, 'قيد الإصدار يحتاج مراجعة قبل تحصيل هذه الفاتورة.');
          for (const payment of previousPayments) {
            const entries = (await tx.find(`${root}/journal_entries`, 'reference_id', payment.id)).filter(e => e.reference_type === 'payment');
            ensure(entries.length === 1, 'قيد تحصيل سابق يحتاج مراجعة.'); linkedEntries.push(...entries);
          }
          for (const currency of ['sdg', 'usd'] as const) {
            const carrying = linkedEntries.flatMap(e => e.lines || []).filter((l: Document) => l.account_code === '1200').reduce((n, l) => n.plus(l[`debit_${currency}`] || 0).minus(l[`credit_${currency}`] || 0), new BigNumber(0));
            ensure(sourceState || carrying.eq(invoice[`remaining_${currency}`]), 'رصيد الفاتورة لا يطابق الذمم. افحص البيانات التاريخية قبل التحصيل.', 409);
          }
          ensure(['SDG', 'USD'].includes(data.currency) && ['cash', 'bankak', 'fawry', 'bank_transfer', 'other'].includes(data.payment_method), 'العملة أو طريقة الدفع غير مدعومة.');
          const rate = data.exchange_rate_used ?? invoice.exchange_rate_used;
          const quote = paymentQuote(invoice, data.amount, data.currency, rate);
          const customer = await required('customers', invoice.customer_id);
          ensure(sourceState || customer.balance_sdg >= quote.settledSdg && customer.balance_usd >= quote.settledUsd, 'رصيد العميل يحتاج مراجعة قبل التحصيل.', 409);
          const payment: Payment = { ...pick(data, ['reference_number', 'notes']), ...stamp, id: `pay-${command.operationId}`, invoice_id: invoice.id, invoice_number: invoice.invoice_number, customer_id: customer.id, customer_name: customer.name, amount: data.amount, currency: data.currency, exchange_rate_used: rate, amount_in_other_currency: data.currency === 'USD' ? quote.cashSdg : quote.cashUsd, payment_method: data.payment_method, payment_date: iso, operation_id: command.operationId, idempotency_key: command.operationId, settled_amount_sdg: quote.settledSdg, settled_amount_usd: quote.settledUsd, cash_amount_sdg: quote.cashSdg, cash_amount_usd: quote.cashUsd };
          if (sourceState) { ensure(sourceState.sequence < 200, 'سجل الفاتورة يتطلب إجراء ترحيل خادمي.', 409); payment.source_sequence = sourceState.sequence + 1; }
          await post(receiptJournal(payment, invoice, orgId, actor.uid));
          const remainingSdg = safeSub(invoice.remaining_sdg, quote.settledSdg, 0), remainingUsd = safeSub(invoice.remaining_usd, quote.settledUsd, 2);
          if (sourceState) {
            sourceState.balance = { sdg: remainingSdg, usd: remainingUsd }; sourceState.paid = { sdg: safeAdd(sourceState.paid.sdg, quote.settledSdg, 0), usd: safeAdd(sourceState.paid.usd, quote.settledUsd, 2) }; sourceState.sequence++;
            const updated = salesInvoiceCaches(invoice, sourceState, iso);
            await saveSalesCustomer({ tx, root, orgId, actor: actor.uid, iso, operationId: command.operationId, settings, set, required, post, counterAdd }, customer, updated); set(`${root}/invoices/${invoice.id}`, updated);
          } else {
          set(`${root}/invoices/${invoice.id}`, { ...invoice, remaining_sdg: remainingSdg, remaining_usd: remainingUsd, paid_amount_sdg: safeAdd(invoice.paid_amount_sdg, quote.settledSdg, 0), paid_amount_usd: safeAdd(invoice.paid_amount_usd, quote.settledUsd, 2), status: (receivableCurrency(invoice) === 'USD' ? remainingUsd : remainingSdg) === 0 ? 'paid' : 'partially_paid', updated_at: iso });
          set(`${root}/customers/${customer.id}`, { ...customer, balance_sdg: safeSub(customer.balance_sdg || 0, quote.settledSdg, 0), balance_usd: safeSub(customer.balance_usd || 0, quote.settledUsd, 2), updated_at: iso });
          }
          set(`${root}/payments/${payment.id}`, payment); counterAdd('payment_count', 1); result = payment; break;
        }
        case 'invoice.update': {
          const invoice = await required('invoices', data.id); assertOpenPeriod(invoice.issue_date, settings);
          ensure(data.updates && typeof data.updates === 'object' && !Array.isArray(data.updates), 'بيانات التعديل غير صالحة.');
          ensure(Object.keys(data.updates || {}).every(k => ['notes', 'payment_instructions', 'due_date'].includes(k)), 'الفاتورة المُرحّلة ثابتة. التعديل متاح للملاحظات والاستحقاق فقط.');
          if (data.updates.due_date) ensure(dateOnly(data.updates.due_date) >= dateOnly(invoice.issue_date), 'تاريخ الاستحقاق غير صالح.');
          result = { ...invoice, ...data.updates, updated_at: iso }; set(`${root}/invoices/${data.id}`, result); break;
        }
        case 'invoice.void': {
          const invoice = await required('invoices', data.id) as Invoice;
          assertOpenPeriod(invoice.issue_date, settings); assertOpenPeriod(iso, settings);
          ensure(!(await tx.find(`${root}/credit_notes`, 'invoice_id', invoice.id)).length && !(await tx.find(`${root}/customer_refunds`, 'invoice_id', invoice.id)).length && !invoice.correction_count, 'الفاتورة المصححة تتطلب إشعاراً موثقاً؛ الإبطال المباشر ممنوع.', 409);
          ensure(invoice.status !== 'void', 'الفاتورة مبطلة مسبقاً.', 409);
          ensure(!(invoice.paid_amount_sdg || invoice.paid_amount_usd) && !(await tx.list(`${root}/payments`)).some(p => p.invoice_id === invoice.id), 'الفاتورة محصّلة. تتطلب معالجة ردّ مبلغ موثّقة قبل إبطالها؛ لن يُنشأ ردّ نقدي وهمي.');
          const original = await required('journal_entries', `jv-inv-${invoice.id}`) as JournalEntry;
          const customer = await required('customers', invoice.customer_id);
          await post(reverseJournal(original, `jv-void-${invoice.id}`, iso, text(data.reason || 'إبطال الفاتورة', 500, true), actor.uid));
          const movements = (await tx.list(`${root}/inventory_movements`)).filter(m => m.reference_id === invoice.id && m.type === 'SALE');
          const quantities = new Map<string, number>(); for (const movement of movements) quantities.set(movement.product_id, safeAdd(quantities.get(movement.product_id) || 0, -movement.quantity, 6));
          for (const [productId, quantity] of quantities) {
            const product = await required('products', productId), resultingStock = safeAdd(product.stock_quantity || 0, quantity, 6), id = `rev-${command.operationId}-${productId}`;
            let productUpdate = { ...product, stock_quantity: resultingStock }, costMovement: Document = {};
            if (product.cost_status === 'valued' || org.accounting_version === 2) {
            await requireCostAuthority();
              const sources = movements.filter(m => m.product_id === productId);
              ensure(sources.every(m => m.costing_version === 2), 'تكلفة الفاتورة القديمة غير متاحة؛ الإبطال يتطلب معالجة ترحيل موثقة ولا يستعمل تكلفة اليوم.', 409);
              const delta = { sdg: sources.reduce((sum, m) => sum.minus(m.value_delta_sdg || 0), new BigNumber(0)).toNumber(), usd: sources.reduce((sum, m) => sum.minus(m.value_delta_usd || 0), new BigNumber(0)).toNumber() };
              productUpdate = { ...product, ...receiveCost(product as Product, quantity, delta, iso) }; costMovement = { value_delta_sdg: delta.sdg, value_delta_usd: delta.usd, costing_version: 2, journal_id: `jv-void-${invoice.id}` };
            }
            set(`${root}/products/${productId}`, productUpdate);
            set(`${root}/inventory_movements/${id}`, { ...stamp, ...costMovement, id, product_id: productId, product_name: product.name, type: 'VOID_REVERSAL', quantity, previous_stock: product.stock_quantity || 0, resulting_stock: resultingStock, reference_type: 'void', reference_id: invoice.id, operation_id: command.operationId }); counterAdd('inventory_movement_count', 1);
          }
          result = { ...invoice, status: 'void', remaining_sdg: 0, remaining_usd: 0, voided_at: iso, voided_by: actor.uid, void_reason: data.reason || 'إبطال الفاتورة', updated_at: iso };
          if (org.accounting_version === 2) await saveSalesCustomer({ tx, root, orgId, actor: actor.uid, iso, operationId: command.operationId, settings, set, required, post, counterAdd }, customer, result as Invoice);
          else set(`${root}/customers/${customer.id}`, { ...customer, balance_sdg: safeSub(customer.balance_sdg || 0, invoice.remaining_sdg, 0), balance_usd: safeSub(customer.balance_usd || 0, invoice.remaining_usd, 2), updated_at: iso });
          set(`${root}/invoices/${invoice.id}`, result); break;
        }
        case 'expense.create': {
          assertOpenPeriod(data.date, settings); ensure(['SDG', 'USD'].includes(data.currency), 'عملة المصروف غير مدعومة.'); money(data.amount, data.currency === 'USD' ? 2 : 0, true); text(data.title, 200, true);
          ensure(data.kind === undefined || data.kind === 'expense', 'مشتريات المخزون تُسجّل بعملية شراء مستقلة.');
          const category = text(data.category || '', 200).trim().toLowerCase();
          ensure(!/(بضاعة|توريدات|مشتريات|inventory|merchandise|stock purchase)/i.test(category), 'مشتريات المخزون ليست مصروفاً تشغيلياً؛ استخدم عملية شراء.');
          const method = data.payment_method || 'cash';
          ensure(['cash', 'bankak', 'fawry', 'bank_transfer', 'other', 'on_credit', 'custom'].includes(method), 'طريقة سداد المصروف غير صالحة.');
          ensure(method !== 'custom' || data.payment_account_code, 'اختر حساب السداد المخصص.');
          result = { ...pick(data, ['title', 'category', 'amount', 'currency', 'exchange_rate_used', 'date', 'notes', 'receipt_image', 'payment_account_code', 'expense_account_code']), payment_method: method, ...stamp, id: `exp-${command.operationId}` };
          if (org.accounting_version === 2 && method === 'on_credit' && (!result.payment_account_code || result.payment_account_code === '2110')) result.payment_account_code = '2140';
          const entry = generateExpenseJournalEntry(result as any, orgId, actor.uid);
          for (const [index, line] of entry.lines.entries()) {
            const account = await tx.get(`${root}/accounts/${identifier(line.account_code)}`) || getDefaultChartOfAccounts(orgId).find(a => a.code === line.account_code);
            ensure(account?.is_active, 'حساب المصروف أو السداد غير موجود أو غير نشط.');
            const classification = classifyAccount(account as Account);
            ensure(index === 0 ? account.type === 'EXPENSE' && classification.reporting_group === 'operating_expense' : method === 'on_credit' ? account.type === 'LIABILITY' && classification.reporting_group === 'payables' : account.type === 'ASSET' && classification.reporting_group === 'cash_bank', 'الحساب المختار لا يطابق المصروف أو طريقة السداد.');
          }
          result.expense_account_code = entry.lines[0].account_code;
          result.payment_account_code = entry.lines[1].account_code;
          await post(entry); set(`${root}/expenses/${result.id}`, result); counterAdd('expense_count', 1); break;
        }
        case 'expense.void': {
          const expense = await required('expenses', data.id); ensure(!expense.voided_at, 'المصروف معكوس مسبقاً.'); assertOpenPeriod(expense.date, settings);
          const original = await required('journal_entries', `jv-exp-${expense.id}`) as JournalEntry;
          await post(reverseJournal(original, `jv-void-${expense.id}`, iso, `عكس المصروف: ${expense.title}`, actor.uid)); result = { ...expense, voided_at: iso }; set(`${root}/expenses/${expense.id}`, result); break;
        }
        case 'journal.create': {
          ensure(['manual', 'opening_balance'].includes(data.reference_type), 'الترحيل الآلي متاح من العملية الأصلية فقط.');
          if (org.accounting_version === 2) for (const line of data.lines || []) { const account = await tx.get(`${root}/accounts/${identifier(line.account_code)}`) || getDefaultChartOfAccounts(orgId).find(a => a.code === line.account_code); ensure(account && line.account_code !== '2110' && !['inventory', 'cogs'].includes(classifyAccount(account as Account).reporting_group), 'قيود المخزون والتكلفة تُرحّل من العملية الأصلية فقط.'); }
          result = journal(`jv-${command.operationId}`, orgId, actor.uid, data.date, data.reference_type, command.operationId, text(data.description, 1000, true), data.lines, data.exchange_rate_used || 0);
          if(adjusting) {ensure(hasPermission(role,'periods:adjust'),'قيد التسوية يتطلب صلاحية المحاسب أو المالك.',403);text(data.reason,1000,true);Object.assign(result,{adjusting:true,adjustment_reason:data.reason,period_id:periods.find(row=>row.start_date<=dateOnly(data.date)&&dateOnly(data.date)<=row.end_date)?.id||null});}
          await post(result as JournalEntry); break;
        }
        case 'account.create': case 'account.update': {
          const updating = command.action.endsWith('update'), code = identifier(data.code);
          const old = updating ? await required('accounts', code) : {};
          ensure(updating || !await tx.get(`${root}/accounts/${code}`), 'رمز الحساب موجود.');
          const input = updating ? data.updates : data;
          ensure(input && typeof input === 'object' && !Array.isArray(input), 'بيانات الحساب غير صالحة.');
          ensure(!updating || !old.is_system || !['code', 'type', 'nature', 'is_active', 'is_system', 'parent_code'].some(k => input[k] !== undefined && input[k] !== old[k]), 'هيكل حسابات النظام ثابت.');
          ensure(!['balance_sdg', 'balance_usd'].some(k => input[k] !== undefined && input[k] !== (old[k] || 0)), 'الرصيد الافتتاحي يُسجّل بقيد افتتاحي متزن.');
          result = { ...old, ...pick(input, ['name_ar', 'name_en', 'type', 'nature', 'parent_code', 'description', 'is_active', 'subtype', 'reporting_group', 'cash_flow_category', 'normal_balance']), ...(!updating ? { ...stamp, is_system: false, balance_sdg: 0, balance_usd: 0 } : {}), code };
          text(result.name_ar, 200, true); ensure(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(result.type) && ['DEBIT', 'CREDIT'].includes(result.nature) && typeof result.is_active === 'boolean', 'تصنيف الحساب غير صالح.');
          const metadata = classifyAccount(result as Account);
          ensure(!updating || !old.is_system || canonical(metadata) === canonical(classifyAccount(old as Account)), 'تصنيف حسابات النظام ثابت.');
          if (updating && (await tx.list(`${root}/journal_entries`)).some(e => e.lines?.some((l: Document) => l.account_code === code))) {
            const oldMetadata = classifyAccount(old as Account);
            ensure(['type', 'nature'].every(k => result[k] === old[k]) && canonical(metadata) === canonical(oldMetadata), 'تصنيف الحساب المُستخدم في القيود ثابت؛ أنشئ حساباً جديداً عند تغيير تصنيفه.');
          }
          Object.assign(result, metadata);
          if (result.parent_code) ensure(result.parent_code !== code && await tx.get(`${root}/accounts/${identifier(result.parent_code)}`), 'الحساب الأب غير صالح.');
          set(`${root}/accounts/${code}`, result); break;
        }
        case 'account.reset': {
          ensure(!(await tx.list(`${root}/journal_entries`)).length, 'لا يمكن إعادة ضبط الدليل بعد الترحيل.');
          for (const account of await tx.list(`${root}/accounts`)) remove(`${root}/accounts/${account.code}`);
          for (const account of getDefaultChartOfAccounts(orgId)) set(`${root}/accounts/${account.code}`, account); break;
        }
        case 'settings.update': {
          ensure(data.updates && typeof data.updates === 'object' && !Array.isArray(data.updates), 'بيانات الإعدادات غير صالحة.');
          const updated = validateSettings({ ...settings, ...pick(data.updates, Object.keys(INITIAL_SETTINGS).concat(['period_lock_date', 'timezone', 'fiscal_year', 'commercial_registration', 'tax_number', 'business_activity', 'manual_exchange_rate', 'freeze_exchange_rate', 'freeze_invoice_exchange_rate'])) });
          if (settings.period_lock_date && (updated.period_lock_date || '') < settings.period_lock_date) ensure(role === 'Owner', 'إعادة فتح فترة مقفلة متاحة للمالك فقط.', 403);
          result = { ...org, settings: updated, name: updated.business_name || org.name, display_name: updated.business_name || org.display_name, base_currency: updated.primary_currency, secondary_currency: updated.secondary_currency, timezone: updated.timezone || org.timezone, fiscal_year: updated.fiscal_year || org.fiscal_year, updated_at: iso };
          result.searchName = result.name.normalize('NFKC').trim().toLowerCase();
          set(root, result); break;
        }
        case 'subscription.request': {
          const requestedId = identifier(data.plan);
          const requested = await tx.get(`plans/${requestedId}`);
          ensure(requested ? requested.active : ['Free', 'Starter', 'Professional', 'Business', 'Enterprise'].includes(requestedId), 'الباقة غير صالحة.');
          result = { id: orgId, organizationId: orgId, organizationName: org.name, requested_plan: data.plan, status: 'pending', requested_by: actor.uid, operationId: command.operationId, created_at: iso };
          set(`${root}/meta/subscription_request`, result); tx.set(`subscriptionRequests/${orgId}`, result); break;
        }
        case 'member.update': case 'member.remove': {
          const member = await required('members', data.uid);
          ensure(member.uid !== org.owner_uid && member.uid !== actor.uid && member.role !== 'Owner', 'لا يمكن تعديل المالك أو عضويتك بهذه العملية.', 403);
          const newRole = data.role || member.role;
          ensure(['Admin', 'Accountant', 'Sales', 'Cashier', 'Viewer'].includes(newRole), 'الدور غير صالح.');
          ensure(role === 'Owner' || !['Owner', 'Admin'].includes(member.role) && newRole !== 'Admin', 'المدير لا يعدّل الأدوار الإدارية.', 403);
          if (command.action === 'member.remove') { remove(`${root}/members/${data.uid}`); remove(`user_organizations/${data.uid}/orgs/${orgId}`); }
          else { ensure(data.status === undefined || ['active', 'suspended'].includes(data.status), 'حالة العضوية غير صالحة.'); result = { ...member, role: newRole, status: data.status || member.status }; set(`${root}/members/${data.uid}`, result); set(`user_organizations/${data.uid}/orgs/${orgId}`, { org_id: orgId, role: newRole, joined_at: member.joined_at }); } break;
        }
        case 'invitation.create': {
          const email = text(data.email, 320, true).toLowerCase(); ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'البريد غير صالح.');
          ensure(['Admin', 'Accountant', 'Sales', 'Cashier', 'Viewer'].includes(data.role) && (role === 'Owner' || data.role !== 'Admin'), 'الدور المطلوب غير مسموح.', 403);
          const members = await tx.list(`${root}/members`), pending = (await tx.list(`${root}/invitations`)).filter(i => i.status === 'pending' && new Date(i.expires_at) > now);
          ensure(!members.some(member => member.email?.toLowerCase() === email) && !pending.some(invitation => (invitation.recipient_email || invitation.email).toLowerCase() === email), 'هذا البريد لديه عضوية أو دعوة قائمة.', 409);
          ensure(new Set([...members.map(member => member.uid), org.owner_uid]).size + pending.length < plan.max_members, `حد أعضاء الباقة ${plan.max_members} شاملاً المالك والدعوات القائمة. المجانية تسمح بموظف واحد إضافي.`);
          result = { id: `invite-${command.operationId}`, org_id: orgId, email, recipient_email: email, role: data.role, token: command.operationId, created_at: iso, expires_at: new Date(now.getTime() + 7 * 86400000).toISOString(), invited_by: actor.email, inviter_uid: actor.uid, status: 'pending' }; set(`${root}/invitations/${result.id}`, result); break;
        }
        case 'invitation.revoke': {
          const invitation = await required('invitations', data.id); ensure(invitation.status === 'pending', 'الدعوة ليست معلقة.'); result = { ...invitation, status: 'revoked', updated_at: iso }; set(`${root}/invitations/${data.id}`, result); break;
        }
        case 'backup.restore': {
          ensure(role === 'Owner', 'استعادة البيانات متاحة للمالك فقط.', 403);
          const backup = data.backup ? { ...data.backup, collections: { ...data.backup.collections } } : data.backup;
          ensure(backup?.schema_version === 3 && backup.collections && backup.settings, 'صيغة النسخة الاحتياطية غير مدعومة.');
          const names = financialCollections;
          Object.assign(backup.collections,validateOpeningBackup(backup),validateEquityBackup(backup),validateFxRevaluationBackup(backup),validateFixedAssetBackup(backup),await validateTaxConfigurationBackup(backup));
          if(backup.period_schema_version!==undefined)ensure(backup.period_schema_version===1 && Number.isSafeInteger(backup.counters?.accounting_period_count) && backup.counters.accounting_period_count===(backup.collections.accounting_periods||[]).length,'أدلة عدد الفترات في النسخة ناقصة أو مختلفة.');
          backup.collections.audit_archives = await restoreAuditArchives(backup,orgId,actor.uid,command.operationId,iso);
          for (const name of [...taxConfigurationCollections,...fixedAssetCollections,...payableCollections, ...cashCollections, ...cashReconciliationCollections, ...salesCorrectionCollections, ...purchaseCorrectionCollections, ...periodCollections, ...openingCollections, ...equityCollections,...fxRevaluationCollections]) if (backup.collections[name] === undefined) backup.collections[name] = [];
          ensure(names.every(n => Array.isArray(backup.collections[n])), 'النسخة ناقصة.');
          ensure(names.reduce((n, key) => n + backup.collections[key].length, 0) + backup.collections.purchase_bills.length + backup.collections.financial_accounts.length <= 440, 'فهرس فواتير المورد يتجاوز حد الاستعادة الذرية.');
          ensure(names.reduce((n, key) => n + backup.collections[key].length, 0) <= 350, 'الاستعادة الذرية تدعم 350 سجلاً. استخدم إجراء ترحيل خادمي للنسخ الأكبر.');
          const usage = await tx.get(`${root}/meta/usage`);
          const priorLifetime = Math.max(usage?.lifetimeInvoiceCount || 0, counters.lifetime_invoice_count || 0, counters.invoice_count || 0);
          ensure(priorLifetime + backup.collections.invoices.length <= (subscription.max_invoices_total ?? 999999), 'عدد فواتير النسخة يتجاوز إجمالي حصة الباقة.', 403);
          ensure(backup.collections.customers.length <= plan.max_customers && backup.collections.products.length <= plan.max_products, 'النسخة تتجاوز حدود العملاء أو المنتجات في الباقة.', 403);
          if (backup.collections.products.some((product: Document) => product.track_inventory) || backup.collections.inventory_movements.length) assertFeature(subscription, 'inventory_tracking');
          if (backup.collections.financial_accounts.some((account: Document) => account.currency === 'USD') || backup.collections.internal_transfers.some((transfer: Document) => transfer.currency === 'USD')) assertFeature(subscription, 'multi_currency');
          if (backup.collections.invoices.some((invoice: Document) => invoice.currency_mode !== 'single_sdg')) assertFeature(subscription, 'multi_currency');
          if(backup.collections.owner_equity_events.some((event:Document)=>event.input?.currency_policy==='dual'))assertFeature(subscription,'multi_currency');
          if(backup.collections.opening_batches.some((batch:Document)=>batch.input?.currency_policy==='dual'))assertFeature(subscription,'multi_currency');
          if (backup.collections.journal_entries.some((entry: Document) => ['manual', 'opening_balance'].includes(entry.reference_type)) || backup.collections.accounts.some((account: Document) => !getDefaultChartOfAccounts(orgId).some(system => system.code === account.code))) assertFeature(subscription, 'accounting');
          for (const name of names.filter(n => n !== 'accounts')) ensure(!(await tx.list(`${root}/${name}`)).length, 'الاستعادة تتطلب مؤسسة فارغة؛ لن تُستبدل دفاتر قائمة.');
          for (const name of names) {
            const ids = backup.collections[name].map((record: Document) => { ensure(record && typeof record === 'object' && !Array.isArray(record), 'سجل النسخة غير صالح.'); return identifier(name === 'accounts' ? record.code : record.id); });
            ensure(new Set(ids).size === ids.length, 'معرّفات النسخة مكررة.');
          }
          if ([...fixedAssetCollections,...payableCollections, ...cashCollections, ...cashReconciliationCollections, ...salesCorrectionCollections, ...purchaseCorrectionCollections, ...periodCollections, ...openingCollections, ...equityCollections,...fxRevaluationCollections].some(name => backup.collections[name].length)) { assertFeature(subscription, 'accounting'); await requireCostAuthority(); }
          const importedSettings = validateSettings(backup.settings);
          await verifyCashSessionHashes(backup.collections);
          validatePeriods(backup.collections.accounting_periods,backup.collections.accounting_periods.length?identifier(backup.org?.id):undefined);await verifyClosedPeriodHashes(backup.collections.accounting_periods,backup.collections.journal_entries,backup.collections);
          const backupVersion = backup.org?.accounting_version || 1;
          ensure(backupVersion === 1 || backupVersion === 2, 'إصدار المحاسبة في النسخة غير مدعوم.');
          ensure(!(backup.collections.fixed_assets.length || backup.collections.accounting_periods.length || backup.collections.purchase_bills.length || backup.collections.supplier_payments.length || backup.collections.internal_transfers.length || backup.collections.bank_reconciliations.length || backup.collections.cash_reconciliations.length || backup.collections.credit_notes.length || backup.collections.customer_refunds.length || backup.collections.purchase_returns.length || backup.collections.supplier_refunds.length || backup.collections.fx_revaluations.length || (backup.collections.owner_equity_events.length || openingCollections.some(name=>backup.collections[name].length))) || backupVersion === 2, 'دفاتر الموردين وإعادة التقييم والأصول تتطلب نسخة محاسبة V2.');
          if (backupVersion === 2 || backup.collections.products.some((p: Document) => p.cost_status === 'valued')) await requireCostAuthority();
          ensure(org.accounting_version !== 2 || backupVersion === 2, 'استعادة نسخة قديمة تحتاج ترحيلاً موثقاً قبل مؤسسة V2.');
          for (const customer of backup.collections.customers) { text(customer.name, 200, true); text(customer.phone, 100); ensure(typeof customer.balance_sdg === 'number' && typeof customer.balance_usd === 'number', 'رصيد العميل في النسخة يجب أن يكون رقماً.'); money(Math.abs(customer.balance_sdg), 0); money(Math.abs(customer.balance_usd), 2); }
          for (const product of backup.collections.products) { text(product.name, 200, true); text(product.unit, 50, true); money(product.price_sdg, 0); money(product.price_usd, 2); money(product.stock_quantity ?? 0, 6); ensure(typeof product.is_active === 'boolean', 'حالة المنتج غير صالحة.'); }
          for (const invoice of backup.collections.invoices) { ensure(['sent', 'paid', 'partially_paid', 'overdue', 'void'].includes(invoice.status), 'حالة الفاتورة غير قابلة للاستعادة.'); dateOnly(invoice.created_at); }
          for (const payment of backup.collections.payments) ensure(['SDG', 'USD'].includes(payment.currency) && ['cash', 'bankak', 'fawry', 'bank_transfer', 'other'].includes(payment.payment_method), 'سند النسخة غير صالح.');
          for (const account of backup.collections.accounts) { text(account.name_ar, 200, true); ensure(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(account.type) && ['DEBIT', 'CREDIT'].includes(account.nature) && typeof account.is_active === 'boolean', 'حساب النسخة غير صالح.'); money(account.balance_sdg || 0, 0); money(account.balance_usd || 0, 2); }
          for (const expense of backup.collections.expenses) { text(expense.title, 200, true); dateOnly(expense.date); ensure(['SDG', 'USD'].includes(expense.currency), 'عملة المصروف غير صالحة.'); money(expense.amount, expense.currency === 'USD' ? 2 : 0, true); }
          ensure(!reconcileFinancialData(backup.collections as FinancialData, importedSettings, { requireCosting: backupVersion === 2 }).length, 'النسخة تحتوي فروقات مالية أو مراجع ناقصة. افحصها بإجراء التدقيق قبل الاستعادة.');
          const restoredCollections=Object.fromEntries(names.map(name=>[name,backup.collections[name].map((record:Document)=>({...record,org_id:orgId}))]));
          Object.assign(restoredCollections,remapOpeningCollections(backup.collections,orgId),remapFixedAssets(backup.collections,orgId),await remapTaxConfigurations(backup.collections,orgId),{owner_equity_events:remapEquityEvents(backup.collections,orgId),fx_revaluations:remapFxRevaluations(backup.collections,orgId)});
          if(hasOpeningSources(restoredCollections))verifyOpeningSources(restoredCollections,orgId);await verifyTaxConfigurationSources(restoredCollections,orgId);
          ensure(!reconcileFinancialData(restoredCollections as FinancialData,importedSettings,{requireCosting:backupVersion===2}).length,'النسخة تحتوي فروقات بعد تطبيع مؤسسة الاستعادة.',409);
          for (const account of backup.collections.financial_accounts) set(`${root}/financial_account_mappings/${account.account_code}`, { id: account.id });
          for (const bill of backup.collections.purchase_bills) { const path = `${root}/purchase_numbers/${bill.supplier_id}.${encodeURIComponent(bill.supplier_reference.toLowerCase())}`; set(path, { id: bill.id, supplier_id: bill.supplier_id, reference: bill.supplier_reference }); }
          for (const name of names) for (const record of restoredCollections[name]) { const id = identifier(name === 'accounts' ? record.code : record.id); set(`${root}/${name}/${id}`, record); }
          result = { ...org, accounting_version: backupVersion, ...(backup.org?.accounting_activated_at ? { accounting_activated_at: backup.org.accounting_activated_at } : {}), settings: importedSettings, base_currency: importedSettings.primary_currency, secondary_currency: importedSettings.secondary_currency, timezone: importedSettings.timezone || org.timezone, updated_at: iso }; set(root, result);
          for (const [name, field] of Object.entries({ invoices: 'invoice_count', customers: 'customer_count', products: 'product_count', payments: 'payment_count', expenses: 'expense_count', inventory_movements: 'inventory_movement_count', credit_notes: 'credit_note_count', customer_refunds: 'customer_refund_count', purchase_returns: 'purchase_return_count', supplier_refunds: 'supplier_refund_count' })) counters[field] = backup.collections[name].length;
          const importedMonth = monthKey(now, importedSettings.timezone || org.timezone || 'Africa/Khartoum');
          const importedMonthly = backup.collections.invoices.filter((invoice: Document) => monthKey(new Date(invoice.created_at), importedSettings.timezone || org.timezone || 'Africa/Khartoum') === importedMonth).length;
          ensure(importedMonthly <= subscription.max_invoices_per_month, 'فواتير الشهر في النسخة تتجاوز حصة الباقة.', 403);
          counters.lifetime_invoice_count = priorLifetime + backup.collections.invoices.length;
          set(`${root}/meta/usage`, { ...usage, lifetimeInvoiceCount: counters.lifetime_invoice_count, firstActualUseAt: usage?.firstActualUseAt || (backup.collections.invoices.length ? iso : null), updatedAt: iso });
          counters.audit_archive_count = backup.collections.audit_archives.length;
          Object.assign(counters,openingBackupCounts(restoredCollections),equityBackupCounts(restoredCollections),fxRevaluationBackupCounts(restoredCollections),fixedAssetBackupCounts(restoredCollections),taxConfigurationBackupCounts(restoredCollections));
          counters.numbering_version = 0; counters.invoice_month = ''; break;
        }
      }
      counters.updated_at = iso; counters.revision = (counters.revision || 0) + 1; set(`${root}/meta/counters`, counters);
      const auditKeys = ['input','quote','source_balance','prior_journal_ids','last_owner_equity_event_id','batch_id','lot_id','journal_id','line_index','party_id','native_amount','last_opening_batch_id','last_opening_settlement_id','start_date','end_date','revision','previous_status','reopened_by','reopened_at','reopen_reason','changed_by','changed_at','close_evidence','adjusting','adjustment_reason','period_id','invoice_id', 'lines', 'native_currency', 'source_sequence', 'correction_count', 'credit_sdg', 'credit_usd', 'restored_cost_sdg', 'restored_cost_usd', 'credited_amount_sdg', 'credited_amount_usd', 'refunded_amount_sdg', 'refunded_amount_usd', 'credit_balance_sdg', 'credit_balance_usd', 'receivable_due_sdg', 'receivable_due_usd', 'available_credit_sdg', 'available_credit_usd', 'financial_account_id', 'ledger_snapshot', 'statement_opening', 'statement_closing', 'statement_lines', 'matches', 'actual_count', 'difference', 'opening_difference', 'difference_reason', 'reconciliation_sequence', 'last_reconciliation_id', 'account_code', 'kind', 'from_id', 'to_id', 'from_account_code', 'to_account_code', 'amount_sdg', 'amount_usd', 'source_balance_sdg', 'source_balance_usd', 'revision', 'last_transfer_id', 'date', 'reason', 'id', 'code', 'name', 'type', 'nature', 'reporting_group', 'cash_flow_category', 'normal_balance', 'supplier_id', 'bill_id', 'supplier_reference', 'due_date', 'reference_number', 'payment_terms_days', 'credit_limit', 'default_currency', 'phone', 'email', 'address', 'tax_number', 'notes', 'sequence', 'payment_sequence', 'settled_amount_sdg', 'settled_amount_usd', 'cash_amount_sdg', 'cash_amount_usd', 'stock_quantity', ...costFields, 'status', 'accounting_version', 'grand_total_sdg', 'grand_total_usd', 'remaining_sdg', 'remaining_usd', 'paid_amount_sdg', 'paid_amount_usd', 'amount', 'currency', 'payment_account_code', 'expense_account_code', 'cogs_sdg', 'cogs_usd', 'balance_sdg', 'balance_usd'];
      const taxAuditKeys=['id','configuration_id','revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active','reason','operation_id'];
      const auditFields=isTaxConfiguration?[...auditKeys,...taxAuditKeys]:auditKeys;
      const previousState = Object.fromEntries(changes.filter(change => beforeValues.has(change.path)).map(change => [change.path, pick(beforeValues.get(change.path)!, auditFields)]));
      const newState = Object.fromEntries(changes.filter(change => !change.path.includes('/meta/')).map(change => [change.path, change.value ? pick(change.value, auditFields) : null]));
      const audit = {...(isEquity?{reauthentication:{auth_time:actor.authTime},owner_equity_evidence:{event_id:result.id,journal_id:result.journal_id,sequence:result.sequence,quote:result.quote}}:{}), ...(isTaxConfiguration?{reauthentication:{auth_time:actor.authTime},tax_configuration_evidence:{configuration_id:result.id,revision:result.revision,version_id:`${result.id}-r${result.revision}`}}:{}), ...(openingProof?{opening_evidence:openingProof,...(command.action==='opening.commit'?{reauthentication:{auth_time:actor.authTime}}:{})}:{}), ...(command.action==='period.reopen'?{reauthentication:{auth_time:actor.authTime}}:{}), ...(command.action==='settings.update' && Object.prototype.hasOwnProperty.call(data.updates,'period_lock_date')?{legacy_period_lock:{previous:settings.period_lock_date||null,new:data.updates.period_lock_date||null}}:{}), ...(command.action === 'correctionDocument.export' ? { event_type: 'DATA_EXPORT_CREATED', export_metadata: { format: 'pdf', document_type: result.document_type, document_id: result.document.id, source_id: result.source.id, schema_version: result.schema_version, record_count: 1 } } : {}), ...(command.action === 'operational.export' ? { export_metadata: { report: data.view, period: result.period, account_code: data.query?.accountCode || '', currency: data.query?.currency || 'SDG/USD' } } : {}), ...(command.action === 'payables.export' ? { export_metadata: { report: 'payables', period: result.period } } : {}), actor_role: role, reason: isEquity?result.input.reason:isOpening?result.reason:data.reason || '', cost_evidence: costEvidence, previous_state: previousState, new_state: newState, id: `audit-${command.operationId}`, org_id: orgId, actor_uid: actor.uid, actor_email: actor.email, action: command.action, entity_type: command.action.split('.')[0], entity_id: result.id || result.code || data.id || orgId, operation_id: command.operationId, created_at: iso, details: `عملية ${command.action}` };
      if(isOpening)ensure(new TextEncoder().encode(JSON.stringify(audit)).length<=650000,'حجم تدقيق الأرصدة يتجاوز حد المستند.',413);
      tx.set(`${root}/audit_logs/${audit.id}`, audit);
      const visible = changes.filter(c => {
        if (c.path === root || c.path.startsWith(`${root}/meta/`)) return true;
        const collection = c.path.split('/')[2];
        const feature = collection === 'inventory_movements' ? 'inventory_tracking' : ['accounts', 'journal_entries', ...fixedAssetCollections,...payableCollections, ...cashCollections, ...cashReconciliationCollections, ...salesCorrectionCollections, ...purchaseCorrectionCollections, ...periodCollections, ...openingCollections, ...equityCollections,...fxRevaluationCollections].includes(collection) ? 'accounting' : ['audit_logs','audit_archives'].includes(collection) ? 'audit_trail' : null;
        return c.path.startsWith(`${root}/`) && hasPermission(role, readPermissions[collection]) && (!feature || subscription.features[feature] === true);
      });
      const response = clean({ result, changes: visible });
      if(isOpening)ensure(new TextEncoder().encode(JSON.stringify(response)).length<=900000,'حجم نتيجة الأرصدة يتجاوز حد المستند الذري.',413);
      tx.set(operationPath, { actor_uid: actor.uid, fingerprint, response, status: 'completed', created_at: iso });
      return response;
    });
  }
}
