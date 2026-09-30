import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  Customer,
  Product,
  Invoice,
  Payment,
  Expense,
  MerchantSettings,
  Currency,
  InventoryMovement,
  IdempotencyRecord,
  CounterRecord,
  Organization,
  OrgMember,
  OrgRole,
  Account,
  JournalEntry,
  OrganizationCounters,
  DEFAULT_ORGANIZATION_COUNTERS,
  OrgSubscription,
  SubscriptionPlan,
} from '../types';
import {
  createDefaultSubscription,
  getPlanConfig,
  PLAN_TIERS,
} from '../lib/plans';
import {
  INITIAL_SETTINGS,
  INITIAL_CUSTOMERS,
  INITIAL_PRODUCTS,
  INITIAL_INVOICES,
  INITIAL_EXPENSES,
} from '../data/initialData';
import { auth, onAuthStateChanged, User, db, cleanFirestoreData, logout } from '../lib/firebase';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  getDocFromServer,
  runTransaction,
  writeBatch,
  query,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  increment,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import {
  convertCurrency,
  safeAdd,
  safeSub,
  safeMul,
  calculateInvoiceFinancials,
  validateExchangeRate,
} from '../lib/currency';
import {
  getUserOrganizations,
  getOrganizationMembers,
  setOrganizationMember,
  removeOrganizationMember,
  suspendOrganizationMember,
  reactivateOrganizationMember,
  createOrganization,
  migrateUserToOrganization,
  createOrganizationEntity,
} from '../services/organizationService';
import { logAuditEvent } from '../services/auditService';
import { hasPermission, ActionType } from '../services/rbacService';
import { checkRateLimit } from '../services/rateLimiter';
import {
  getDefaultChartOfAccounts,
  generateInvoiceJournalEntry,
  generatePaymentJournalEntry,
  generateExpenseJournalEntry,
  generateVoidInvoiceJournalEntry,
} from '../services/accountingService';

// Test connection on startup per Firebase skill guidelines
async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or starting up.');
    }
  }
}
testFirestoreConnection();

interface AppContextType {
  currentUser: User | null;
  authLoading: boolean;
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
  exportDataJson: () => string;
  importDataJson: (jsonString: string) => boolean;
  logoutUser: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'hisabuk_pos_data_v2';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Multi-Tenant & RBAC State
  const defaultGuestOrg: Organization = {
    id: 'local-guest-org',
    name: INITIAL_SETTINGS.business_name || 'حسابك - نقطة البيع',
    display_name: INITIAL_SETTINGS.business_name || 'حسابك - نقطة البيع',
    business_activity: 'تجارة عامة وخدمات',
    base_currency: INITIAL_SETTINGS.primary_currency,
    secondary_currency: INITIAL_SETTINGS.secondary_currency,
    timezone: 'Africa/Khartoum',
    fiscal_year: new Date().getFullYear().toString(),
    status: 'active',
    owner_uid: 'guest',
    schema_version: 2,
    settings: INITIAL_SETTINGS,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Mutex & Session Epoch to prevent race conditions across account switches
  const sessionEpochRef = useRef<number>(0);

  const defaultGuestMember: OrgMember = {
    uid: 'guest',
    org_id: 'local-guest-org',
    email: 'guest@hesabak.app',
    display_name: 'المالك الافتراضي',
    role: 'Owner',
    joined_at: new Date().toISOString(),
    status: 'active',
  };

  const [currentOrg, setCurrentOrg] = useState<Organization | null>(defaultGuestOrg);
  const [userOrgs, setUserOrgs] = useState<Organization[]>([defaultGuestOrg]);
  const [userRole, setUserRole] = useState<OrgRole>('Owner');
  const [memberStatus, setMemberStatus] = useState<'active' | 'suspended'>('active');
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([defaultGuestMember]);

  // Helper to check RBAC permissions - Inactive or suspended members fail-closed on all actions
  const isActionAllowed = (action: ActionType): boolean => {
    if (memberStatus === 'suspended') return false;
    return hasPermission(userRole, action);
  };

  // Strictly Scoped Storage Keys
  const getAuthStorageKey = (uid: string, orgId: string, key: string) => {
    return `hisabuk_cache_${uid}_${orgId}_${key}`;
  };

  const getGuestStorageKey = (key: string) => {
    return `hisabuk_guest_v1_${key}`;
  };

  // Safe Default Initial State - Never pre-populated from untrusted global keys
  const [settings, setSettings] = useState<MerchantSettings>(INITIAL_SETTINGS);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);

  // Page Size for Firestore Query Limits
  const PAGE_SIZE = 25;

  // Atomic Usage Counters
  const [counters, setCounters] = useState<OrganizationCounters>(DEFAULT_ORGANIZATION_COUNTERS);

  // Organization Subscription & Limits
  const [subscription, setSubscription] = useState<OrgSubscription>(() => createDefaultSubscription('local-guest-org'));

  // Pagination Cursors and Loading States
  const [hasMoreInvoices, setHasMoreInvoices] = useState<boolean>(false);
  const [isLoadingMoreInvoices, setIsLoadingMoreInvoices] = useState<boolean>(false);
  const lastInvoiceDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [hasMoreCustomers, setHasMoreCustomers] = useState<boolean>(false);
  const [isLoadingMoreCustomers, setIsLoadingMoreCustomers] = useState<boolean>(false);
  const lastCustomerDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [hasMoreProducts, setHasMoreProducts] = useState<boolean>(false);
  const [isLoadingMoreProducts, setIsLoadingMoreProducts] = useState<boolean>(false);
  const lastProductDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [hasMoreExpenses, setHasMoreExpenses] = useState<boolean>(false);
  const [isLoadingMoreExpenses, setIsLoadingMoreExpenses] = useState<boolean>(false);
  const lastExpenseDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [hasMorePayments, setHasMorePayments] = useState<boolean>(false);
  const [isLoadingMorePayments, setIsLoadingMorePayments] = useState<boolean>(false);
  const lastPaymentDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [hasMoreInventoryMovements, setHasMoreInventoryMovements] = useState<boolean>(false);
  const [isLoadingMoreInventoryMovements, setIsLoadingMoreInventoryMovements] = useState<boolean>(false);
  const lastMovementDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  // Synchronous State Reset to Safe Defaults
  const resetBusinessStateToSafeDefaults = () => {
    setSettings(INITIAL_SETTINGS);
    setCustomers([]);
    setProducts([]);
    setInvoices([]);
    setPayments([]);
    setExpenses([]);
    setInventoryMovements([]);
    setAccounts([]);
    setJournalEntries([]);
    setCounters(DEFAULT_ORGANIZATION_COUNTERS);
    setSubscription(createDefaultSubscription('local-guest-org'));
    setHasMoreInvoices(false);
    setIsLoadingMoreInvoices(false);
    lastInvoiceDocRef.current = null;
    setHasMoreCustomers(false);
    setIsLoadingMoreCustomers(false);
    lastCustomerDocRef.current = null;
    setHasMoreProducts(false);
    setIsLoadingMoreProducts(false);
    lastProductDocRef.current = null;
    setHasMoreExpenses(false);
    setIsLoadingMoreExpenses(false);
    lastExpenseDocRef.current = null;
    setHasMorePayments(false);
    setIsLoadingMorePayments(false);
    lastPaymentDocRef.current = null;
    setHasMoreInventoryMovements(false);
    setIsLoadingMoreInventoryMovements(false);
    lastMovementDocRef.current = null;
  };

  // Clean up legacy global localStorage keys on mount to prevent cross-account contamination
  useEffect(() => {
    try {
      const legacyKeys = [
        'hisabuk_pos_data_v2_settings',
        'hisabuk_pos_data_v2_customers',
        'hisabuk_pos_data_v2_products',
        'hisabuk_pos_data_v2_invoices',
        'hisabuk_pos_data_v2_payments',
        'hisabuk_pos_data_v2_expenses',
        'hisabuk_pos_data_v2_movements',
        'hisabuk_pos_data_v2_accounts',
        'hisabuk_pos_data_v2_journal_entries',
        'hisabuk_pos_data_v2_current_org',
      ];
      legacyKeys.forEach((k) => localStorage.removeItem(k));
    } catch {}
  }, []);

  // Mutex / in-flight promise cache to prevent concurrent duplicate invoice creation
  const inFlightInvoiceCreations = useRef<Map<string, Promise<Invoice>>>(new Map());

