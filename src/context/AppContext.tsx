import type { OpeningInput } from '../domain/openingBalances';
import type { OpeningTerms } from '../domain/openingSources';
import type { OwnerEquityInput } from '../domain/ownerEquity';
import type { FxRevaluationInput } from '../domain/fxRevaluation';
import type { FixedAssetAction, FixedAssetPreview, FixedAssetPreviewRequest } from '../domain/fixedAssetPreview';
import type { AccountingPeriod } from '../domain/periodContracts';
import type { TaxConfiguration } from '../domain/taxConfiguration';
import type { ManagementDimension } from '../domain/managementDimensions';
import type { DimensionKind } from '../domain/managementDimensions';
import type { BudgetPlan } from '../domain/managementBudgets';
import type { RecurringCashSource, ScheduledCashSource } from '../domain/managementCashSources';
import type { ApprovalPolicy } from '../domain/approvalPolicies';
import { reauthenticateOwner, type OwnerAuthMethod } from '../services/ownerReauthentication';
import type { CorrectionDocument, CorrectionDocumentKind } from '../domain/correctionDocuments';
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { Customer, Product, Invoice, Supplier, PurchaseBill, SupplierPayment, Payment, Expense, MerchantSettings, Currency, InventoryMovement, Organization, OrgMember, OrgRole, Account, JournalEntry, OrganizationCounters, OrgSubscription } from '../types';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../types';
import { INITIAL_SETTINGS } from '../data/initialData';
import { auth, onAuthStateChanged, logout, checkRedirectResult, type User } from '../lib/firebase';
import { createDefaultSubscription } from '../lib/plans';
import { Operations, type Actor } from '../domain/operations';
import type { FinancialAccount } from '../domain/cashManagement';
import type { OperationalReportTypes, OperationalView, LedgerQuery, ReportPeriod } from '../domain/operationalReports';
import type { CostInput } from '../domain/inventoryCost';
import type { Change, Document } from '../domain/store';
import { api, operationId } from '../services/businessApi';
import { firebaseCommand, firebaseSnapshot, watchFirebaseRevision } from '../services/firebaseSync';
import { cloudOrganizations } from '../services/cloudOrganizations';
import { createGuestStore, guestActor, guestId } from '../services/guestStore';
import { readSnapshotCache, writeSnapshotCache } from '../services/snapshotCache';
import { hasPermission, type ActionType } from '../services/rbacService';
import type { MasterExportModule } from '../domain/masterExport';
import type { MasterImportInput } from '../domain/masterImport';
import type { HistoricalImportStageInput } from '../domain/historicalImportStaging';
import { getDefaultChartOfAccounts } from '../services/accountingService';
import { BusinessError } from '../domain/validation';
import { invoiceQuotaReached } from '../domain/subscriptions';

