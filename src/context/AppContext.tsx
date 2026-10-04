import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { Customer, Product, Invoice, Payment, Expense, MerchantSettings, Currency, InventoryMovement, Organization, OrgMember, OrgRole, Account, JournalEntry, OrganizationCounters, OrgSubscription, SubscriptionPlan } from '../types';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../types';
import { INITIAL_SETTINGS } from '../data/initialData';
import { auth, onAuthStateChanged, logout, type User } from '../lib/firebase';
import { createDefaultSubscription } from '../lib/plans';
import { Operations, type Actor } from '../domain/operations';
import type { Change, Document } from '../domain/store';
import { api, operationId } from '../services/businessApi';
import { firebaseCommand, firebaseSnapshot, watchFirebaseRevision } from '../services/firebaseSync';
import { cloudOrganizations } from '../services/cloudOrganizations';
import { createGuestStore, guestActor, guestId } from '../services/guestStore';
import { readSnapshotCache, writeSnapshotCache } from '../services/snapshotCache';
import { hasPermission, type ActionType } from '../services/rbacService';
import { getDefaultChartOfAccounts } from '../services/accountingService';
import { BusinessError } from '../domain/validation';

interface AppContextType {
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
  expenses: Expense[];
  inventoryMovements: InventoryMovement[];
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  // Multi-Tenant SaaS & RBAC
  currentOrg: Organization | null;
  userOrgs: Organization[];
  userRole: OrgRole;
  memberStatus: 'active' | 'suspended';
  orgMembers: OrgMember[];
  switchOrganization: (orgId: string) => Promise<void>;
  createNewOrg: (name: string) => Promise<Organization>;
  inviteMember: (email: string, role: OrgRole) => Promise<void>;
  updateMemberRole: (memberUid: string, role: OrgRole) => Promise<void>;
  removeMember: (memberUid: string) => Promise<void>;
  suspendMember: (memberUid: string) => Promise<void>;
  reactivateMember: (memberUid: string) => Promise<void>;
  isActionAllowed: (action: ActionType) => boolean;
  // Actions
  updateSettings: (newSettings: Partial<MerchantSettings>) => Promise<void>;
  addCustomer: (customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  addProduct: (product: Omit<Product, 'id' | 'created_at'>) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  updateProductStock: (id: string, newStock: number, reason?: string) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  createInvoice: (invoiceData: Omit<Invoice, 'id' | 'created_at' | 'updated_at'>) => Promise<Invoice>;
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
  updateSubscriptionPlan: (newPlan: SubscriptionPlan) => Promise<void>;
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
  addJournalEntry: (entry: Omit<JournalEntry, 'id' | 'created_at' | 'org_id'>) => Promise<JournalEntry>;
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
  };
  const load = async (org: Organization) => {
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
        revisionWatch.current?.();
        revisionWatch.current = watchFirebaseRevision(
          org.id,
          revision => {
            if (epoch !== session.current || activeOrg.current !== org.id || revision <= confirmedRevision.current || pendingRefresh.current) return;
            pendingRefresh.current = true;
            void refresh(org.id, epoch)
              .catch(error => { if (epoch === session.current && activeOrg.current === org.id) fail(error); })
              .finally(() => { pendingRefresh.current = false; });
          },
          error => { if (epoch === session.current && activeOrg.current === org.id) fail(error); },
        );
      }
    } catch (error) { if (epoch === session.current) fail(error); throw error; }
  };
  const initializeCloudOrganization = async (user: User, epoch = session.current) => {
    let orgs = await cloudOrganizations();
    if (epoch !== session.current || userRef.current?.uid !== user.uid) return;
    if (!orgs.length) {
      const created = await api<Organization>('/organizations', { method: 'POST', body: JSON.stringify({ initial: true, operationId: 'initial', name: 'مؤسستي التجارية', settings: INITIAL_SETTINGS }) });
      orgs = [created];
    }
    if (epoch !== session.current || userRef.current?.uid !== user.uid) return;
    setUserOrgs(orgs);
    const saved = localStorage.getItem(`sudaflow_active_org_${user.uid}`) || localStorage.getItem('hisabuk_active_org_id');
    await load(orgs.find(o => o.id === saved) || orgs[0]);
  };
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
      if (user && !user.emailVerified) {
        setSyncStatus('idle');
        setSyncError('أكّد بريدك الإلكتروني أولاً. لم يتم إنشاء مؤسسة أو بدء مزامنة لهذا الحساب بعد.');
        // Registration sends verification before signing out. Do not race that request.
        userRef.current = null; setCurrentUser(null);
        setAuthLoading(false);
        return;
      }
      if (!user) {
        const loaded = await getGuest().snapshot(guestId, guestActor);
        if (epoch !== session.current) return;
        activeOrg.current = guestId; apply(loaded); setUserOrgs([loaded.org]); setSyncStatus('idle');
      } else {
        await initializeCloudOrganization(user, epoch);
      }
    } catch (error) { if (userRef.current?.uid === user?.uid) fail(error); }
    finally { if (userRef.current?.uid === user?.uid) setAuthLoading(false); }
  }), []);
  // Firestore listener is the primary synchronization path. Focus/online are fallback reconciliations.
  useEffect(() => {
    const reconcile = () => {
      const user = userRef.current, epoch = session.current;
      if (!user || pendingRefresh.current || document.visibilityState !== 'visible') return;
      pendingRefresh.current = true;
      const work = activeOrg.current ? refresh() : initializeCloudOrganization(user, epoch);
      void work.catch(error => { if (epoch === session.current && userRef.current?.uid === user.uid) fail(error); }).finally(() => { pendingRefresh.current = false; });
    };
    const interval = window.setInterval(reconcile, 30000);
    window.addEventListener('focus', reconcile); window.addEventListener('online', reconcile);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', reconcile); window.removeEventListener('online', reconcile);
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
        const response = !activeUser && id === guestId ? await getGuest().execute(id, guestActor, { action, operationId: suggestedId || operationId(), data }) : await firebaseCommand(id, action, data, suggestedId);
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
  const isActionAllowed = (action: ActionType) => Boolean(state.org && hasPermission(state.role, action));
  const switchOrganization = async (id: string) => {
    const orgs = await api<Organization[]>('/organizations'); setUserOrgs(orgs);
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
  const importDataJson = async (json: string) => { await run('backup.restore', { backup: JSON.parse(json) }); await refresh(); return true; };
  const nothing = async () => {};
  const value: AppContextType = {
    currentUser, authLoading, syncStatus, syncError, dismissSyncError: () => setSyncError(null), lastSyncedAt,
    currentOrg: state.org, userOrgs, userRole: state.role, memberStatus: state.member?.status === 'suspended' ? 'suspended' : 'active', orgMembers: rows<OrgMember>('members'),
    settings: state.settings, customers, products, invoices, payments, expenses, inventoryMovements, accounts, journalEntries,
    counters: state.counters, subscription: state.subscription as OrgSubscription, theme, setTheme, toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light'),
    isActionAllowed, switchOrganization, createNewOrg,
    inviteMember: async (email, role) => { await run('invitation.create', { email, role }); },
    updateMemberRole: async (uid, role) => { await run('member.update', { uid, role }); },
    removeMember: async uid => { await run('member.remove', { uid }); },
    suspendMember: async uid => { await run('member.update', { uid, status: 'suspended' }); },
    reactivateMember: async uid => { await run('member.update', { uid, status: 'active' }); },
    updateSettings: async updates => { await run('settings.update', { updates }); },
    addCustomer: data => run<Customer>('customer.create', data), updateCustomer: async (id, updates) => { await run('customer.update', { id, updates }); }, deleteCustomer: async id => { await run('customer.delete', { id }); },
    addProduct: data => run<Product>('product.create', data), updateProduct: async (id, updates) => { await run('product.update', { id, updates }); }, deleteProduct: async id => { await run('product.delete', { id }); },
    updateProductStock: async (id, newStock, reason) => { await run('product.stock', { id, newStock, reason: reason || 'تسوية جرد' }); },
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