  // Theme State (light / dark)
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    try {
      const savedTheme = localStorage.getItem('mohasbasd_theme');
      if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
      }
      return 'dark';
    } catch {
      return 'dark';
    }
  });

  const setTheme = (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('mohasbasd_theme', newTheme);
    } catch (e) {
      console.warn('Could not persist theme preference', e);
    }
    if (typeof document !== 'undefined') {
      if (newTheme === 'light') {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      } else {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
      }
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  // Sync theme class on mount or change
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (theme === 'light') {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      } else {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
      }
    }
  }, [theme]);

  // Load Isolated Guest Data (Only when in guest mode and not authenticated)
  const loadGuestData = () => {
    try {
      const savedSettings = localStorage.getItem(getGuestStorageKey('settings'));
      const savedCust = localStorage.getItem(getGuestStorageKey('customers'));
      const savedProd = localStorage.getItem(getGuestStorageKey('products'));
      const savedInv = localStorage.getItem(getGuestStorageKey('invoices'));
      const savedPay = localStorage.getItem(getGuestStorageKey('payments'));
      const savedExp = localStorage.getItem(getGuestStorageKey('expenses'));
      const savedMov = localStorage.getItem(getGuestStorageKey('movements'));
      const savedAcc = localStorage.getItem(getGuestStorageKey('accounts'));
      const savedJv = localStorage.getItem(getGuestStorageKey('journal_entries'));

      setSettings(savedSettings ? JSON.parse(savedSettings) : INITIAL_SETTINGS);
      setCustomers(savedCust ? JSON.parse(savedCust) : INITIAL_CUSTOMERS);
      setProducts(savedProd ? JSON.parse(savedProd) : INITIAL_PRODUCTS);
      setInvoices(savedInv ? JSON.parse(savedInv) : INITIAL_INVOICES);
      setPayments(savedPay ? JSON.parse(savedPay) : []);
      setExpenses(savedExp ? JSON.parse(savedExp) : INITIAL_EXPENSES);
      setInventoryMovements(savedMov ? JSON.parse(savedMov) : []);
      setAccounts(savedAcc ? JSON.parse(savedAcc) : getDefaultChartOfAccounts('local-guest-org'));
      setJournalEntries(savedJv ? JSON.parse(savedJv) : []);
    } catch (e) {
      console.warn('Guest data load notice:', e);
    }
  };

  // Strictly Scoped Local Persistence - Never writes to global shared keys
  useEffect(() => {
    if (authLoading) return;
    try {
      if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
        const uid = currentUser.uid;
        const orgId = currentOrg.id;
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'settings'), JSON.stringify(settings));
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'customers'), JSON.stringify(customers));
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'products'), JSON.stringify(products));
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'invoices'), JSON.stringify(invoices));
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'payments'), JSON.stringify(payments));
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'expenses'), JSON.stringify(expenses));
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'movements'), JSON.stringify(inventoryMovements));
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'accounts'), JSON.stringify(accounts));
        localStorage.setItem(getAuthStorageKey(uid, orgId, 'journal_entries'), JSON.stringify(journalEntries));
      } else if (!currentUser && currentOrg?.id === 'local-guest-org' && localStorage.getItem('mohasbasd_guest_session') === 'true') {
        localStorage.setItem(getGuestStorageKey('settings'), JSON.stringify(settings));
        localStorage.setItem(getGuestStorageKey('customers'), JSON.stringify(customers));
        localStorage.setItem(getGuestStorageKey('products'), JSON.stringify(products));
        localStorage.setItem(getGuestStorageKey('invoices'), JSON.stringify(invoices));
        localStorage.setItem(getGuestStorageKey('payments'), JSON.stringify(payments));
        localStorage.setItem(getGuestStorageKey('expenses'), JSON.stringify(expenses));
        localStorage.setItem(getGuestStorageKey('movements'), JSON.stringify(inventoryMovements));
        localStorage.setItem(getGuestStorageKey('accounts'), JSON.stringify(accounts));
        localStorage.setItem(getGuestStorageKey('journal_entries'), JSON.stringify(journalEntries));
      }
    } catch (e) {
      console.warn('Isolated storage notice:', e);
    }
  }, [
    authLoading,
    currentUser,
    currentOrg,
    settings,
    customers,
    products,
    invoices,
    payments,
    expenses,
    inventoryMovements,
    accounts,
    journalEntries,
  ]);

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Helper to load cached data for a specific user and organization
  const loadCachedOrgData = (uid: string, orgId: string): boolean => {
    try {
      const savedSettings = localStorage.getItem(getAuthStorageKey(uid, orgId, 'settings'));
      const savedCust = localStorage.getItem(getAuthStorageKey(uid, orgId, 'customers'));
      const savedProd = localStorage.getItem(getAuthStorageKey(uid, orgId, 'products'));
      const savedInv = localStorage.getItem(getAuthStorageKey(uid, orgId, 'invoices'));
      const savedPay = localStorage.getItem(getAuthStorageKey(uid, orgId, 'payments'));
      const savedExp = localStorage.getItem(getAuthStorageKey(uid, orgId, 'expenses'));
      const savedMov = localStorage.getItem(getAuthStorageKey(uid, orgId, 'movements'));
      const savedAcc = localStorage.getItem(getAuthStorageKey(uid, orgId, 'accounts'));
      const savedJv = localStorage.getItem(getAuthStorageKey(uid, orgId, 'journal_entries'));

      if (savedSettings || savedCust || savedProd || savedInv) {
        if (savedSettings) setSettings(JSON.parse(savedSettings));
        setCustomers(savedCust ? JSON.parse(savedCust) : []);
        setProducts(savedProd ? JSON.parse(savedProd) : []);
        setInvoices(savedInv ? JSON.parse(savedInv) : []);
        setPayments(savedPay ? JSON.parse(savedPay) : []);
        setExpenses(savedExp ? JSON.parse(savedExp) : []);
        setInventoryMovements(savedMov ? JSON.parse(savedMov) : []);
        setAccounts(savedAcc ? JSON.parse(savedAcc) : getDefaultChartOfAccounts(orgId));
        setJournalEntries(savedJv ? JSON.parse(savedJv) : []);
        return true;
      }
    } catch (e) {
      console.warn('Notice loading cached tenant data:', e);
    }
    return false;
  };

  // Load organization-scoped data from Firestore
  const loadOrgData = async (org: Organization, userUid: string) => {
    if (!org || !userUid || org.id === 'local-guest-org') {
      setSyncStatus('idle');
      return;
    }
    const currentEpoch = sessionEpochRef.current;
    setSyncStatus('syncing');
    try {
      // 1. Settings
      if (org.settings) {
        setSettings(org.settings);
      }

      // 2. Members
      const members = await getOrganizationMembers(org.id);
      if (sessionEpochRef.current !== currentEpoch) return;
      setOrgMembers(members);

      // Determine role & active status
      const memberRecord = members.find((m) => m.uid === userUid);
      if (memberRecord) {
        setMemberStatus(memberRecord.status || 'active');
        setUserRole(memberRecord.role);
        if (memberRecord.status === 'suspended') {
          console.warn(`User ${userUid} is suspended in organization ${org.id}. Access denied.`);
          resetBusinessStateToSafeDefaults();
          setSyncStatus('error');
          return;
        }
      } else if (org.owner_uid === userUid || org.id === `org-${userUid}`) {
        setMemberStatus('active');
        setUserRole('Owner');
      } else {
        setMemberStatus('suspended');
        setUserRole('Viewer');
        resetBusinessStateToSafeDefaults();
        setSyncStatus('error');
        return;
      }

      // Reset pagination cursors
      lastInvoiceDocRef.current = null;
      lastCustomerDocRef.current = null;
      lastProductDocRef.current = null;
      lastExpenseDocRef.current = null;
      lastPaymentDocRef.current = null;
      lastMovementDocRef.current = null;

      // 3. Subcollections from /organizations/{orgId}/*
      let hasData = false;

      // Counters (Atomic Usage Counters)
      const counterDocRef = doc(db, 'organizations', org.id, 'meta', 'counters');
      let loadedCounters: OrganizationCounters = { ...DEFAULT_ORGANIZATION_COUNTERS };
      let countersExist = false;
      try {
        const counterSnap = await getDoc(counterDocRef);
        if (sessionEpochRef.current !== currentEpoch) return;
        if (counterSnap.exists()) {
          countersExist = true;
          const cData = counterSnap.data();
          loadedCounters = {
            invoice_count: cData.invoice_count ?? 0,
            customer_count: cData.customer_count ?? 0,
            product_count: cData.product_count ?? 0,
            expense_count: cData.expense_count ?? 0,
            payment_count: cData.payment_count ?? 0,
            inventory_movement_count: cData.inventory_movement_count ?? 0,
            last_invoice_number: cData.last_invoice_number ?? 0,
            updated_at: cData.updated_at,
          };
        }
      } catch (cntErr) {
        console.warn('Notice while loading counters:', cntErr);
      }

      // Subscription (Org Plan & Limits)
      const subDocRef = doc(db, 'organizations', org.id, 'meta', 'subscription');
      let loadedSubscription: OrgSubscription = createDefaultSubscription(org.id);
      try {
        const subSnap = await getDoc(subDocRef);
        if (sessionEpochRef.current !== currentEpoch) return;
        if (subSnap.exists()) {
          const sData = subSnap.data() as OrgSubscription;
          const planConfig = getPlanConfig(sData.plan);
          loadedSubscription = {
            ...sData,
            max_invoices_per_month: sData.max_invoices_per_month ?? planConfig.max_invoices_per_month,
            max_members: sData.max_members ?? planConfig.max_members,
            max_customers: sData.max_customers ?? planConfig.max_customers,
            max_products: sData.max_products ?? planConfig.max_products,
            features: { ...planConfig.features, ...(sData.features || {}) },
          };
        } else if (currentUser && org.id !== 'local-guest-org') {
          // Initialize default Free subscription if missing
          setDoc(subDocRef, loadedSubscription).catch((err) =>
            console.warn('Notice writing initial subscription doc:', err)
          );
        }
      } catch (subErr) {
        console.warn('Notice while loading subscription:', subErr);
      }
      setSubscription(loadedSubscription);

      // Customers (Paginated: orderBy created_at desc, limit PAGE_SIZE)
      const custCol = collection(db, 'organizations', org.id, 'customers');
      const custQuery = query(custCol, orderBy('created_at', 'desc'), limit(PAGE_SIZE));
      const custSnap = await getDocs(custQuery);
      if (sessionEpochRef.current !== currentEpoch) return;
      const loadedCustomers = custSnap.docs.map((d) => d.data() as Customer);
      lastCustomerDocRef.current = custSnap.docs.length > 0 ? custSnap.docs[custSnap.docs.length - 1] : null;
      setHasMoreCustomers(custSnap.docs.length === PAGE_SIZE);
      if (loadedCustomers.length > 0) hasData = true;
      setCustomers(loadedCustomers);

      // Products (Paginated: orderBy created_at desc, limit PAGE_SIZE)
      const prodCol = collection(db, 'organizations', org.id, 'products');
      const prodQuery = query(prodCol, orderBy('created_at', 'desc'), limit(PAGE_SIZE));
      const prodSnap = await getDocs(prodQuery);
      if (sessionEpochRef.current !== currentEpoch) return;
      const loadedProducts = prodSnap.docs.map((d) => d.data() as Product);
      lastProductDocRef.current = prodSnap.docs.length > 0 ? prodSnap.docs[prodSnap.docs.length - 1] : null;
      setHasMoreProducts(prodSnap.docs.length === PAGE_SIZE);
      if (loadedProducts.length > 0) hasData = true;
      setProducts(loadedProducts);

      // Invoices (Paginated: orderBy created_at desc, limit PAGE_SIZE)
      const invCol = collection(db, 'organizations', org.id, 'invoices');
      const invQuery = query(invCol, orderBy('created_at', 'desc'), limit(PAGE_SIZE));
      const invSnap = await getDocs(invQuery);
      if (sessionEpochRef.current !== currentEpoch) return;
      const loadedInvoices = invSnap.docs.map((d) => d.data() as Invoice);
      lastInvoiceDocRef.current = invSnap.docs.length > 0 ? invSnap.docs[invSnap.docs.length - 1] : null;
      setHasMoreInvoices(invSnap.docs.length === PAGE_SIZE);
      if (loadedInvoices.length > 0) hasData = true;
      setInvoices(loadedInvoices);

      // Payments (Paginated: orderBy created_at desc, limit PAGE_SIZE)
      const payCol = collection(db, 'organizations', org.id, 'payments');
      const payQuery = query(payCol, orderBy('created_at', 'desc'), limit(PAGE_SIZE));
      const paySnap = await getDocs(payQuery);
      if (sessionEpochRef.current !== currentEpoch) return;
      const loadedPayments = paySnap.docs.map((d) => d.data() as Payment);
      lastPaymentDocRef.current = paySnap.docs.length > 0 ? paySnap.docs[paySnap.docs.length - 1] : null;
      setHasMorePayments(paySnap.docs.length === PAGE_SIZE);
      if (loadedPayments.length > 0) hasData = true;
      setPayments(loadedPayments);

      // Expenses (Paginated: orderBy created_at desc, limit PAGE_SIZE)
      const expCol = collection(db, 'organizations', org.id, 'expenses');
      const expQuery = query(expCol, orderBy('created_at', 'desc'), limit(PAGE_SIZE));
      const expSnap = await getDocs(expQuery);
      if (sessionEpochRef.current !== currentEpoch) return;
      const loadedExpenses = expSnap.docs.map((d) => d.data() as Expense);
      lastExpenseDocRef.current = expSnap.docs.length > 0 ? expSnap.docs[expSnap.docs.length - 1] : null;
      setHasMoreExpenses(expSnap.docs.length === PAGE_SIZE);
      if (loadedExpenses.length > 0) hasData = true;
      setExpenses(loadedExpenses);

      // Inventory Movements (Paginated: orderBy created_at desc, limit PAGE_SIZE)
      const movCol = collection(db, 'organizations', org.id, 'inventory_movements');
      const movQuery = query(movCol, orderBy('created_at', 'desc'), limit(PAGE_SIZE));
      const movSnap = await getDocs(movQuery);
      if (sessionEpochRef.current !== currentEpoch) return;
      const loadedMovements = movSnap.docs.map((d) => d.data() as InventoryMovement);
      lastMovementDocRef.current = movSnap.docs.length > 0 ? movSnap.docs[movSnap.docs.length - 1] : null;
      setHasMoreInventoryMovements(movSnap.docs.length === PAGE_SIZE);
      if (loadedMovements.length > 0) hasData = true;
      setInventoryMovements(loadedMovements);

      // Accounts (Structural table - Chart of Accounts)
      const accCol = collection(db, 'organizations', org.id, 'accounts');
      const accSnap = await getDocs(accCol);
      if (sessionEpochRef.current !== currentEpoch) return;
      if (!accSnap.empty) {
        setAccounts(accSnap.docs.map((d) => d.data() as Account));
      } else {
        const defaults = getDefaultChartOfAccounts(org.id);
        setAccounts(defaults);
        defaults.forEach((acc) => {
          setDoc(doc(db, 'organizations', org.id, 'accounts', acc.code), acc).catch(() => {});
        });
      }

      // Journal Entries (Full General Ledger required for exact trial balance & financial statement integrity)
      const jvCol = collection(db, 'organizations', org.id, 'journal_entries');
      const jvSnap = await getDocs(jvCol);
      if (sessionEpochRef.current !== currentEpoch) return;
      const loadedJv = jvSnap.docs.map((d) => d.data() as JournalEntry);
      if (loadedJv.length > 0) hasData = true;
      setJournalEntries(loadedJv);

      // If counters doc did not exist yet, initialize it accurately via getCountFromServer
      if (!countersExist && hasData) {
        try {
          const [custCountSnap, prodCountSnap, invCountSnap, payCountSnap, expCountSnap, movCountSnap] = await Promise.all([
            getCountFromServer(custCol),
            getCountFromServer(prodCol),
            getCountFromServer(invCol),
            getCountFromServer(payCol),
            getCountFromServer(expCol),
            getCountFromServer(movCol),
          ]);
          loadedCounters = {
            customer_count: custCountSnap.data().count,
            product_count: prodCountSnap.data().count,
            invoice_count: invCountSnap.data().count,
            payment_count: payCountSnap.data().count,
            expense_count: expCountSnap.data().count,
            inventory_movement_count: movCountSnap.data().count,
            last_invoice_number: loadedCounters.last_invoice_number || 0,
            updated_at: new Date().toISOString(),
          };
          setDoc(counterDocRef, loadedCounters, { merge: true }).catch(() => {});
        } catch (cntInitErr) {
          console.warn('Fallback initializing counters from local snapshots:', cntInitErr);
          loadedCounters = {
            customer_count: loadedCustomers.length,
            product_count: loadedProducts.length,
            invoice_count: loadedInvoices.length,
            payment_count: loadedPayments.length,
            expense_count: loadedExpenses.length,
            inventory_movement_count: loadedMovements.length,
            last_invoice_number: 0,
            updated_at: new Date().toISOString(),
          };
          setDoc(counterDocRef, loadedCounters, { merge: true }).catch(() => {});
        }
      }
      setCounters(loadedCounters);

      if (sessionEpochRef.current === currentEpoch) {
        setSyncStatus('synced');
        setLastSyncedAt(new Date());
      }
    } catch (err: any) {
      console.warn('Notice while loading organization data:', err?.message || err);
      if (sessionEpochRef.current === currentEpoch) {
        setSyncStatus('synced');
      }
    }
  };

  // Auth Listener and Multi-Tenant Firestore Syncing
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      sessionEpochRef.current += 1;
      const currentEpoch = sessionEpochRef.current;
      setCurrentUser(user);
      setAuthLoading(false);

      if (user) {
        // Clear out previous state to guarantee clean tenant isolation
        resetBusinessStateToSafeDefaults();
        setSyncStatus('syncing');
        try {
          // 1. Fetch user organizations
          let orgs = await getUserOrganizations(user.uid);
          if (sessionEpochRef.current !== currentEpoch) return;

          // 2. If no organizations exist, create clean primary organization
          if (orgs.length === 0) {
            const newPrimaryOrg = await createOrganization(
              user.uid,
              user.email || '',
              'مؤسستي التجارية',
              INITIAL_SETTINGS
            );
            if (sessionEpochRef.current !== currentEpoch) return;
            orgs = [newPrimaryOrg];
          }

          setUserOrgs(orgs);

          // 3. Determine active organization (filter out local-guest-org for authenticated user)
          const lastOrgId = localStorage.getItem('hisabuk_active_org_id');
          const activeOrgs = orgs.filter((o) => o.id !== 'local-guest-org');
          const matchedOrg = (activeOrgs.find((o) => o.id === lastOrgId) || activeOrgs[0] || orgs[0]);

          setCurrentOrg(matchedOrg);
          localStorage.setItem('hisabuk_active_org_id', matchedOrg.id);

          // Load cached data for instant responsiveness if available
          loadCachedOrgData(user.uid, matchedOrg.id);

          // 4. Load tenant data from Firestore
          await loadOrgData(matchedOrg, user.uid);
        } catch (err) {
          if (sessionEpochRef.current !== currentEpoch) return;
          console.warn('Notice initializing user organization session:', err);
          const fallbackOrg = createOrganizationEntity(`org-${user.uid}`, user.uid, INITIAL_SETTINGS);
          setCurrentOrg(fallbackOrg);
          setUserOrgs([fallbackOrg]);
          setUserRole('Owner');
          setSyncStatus('idle');
        }
      } else {
        // Guest Mode or Logged Out
        resetBusinessStateToSafeDefaults();
        setSyncStatus('idle');
        setCurrentOrg(defaultGuestOrg);
        setUserOrgs([defaultGuestOrg]);
        setUserRole('Owner');
        setOrgMembers([defaultGuestMember]);

        if (localStorage.getItem('mohasbasd_guest_session') === 'true') {
          loadGuestData();
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Logout Handler with state purge
  const logoutUser = async () => {
    sessionEpochRef.current += 1;
    try {
      await logout();
    } finally {
      localStorage.removeItem('mohasbasd_guest_session');
      localStorage.removeItem('hisabuk_active_org_id');
      setCurrentOrg(defaultGuestOrg);
      setUserOrgs([defaultGuestOrg]);
      setUserRole('Owner');
      setOrgMembers([defaultGuestMember]);
      resetBusinessStateToSafeDefaults();
      setSyncStatus('idle');
    }
  };

  // Multi-Tenant Action Handlers
  const switchOrganization = async (orgId: string) => {
    if (!currentUser) return;
    const targetOrg = userOrgs.find((o) => o.id === orgId);
    if (!targetOrg) return;

    sessionEpochRef.current += 1;
    resetBusinessStateToSafeDefaults();
    setCurrentOrg(targetOrg);
    localStorage.setItem('hisabuk_active_org_id', orgId);

    // Try fast-loading cached data for this org
    loadCachedOrgData(currentUser.uid, targetOrg.id);

    await loadOrgData(targetOrg, currentUser.uid);
    await logAuditEvent(
      targetOrg.id,
      currentUser.uid,
      currentUser.email || '',
      'org:switch',
      'settings',
      targetOrg.id,
      `التبديل إلى المؤسسة: ${targetOrg.name}`
    );
  };

  const createNewOrg = async (name: string): Promise<Organization> => {
    if (!currentUser) {
      throw new Error('يجب تسجيل الدخول لإنشاء مؤسسة جديدة');
    }
    const newOrg = await createOrganization(
      currentUser.uid,
      currentUser.email || '',
      name,
      settings
    );

    setUserOrgs((prev) => [newOrg, ...prev]);
    setCurrentOrg(newOrg);
    setUserRole('Owner');
    localStorage.setItem('hisabuk_active_org_id', newOrg.id);
    localStorage.setItem(`${LOCAL_STORAGE_KEY}_current_org`, JSON.stringify(newOrg));

    // Initialize fresh empty state for new org
    setCustomers([]);
    setProducts([]);
    setInvoices([]);
    setPayments([]);
    setExpenses([]);
    setInventoryMovements([]);
    const defaultAccounts = getDefaultChartOfAccounts(newOrg.id);
    setAccounts(defaultAccounts);
    setJournalEntries([]);
    defaultAccounts.forEach((acc) => {
      setDoc(doc(db, 'organizations', newOrg.id, 'accounts', acc.code), acc).catch(() => {});
    });
    setOrgMembers([
      {
        uid: currentUser.uid,
        org_id: newOrg.id,
        email: currentUser.email || '',
        display_name: settings.business_name || 'المالك',
        role: 'Owner',
        joined_at: new Date().toISOString(),
        status: 'active',
      },
    ]);

    return newOrg;
  };

  const inviteMember = async (email: string, role: OrgRole): Promise<void> => {
    if (!currentOrg) return;
    if (!isActionAllowed('members:invite')) {
      throw new Error('ليس لديك صلاحية دعوة أعضاء جدد إلى المؤسسة');
    }

    // Subscription limit enforcement (client-side UX guardrail)
    const memberLimit = subscription.max_members ?? getPlanConfig(subscription.plan).max_members;
    if (orgMembers.length >= memberLimit) {
      throw new Error(
        `عذراً، لقد استنفدت الحد الأقصى لأعضاء الفريق في باقتك الحالية (${orgMembers.length}/${memberLimit} عضو). يرجى ترقية باقة اشتراكك لإضافة أعضاء جدد.`
      );
    }

    const limitCheck = checkRateLimit('invitation_send', currentUser?.uid || 'guest');
    if (!limitCheck.allowed) {
      throw new Error('تم تجاوز الحد المسموح لإرسال الدعوات. يرجى المحاولة لاحقاً.');
    }

    const syntheticUid = 'uid-' + Math.random().toString(36).substring(2, 8);
    const newMember: OrgMember = {
      uid: syntheticUid,
      org_id: currentOrg.id,
      email,
      display_name: email.split('@')[0],
      role,
      joined_at: new Date().toISOString(),
      invited_by: currentUser?.email || 'admin',
      status: 'active',
    };

    if (currentUser && currentOrg.id !== 'local-guest-org') {
      await setOrganizationMember(currentOrg.id, newMember, currentUser.uid, currentUser.email || '');
    }

    setOrgMembers((prev) => [...prev, newMember]);
  };

  const updateMemberRole = async (memberUid: string, role: OrgRole): Promise<void> => {
    if (!currentOrg) return;
    if (!isActionAllowed('members:update_role')) {
      throw new Error('ليس لديك صلاحية تعديل أدوار الأعضاء');
    }
    const member = orgMembers.find((m) => m.uid === memberUid);
    if (!member) return;

    if (member.role === 'Owner' && role !== 'Owner') {
      throw new Error('لا يمكن تخفيض رتبة مالك المؤسسة');
    }

    const updatedMember: OrgMember = { ...member, role };
    if (currentUser && currentOrg.id !== 'local-guest-org') {
      await setOrganizationMember(currentOrg.id, updatedMember, currentUser.uid, currentUser.email || '');
    }

    setOrgMembers((prev) => prev.map((m) => (m.uid === memberUid ? updatedMember : m)));
  };

  const removeMember = async (memberUid: string): Promise<void> => {
    if (!currentOrg) return;
    if (!isActionAllowed('members:remove')) {
      throw new Error('ليس لديك صلاحية إزالة الأعضاء');
    }
    const member = orgMembers.find((m) => m.uid === memberUid);
    if (member?.role === 'Owner') {
      throw new Error('لا يمكن إزالة مالك المؤسسة');
    }

    if (currentUser && currentOrg.id !== 'local-guest-org') {
      await removeOrganizationMember(currentOrg.id, memberUid, currentUser.uid, currentUser.email || '');
    }

    setOrgMembers((prev) => prev.filter((m) => m.uid !== memberUid));
  };

  const suspendMember = async (memberUid: string): Promise<void> => {
    if (!currentOrg) return;
    if (!isActionAllowed('members:update_role')) {
      throw new Error('ليس لديك صلاحية تجميد حسابات الأعضاء');
    }
    const member = orgMembers.find((m) => m.uid === memberUid);
    if (member?.role === 'Owner') {
      throw new Error('لا يمكن تجميد حساب مالك المؤسسة');
    }
    if (memberUid === currentUser?.uid) {
      throw new Error('لا يمكنك تجميد حسابك الخاص');
    }
    if (currentUser && currentOrg.id !== 'local-guest-org') {
      await suspendOrganizationMember(currentOrg.id, memberUid, currentUser.uid, currentUser.email || '');
    }
    setOrgMembers((prev) => prev.map((m) => (m.uid === memberUid ? { ...m, status: 'suspended' } : m)));
  };

  const reactivateMember = async (memberUid: string): Promise<void> => {
    if (!currentOrg) return;
    if (!isActionAllowed('members:update_role')) {
      throw new Error('ليس لديك صلاحية تفعيل حسابات الأعضاء');
    }
    if (currentUser && currentOrg.id !== 'local-guest-org') {
      await reactivateOrganizationMember(currentOrg.id, memberUid, currentUser.uid, currentUser.email || '');
    }
    setOrgMembers((prev) => prev.map((m) => (m.uid === memberUid ? { ...m, status: 'active' } : m)));
  };

  // Manual or automatic Full Cloud Sync
  const syncAllToCloud = async (): Promise<boolean> => {
    if (!currentUser) return false;
    setSyncStatus('syncing');
    try {
      const orgId = currentOrg && currentOrg.id !== 'local-guest-org' ? currentOrg.id : `org-${currentUser.uid}`;

      // 1. Settings and Organization doc
      await setDoc(
        doc(db, 'organizations', orgId),
        {
          id: orgId,
          owner_uid: currentUser.uid,
          name: settings.business_name || 'مؤسستي',
          display_name: settings.business_name || 'مؤسستي',
          settings,
          updated_at: new Date().toISOString(),
          schema_version: 2,
        },
        { merge: true }
      );

      // 2. Customers
      for (const c of customers) {
        const cleanC = cleanFirestoreData({ ...c, org_id: orgId });
        await setDoc(doc(db, 'organizations', orgId, 'customers', c.id), cleanC, { merge: true });
      }

      // 3. Products
      for (const p of products) {
        const cleanP = cleanFirestoreData({ ...p, org_id: orgId });
        await setDoc(doc(db, 'organizations', orgId, 'products', p.id), cleanP, { merge: true });
      }

      // 4. Invoices
      for (const inv of invoices) {
        const cleanInv = cleanFirestoreData({ ...inv, org_id: orgId });
        await setDoc(doc(db, 'organizations', orgId, 'invoices', inv.id), cleanInv, { merge: true });
      }

      // 5. Payments
      for (const pay of payments) {
        const cleanPay = cleanFirestoreData({ ...pay, org_id: orgId });
        await setDoc(doc(db, 'organizations', orgId, 'payments', pay.id), cleanPay, { merge: true });
      }

      // 6. Expenses
      for (const exp of expenses) {
        const cleanExp = cleanFirestoreData({ ...exp, org_id: orgId });
        await setDoc(doc(db, 'organizations', orgId, 'expenses', exp.id), cleanExp, { merge: true });
      }

      // 7. Inventory Movements
      for (const mov of inventoryMovements) {
        const cleanMov = cleanFirestoreData({ ...mov, org_id: orgId });
        await setDoc(doc(db, 'organizations', orgId, 'inventory_movements', mov.id), cleanMov, { merge: true });
      }

      // 8. Accounts (Chart of Accounts)
      for (const acc of accounts) {
        const cleanAcc = cleanFirestoreData({ ...acc, org_id: orgId });
        await setDoc(doc(db, 'organizations', orgId, 'accounts', acc.code), cleanAcc, { merge: true });
      }

      // 9. Journal Entries (General Ledger)
      for (const jv of journalEntries) {
        const cleanJv = cleanFirestoreData({ ...jv, org_id: orgId });
        await setDoc(doc(db, 'organizations', orgId, 'journal_entries', jv.id), cleanJv, { merge: true });
      }

      setSyncStatus('synced');
      setLastSyncedAt(new Date());
      return true;
    } catch (err) {
      console.error('Error in syncAllToCloud:', err);
      setSyncStatus('error');
      return false;
    }
  };

  // Update Settings
  const updateSettings = async (newSettings: Partial<MerchantSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    if (currentOrg) {
      setCurrentOrg((prev) => (prev ? { ...prev, settings: updated } : prev));
    }

    if (currentUser) {
      try {
        const orgId = currentOrg && currentOrg.id !== 'local-guest-org' ? currentOrg.id : `org-${currentUser.uid}`;
        if (currentOrg && currentOrg.id !== 'local-guest-org') {
          await setDoc(doc(db, 'organizations', orgId), { id: orgId, owner_uid: currentUser.uid, settings: updated, updated_at: new Date().toISOString() }, { merge: true });
        }
      } catch (err) {
        console.error('Firestore sync error for settings:', err);
      }
    }
  };

  // Customers
  const addCustomer = async (custData: Omit<Customer, 'id' | 'created_at' | 'updated_at'>): Promise<Customer> => {
    if (!isActionAllowed('customers:create')) {
      throw new Error('ليس لديك صلاحية لإضافة عملاء جدد');
    }

    // Subscription limit enforcement (client-side UX guardrail)
    const customerLimit = subscription.max_customers ?? getPlanConfig(subscription.plan).max_customers;
    if (counters.customer_count >= customerLimit) {
      throw new Error(
        `عذراً، لقد استنفدت الحد الأقصى المسموح به للعملاء في باقتك الحالية (${counters.customer_count}/${customerLimit} عميل). يرجى ترقية باقة اشتراكك لإضافة المزيد من العملاء.`
      );
    }

    const orgId = currentOrg?.id || 'local-guest-org';
    const newCust: Customer = {
      ...custData,
      id: 'cust-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      org_id: orgId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const updated = [newCust, ...customers];
    setCustomers(updated);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const batch = writeBatch(db);
        const cleanCust = cleanFirestoreData(newCust);
        batch.set(doc(db, 'organizations', orgId, 'customers', newCust.id), cleanCust);
        batch.set(
          doc(db, 'organizations', orgId, 'meta', 'counters'),
          { customer_count: increment(1), updated_at: new Date().toISOString() },
          { merge: true }
        );
        await batch.commit();
      } catch (e) {
        console.error('Error saving customer to Firestore', e);
      }
    }
    setCounters((prev) => ({ ...prev, customer_count: prev.customer_count + 1 }));
    return newCust;
  };

  const updateCustomer = async (id: string, updates: Partial<Customer>) => {
    if (!isActionAllowed('customers:update')) {
      throw new Error('ليس لديك صلاحية لتعديل بيانات العملاء');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const updated = customers.map((c) =>
      c.id === id ? { ...c, ...updates, updated_at: new Date().toISOString() } : c
    );
    setCustomers(updated);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const item = updated.find((c) => c.id === id);
        if (item) {
          const cleanItem = cleanFirestoreData(item);
          await setDoc(doc(db, 'organizations', orgId, 'customers', id), cleanItem, { merge: true });
        }
      } catch (e) {
        console.error('Error updating customer in Firestore', e);
      }
    }
  };

  const deleteCustomer = async (id: string) => {
    if (!isActionAllowed('customers:delete')) {
      throw new Error('ليس لديك صلاحية لحذف العملاء');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    setCustomers(customers.filter((c) => c.id !== id));
    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'organizations', orgId, 'customers', id));
        batch.set(
          doc(db, 'organizations', orgId, 'meta', 'counters'),
          { customer_count: increment(-1), updated_at: new Date().toISOString() },
          { merge: true }
        );
        await batch.commit();
      } catch (e) {
        console.error('Error deleting customer from Firestore', e);
      }
    }
    setCounters((prev) => ({ ...prev, customer_count: Math.max(0, prev.customer_count - 1) }));
  };

  // Products
  const addProduct = async (prodData: Omit<Product, 'id' | 'created_at'>): Promise<Product> => {
    if (!isActionAllowed('products:create')) {
      throw new Error('ليس لديك صلاحية لإضافة منتجات');
    }

    // Subscription limit enforcement (client-side UX guardrail)
    const productLimit = subscription.max_products ?? getPlanConfig(subscription.plan).max_products;
    if (counters.product_count >= productLimit) {
      throw new Error(
        `عذراً، لقد استنفدت الحد الأقصى المسموح به للمنتجات في باقتك الحالية (${counters.product_count}/${productLimit} منتج). يرجى ترقية باقة اشتراكك لإضافة منتجات جديدة.`
      );
    }

    const orgId = currentOrg?.id || 'local-guest-org';
    const newProd: Product = {
      ...prodData,
      id: 'prod-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      org_id: orgId,
      created_at: new Date().toISOString(),
    };
    const updated = [newProd, ...products];
    setProducts(updated);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const batch = writeBatch(db);
        const cleanProd = cleanFirestoreData(newProd);
        batch.set(doc(db, 'organizations', orgId, 'products', newProd.id), cleanProd);
        batch.set(
          doc(db, 'organizations', orgId, 'meta', 'counters'),
          { product_count: increment(1), updated_at: new Date().toISOString() },
          { merge: true }
        );
        await batch.commit();
      } catch (e) {
        console.error('Error saving product to Firestore', e);
      }
    }
    setCounters((prev) => ({ ...prev, product_count: prev.product_count + 1 }));
    return newProd;
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    if (!isActionAllowed('products:update')) {
      throw new Error('ليس لديك صلاحية لتعديل المنتجات');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const updated = products.map((p) => (p.id === id ? { ...p, ...updates } : p));
    setProducts(updated);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const item = updated.find((p) => p.id === id);
        if (item) {
          const cleanItem = cleanFirestoreData(item);
          await setDoc(doc(db, 'organizations', orgId, 'products', id), cleanItem, { merge: true });
        }
      } catch (e) {
        console.error('Error updating product in Firestore', e);
      }
    }
  };

  const updateProductStock = async (id: string, newStock: number, reason: string = 'تسوية جرد فعلي') => {
    if (!isActionAllowed('products:stock_adjustment')) {
      throw new Error('ليس لديك صلاحية لتعديل المخزون');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const prod = products.find((p) => p.id === id);
    if (!prod) return;

    const cleanStock = Math.max(0, newStock);
    const prevStock = prod.stock_quantity ?? 0;
    const diff = cleanStock - prevStock;
    const now = new Date().toISOString();

    const movement: InventoryMovement = {
      id: 'mov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      product_id: prod.id,
      product_name: prod.name,
      type: 'ADJUSTMENT',
      quantity: diff,
      previous_stock: prevStock,
      resulting_stock: cleanStock,
      reference_type: 'audit_adjustment',
      reference_id: `adj-${Date.now()}`,
      reason,
      created_at: now,
      org_id: orgId,
    };

    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, stock_quantity: cleanStock, updated_at: now } : p))
    );
    setInventoryMovements((prev) => [movement, ...prev]);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        await runTransaction(db, async (txn) => {
          const prodDocRef = doc(db, 'organizations', orgId, 'products', id);
          const prodSnap = await txn.get(prodDocRef);
          let currentStockInDb = prevStock;
          if (prodSnap.exists()) {
            currentStockInDb = prodSnap.data()?.stock_quantity ?? prevStock;
          }
          const actualDiff = cleanStock - currentStockInDb;
          const actualMovement: InventoryMovement = {
            ...movement,
            previous_stock: currentStockInDb,
            quantity: actualDiff,
          };

          txn.update(prodDocRef, {
            stock_quantity: cleanStock,
            updated_at: now,
          });

          txn.set(
            doc(db, 'organizations', orgId, 'inventory_movements', actualMovement.id),
            cleanFirestoreData(actualMovement)
          );

          const counterRef = doc(db, 'organizations', orgId, 'meta', 'counters');
          txn.set(
            counterRef,
            { inventory_movement_count: increment(1), updated_at: now },
            { merge: true }
          );
        });

        await logAuditEvent(
          orgId,
          currentUser.uid,
          currentUser.email || '',
          'inventory:adjust',
          'product',
          prod.id,
          `تعديل مخزون المنتج ${prod.name} من ${prevStock} إلى ${cleanStock}`
        );
      } catch (e) {
        console.error('Error executing inventory transaction in Firestore', e);
      }
    }
    setCounters((prev) => ({ ...prev, inventory_movement_count: prev.inventory_movement_count + 1 }));
  };

  const deleteProduct = async (id: string) => {
    if (!isActionAllowed('products:delete')) {
      throw new Error('ليس لديك صلاحية لحذف المنتجات');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    setProducts(products.filter((p) => p.id !== id));
    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'organizations', orgId, 'products', id));
        batch.set(
          doc(db, 'organizations', orgId, 'meta', 'counters'),
          { product_count: increment(-1), updated_at: new Date().toISOString() },
          { merge: true }
        );
        await batch.commit();
      } catch (e) {
        console.error('Error deleting product from Firestore', e);
      }
    }
    setCounters((prev) => ({ ...prev, product_count: Math.max(0, prev.product_count - 1) }));
  };

  // Sequential Invoice Number Generator (Monotonic & Collision-Safe)
  const getNextInvoiceNumber = (customPrefix?: string): string => {
    const currentYear = new Date().getFullYear();
    const prefix = customPrefix || settings.invoice_prefix || `INV-${currentYear}-`;

    let maxNum = 0;
    for (const inv of invoices) {
      const digits = inv.invoice_number.match(/\d+$/);
      if (digits) {
        const val = parseInt(digits[0], 10);
        if (!isNaN(val) && val > maxNum) maxNum = val;
      }
    }

    let localCounter = 0;
    try {
      localCounter = parseInt(localStorage.getItem(`hisabuk_${currentOrg?.id || 'atomic'}_invoice_seq`) || '0', 10);
    } catch {}

    const nextSeq = Math.max(maxNum, localCounter) + 1;
    try {
      localStorage.setItem(`hisabuk_${currentOrg?.id || 'atomic'}_invoice_seq`, nextSeq.toString());
    } catch {}

    return `${prefix}${nextSeq.toString().padStart(4, '0')}`;
  };

  // Invoices (Atomic, Idempotent, with Ledger tracking)
  const createInvoice = async (
    invoiceData: Omit<Invoice, 'id' | 'created_at' | 'updated_at'>
  ): Promise<Invoice> => {
    if (!isActionAllowed('invoices:create')) {
      throw new Error('ليس لديك صلاحية لإنشاء فواتير جديدة');
    }

    // Subscription limit enforcement (client-side UX guardrail)
    const invoiceLimit = subscription.max_invoices_per_month ?? getPlanConfig(subscription.plan).max_invoices_per_month;
    if (counters.invoice_count >= invoiceLimit) {
      throw new Error(
        `عذراً، لقد استنفدت الحد المسموح به من الفواتير في باقتك الحالية (${counters.invoice_count}/${invoiceLimit} فاتورة). يرجى ترقية باقة اشتراكك لمتابعة إصدار الفواتير.`
      );
    }

    if (settings.period_lock_date) {
      const txDate = invoiceData.issue_date || new Date().toISOString().split('T')[0];
      if (txDate <= settings.period_lock_date) {
        throw new Error(`لا يمكن إصدار فاتورة في فترة محاسبية مقفلة (تاريخ إقفال الفترة: ${settings.period_lock_date})`);
      }
    }

    const orgId = currentOrg?.id || 'local-guest-org';

    // 1. Idempotency key extraction
    const opId = (invoiceData as any).operation_id || `op-inv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // 2. Immediate in-memory idempotency check
    const existingInv = invoices.find(
      (inv) => (inv.operation_id && inv.operation_id === opId) || ((invoiceData as any).id && inv.id === (invoiceData as any).id)
    );
    if (existingInv) {
      return existingInv;
    }

    // 3. Concurrency Protection: If the exact same operation_id is currently in flight, return the same promise
    if (inFlightInvoiceCreations.current.has(opId)) {
      return inFlightInvoiceCreations.current.get(opId)!;
    }

    const executionPromise = (async (): Promise<Invoice> => {
      // Re-verify in-memory state in case of race condition during resolution
      const recheck = invoices.find((inv) => (inv.operation_id && inv.operation_id === opId));
      if (recheck) {
        return recheck;
      }

      // 4. Deterministic financial recalculation
      const finalRate = invoiceData.exchange_rate_used || settings.default_exchange_rate || 0;
      const hasForeignItems = (invoiceData.items || []).some((item) => item.currency && item.currency !== (settings.primary_currency || 'SDG'));
      if (hasForeignItems || invoiceData.currency_mode === 'single_usd' || invoiceData.currency_mode === 'dual') {
        const rateVal = validateExchangeRate(finalRate);
        if (!rateVal.isValid) {
          throw new Error(rateVal.error || 'سعر الصرف غير صالح ولا يمكن إصدار فاتورة بالعملة الأجنبية دون تحديد سعر صرف معتمد.');
        }
      }

      const financials = calculateInvoiceFinancials(
        invoiceData.items || [],
        finalRate,
        invoiceData.discount_type || 'fixed',
        invoiceData.discount_value || 0,
        invoiceData.paid_amount_sdg || 0,
        invoiceData.paid_amount_usd || 0,
        settings
      );

      const now = new Date().toISOString();
      const invId = (invoiceData as any).id || ('inv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));

      // Determine final sequential invoice number
      let finalInvoiceNumber = invoiceData.invoice_number;
      if (!finalInvoiceNumber || finalInvoiceNumber.trim() === '') {
        finalInvoiceNumber = getNextInvoiceNumber();
      }

      // 5. Prepare inventory deductions & movements
      const movementsToCreate: InventoryMovement[] = [];
      const updatedProducts = products.map((prod) => {
        const matchingItem = invoiceData.items?.find((it) => it.product_id === prod.id);
        if (matchingItem && prod.track_inventory && typeof prod.stock_quantity === 'number') {
          const currentStock = prod.stock_quantity;
          const newQty = Math.max(0, currentStock - matchingItem.quantity);
          movementsToCreate.push({
            id: 'mov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
            product_id: prod.id,
            product_name: prod.name,
            type: 'SALE',
            quantity: -matchingItem.quantity,
            previous_stock: currentStock,
            resulting_stock: newQty,
            reference_type: 'invoice',
            reference_id: invId,
            reason: `مبيعات بموجب الفاتورة #${finalInvoiceNumber}`,
            created_at: now,
            operation_id: opId,
            org_id: orgId,
          });
          return { ...prod, stock_quantity: newQty };
        }
        return prod;
      });

      // 6. Update customer outstanding debt
      let updatedCustomers = customers;
      if (invoiceData.customer_id) {
        updatedCustomers = customers.map((c) => {
          if (c.id === invoiceData.customer_id) {
            return {
              ...c,
              balance_sdg: safeAdd(c.balance_sdg || 0, financials.remaining_sdg, settings.sdg_decimals),
              balance_usd: safeAdd(c.balance_usd || 0, financials.remaining_usd, settings.usd_decimals),
              updated_at: now,
            };
          }
          return c;
        });
      }

      // 7. Construct authoritative invoice
      const newInv: Invoice = {
        ...invoiceData,
        id: invId,
        org_id: orgId,
        invoice_number: finalInvoiceNumber,
        subtotal_sdg: financials.subtotal_sdg,
        subtotal_usd: financials.subtotal_usd,
        discount_total_sdg: financials.discount_total_sdg,
        discount_total_usd: financials.discount_total_usd,
        tax_total_sdg: financials.tax_total_sdg,
        tax_total_usd: financials.tax_total_usd,
        grand_total_sdg: financials.grand_total_sdg,
        grand_total_usd: financials.grand_total_usd,
        remaining_sdg: financials.remaining_sdg,
        remaining_usd: financials.remaining_usd,
        operation_id: opId,
        created_at: now,
        updated_at: now,
      };

      // Automatically generate double-entry general ledger voucher
      const invJv = generateInvoiceJournalEntry(newInv, orgId, currentUser?.uid);

      // Commit to React local state with duplicate checks
      setInvoices((prev) => {
        if (prev.some((inv) => (inv.operation_id && inv.operation_id === opId) || inv.id === newInv.id)) {
          return prev;
        }
        return [newInv, ...prev];
      });
      setProducts(updatedProducts);
      setCustomers(updatedCustomers);
      if (movementsToCreate.length > 0) {
        setInventoryMovements((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const fresh = movementsToCreate.filter((m) => !existingIds.has(m.id));
          return [...fresh, ...prev];
        });
      }
      setJournalEntries((prev) => {
        if (prev.some((jv) => jv.id === invJv.id || (jv.reference_id === newInv.id && jv.reference_type === 'invoice'))) {
          return prev;
        }
        return [invJv, ...prev];
      });
      setCounters((prev) => ({
        ...prev,
        invoice_count: prev.invoice_count + 1,
        inventory_movement_count: prev.inventory_movement_count + movementsToCreate.length,
      }));

      // 8. Atomic Firestore write if authenticated
      if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
        try {
          await runTransaction(db, async (txn) => {
            // Check idempotency inside transaction
            const idempotencyRef = doc(db, 'organizations', orgId, 'idempotency', opId);
            const idempotencySnap = await txn.get(idempotencyRef);
            if (idempotencySnap.exists()) {
              console.warn(`[Idempotency] Invoice operation ${opId} was already executed in Firestore.`);
              return;
            }

            // Read counter doc for atomic increment in organization
            const counterRef = doc(db, 'organizations', orgId, 'meta', 'counters');
            const counterSnap = await txn.get(counterRef);
            let currentCounter = 0;
            let currentInvCount = 0;
            let currentMovCount = 0;
            if (counterSnap.exists()) {
              const cData = counterSnap.data();
              currentCounter = cData?.last_invoice_number || 0;
              currentInvCount = cData?.invoice_count || 0;
              currentMovCount = cData?.inventory_movement_count || 0;
            }
            const nextCounter = currentCounter + 1;

            // Atomic writes in transaction
            txn.set(
              counterRef,
              {
                last_invoice_number: nextCounter,
                invoice_count: currentInvCount + 1,
                inventory_movement_count: currentMovCount + movementsToCreate.length,
                updated_at: now,
              },
              { merge: true }
            );
            const cleanNewInv = cleanFirestoreData(newInv);
            const cleanInvJv = cleanFirestoreData(invJv);
            txn.set(doc(db, 'organizations', orgId, 'invoices', newInv.id), cleanNewInv);

            // Update stock for deducted items
            for (const mov of movementsToCreate) {
              txn.update(doc(db, 'organizations', orgId, 'products', mov.product_id), {
                stock_quantity: mov.resulting_stock,
              });
              txn.set(doc(db, 'organizations', orgId, 'inventory_movements', mov.id), cleanFirestoreData(mov));
            }

            // Update customer balance
            if (invoiceData.customer_id) {
              const cust = updatedCustomers.find((c) => c.id === invoiceData.customer_id);
              if (cust) {
                txn.update(doc(db, 'organizations', orgId, 'customers', cust.id), {
                  balance_sdg: cust.balance_sdg,
                  balance_usd: cust.balance_usd,
                  updated_at: now,
                });
              }
            }

            // Atomic journal entry in the same transaction (Fixes ACC-01 split-write risk)
            txn.set(doc(db, 'organizations', orgId, 'journal_entries', invJv.id), cleanInvJv);

            // Idempotency record commit
            txn.set(idempotencyRef, {
              id: opId,
              action: 'create_invoice',
              resource_id: newInv.id,
              created_at: now,
              status: 'completed',
            });
          });

          // Audit log
          await logAuditEvent(
            orgId,
            currentUser.uid,
            currentUser.email || '',
            'invoice:create',
            'invoice',
            newInv.id,
            `إنشاء فاتورة جديدة #${newInv.invoice_number} بإجمالي ${newInv.grand_total_sdg.toLocaleString()} SDG`
          );
        } catch (e) {
          console.error('Error in Firestore createInvoice transaction:', e);
        }
      }

      return newInv;
    })();

    inFlightInvoiceCreations.current.set(opId, executionPromise);
    try {
      const result = await executionPromise;
      return result;
    } finally {
      inFlightInvoiceCreations.current.delete(opId);
    }
  };

  const updateInvoice = async (id: string, updates: Partial<Invoice>) => {
    if (!isActionAllowed('invoices:update')) {
      throw new Error('ليس لديك صلاحية لتعديل الفواتير');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const updated = invoices.map((inv) =>
      inv.id === id ? { ...inv, ...updates, updated_at: new Date().toISOString() } : inv
    );
    setInvoices(updated);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const item = updated.find((inv) => inv.id === id);
        if (item) {
          const cleanItem = cleanFirestoreData(item);
          await setDoc(doc(db, 'organizations', orgId, 'invoices', id), cleanItem, { merge: true });
        }
      } catch (e) {
        console.error('Error updating invoice in Firestore', e);
      }
    }
  };

  // Void/Cancel Invoice (Reverses inventory deductions, balances, preserves audit trail)
  const voidInvoice = async (id: string, reason: string = 'إلغاء بناء على طلب المستخدم'): Promise<void> => {
    if (!isActionAllowed('invoices:void')) {
      throw new Error('ليس لديك صلاحية لإبطال أو إلغاء الفواتير');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const target = invoices.find((inv) => inv.id === id);
    if (!target || target.status === 'void' || target.status === 'cancelled') return;

    if (settings.period_lock_date && target.issue_date <= settings.period_lock_date) {
      throw new Error(`لا يمكن إبطال أو إلغاء فاتورة تابعة لفترة محاسبية مقفلة (تاريخ إقفال الفترة: ${settings.period_lock_date})`);
    }

    const voidedAt = new Date().toISOString();
    const opId = `op-void-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // Reversing inventory movements
    const reversingMovements: InventoryMovement[] = [];
    const restoredProducts = products.map((prod) => {
      const matchingItem = target.items?.find((it) => it.product_id === prod.id);
      if (matchingItem && prod.track_inventory && typeof prod.stock_quantity === 'number') {
        const currentStock = prod.stock_quantity;
        const newStock = currentStock + matchingItem.quantity;
        reversingMovements.push({
          id: 'mov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
          product_id: prod.id,
          product_name: prod.name,
          type: 'VOID_REVERSAL',
          quantity: matchingItem.quantity,
          previous_stock: currentStock,
          resulting_stock: newStock,
          reference_type: 'void',
          reference_id: target.id,
          reason: `إرجاع مخزون بعد إبطال الفاتورة #${target.invoice_number}: ${reason}`,
          created_at: voidedAt,
          operation_id: opId,
          org_id: orgId,
        });
        return { ...prod, stock_quantity: newStock };
      }
      return prod;
    });

    // Reverse customer balance
    let updatedCustomers = customers;
    if (target.customer_id) {
      updatedCustomers = customers.map((c) => {
        if (c.id === target.customer_id) {
          return {
            ...c,
            balance_sdg: Math.max(0, safeSub(c.balance_sdg || 0, target.remaining_sdg, settings.sdg_decimals)),
            balance_usd: Math.max(0, safeSub(c.balance_usd || 0, target.remaining_usd, settings.usd_decimals)),
            updated_at: voidedAt,
          };
        }
        return c;
      });
    }

    const updatedInvoices = invoices.map((inv) =>
      inv.id === id
        ? {
            ...inv,
            status: 'void' as const,
            voided_at: voidedAt,
            void_reason: reason,
            updated_at: voidedAt,
          }
        : inv
    );

    setInvoices(updatedInvoices);
    setProducts(restoredProducts);
    setCustomers(updatedCustomers);
    if (reversingMovements.length > 0) {
      setInventoryMovements((prev) => [...reversingMovements, ...prev]);
    }

    // Automatically generate reversal journal voucher
    const voidJv = generateVoidInvoiceJournalEntry(target, reason, orgId, currentUser?.uid);
    setJournalEntries((prev) => [voidJv, ...prev]);

    // Atomic sync to Firestore
    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const batch = writeBatch(db);
        const invRef = doc(db, 'organizations', orgId, 'invoices', target.id);
        batch.update(invRef, {
          status: 'void',
          voided_at: voidedAt,
          void_reason: reason,
          updated_at: voidedAt,
        });

        batch.set(doc(db, 'organizations', orgId, 'journal_entries', voidJv.id), voidJv);

        for (const mov of reversingMovements) {
          batch.update(doc(db, 'organizations', orgId, 'products', mov.product_id), {
            stock_quantity: mov.resulting_stock,
          });
          batch.set(doc(db, 'organizations', orgId, 'inventory_movements', mov.id), mov);
        }

        if (target.customer_id) {
          const cust = updatedCustomers.find((c) => c.id === target.customer_id);
          if (cust) {
            batch.update(doc(db, 'organizations', orgId, 'customers', cust.id), {
              balance_sdg: cust.balance_sdg,
              balance_usd: cust.balance_usd,
              updated_at: voidedAt,
            });
          }
        }

        const counterUpdate: Record<string, any> = { updated_at: voidedAt };
        if (reversingMovements.length > 0) {
          counterUpdate.inventory_movement_count = increment(reversingMovements.length);
        }
        batch.set(
          doc(db, 'organizations', orgId, 'meta', 'counters'),
          counterUpdate,
          { merge: true }
        );

        await batch.commit();

        await logAuditEvent(
          orgId,
          currentUser.uid,
          currentUser.email || '',
          'invoice:void',
          'invoice',
          target.id,
          `إبطال الفاتورة #${target.invoice_number}: ${reason}`
        );
      } catch (err) {
        console.error('Error committing voidInvoice to Firestore:', err);
      }
    }
    if (reversingMovements.length > 0) {
      setCounters((prev) => ({
        ...prev,
        inventory_movement_count: prev.inventory_movement_count + reversingMovements.length,
      }));
    }
  };

  // Safe soft delete wrapper for backwards compatibility
  const deleteInvoice = async (id: string) => {
    await voidInvoice(id, 'إلغاء وحذف من واجهة المستخدم');
  };

  // Record Payment (Idempotent, Atomic)
  const recordPayment = async (data: {
    invoice_id: string;
    amount: number;
    currency: Currency;
    payment_method: any;
    exchange_rate_used?: number;
    reference_number?: string;
    notes?: string;
    idempotency_key?: string;
  }): Promise<Payment> => {
    if (!isActionAllowed('payments:create')) {
      throw new Error('ليس لديك صلاحية لتسجيل السندات المالية');
    }

    if (settings.period_lock_date) {
      const txDate = new Date().toISOString().split('T')[0];
      if (txDate <= settings.period_lock_date) {
        throw new Error(`لا يمكن تسجيل سند قبض في فترة محاسبية مقفلة (تاريخ إقفال الفترة: ${settings.period_lock_date})`);
      }
    }

    const orgId = currentOrg?.id || 'local-guest-org';
    const opId = data.idempotency_key || `op-pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // Idempotency deduplication
    const existing = payments.find((p) => p.idempotency_key && p.idempotency_key === opId);
    if (existing) {
      return existing;
    }

    const targetInvoice = invoices.find((inv) => inv.id === data.invoice_id);
    if (!targetInvoice) {
      throw new Error('الفاتورة غير موجودة');
    }

    const rate = data.exchange_rate_used || targetInvoice.exchange_rate_used || settings.default_exchange_rate || 0;
    if (data.currency === 'USD' || targetInvoice.currency_mode === 'single_usd' || targetInvoice.currency_mode === 'dual') {
      const rateVal = validateExchangeRate(rate);
      if (!rateVal.isValid) {
        throw new Error(rateVal.error || 'سعر الصرف غير صالح ولا يمكن تسجيل دفعة بعملة أجنبية دون سعر صرف معتمد.');
      }
    }
    let amountSdg = 0;
    let amountUsd = 0;

    if (data.currency === 'SDG') {
      amountSdg = data.amount;
      amountUsd = convertCurrency(data.amount, 'SDG', 'USD', rate, settings);
    } else {
      amountUsd = data.amount;
      amountSdg = convertCurrency(data.amount, 'USD', 'SDG', rate, settings);
    }

    const newPaidSdg = safeAdd(targetInvoice.paid_amount_sdg || 0, amountSdg, settings.sdg_decimals);
    const newPaidUsd = safeAdd(targetInvoice.paid_amount_usd || 0, amountUsd, settings.usd_decimals);

    const remainingSdg = Math.max(0, safeSub(targetInvoice.grand_total_sdg, newPaidSdg, settings.sdg_decimals));
    const remainingUsd = Math.max(0, safeSub(targetInvoice.grand_total_usd, newPaidUsd, settings.usd_decimals));

    const newStatus =
      remainingSdg <= 1 && remainingUsd <= 0.05
        ? 'paid'
        : newPaidSdg > 0
        ? 'partially_paid'
        : targetInvoice.status;

    const paymentRecord: Payment = {
      id: 'pay-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      org_id: orgId,
      invoice_id: targetInvoice.id,
      invoice_number: targetInvoice.invoice_number,
      customer_id: targetInvoice.customer_id,
      customer_name: targetInvoice.customer_name,
      amount: data.amount,
      currency: data.currency,
      exchange_rate_used: rate,
      amount_in_other_currency: data.currency === 'SDG' ? amountUsd : amountSdg,
      payment_method: data.payment_method,
      reference_number: data.reference_number,
      payment_date: new Date().toISOString(),
      notes: data.notes,
      idempotency_key: opId,
      operation_id: opId,
      created_at: new Date().toISOString(),
    };

    const updatedInvoiceFields = {
      paid_amount_sdg: newPaidSdg,
      paid_amount_usd: newPaidUsd,
      remaining_sdg: remainingSdg,
      remaining_usd: remainingUsd,
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    setInvoices((prev) =>
      prev.map((inv) => (inv.id === targetInvoice.id ? { ...inv, ...updatedInvoiceFields } : inv))
    );

    let updatedCust: Customer | undefined;
    if (targetInvoice.customer_id) {
      const cust = customers.find((c) => c.id === targetInvoice.customer_id);
      if (cust) {
        updatedCust = {
          ...cust,
          balance_sdg: Math.max(0, safeSub(cust.balance_sdg || 0, amountSdg, settings.sdg_decimals)),
          balance_usd: Math.max(0, safeSub(cust.balance_usd || 0, amountUsd, settings.usd_decimals)),
          updated_at: new Date().toISOString(),
        };
        setCustomers((prev) => prev.map((c) => (c.id === updatedCust!.id ? updatedCust! : c)));
      }
    }

    setPayments((prev) => [paymentRecord, ...prev]);

    // Automatically generate double-entry payment journal voucher with FX variance handling
    const payJv = generatePaymentJournalEntry(paymentRecord, orgId, currentUser?.uid, targetInvoice.exchange_rate_used);
    setJournalEntries((prev) => [payJv, ...prev]);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const batch = writeBatch(db);
        const cleanPayment = cleanFirestoreData(paymentRecord);
        const cleanPayJv = cleanFirestoreData(payJv);

        batch.set(doc(db, 'organizations', orgId, 'payments', paymentRecord.id), cleanPayment);
        batch.set(doc(db, 'organizations', orgId, 'journal_entries', payJv.id), cleanPayJv);
        batch.update(doc(db, 'organizations', orgId, 'invoices', targetInvoice.id), updatedInvoiceFields);

        if (updatedCust) {
          batch.update(doc(db, 'organizations', orgId, 'customers', updatedCust.id), {
            balance_sdg: updatedCust.balance_sdg,
            balance_usd: updatedCust.balance_usd,
            updated_at: updatedCust.updated_at,
          });
        }

        batch.set(
          doc(db, 'organizations', orgId, 'meta', 'counters'),
          { payment_count: increment(1), updated_at: new Date().toISOString() },
          { merge: true }
        );

        batch.set(doc(db, 'organizations', orgId, 'idempotency', opId), {
          id: opId,
          action: 'record_payment',
          resource_id: paymentRecord.id,
          created_at: new Date().toISOString(),
          status: 'completed',
        });

        await batch.commit();

        await logAuditEvent(
          orgId,
          currentUser.uid,
          currentUser.email || '',
          'payment:record',
          'payment',
          paymentRecord.id,
          `تسجيل دفعة للفاتورة #${targetInvoice.invoice_number} بمبلغ ${paymentRecord.amount.toLocaleString()} ${paymentRecord.currency}`
        );
      } catch (e) {
        console.error('Error saving payment to Firestore', e);
      }
    }
    setCounters((prev) => ({ ...prev, payment_count: prev.payment_count + 1 }));

    return paymentRecord;
  };

  // Stock consistency and reconciliation helper
  const reconcileProductStock = (productId: string) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) {
      return { isConsistent: true, currentStock: 0, calculatedStock: 0, difference: 0 };
    }
    const movements = inventoryMovements.filter((m) => m.product_id === productId);
    if (movements.length === 0) {
      return {
        isConsistent: true,
        currentStock: prod.stock_quantity ?? 0,
        calculatedStock: prod.stock_quantity ?? 0,
        difference: 0,
      };
    }
    const sorted = [...movements].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const earliestPrev = sorted[0].previous_stock;
    const netChanges = sorted.reduce((sum, m) => sum + m.quantity, 0);
    const calculatedStock = earliestPrev + netChanges;
    const currentStock = prod.stock_quantity ?? 0;
    return {
      isConsistent: currentStock === calculatedStock,
      currentStock,
      calculatedStock,
      difference: currentStock - calculatedStock,
    };
  };

  // Expenses
  const addExpense = async (expenseData: Omit<Expense, 'id' | 'created_at'>): Promise<Expense> => {
    if (!isActionAllowed('expenses:create')) {
      throw new Error('ليس لديك صلاحية لتسجيل المصروفات');
    }

    if (settings.period_lock_date) {
      const txDate = expenseData.date || new Date().toISOString().split('T')[0];
      if (txDate <= settings.period_lock_date) {
        throw new Error(`لا يمكن تسجيل مصروف في فترة محاسبية مقفلة (تاريخ إقفال الفترة: ${settings.period_lock_date})`);
      }
    }

    const orgId = currentOrg?.id || 'local-guest-org';
    const newExp: Expense = {
      ...expenseData,
      id: 'exp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      org_id: orgId,
      created_at: new Date().toISOString(),
    };
    const updated = [newExp, ...expenses];
    setExpenses(updated);

    // Automatically generate double-entry expense journal voucher
    const expJv = generateExpenseJournalEntry(newExp, orgId, currentUser?.uid);
    setJournalEntries((prev) => [expJv, ...prev]);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const batch = writeBatch(db);
        const cleanExp = cleanFirestoreData(newExp);
        const cleanExpJv = cleanFirestoreData(expJv);
        batch.set(doc(db, 'organizations', orgId, 'expenses', newExp.id), cleanExp);
        batch.set(doc(db, 'organizations', orgId, 'journal_entries', expJv.id), cleanExpJv);
        batch.set(
          doc(db, 'organizations', orgId, 'meta', 'counters'),
          { expense_count: increment(1), updated_at: new Date().toISOString() },
          { merge: true }
        );
        await batch.commit();
      } catch (e) {
        console.error('Error saving expense to Firestore', e);
      }
    }
    setCounters((prev) => ({ ...prev, expense_count: prev.expense_count + 1 }));
    return newExp;
  };

  const deleteExpense = async (id: string) => {
    if (!isActionAllowed('expenses:delete')) {
      throw new Error('ليس لديك صلاحية لحذف المصروفات');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const targetExpense = expenses.find((e) => e.id === id);

    if (settings.period_lock_date && targetExpense) {
      const txDate = targetExpense.date || targetExpense.created_at?.split('T')[0];
      if (txDate && txDate <= settings.period_lock_date) {
        throw new Error(`لا يمكن حذف مصروف مسجل في فترة محاسبية مقفلة (تاريخ إقفال الفترة: ${settings.period_lock_date})`);
      }
    }

    setExpenses(expenses.filter((e) => e.id !== id));

    // ACC-02 Remediation: Compensating Reversal Journal Entry for deleted expense
    let revJv: JournalEntry | null = null;
    if (targetExpense) {
      const expJv = journalEntries.find(
        (jv) => jv.reference_id === id && jv.reference_type === 'expense'
      );
      if (expJv) {
        revJv = {
          id: `jv-rev-exp-${id}`,
          org_id: orgId,
          entry_number: `JV-REV-EXP-${id.substring(0, 8)}`,
          date: new Date().toISOString(),
          description: `قيد عكسي لتسوية حذف المصروف: ${targetExpense.title || ''}`,
          reference_type: 'void',
          reference_id: id,
          exchange_rate_used: expJv.exchange_rate_used,
          created_by: currentUser?.uid,
          created_at: new Date().toISOString(),
          total_debit_sdg: expJv.total_credit_sdg,
          total_credit_sdg: expJv.total_debit_sdg,
          total_debit_usd: expJv.total_credit_usd,
          total_credit_usd: expJv.total_debit_usd,
          is_balanced: true,
          lines: expJv.lines.map((line) => ({
            ...line,
            id: `line-rev-${Math.random().toString(36).substring(2, 7)}`,
            debit_sdg: line.credit_sdg,
            credit_sdg: line.debit_sdg,
            debit_usd: line.credit_usd,
            credit_usd: line.debit_usd,
            description: `عكس قيد: ${line.description || ''}`,
          })),
        };
        setJournalEntries((prev) => [revJv!, ...prev]);
      }
    }

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        const batch = writeBatch(db);
        if (revJv) {
          batch.set(doc(db, 'organizations', orgId, 'journal_entries', revJv.id), cleanFirestoreData(revJv));
        }
        batch.delete(doc(db, 'organizations', orgId, 'expenses', id));
        batch.set(
          doc(db, 'organizations', orgId, 'meta', 'counters'),
          { expense_count: increment(-1), updated_at: new Date().toISOString() },
          { merge: true }
        );
        await batch.commit();
      } catch (e) {
        console.error('Error deleting expense from Firestore', e);
      }
    }
    setCounters((prev) => ({ ...prev, expense_count: Math.max(0, prev.expense_count - 1) }));
  };

  // Accounting & General Ledger Functions
  const addAccount = async (accountData: Omit<Account, 'org_id' | 'created_at'>): Promise<Account> => {
    if (!isActionAllowed('accounts:create')) {
      throw new Error('ليس لديك صلاحية لإنشاء حساب مالي بدليل الحسابات');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const newAcc: Account = {
      ...accountData,
      org_id: orgId,
      created_at: new Date().toISOString(),
    };

    setAccounts((prev) => [...prev, newAcc]);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        await setDoc(doc(db, 'organizations', orgId, 'accounts', newAcc.code), newAcc);
      } catch (e) {
        console.error('Error saving account to Firestore', e);
      }
    }
    return newAcc;
  };

  const updateAccount = async (code: string, updates: Partial<Account>) => {
    if (!isActionAllowed('accounts:update')) {
      throw new Error('ليس لديك صلاحية لتعديل حساب بدليل الحسابات');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    setAccounts((prev) => prev.map((a) => (a.code === code ? { ...a, ...updates, updated_at: new Date().toISOString() } : a)));

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        await setDoc(doc(db, 'organizations', orgId, 'accounts', code), {
          ...updates,
          updated_at: new Date().toISOString(),
        }, { merge: true });
      } catch (e) {
        console.error('Error updating account in Firestore', e);
      }
    }
  };

  const addJournalEntry = async (entryData: Omit<JournalEntry, 'id' | 'created_at' | 'org_id'>): Promise<JournalEntry> => {
    if (!isActionAllowed('journal:create')) {
      throw new Error('ليس لديك صلاحية لإنشاء قيود يومية عامة');
    }

    if (settings.period_lock_date) {
      const txDate = entryData.date || new Date().toISOString().split('T')[0];
      if (txDate <= settings.period_lock_date) {
        throw new Error(`لا يمكن إضافة قيد يومية في فترة محاسبية مقفلة (تاريخ إقفال الفترة: ${settings.period_lock_date})`);
      }
    }

    const orgId = currentOrg?.id || 'local-guest-org';
    const newJv: JournalEntry = {
      ...entryData,
      id: 'jv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      org_id: orgId,
      created_at: new Date().toISOString(),
      created_by: currentUser?.uid,
    };

    setJournalEntries((prev) => [newJv, ...prev]);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        await setDoc(doc(db, 'organizations', orgId, 'journal_entries', newJv.id), newJv);
      } catch (e) {
        console.error('Error saving journal entry to Firestore', e);
      }
    }
    return newJv;
  };

  const resetChartOfAccounts = async () => {
    if (!isActionAllowed('accounts:update')) {
      throw new Error('ليس لديك صلاحية لإعادة ضبط شجرة الحسابات');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const defaults = getDefaultChartOfAccounts(orgId);
    setAccounts(defaults);

    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      try {
        for (const acc of defaults) {
          await setDoc(doc(db, 'organizations', orgId, 'accounts', acc.code), acc);
        }
      } catch (e) {
        console.error('Error resetting chart of accounts in Firestore', e);
      }
    }
  };

  // Reset to initial sample data
  const resetToSampleData = () => {
    setSettings(INITIAL_SETTINGS);
    setCustomers(INITIAL_CUSTOMERS);
    setProducts(INITIAL_PRODUCTS);
    setInvoices(INITIAL_INVOICES);
    setExpenses(INITIAL_EXPENSES);
    setPayments([]);
  };

  // Export JSON backup
  const exportDataJson = (): string => {
    const backup = {
      version: '2.0',
      exported_at: new Date().toISOString(),
      organization: currentOrg,
      members: orgMembers,
      settings,
      customers,
      products,
      invoices,
      payments,
      expenses,
      inventoryMovements,
      accounts,
      journalEntries,
    };
    return JSON.stringify(backup, null, 2);
  };

  // Import JSON backup
  const importDataJson = (jsonString: string): boolean => {
    try {
      const data = JSON.parse(jsonString);
      if (data.organization && typeof data.organization === 'object') {
        setCurrentOrg(data.organization);
      }
      if (Array.isArray(data.members)) setOrgMembers(data.members);
      if (data.settings) setSettings(data.settings);
      if (Array.isArray(data.customers)) setCustomers(data.customers);
      if (Array.isArray(data.products)) setProducts(data.products);
      if (Array.isArray(data.invoices)) setInvoices(data.invoices);
      if (Array.isArray(data.payments)) setPayments(data.payments);
      if (Array.isArray(data.expenses)) setExpenses(data.expenses);
      if (Array.isArray(data.inventoryMovements)) setInventoryMovements(data.inventoryMovements);
      if (Array.isArray(data.accounts)) setAccounts(data.accounts);
      if (Array.isArray(data.journalEntries)) setJournalEntries(data.journalEntries);
      return true;
    } catch (err) {
      console.error('Failed to import JSON', err);
      return false;
    }
  };

  const refreshCounters = async () => {
    if (!currentOrg || currentOrg.id === 'local-guest-org') return;
    try {
      const counterRef = doc(db, 'organizations', currentOrg.id, 'meta', 'counters');
      const snap = await getDoc(counterRef);
      if (snap.exists()) {
        const data = snap.data();
        setCounters({
          invoice_count: data.invoice_count ?? 0,
          customer_count: data.customer_count ?? 0,
          product_count: data.product_count ?? 0,
          expense_count: data.expense_count ?? 0,
          payment_count: data.payment_count ?? 0,
          inventory_movement_count: data.inventory_movement_count ?? 0,
          last_invoice_number: data.last_invoice_number ?? 0,
          updated_at: data.updated_at,
        });
      }
    } catch (e) {
      console.warn('Error refreshing counters:', e);
    }
  };

  const refreshSubscription = async () => {
    if (!currentOrg || currentOrg.id === 'local-guest-org') return;
    try {
      const subRef = doc(db, 'organizations', currentOrg.id, 'meta', 'subscription');
      const snap = await getDoc(subRef);
      if (snap.exists()) {
        const sData = snap.data() as OrgSubscription;
        const planConfig = getPlanConfig(sData.plan);
        setSubscription({
          ...sData,
          max_invoices_per_month: sData.max_invoices_per_month ?? planConfig.max_invoices_per_month,
          max_members: sData.max_members ?? planConfig.max_members,
          max_customers: sData.max_customers ?? planConfig.max_customers,
          max_products: sData.max_products ?? planConfig.max_products,
          features: { ...planConfig.features, ...(sData.features || {}) },
        });
      }
    } catch (e) {
      console.warn('Error refreshing subscription:', e);
    }
  };

  const updateSubscriptionPlan = async (newPlan: SubscriptionPlan) => {
    if (!isActionAllowed('org:update_settings')) {
      throw new Error('ليس لديك صلاحية لتعديل خطة الاشتراك');
    }
    const orgId = currentOrg?.id || 'local-guest-org';
    const planConfig = getPlanConfig(newPlan);
    const updatedSub: OrgSubscription = {
      org_id: orgId,
      plan: newPlan,
      status: 'active',
      max_invoices_per_month: planConfig.max_invoices_per_month,
      max_members: planConfig.max_members,
      max_customers: planConfig.max_customers,
      max_products: planConfig.max_products,
      features: { ...planConfig.features },
      updated_at: new Date().toISOString(),
    };

    setSubscription(updatedSub);
    if (currentUser && currentOrg && currentOrg.id !== 'local-guest-org') {
      await setDoc(doc(db, 'organizations', orgId, 'meta', 'subscription'), updatedSub, { merge: true });
      await logAuditEvent(
        orgId,
        currentUser.uid,
        currentUser.email || '',
        'settings:update',
        'settings',
        orgId,
        `ترقية باقة اشتراك المؤسسة إلى ${planConfig.arabic_name} (${newPlan})`
      );
    }
  };

  const loadMoreInvoices = async () => {
    if (!currentOrg || currentOrg.id === 'local-guest-org' || !lastInvoiceDocRef.current || isLoadingMoreInvoices) return;
    setIsLoadingMoreInvoices(true);
    try {
      const q = query(
        collection(db, 'organizations', currentOrg.id, 'invoices'),
        orderBy('created_at', 'desc'),
        startAfter(lastInvoiceDocRef.current),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMoreInvoices(false);
        return;
      }
      lastInvoiceDocRef.current = snap.docs[snap.docs.length - 1];
      const newItems = snap.docs.map((d) => d.data() as Invoice);
      setInvoices((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const filtered = newItems.filter((i) => !existingIds.has(i.id));
        return [...prev, ...filtered];
      });
      setHasMoreInvoices(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more invoices:', err);
    } finally {
      setIsLoadingMoreInvoices(false);
    }
  };

  const loadMoreCustomers = async () => {
    if (!currentOrg || currentOrg.id === 'local-guest-org' || !lastCustomerDocRef.current || isLoadingMoreCustomers) return;
    setIsLoadingMoreCustomers(true);
    try {
      const q = query(
        collection(db, 'organizations', currentOrg.id, 'customers'),
        orderBy('created_at', 'desc'),
        startAfter(lastCustomerDocRef.current),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMoreCustomers(false);
        return;
      }
      lastCustomerDocRef.current = snap.docs[snap.docs.length - 1];
      const newItems = snap.docs.map((d) => d.data() as Customer);
      setCustomers((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const filtered = newItems.filter((c) => !existingIds.has(c.id));
        return [...prev, ...filtered];
      });
      setHasMoreCustomers(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more customers:', err);
    } finally {
      setIsLoadingMoreCustomers(false);
    }
  };

  const loadMoreProducts = async () => {
    if (!currentOrg || currentOrg.id === 'local-guest-org' || !lastProductDocRef.current || isLoadingMoreProducts) return;
    setIsLoadingMoreProducts(true);
    try {
      const q = query(
        collection(db, 'organizations', currentOrg.id, 'products'),
        orderBy('created_at', 'desc'),
        startAfter(lastProductDocRef.current),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMoreProducts(false);
        return;
      }
      lastProductDocRef.current = snap.docs[snap.docs.length - 1];
      const newItems = snap.docs.map((d) => d.data() as Product);
      setProducts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const filtered = newItems.filter((p) => !existingIds.has(p.id));
        return [...prev, ...filtered];
      });
      setHasMoreProducts(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more products:', err);
    } finally {
      setIsLoadingMoreProducts(false);
    }
  };

  const loadMoreExpenses = async () => {
    if (!currentOrg || currentOrg.id === 'local-guest-org' || !lastExpenseDocRef.current || isLoadingMoreExpenses) return;
    setIsLoadingMoreExpenses(true);
    try {
      const q = query(
        collection(db, 'organizations', currentOrg.id, 'expenses'),
        orderBy('created_at', 'desc'),
        startAfter(lastExpenseDocRef.current),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMoreExpenses(false);
        return;
      }
      lastExpenseDocRef.current = snap.docs[snap.docs.length - 1];
      const newItems = snap.docs.map((d) => d.data() as Expense);
      setExpenses((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const filtered = newItems.filter((e) => !existingIds.has(e.id));
        return [...prev, ...filtered];
      });
      setHasMoreExpenses(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more expenses:', err);
    } finally {
      setIsLoadingMoreExpenses(false);
    }
  };

  const loadMorePayments = async () => {
    if (!currentOrg || currentOrg.id === 'local-guest-org' || !lastPaymentDocRef.current || isLoadingMorePayments) return;
    setIsLoadingMorePayments(true);
    try {
      const q = query(
        collection(db, 'organizations', currentOrg.id, 'payments'),
        orderBy('created_at', 'desc'),
        startAfter(lastPaymentDocRef.current),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMorePayments(false);
        return;
      }
      lastPaymentDocRef.current = snap.docs[snap.docs.length - 1];
      const newItems = snap.docs.map((d) => d.data() as Payment);
      setPayments((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const filtered = newItems.filter((p) => !existingIds.has(p.id));
        return [...prev, ...filtered];
      });
      setHasMorePayments(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more payments:', err);
    } finally {
      setIsLoadingMorePayments(false);
    }
  };

  const loadMoreInventoryMovements = async () => {
    if (!currentOrg || currentOrg.id === 'local-guest-org' || !lastMovementDocRef.current || isLoadingMoreInventoryMovements) return;
    setIsLoadingMoreInventoryMovements(true);
    try {
      const q = query(
        collection(db, 'organizations', currentOrg.id, 'inventory_movements'),
        orderBy('created_at', 'desc'),
        startAfter(lastMovementDocRef.current),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMoreInventoryMovements(false);
        return;
      }
      lastMovementDocRef.current = snap.docs[snap.docs.length - 1];
      const newItems = snap.docs.map((d) => d.data() as InventoryMovement);
      setInventoryMovements((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const filtered = newItems.filter((m) => !existingIds.has(m.id));
        return [...prev, ...filtered];
      });
      setHasMoreInventoryMovements(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more inventory movements:', err);
    } finally {
      setIsLoadingMoreInventoryMovements(false);
    }
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        authLoading,
        syncStatus,
        lastSyncedAt,
        settings,
        customers,
        products,
        invoices,
        payments,
        expenses,
        inventoryMovements,
        accounts,
        journalEntries,
        counters,
        refreshCounters,
        subscription,
        refreshSubscription,
        updateSubscriptionPlan,
        hasMoreInvoices,
        isLoadingMoreInvoices,
        loadMoreInvoices,
        hasMoreCustomers,
        isLoadingMoreCustomers,
        loadMoreCustomers,
        hasMoreProducts,
        isLoadingMoreProducts,
        loadMoreProducts,
        hasMoreExpenses,
        isLoadingMoreExpenses,
        loadMoreExpenses,
        hasMorePayments,
        isLoadingMorePayments,
        loadMorePayments,
        hasMoreInventoryMovements,
        isLoadingMoreInventoryMovements,
        loadMoreInventoryMovements,
        theme,
        setTheme,
        toggleTheme,
        currentOrg,
        userOrgs,
        userRole,
        memberStatus,
        orgMembers,
        switchOrganization,
        createNewOrg,
        inviteMember,
        updateMemberRole,
        removeMember,
        suspendMember,
        reactivateMember,
        isActionAllowed,
        updateSettings,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        addProduct,
        updateProduct,
        updateProductStock,
        deleteProduct,
        createInvoice,
        updateInvoice,
        deleteInvoice,
        voidInvoice,
        recordPayment,
        reconcileProductStock,
        addExpense,
        deleteExpense,
        addAccount,
        updateAccount,
        addJournalEntry,
        resetChartOfAccounts,
        syncAllToCloud,
        getNextInvoiceNumber,
        resetToSampleData,
        exportDataJson,
        importDataJson,
        logoutUser,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