interface AppContextType {
  approvalPolicies: ApprovalPolicy[];
  saveApprovalPolicy:(data:Document,updating:boolean,expectedOrgId:string,requestId:string)=>Promise<ApprovalPolicy>;
  recurringCashSources:RecurringCashSource[];
  scheduledCashSources:ScheduledCashSource[];
  saveRecurringCashSource:(data:Document,updating:boolean,expectedOrgId:string,requestId:string)=>Promise<RecurringCashSource>;
  saveScheduledCashSource:(data:Document,updating:boolean,expectedOrgId:string,requestId:string)=>Promise<ScheduledCashSource>;
  budgets: BudgetPlan[];
  saveBudget:(data:Document,updating:boolean,expectedOrgId:string,requestId:string)=>Promise<BudgetPlan>;
  loadBudgetReport:(budgetId:string)=>Promise<Awaited<ReturnType<Operations['budgetReport']>>>;
  loadCashForecast:(input:{asOf?:string;days?:number})=>Promise<Awaited<ReturnType<Operations['cashForecastReport']>>>;
  loadAccountingHealth:(asOf?:string)=>Promise<Awaited<ReturnType<Operations['accountingHealth']>>>;
  loadAccountingAssistance:(asOf?:string)=>Promise<Awaited<ReturnType<Operations['accountingAssistance']>>>;
  loadOwnerFinancialSummary:(asOf?:string)=>Promise<Awaited<ReturnType<Operations['ownerFinancialSummary']>>>;
  branches: ManagementDimension[];
  costCenters: ManagementDimension[];
  projects: ManagementDimension[];
  saveDimension: (kind: DimensionKind, data: Document, updating: boolean, expectedOrgId: string, requestId: string) => Promise<ManagementDimension>;
  taxConfigurations: TaxConfiguration[];
  saveTaxConfiguration: (data: Document, updating: boolean, expectedOrgId: string, requestId: string) => Promise<TaxConfiguration>;
  loadTaxReport: (period: {start?:string;end?:string}) => Promise<Awaited<ReturnType<Operations['taxReports']>>>;
  loadBranchProfitAndLoss: (branchId:string, period:{start?:string;end?:string}) => Promise<Awaited<ReturnType<Operations['branchProfitAndLoss']>>>;
  loadProductProfitability: (period:{start?:string;end?:string}) => Promise<Awaited<ReturnType<Operations['productProfitability']>>>;
  loadCustomerProfitability: (period:{start?:string;end?:string}) => Promise<Awaited<ReturnType<Operations['customerProfitability']>>>;
  fixedAssets: Document[];
  fixedAssetDepreciations: Document[];
  previewFixedAsset: (request: FixedAssetPreviewRequest, expectedOrgId: string) => Promise<FixedAssetPreview>;
  saveFixedAsset: (action: FixedAssetAction, data: Document, expectedOrgId: string, requestId: string) => Promise<Document>;
  openingBatches: Document[];
  openingLots: Document[];
  openingSettlements: Document[];
  previewOpening: (request: {input: OpeningInput; terms: OpeningTerms[]}, expectedOrgId: string) => Promise<Awaited<ReturnType<Operations['openingPreview']>>>;
  saveOpening: (action: 'opening.commit' | 'openingSettlement.create', data: Document, expectedOrgId: string, requestId: string) => Promise<Document>;
  ownerEquityEvents: Document[];
  saveOwnerEquity: (data: OwnerEquityInput, expectedOrgId: string, requestId: string) => Promise<Document>;
  fxRevaluations: Document[];
  previewFxRevaluation: (data: FxRevaluationInput, expectedOrgId: string) => Promise<Awaited<ReturnType<Operations['fxRevaluationPreview']>>>;
  saveFxRevaluation: (data: FxRevaluationInput & {expected_quote_hash:string}, expectedOrgId: string, requestId: string) => Promise<Document>;
  accountingPeriods: AccountingPeriod[];
  loadAccountingPeriods: (periodId?: string) => Promise<Awaited<ReturnType<Operations['periodReports']>>>;
  saveAccountingPeriod: (action: 'period.create' | 'period.softClose' | 'period.close' | 'period.reopen', data: Document, expectedOrgId: string) => Promise<AccountingPeriod>;
  confirmOwnerReauthentication: (method: OwnerAuthMethod | 'local-demo', password?: string) => Promise<string>;
  exportCorrectionDocument: (kind: CorrectionDocumentKind, id: string) => Promise<CorrectionDocument>;
  currentUser: User | null;
  authLoading: boolean;
  syncError: string | null;
  dismissSyncError: () => void;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  lastSyncedAt: Date | null;
  settings: MerchantSettings;
  customers: Customer[];
  products: Product[];
  invoices: Invoice[];
  payments: Payment[];
  creditNotes: Document[];
  customerRefunds: Document[];
  createCreditNote: (data: Document) => Promise<Document>;
  refundCustomer: (data: Document) => Promise<Document>;
  expenses: Expense[];
  suppliers: Supplier[];
  purchaseBills: PurchaseBill[];
  supplierPayments: SupplierPayment[];
  purchaseReturns: Document[];
  supplierRefunds: Document[];
  returnPurchase: (data: Document) => Promise<Document>;
  refundSupplier: (data: Document) => Promise<Document>;
  saveSupplier: (data: Document, id?: string) => Promise<Supplier>;
  createPurchase: (data: Document) => Promise<PurchaseBill>;
  paySupplier: (data: Document) => Promise<SupplierPayment>;
  loadPayablesReport: (period: { start?: string; end?: string }, exporting?: boolean) => Promise<Awaited<ReturnType<Operations['payableReports']>>>;
  loadOperationalReport: <View extends OperationalView>(view: View, query: ReportPeriod & Partial<LedgerQuery>, exporting?: boolean) => Promise<OperationalReportTypes[View] & { organizationId: string; generatedAt: string; view: View }>;
  financialAccounts: FinancialAccount[];
  internalTransfers: Document[];
  saveFinancialAccount: (data: Document, id?: string) => Promise<FinancialAccount>;
  transferCash: (data: Document) => Promise<Document>;
  loadCashReconciliations: (asOf: string) => Promise<Awaited<ReturnType<Operations['cashReconciliationReports']>>>;
  saveBankReconciliation: (data: Document) => Promise<Document>;
  recordCashCount: (data: Document) => Promise<Document>;
  inventoryMovements: InventoryMovement[];
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  // Multi-Tenant SaaS & RBAC
  currentOrg: Organization | null;
  userOrgs: Organization[];
  userRole: OrgRole;
  memberStatus: 'active' | 'suspended' | 'unknown';
  orgMembers: OrgMember[];
  switchOrganization: (orgId: string) => Promise<void>;
  createNewOrg: (name: string) => Promise<Organization>;
  inviteMember: (email: string, role: OrgRole) => Promise<void>;
  updateMemberRole: (memberUid: string, role: OrgRole) => Promise<void>;
  removeMember: (memberUid: string) => Promise<void>;
  suspendMember: (memberUid: string) => Promise<void>;
  reactivateMember: (memberUid: string) => Promise<void>;
  isActionAllowed: (action: ActionType) => boolean;
  createMasterExport: (module: MasterExportModule) => Promise<{workbook_base64:string;mime_type:string;filename:string;record_count:number;masked_fields:string[]}>;
  createAccountingExport: (period:{start?:string;end?:string}) => Promise<{workbook_base64:string;mime_type:string;filename:string;record_count:number;line_count:number}>;
  exportPresets: Document[];
  dataTransferHistory: Document[];
  saveExportPreset: (input:{id?:string;name:string;kind:'company'|'accounting'|'master';module?:MasterExportModule;period?:{start?:string;end?:string}}) => Promise<Document>;
  deleteExportPreset: (id:string) => Promise<void>;
  createCompanyExport: (presetId?:string) => Promise<{json:string;filename:string;byte_size:number;collection_counts:Record<string,number>}>;
  stageHistoricalImport: (input: HistoricalImportStageInput, operationId: string) => Promise<Document>;
  stageMasterImport: (input: MasterImportInput) => Promise<Document>;
  largeImportJobs: Document[];
  requestLargeImport: (sessionId:string,duplicatePolicy:'skip'|'update') => Promise<Document>;
  cancelLargeImport: (id:string) => Promise<Document>;
  retryLargeImport: (id:string) => Promise<Document>;
  commitLargeImport: (id:string) => Promise<Document>;
  undoLargeImport: (id:string,reason:string) => Promise<Document>;
  // Actions
  updateSettings: (newSettings: Partial<MerchantSettings>, reason?: string, expectedOrgId?: string) => Promise<void>;
  addCustomer: (customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  addProduct: (product: Omit<Product, 'id' | 'created_at'> & CostInput) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  establishProductCost: (id: string, cost: CostInput, reason: string) => Promise<void>;
  receiveInventory: (id: string, quantity: number, cost: CostInput, reason: string, paymentMethod: string) => Promise<void>;
  activateAccountingV2: (reason: string) => Promise<void>;
  updateProductStock: (id: string, newStock: number, reason?: string, cost?: CostInput) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  createInvoice: (invoiceData: Omit<Invoice, 'id' | 'created_at' | 'updated_at'> & { credit_limit_override_reason?: string }) => Promise<Invoice>;
  updateInvoice: (id: string, updates: Partial<Invoice>) => Promise<void>;
  voidInvoice: (id: string, reason?: string) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  recordPayment: (paymentData: {
    invoice_id: string;
    amount: number;
    currency: Currency;
    payment_method: any;
    exchange_rate_used?: number;
    reference_number?: string;
    notes?: string;
    idempotency_key?: string;
  }) => Promise<Payment>;
  reconcileProductStock: (productId: string) => {
    isConsistent: boolean;
    currentStock: number;
    calculatedStock: number;
    difference: number;
  };
  addExpense: (expense: Omit<Expense, 'id' | 'created_at'>) => Promise<Expense>;
  deleteExpense: (id: string) => Promise<void>;
  // Usage Counters (Atomic)
  counters: OrganizationCounters;
  refreshCounters: () => Promise<void>;
  // Subscription Plan & Limits
  subscription: OrgSubscription;
  refreshSubscription: () => Promise<void>;
  updateSubscriptionPlan: (newPlan: string) => Promise<void>;
  // Pagination for List Views
  hasMoreInvoices: boolean;
  isLoadingMoreInvoices: boolean;
  loadMoreInvoices: () => Promise<void>;
  hasMoreCustomers: boolean;
  isLoadingMoreCustomers: boolean;
  loadMoreCustomers: () => Promise<void>;
  hasMoreProducts: boolean;
  isLoadingMoreProducts: boolean;
  loadMoreProducts: () => Promise<void>;
  hasMoreExpenses: boolean;
  isLoadingMoreExpenses: boolean;
  loadMoreExpenses: () => Promise<void>;
  hasMorePayments: boolean;
  isLoadingMorePayments: boolean;
  loadMorePayments: () => Promise<void>;
  hasMoreInventoryMovements: boolean;
  isLoadingMoreInventoryMovements: boolean;
  loadMoreInventoryMovements: () => Promise<void>;
  // Accounting & General Ledger
  accounts: Account[];
  journalEntries: JournalEntry[];
  addAccount: (account: Omit<Account, 'org_id' | 'created_at'>) => Promise<Account>;
  updateAccount: (code: string, updates: Partial<Account>) => Promise<void>;
  addJournalEntry: (entry: Omit<JournalEntry, 'id' | 'created_at' | 'org_id'> & { reason?: string }) => Promise<JournalEntry>;
  resetChartOfAccounts: () => Promise<void>;
  syncAllToCloud: () => Promise<boolean>;
  getNextInvoiceNumber: () => string;
  resetToSampleData: () => void;
  exportDataJson: () => Promise<string>;
  importDataJson: (jsonString: string) => Promise<boolean>;
  logoutUser: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
type Snapshot = Awaited<ReturnType<Operations['snapshot']>>;
const emptySnapshot = (): Snapshot => ({ schema_version: 3, org: null as unknown as Organization, role: 'Viewer', member: undefined, settings: INITIAL_SETTINGS, collections: {}, counters: { ...DEFAULT_ORGANIZATION_COUNTERS }, subscription: createDefaultSubscription(''), exported_at: '' });

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [state, setState] = useState<Snapshot>(emptySnapshot);
  const [userOrgs, setUserOrgs] = useState<Organization[]>([]);
  const [syncStatus, setSyncStatus] = useState<AppContextType['syncStatus']>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('hisabuk_theme') === 'dark' ? 'dark' : 'light');
  const guestOwnerAuthAt = useRef<number | undefined>(undefined);
  const session = useRef(0), snapshot = useRef(state), userRef = useRef<User | null>(null), guest = useRef<Operations | null>(null);
  const activeOrg = useRef<string | null>(null), queue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRefresh = useRef(false), confirmedRevision = useRef(-1), revisionWatch = useRef<(() => void) | null>(null);
  const fail = (error: unknown) => { setSyncStatus('error'); setSyncError(error instanceof Error ? error.message : 'تعذر إكمال العملية.'); };
  const apply = (next: Snapshot) => { snapshot.current = next; setState(next); };
  const actor = (): Actor => ({ uid: userRef.current?.uid || 'guest', email: userRef.current?.email || '', emailVerified: userRef.current?.emailVerified || false });
  const getGuest = () => { if (!guest.current) guest.current = new Operations(createGuestStore(), undefined, saved => saved as OrgSubscription); return guest.current; };
  const cacheConfirmedSnapshot = (next: Snapshot, savedAt = new Date()) => {
    const user = userRef.current;
    if (!user || !next.org?.id || next.org.id === guestId) return;
    writeSnapshotCache(localStorage, user.uid, next.org.id, next, savedAt);
  };
  const refresh = async (id = activeOrg.current, epoch = session.current) => {
    if (!id) throw new BusinessError('اختر مؤسسة أولاً.');
    const loaded = id === guestId && !userRef.current ? await getGuest().snapshot(id, guestActor) : await firebaseSnapshot(id);
    if (epoch !== session.current || id !== activeOrg.current) return;
    const loadedRevision = Number(loaded.counters.revision || 0);
    // Only server-confirmed revisions participate in ordering. A cached snapshot is display-only
    // and can never block a fresher authoritative response.
    if (loadedRevision < confirmedRevision.current) return;
    if (!(loaded.collections.accounts || []).length) loaded.collections.accounts = getDefaultChartOfAccounts(id);
    confirmedRevision.current = loadedRevision;
    apply(loaded);
    if (id !== guestId) cacheConfirmedSnapshot(loaded);
    setSyncStatus(id === guestId ? 'idle' : 'synced'); setSyncError(null); setLastSyncedAt(id === guestId ? null : new Date());
    startRevisionWatch(id, epoch);
  };
  const startRevisionWatch = (id: string, epoch: number) => {
    if (revisionWatch.current || id === guestId || !userRef.current || epoch !== session.current) return;
    let monitoringFailed = false;
    revisionWatch.current = watchFirebaseRevision(
      id,
      revision => {
        if (epoch !== session.current || activeOrg.current !== id || (revision <= confirmedRevision.current && !monitoringFailed) || pendingRefresh.current) return;
        pendingRefresh.current = true;
        void refresh(id, epoch)
          .then(() => { monitoringFailed = false; })
          .catch(error => { if (epoch === session.current && activeOrg.current === id) { monitoringFailed = true; fail(error); } })
          .finally(() => { pendingRefresh.current = false; });
      },
      () => {
        if (epoch !== session.current || activeOrg.current !== id) return;
        monitoringFailed = true;
        // A denied/broken notification stream does not imply the confirmed API is unavailable.
        // Reconcile immediately; periodic API reads keep recovering the failed stream.
        if (pendingRefresh.current) return;
        pendingRefresh.current = true;
        void refresh(id, epoch).then(() => { monitoringFailed = false; })
          .catch(error => { if (epoch === session.current && activeOrg.current === id) fail(error); })
          .finally(() => { pendingRefresh.current = false; });
      },
    );
  };
  const load = async (org: Organization) => {
    revisionWatch.current?.(); revisionWatch.current = null;
    const epoch = ++session.current;
    activeOrg.current = org.id;
    confirmedRevision.current = -1;
    const user = userRef.current;
    const cached = user && org.id !== guestId ? readSnapshotCache<Snapshot>(localStorage, user.uid, org.id) : null;
    if (cached) {
      apply(cached.snapshot);
      setSyncStatus('syncing');
      setSyncError(null);
      setLastSyncedAt(cached.savedAt);
      // Cached data is already authenticated to this user+organization key. Let the UI render
      // immediately while the server snapshot is being reconciled in the background.
      setAuthLoading(false);
    } else {
      apply({ ...emptySnapshot(), org, role: org.owner_uid === userRef.current?.uid ? 'Owner' : 'Viewer' }); setSyncStatus('syncing'); setSyncError(null); setLastSyncedAt(null);
    }
    try {
      await refresh(org.id, epoch);
      if (epoch === session.current && userRef.current) {
        localStorage.setItem(`sudaflow_active_org_${userRef.current.uid}`, org.id);
      }
    } catch (error) { if (epoch === session.current) fail(error); throw error; }
  };
  const initializeCloudOrganization = async (user: User, epoch = session.current) => {
    try {
      let orgs = await cloudOrganizations();
      if (epoch !== session.current || userRef.current?.uid !== user.uid) return;
      if (!orgs.length) {
        const orgName = user.displayName?.trim() ? `مؤسسة ${user.displayName.trim()}` : 'مؤسستي التجارية';
        const created = await api<Organization>('/organizations', { method: 'POST', body: JSON.stringify({ initial: true, operationId: 'initial', name: orgName, settings: INITIAL_SETTINGS }) });
        orgs = [created];
      }
      if (epoch !== session.current || userRef.current?.uid !== user.uid) return;
      setUserOrgs(orgs);
      const saved = localStorage.getItem(`sudaflow_active_org_${user.uid}`) || localStorage.getItem('hisabuk_active_org_id');
      await load(orgs.find(o => o.id === saved) || orgs[0]);
    } catch (error) {
      console.warn('Initial cloud organization load warning:', error);
      if (epoch !== session.current || userRef.current?.uid !== user.uid) return;
      // Organization discovery is an authority boundary. Never invent a tenant ID when
      // the server is unavailable: keep the authenticated shell visible, surface the
      // original failure, and let the existing online/focus/interval reconciler retry.
      activeOrg.current = null;
      setUserOrgs([]);
      fail(error);
    }
  };
  useEffect(() => {
    checkRedirectResult().catch(() => {});
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.sfTheme = theme;
    localStorage.setItem('hisabuk_theme', theme);
  }, [theme]);
  useEffect(() => onAuthStateChanged(auth, async user => {
    const epoch = ++session.current;
    revisionWatch.current?.(); revisionWatch.current = null;
    userRef.current = user; setCurrentUser(user); activeOrg.current = null; confirmedRevision.current = -1; apply(emptySnapshot()); setUserOrgs([]); setAuthLoading(true); setSyncError(null);
    try {
      const isGoogleUser = user?.providerData?.some(p => p.providerId === 'google.com') || false;
      const isVerified = Boolean(user?.emailVerified || isGoogleUser);
      if (user && !isVerified) {
        setSyncStatus('idle');
        setSyncError('أكّد بريدك الإلكتروني أولاً عبر الرابط المرسل لبريدك الإلكتروني، ثم سجّل الدخول.');
        void logout();
        userRef.current = null; setCurrentUser(null);
        setAuthLoading(false);
        return;
      }
      if (!user) {
        const loaded = await getGuest().snapshot(guestId, guestActor);
        if (epoch !== session.current) return;
        activeOrg.current = guestId; apply(loaded); setUserOrgs([loaded.org]); setSyncStatus('idle');
      } else {
        if (window.location.pathname === '/super-admin' || window.location.pathname.startsWith('/super-admin/')) { setSyncStatus('idle'); return; }
        await initializeCloudOrganization(user, epoch);
      }
    } catch (error) { if (userRef.current?.uid === user?.uid) fail(error); }
    finally { if (userRef.current?.uid === user?.uid) setAuthLoading(false); }
  }), []);
  // Realtime notifications plus periodic reconciliation recover missed revisions and stream outages.
  useEffect(() => {
    const reconcile = () => {
      const user = userRef.current, epoch = session.current;
      if (!user || pendingRefresh.current || document.visibilityState !== 'visible' || window.location.pathname.startsWith('/super-admin')) return;
      pendingRefresh.current = true;
      const work = activeOrg.current ? refresh() : initializeCloudOrganization(user, epoch);
      void work.catch(error => { if (epoch === session.current && userRef.current?.uid === user.uid) fail(error); }).finally(() => { pendingRefresh.current = false; });
    };
    const interval = window.setInterval(reconcile, 30000);
    window.addEventListener('focus', reconcile); window.addEventListener('online', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', reconcile); window.removeEventListener('online', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
      revisionWatch.current?.(); revisionWatch.current = null;
    };
  }, []);
  const applyChanges = (changes: Change[]) => {
    const next = { ...snapshot.current, collections: { ...snapshot.current.collections } };
    for (const change of changes) {
      const parts = change.path.split('/');
      if (parts.length === 2) { next.org = change.value as Organization; next.settings = next.org.settings; continue; }
      const collection = parts[2], id = parts[3];
      if (collection === 'meta') { if (id === 'counters') next.counters = change.value as Snapshot['counters']; else if (id === 'subscription') next.subscription = change.value as OrgSubscription; continue; }
      const rows = (next.collections[collection] || []).filter(row => (row.id || row.code || row.uid) !== id);
      next.collections[collection] = change.value ? [change.value, ...rows] : rows;
    }
    confirmedRevision.current = Math.max(confirmedRevision.current, Number(next.counters.revision || 0));
    apply(next);
    cacheConfirmedSnapshot(next);
  };
  const run = <T extends Document = Document>(action: string, data: Document, suggestedId?: string): Promise<T> => {
    const epoch = session.current, id = activeOrg.current, activeUser = userRef.current;
    const work = queue.current.then(async () => {
      if (!id || epoch !== session.current || snapshot.current.role === 'Viewer') throw new BusinessError('المؤسسة لم تُحمّل أو صلاحية الكتابة غير متاحة.', 403);
      setSyncStatus('syncing'); setSyncError(null);
      try {
        const response = !activeUser && id === guestId ? await getGuest().execute(id, { ...guestActor, authTime: guestOwnerAuthAt.current }, { action, operationId: suggestedId || operationId(), data }) : await firebaseCommand(id, action, data, suggestedId);
        if (epoch !== session.current) throw new BusinessError('تم حفظ العملية في المؤسسة السابقة. تغيّرت الجلسة؛ أعد تحميل المؤسسة لمشاهدتها.', 409);
        applyChanges(response.changes);
        setSyncStatus(id === guestId ? 'idle' : 'synced'); setLastSyncedAt(id === guestId ? null : new Date());
        return response.result as T;
      } catch (error) { if (epoch === session.current) fail(error); throw error; }
    });
    queue.current = work.catch(() => undefined);
    return work;
  };
  const rows = <T,>(name: string): T[] => (state.collections[name] || []) as T[];
  const customers = rows<Customer>('customers'), products = rows<Product>('products'), invoices = rows<Invoice>('invoices'), payments = rows<Payment>('payments');
  const expenses = rows<Expense>('expenses').filter(e => !e.voided_at), inventoryMovements = rows<InventoryMovement>('inventory_movements');
  const accounts = rows<Account>('accounts'), journalEntries = rows<JournalEntry>('journal_entries');
  const isActionAllowed = (action: ActionType) => {
    if (!state.org || !state.exported_at || !hasPermission(state.role, action)) return false;
    const status = state.subscription.effective_status || state.subscription.status;
    const active = state.org.status === 'active' && ['active', 'trial', 'trialing'].includes(status) && (!state.subscription.subscription_end || Date.parse(state.subscription.subscription_end) > Date.now());
    const sensitive = ['payables:read', 'audit_logs:view', 'journal:read', 'accounts:read', 'periods:read'];
    const readOnly = action.endsWith(':read') || action === 'members:view';
    if (!active && (!readOnly || sensitive.includes(action))) return false;
    const features: Partial<Record<ActionType, string>> = { 'tax:read': 'accounting', 'tax:manage': 'accounting', 'equity:write': 'accounting', 'opening:preview': 'accounting', 'opening:write': 'accounting', 'opening:settle': 'accounting', 'periods:read': 'accounting', 'periods:manage': 'accounting', 'periods:adjust': 'accounting', 'periods:reopen': 'accounting', 'payables:read': 'accounting', 'payables:write': 'accounting', 'reports:advanced': 'advanced_reports', 'products:stock_adjustment': 'inventory_tracking', 'audit_logs:view': 'audit_trail', 'journal:create': 'accounting', 'journal:read': 'accounting', 'accounts:create': 'accounting', 'accounts:update': 'accounting', 'accounts:read': 'accounting', 'export:company': 'accounting' };
    if (features[action] && state.subscription.features[features[action]!] !== true) return false;
    if (action === 'invoices:create' && invoiceQuotaReached(state.subscription, state.counters.lifetime_invoice_count || state.counters.invoice_count, state.counters.monthly_invoice_count || 0)) return false;
    return true;
  };
  const switchOrganization = async (id: string) => {
    const orgs = await cloudOrganizations(); setUserOrgs(orgs);
    const org = orgs.find(o => o.id === id); if (!org) throw new BusinessError('عضوية المؤسسة غير متاحة.', 403);
    await load(org);
  };
  const createNewOrg = async (name: string) => {
    const org = await api<Organization>('/organizations', { method: 'POST', body: JSON.stringify({ name, settings: INITIAL_SETTINGS, initial: false, operationId: operationId() }) });
    setUserOrgs(prev => [...prev, org]); await load(org); return org;
  };
  const syncAllToCloud = async () => {
    const user = userRef.current, epoch = session.current;
    try {
      setSyncStatus('syncing');
      if (user && !activeOrg.current) await initializeCloudOrganization(user, epoch);
      else await refresh();
      return userRef.current?.uid === user?.uid;
    } catch (error) { if (epoch === session.current && userRef.current?.uid === user?.uid) fail(error); return false; }
  };
  const reconcileProductStock = (id: string) => {
    const product = products.find(p => p.id === id), movements = inventoryMovements.filter(m => m.product_id === id);
    const opening = movements.some(m => m.type === 'OPENING_BALANCE') ? 0 : [...movements].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.previous_stock || 0;
    const calculatedStock = movements.reduce((sum, m) => sum + m.quantity, opening), currentStock = product?.stock_quantity || 0;
    return { isConsistent: Math.abs(currentStock - calculatedStock) < 0.000001, currentStock, calculatedStock, difference: currentStock - calculatedStock };
  };
  const exportDataJson = async () => {
    const id = activeOrg.current; if (!id) throw new BusinessError('اختر مؤسسة أولاً.');
    const full = id === guestId ? await getGuest().snapshot(id, guestActor, true) : await firebaseSnapshot(id, true);
    return JSON.stringify(full, null, 2);
  };
  const createCompanyExport = async (presetId?:string) => {
    const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('اختر مؤسسة أولاً.');
    if(snapshot.current.role!=='Owner'||snapshot.current.org.owner_uid!==(userRef.current?.uid||guestActor.uid))throw new BusinessError('تصدير الشركة الكامل متاح لمالك المؤسسة الفعلي فقط.',403);
    const full=id===guestId?await getGuest().snapshot(id,guestActor,true):await firebaseSnapshot(id,true);
    if(id!==activeOrg.current||epoch!==session.current)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ أعد التصدير.',409);
    const json=JSON.stringify(full,null,2),byte_size=new TextEncoder().encode(json).length; if(byte_size>900000)throw new BusinessError('التصدير المباشر الكامل محدود بـ900KB؛ استخدم مهمة التصدير الكبيرة.',413);
    const collection_counts=Object.fromEntries(Object.entries(full.collections).map(([name,records])=>[name,(records as Document[]).length])),filename=`sudaflow-company-${id}-${new Date().toISOString().slice(0,10)}.json`;
    await run('companyExport.record',{schema_version:3,byte_size,collection_counts,filename,...presetId?{preset_id:presetId}:{}});return{json,filename,byte_size,collection_counts};
  };
  const importDataJson = async (json: string) => { await run('backup.restore', { backup: JSON.parse(json) }); await refresh(); return true; };
  const nothing = async () => {};
  const value: AppContextType = {
    taxConfigurations: rows<TaxConfiguration>('tax_configurations'),
    saveTaxConfiguration: (data, updating, expectedOrgId, requestId) => activeOrg.current === expectedOrgId
      ? run<TaxConfiguration>(updating ? 'taxConfiguration.update' : 'taxConfiguration.create', data, requestId)
      : Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح إعداد الضريبة.', 409)),
    loadTaxReport: async period => {
      const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');
      const params=new URLSearchParams();if(period.start)params.set('start',period.start);if(period.end)params.set('end',period.end);
      const report=id===guestId&&!userRef.current?await getGuest().taxReports(id,guestActor,period):await api<Awaited<ReturnType<Operations['taxReports']>>>(`/organizations/${encodeURIComponent(id)}/reports/tax?${params}`);
      if(id!==activeOrg.current||epoch!==session.current||report.organizationId!==id)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدث تقرير الضريبة.',409);return report;
    },
    fixedAssets: rows<Document>('fixed_assets'), fixedAssetDepreciations: rows<Document>('fixed_asset_depreciations'),
    previewFixedAsset: async (request, expectedOrgId) => {
      const id = activeOrg.current, epoch = session.current;
      if (!id || id !== expectedOrgId) throw new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.', 409);
      const preview = id === guestId && !userRef.current ? await getGuest().fixedAssetPreview(id, guestActor, request) : await api<FixedAssetPreview>(`/organizations/${encodeURIComponent(id)}/fixed-assets/preview`, {method: 'POST', body: JSON.stringify(request)});
      if (id !== activeOrg.current || epoch !== session.current || preview.organizationId !== id) throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ أعد المعاينة.', 409);
      return preview;
    },
    saveFixedAsset: (action, data, expectedOrgId, requestId) => activeOrg.current === expectedOrgId ? run(action, data, requestId) : Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.', 409)),
    openingBatches: rows<Document>('opening_batches'), openingLots: rows<Document>('opening_lots'), openingSettlements: rows<Document>('opening_settlements'),
    ownerEquityEvents: rows<Document>('owner_equity_events'), fxRevaluations: rows<Document>('fx_revaluations'),
    previewOpening: async (request, expectedOrgId) => {
      const id = activeOrg.current, epoch = session.current;
      if (!id || id !== expectedOrgId) throw new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.', 409);
      const preview = id === guestId && !userRef.current ? await getGuest().openingPreview(id, guestActor, request) : await api<Awaited<ReturnType<Operations['openingPreview']>>>(`/organizations/${encodeURIComponent(id)}/opening-balances/preview`, {method: 'POST', body: JSON.stringify(request)});
      if (id !== activeOrg.current || epoch !== session.current) throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ أعد المعاينة.', 409);
      return preview;
    },
    saveOpening: (action, data, expectedOrgId, requestId) => {
      if (activeOrg.current !== expectedOrgId) return Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.', 409));
      return run(action, data, requestId);
    },
    saveOwnerEquity: (data, expectedOrgId, requestId) => {
      if (activeOrg.current !== expectedOrgId) return Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.', 409));
      return run('ownerEquity.create', data, requestId);
    },
    previewFxRevaluation: async(data,expectedOrgId)=>{
      const id=activeOrg.current,epoch=session.current;if(!id||id!==expectedOrgId)throw new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.',409);
      const preview=id===guestId&&!userRef.current?await getGuest().fxRevaluationPreview(id,guestActor,data):await api<Awaited<ReturnType<Operations['fxRevaluationPreview']>>>(`/organizations/${encodeURIComponent(id)}/fx-revaluations/preview`,{method:'POST',body:JSON.stringify(data)});
      if(id!==activeOrg.current||epoch!==session.current)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ أعد المعاينة.',409);return preview;
    },
    saveFxRevaluation:(data,expectedOrgId,requestId)=>activeOrg.current===expectedOrgId?run('fxRevaluation.create',data,requestId):Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.',409)),
    accountingPeriods: rows<AccountingPeriod>('accounting_periods'),
    loadAccountingPeriods: async periodId => {
      const id = activeOrg.current, epoch = session.current; if (!id) throw new BusinessError('المؤسسة غير متاحة.');
      const report = id === guestId && !userRef.current ? await getGuest().periodReports(id, guestActor, periodId) : await api<Awaited<ReturnType<Operations['periodReports']>>>(`/organizations/${encodeURIComponent(id)}/accounting-periods${periodId ? '?periodId=' + encodeURIComponent(periodId) : ''}`);
      if (id !== activeOrg.current || epoch !== session.current) throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدث البيانات.', 409);
      return report;
    },
    saveAccountingPeriod: (action, data, expectedOrgId) => {
      if (activeOrg.current !== expectedOrgId) return Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.', 409));
      return run<AccountingPeriod>(action, data);
    },
    confirmOwnerReauthentication: async (method, password) => {
      const id = activeOrg.current, epoch = session.current, uid = userRef.current?.uid;
      if (!id || snapshot.current.role !== 'Owner' || !isActionAllowed('org:update_settings')) throw new BusinessError('إعادة الفتح متاحة لمالك المؤسسة فقط.', 403);
      if (!uid && id === guestId && method === 'local-demo') guestOwnerAuthAt.current = Math.floor(Date.now() / 1000);
      else {
        if (method === 'local-demo') throw new BusinessError('التأكيد المحلي لا يصلح للحساب السحابي.', 403);
        await reauthenticateOwner(method, password, uid || '');
      }
      if (id !== activeOrg.current || epoch !== session.current || uid !== userRef.current?.uid) throw new BusinessError('تغيرت المؤسسة أو الجلسة أثناء التحقق.', 409);
      return id;
    },
    exportCorrectionDocument: (kind, id) => run<CorrectionDocument>('correctionDocument.export', { kind, id }),
    currentUser, authLoading, syncStatus, syncError, dismissSyncError: () => setSyncError(null), lastSyncedAt,
    currentOrg: state.org, userOrgs, userRole: state.role, memberStatus: state.exported_at ? state.member?.status || (state.role === 'Owner' ? 'active' : 'unknown') : 'unknown', orgMembers: rows<OrgMember>('members'),
    settings: state.settings, customers, products, invoices, payments, expenses, inventoryMovements, accounts, journalEntries,
    branches: rows<ManagementDimension>('branches'), costCenters: rows<ManagementDimension>('cost_centers'), projects: rows<ManagementDimension>('projects'),
    budgets:rows<BudgetPlan>('budgets'),
    approvalPolicies:rows<ApprovalPolicy>('approval_policies'),
    saveApprovalPolicy:(data,updating,expectedOrgId,requestId)=>activeOrg.current===expectedOrgId?run<ApprovalPolicy>(updating?'approvalPolicy.update':'approvalPolicy.create',data,requestId):Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح سياسة الاعتماد.',409)),
    recurringCashSources:rows<RecurringCashSource>('recurring_cash_sources'),scheduledCashSources:rows<ScheduledCashSource>('scheduled_cash_sources'),
    saveRecurringCashSource:(data,updating,expectedOrgId,requestId)=>activeOrg.current===expectedOrgId?run<RecurringCashSource>(updating?'recurringCashSource.update':'recurringCashSource.create',data,requestId):Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح مصدر التوقع.',409)),
    saveScheduledCashSource:(data,updating,expectedOrgId,requestId)=>activeOrg.current===expectedOrgId?run<ScheduledCashSource>(updating?'scheduledCashSource.update':'scheduledCashSource.create',data,requestId):Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح مصدر التوقع.',409)),
    saveBudget:(data,updating,expectedOrgId,requestId)=>activeOrg.current===expectedOrgId?run<BudgetPlan>(updating?'budget.update':'budget.create',data,requestId):Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح الميزانية.',409)),
    loadBudgetReport:async budgetId=>{const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');const value=id===guestId&&!userRef.current?await getGuest().budgetReport(id,guestActor,budgetId):await api<Awaited<ReturnType<Operations['budgetReport']>>>(`/organizations/${encodeURIComponent(id)}/reports/budget-vs-actual?budgetId=${encodeURIComponent(budgetId)}`);if(id!==activeOrg.current||epoch!==session.current)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدّث التقرير.',409);return value;},
    loadCashForecast:async input=>{const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');const params=new URLSearchParams({...input.asOf?{asOf:input.asOf}:{},...input.days?{days:String(input.days)}:{}}),value=id===guestId&&!userRef.current?await getGuest().cashForecastReport(id,guestActor,input):await api<Awaited<ReturnType<Operations['cashForecastReport']>>>(`/organizations/${encodeURIComponent(id)}/reports/cash-forecast?${params}`);if(id!==activeOrg.current||epoch!==session.current)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدّث التوقع.',409);return value;},
    loadAccountingHealth:async asOf=>{const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');const params=new URLSearchParams(asOf?{asOf}:{}),value=id===guestId&&!userRef.current?await getGuest().accountingHealth(id,guestActor,asOf):await api<Awaited<ReturnType<Operations['accountingHealth']>>>(`/organizations/${encodeURIComponent(id)}/reports/accounting-health?${params}`);if(id!==activeOrg.current||epoch!==session.current||value.organizationId!==id)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدّث مركز الصحة.',409);return value;},
    loadAccountingAssistance:async asOf=>{const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');const params=new URLSearchParams(asOf?{asOf}:{}),value=id===guestId&&!userRef.current?await getGuest().accountingAssistance(id,guestActor,asOf):await api<Awaited<ReturnType<Operations['accountingAssistance']>>>(`/organizations/${encodeURIComponent(id)}/reports/accounting-assistance?${params}`);if(id!==activeOrg.current||epoch!==session.current||value.organizationId!==id)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدّث مساعد المحاسبة.',409);return value;},
    loadOwnerFinancialSummary:async asOf=>{const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');const params=new URLSearchParams(asOf?{asOf}:{}),value=id===guestId&&!userRef.current?await getGuest().ownerFinancialSummary(id,guestActor,asOf):await api<Awaited<ReturnType<Operations['ownerFinancialSummary']>>>(`/organizations/${encodeURIComponent(id)}/reports/owner-financial-summary?${params}`);if(id!==activeOrg.current||epoch!==session.current||value.organizationId!==id)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدّث ملخص المالك.',409);return value;},
    saveDimension: (kind, data, updating, expectedOrgId, requestId) => {
      if (activeOrg.current !== expectedOrgId) return Promise.reject(new BusinessError('تغيرت المؤسسة؛ أعد فتح إدارة الأبعاد.', 409));
      return run<ManagementDimension>(updating ? 'dimension.update' : 'dimension.create', { ...data, kind }, requestId);
    },
    loadBranchProfitAndLoss: async (branchId, period) => {
      const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');
      const params=new URLSearchParams({branchId,...(period.start?{start:period.start}:{}),...(period.end?{end:period.end}:{})});
      const report=id===guestId&&!userRef.current?await getGuest().branchProfitAndLoss(id,guestActor,branchId,period):await api<Awaited<ReturnType<Operations['branchProfitAndLoss']>>>(`/organizations/${encodeURIComponent(id)}/reports/branch-profit-loss?${params}`);
      if(id!==activeOrg.current||epoch!==session.current)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدّث التقرير.',409);return report;
    },
    loadProductProfitability: async period => {
      const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');
      const params=new URLSearchParams({...period.start?{start:period.start}:{},...period.end?{end:period.end}:{}});
      const report=id===guestId&&!userRef.current?await getGuest().productProfitability(id,guestActor,period):await api<Awaited<ReturnType<Operations['productProfitability']>>>(`/organizations/${encodeURIComponent(id)}/reports/product-profitability?${params}`);
      if(id!==activeOrg.current||epoch!==session.current)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدّث التقرير.',409);return report;
    },
    loadCustomerProfitability: async period => {
      const id=activeOrg.current,epoch=session.current;if(!id)throw new BusinessError('المؤسسة غير متاحة.');
      const params=new URLSearchParams({...period.start?{start:period.start}:{},...period.end?{end:period.end}:{}});
      const report=id===guestId&&!userRef.current?await getGuest().customerProfitability(id,guestActor,period):await api<Awaited<ReturnType<Operations['customerProfitability']>>>(`/organizations/${encodeURIComponent(id)}/reports/customer-profitability?${params}`);
      if(id!==activeOrg.current||epoch!==session.current)throw new BusinessError('تغيرت المؤسسة أو الجلسة؛ حدّث التقرير.',409);return report;
    },
    creditNotes: rows<Document>('credit_notes'), customerRefunds: rows<Document>('customer_refunds'),
    createCreditNote: data => run('creditNote.create', data), refundCustomer: data => run('customerRefund.create', data),
    suppliers: rows<Supplier>('suppliers'), purchaseBills: rows<PurchaseBill>('purchase_bills'), supplierPayments: rows<SupplierPayment>('supplier_payments'), purchaseReturns: rows<Document>('purchase_returns'), supplierRefunds: rows<Document>('supplier_refunds'), returnPurchase: data => run<Document>('purchaseReturn.create',data), refundSupplier: data => run<Document>('supplierRefund.create',data),
    saveSupplier: (data, id) => run<Supplier>(id ? 'supplier.update' : 'supplier.create', id ? { id, updates: data } : data),
    createPurchase: data => run<PurchaseBill>('purchase.create', data), paySupplier: data => run<SupplierPayment>('supplierPayment.create', data),
    loadPayablesReport: async (period, exporting = false) => {
      const id = activeOrg.current; if (!id) throw new BusinessError('المؤسسة غير متاحة.');
      if (exporting) return run('payables.export', { period }) as Promise<Awaited<ReturnType<Operations['payableReports']>>>;
      return id === guestId && !userRef.current ? getGuest().payableReports(id, guestActor, period) : api(`/organizations/${encodeURIComponent(id)}/reports/payables?start=${encodeURIComponent(period.start || '')}&end=${encodeURIComponent(period.end || '')}`);
    },
    loadOperationalReport: async (view, query, exporting = false) => {
      const id = activeOrg.current; if (!id) throw new BusinessError('المؤسسة غير متاحة.');
      if (exporting) return run('operational.export', { view, query });
      const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, value!]));
      return id === guestId && !userRef.current ? getGuest().operationalReport(id, guestActor, view, query) : api(`/organizations/${encodeURIComponent(id)}/reports/${view}?${params}`);
    },
    financialAccounts: rows<FinancialAccount>('financial_accounts'), internalTransfers: rows<Document>('internal_transfers'),
    saveFinancialAccount: (data, id) => run<FinancialAccount>(id ? 'financialAccount.update' : 'financialAccount.create', id ? { id, updates: data } : data),
    transferCash: data => run('cashTransfer.create', data),
    loadCashReconciliations: async asOf => {
      const id = activeOrg.current; if (!id) throw new BusinessError('المؤسسة غير متاحة.');
      return id === guestId && !userRef.current ? getGuest().cashReconciliationReports(id, guestActor, asOf) : api(`/organizations/${encodeURIComponent(id)}/reports/reconciliations?asOf=${encodeURIComponent(asOf)}`);
    },
    saveBankReconciliation: data => run('bankReconciliation.create', data),
    recordCashCount: data => run('cashCount.create', data),
    counters: state.counters, subscription: state.subscription as OrgSubscription, theme, setTheme, toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light'),
    isActionAllowed, createMasterExport: module => run('masterExport.create',{module}), createAccountingExport:period=>run('accountingExport.create',{period}),
    exportPresets:rows<Document>('export_presets'),dataTransferHistory:rows<Document>('audit_logs').filter(row=>['DATA_EXPORT_CREATED','DATA_IMPORT_STARTED'].includes(row.event_type)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))),
    saveExportPreset:input=>run('exportPreset.save',input),deleteExportPreset:async id=>{await run('exportPreset.delete',{id});},createCompanyExport,
    stageHistoricalImport: async (input, id) => {
      if (!userRef.current || activeOrg.current === guestId) throw new BusinessError('الاستيراد التاريخي المحمي يتطلب خدمة الخادم وحساباً مسجلاً؛ وضع الضيف للمراجعة فقط.', 403, 'accounting_server_required');
      return run('historicalImport.stage', input as unknown as Document, id);
    },
    stageMasterImport: input => run('masterImport.stage',input as unknown as Document),
    largeImportJobs:rows<Document>('large_import_jobs').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))),
    requestLargeImport:(sessionId,duplicatePolicy)=>run('largeImport.request',{session_id:sessionId,reviewed:true,duplicate_policy:duplicatePolicy}),
    cancelLargeImport:id=>run('largeImport.cancel',{id}),retryLargeImport:id=>run('largeImport.retry',{id}),commitLargeImport:id=>run('largeImport.commit',{id}),undoLargeImport:(id,reason)=>run('largeImport.undo',{id,reason}), switchOrganization, createNewOrg,
    inviteMember: async (email, role) => { await run('invitation.create', { email, role }); },
    updateMemberRole: async (uid, role) => { await run('member.update', { uid, role }); },
    removeMember: async uid => { await run('member.remove', { uid }); },
    suspendMember: async uid => { await run('member.update', { uid, status: 'suspended' }); },
    reactivateMember: async uid => { await run('member.update', { uid, status: 'active' }); },
    updateSettings: async (updates, reason, expectedOrgId) => { if (expectedOrgId && activeOrg.current !== expectedOrgId) throw new BusinessError('تغيرت المؤسسة؛ أعد فتح العملية.', 409); await run('settings.update', { updates, ...(reason === undefined ? {} : { reason }) }); },
    addCustomer: data => run<Customer>('customer.create', data), updateCustomer: async (id, updates) => { await run('customer.update', { id, updates }); }, deleteCustomer: async id => { await run('customer.delete', { id }); },
    addProduct: data => run<Product>('product.create', data), updateProduct: async (id, updates) => { await run('product.update', { id, updates }); }, deleteProduct: async id => { await run('product.delete', { id }); },
    establishProductCost: async (id, cost, reason) => { await run('product.cost.establish', { id, ...cost, reason }); },
    receiveInventory: async (id, quantity, cost, reason, paymentMethod) => { await run('inventory.receive', { id, quantity, ...cost, reason, payment_method: paymentMethod }); },
    activateAccountingV2: async reason => { await run('accounting.activate', { reason }); },
    updateProductStock: async (id, newStock, reason, cost) => { await run('product.stock', { id, newStock, ...(cost || {}), reason: reason || 'تسوية جرد' }); },
    createInvoice: data => { const { operation_id, ...payload } = data; return run<Invoice>('invoice.create', payload, operation_id); },
    updateInvoice: async (id, updates) => { await run('invoice.update', { id, updates }); }, voidInvoice: async (id, reason) => { await run('invoice.void', { id, reason: reason || 'إبطال الفاتورة' }); }, deleteInvoice: async id => { await run('invoice.void', { id, reason: 'إبطال الفاتورة' }); },
    recordPayment: data => { const { idempotency_key, ...payload } = data; return run<Payment>('payment.create', payload, idempotency_key); },
    addExpense: data => run<Expense>('expense.create', data), deleteExpense: async id => { await run('expense.void', { id }); },
    addAccount: data => run<Account>('account.create', data), updateAccount: async (code, updates) => { await run('account.update', { code, updates }); },
    addJournalEntry: data => run<JournalEntry>('journal.create', data), resetChartOfAccounts: async () => { await run('account.reset', {}); },
    refreshCounters: refresh, refreshSubscription: refresh, updateSubscriptionPlan: async plan => { await run('subscription.request', { plan }); },
    hasMoreInvoices: false, isLoadingMoreInvoices: false, loadMoreInvoices: nothing,
    hasMoreCustomers: false, isLoadingMoreCustomers: false, loadMoreCustomers: nothing,
    hasMoreProducts: false, isLoadingMoreProducts: false, loadMoreProducts: nothing,
    hasMoreExpenses: false, isLoadingMoreExpenses: false, loadMoreExpenses: nothing,
    hasMorePayments: false, isLoadingMorePayments: false, loadMorePayments: nothing,
    hasMoreInventoryMovements: false, isLoadingMoreInventoryMovements: false, loadMoreInventoryMovements: nothing,
    syncAllToCloud, reconcileProductStock, exportDataJson, importDataJson,
    getNextInvoiceNumber: () => `${state.settings.invoice_prefix}${String((state.counters.last_invoice_number || 0) + 1).padStart(4, '0')}`,
    resetToSampleData: () => { setSyncError('بياناتك محفوظة. للاستعادة اختر نسخة احتياطية ومؤسسة فارغة.'); },
    logoutUser: async () => { ++session.current; revisionWatch.current?.(); revisionWatch.current = null; activeOrg.current = null; confirmedRevision.current = -1; apply(emptySnapshot()); await logout(); },
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
export const useApp = (): AppContextType => {
  const context = useContext(AppContext); if (!context) throw new Error('useApp must be used within AppProvider'); return context;
};
