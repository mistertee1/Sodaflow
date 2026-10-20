import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { SubscriptionBanner } from './components/SubscriptionBanner';
const SuperAdminPage = lazy(() => import('./components/SuperAdminPage').then(module => ({ default: module.SuperAdminPage })));
const DashboardView = lazy(() => import('./components/DashboardView').then(module => ({ default: module.DashboardView })));
const InvoicesView = lazy(() => import('./components/InvoicesView').then(module => ({ default: module.InvoicesView })));
const CustomersView = lazy(() => import('./components/CustomersView').then(module => ({ default: module.CustomersView })));
const ProductsView = lazy(() => import('./components/ProductsView').then(module => ({ default: module.ProductsView })));
const ExpensesView = lazy(() => import('./components/ExpensesView').then(module => ({ default: module.ExpensesView })));
const AccountingView = lazy(() => import('./components/AccountingView').then(module => ({ default: module.AccountingView })));
const InvoiceFormModal = lazy(() => import('./components/InvoiceFormModal').then(module => ({ default: module.InvoiceFormModal })));
const InvoiceDetailModal = lazy(() => import('./components/InvoiceDetailModal').then(module => ({ default: module.InvoiceDetailModal })));
const InvoiceWorkspaceView = lazy(() => import('./components/InvoiceWorkspaceView').then(module => ({ default: module.InvoiceWorkspaceView })));
const InvoiceShareDialog = lazy(() => import('./components/InvoiceShareDialog').then(module => ({ default: module.InvoiceShareDialog })));
import { PaymentModal } from './components/PaymentModal';
const PaymentReceiptModal = lazy(() => import('./components/PaymentReceiptModal').then(module => ({ default: module.PaymentReceiptModal })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then(module => ({ default: module.SettingsModal })));
import { OnboardingModal } from './components/OnboardingModal';
import { LandingPageView } from './components/LandingPageView';
import { Footer } from './components/Footer';
import { LegalModal, LegalTab } from './components/LegalModal';
import { Invoice, Customer, Payment } from './types';
import { RefreshCw, Store } from 'lucide-react';
import { trackPageView } from './lib/analytics';

function MainLayout() {
  const { currentUser, authLoading, memberStatus, syncStatus, syncError, lastSyncedAt, logoutUser, dismissSyncError, syncAllToCloud, isActionAllowed, currentOrg, invoices } = useApp();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isNewInvoiceOpen, setIsNewInvoiceOpen] = useState(false);
  const [prefilledCustomer, setPrefilledCustomer] = useState<Customer | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [previewingInvoice, setPreviewingInvoice] = useState<Invoice | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Payment | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [showAuthLanding, setShowAuthLanding] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalTab | null>(null);
  const [standaloneShareInvoice, setStandaloneShareInvoice] = useState<Invoice | null>(null);
  const [pendingShareId, setPendingShareId] = useState(() => new URL(window.location.href).searchParams.get('share-invoice'));

  useEffect(() => {
    setViewingInvoice(null); setPreviewingInvoice(null); setPayingInvoice(null); setViewingReceipt(null); setIsNewInvoiceOpen(false); setPrefilledCustomer(null); setStandaloneShareInvoice(null);
  }, [currentOrg?.id, currentUser?.uid]);

  // Track virtual page views for SPA navigation in Google Analytics
  useEffect(() => {
    if (viewingInvoice) {
      trackPageView(`/invoices/${viewingInvoice.id}`, `فاتورة - ${viewingInvoice.invoice_number}`);
      return;
    }
    trackPageView(`/${activeTab}`, `محاسبة وفواتير - ${activeTab}`);
  }, [activeTab, viewingInvoice?.id, viewingInvoice?.invoice_number]);

  // Opening outside an embedded preview restores the browser's own sharing policy.
  // Resolve only against invoices already authorized and loaded by AppContext.
  useEffect(() => {
    if (authLoading || !pendingShareId || !currentUser) return;
    const invoice = invoices.find(item => item.id === pendingShareId);
    if (!invoice) return;
    setStandaloneShareInvoice(invoice); setActiveTab('invoices'); setPendingShareId(null);
    const url = new URL(window.location.href); url.searchParams.delete('share-invoice');
    window.history.replaceState(window.history.state, '', url);
  }, [authLoading, currentUser, invoices, pendingShareId]);

  // Loading screen while Firebase Auth state initializes
  if (authLoading) {
    return (
      <div className="min-h-screen bg-sf-canvas flex flex-col items-center justify-center text-sf-text p-4">
        <div className="w-14 h-14 rounded-2xl bg-sf-action/10 border border-sf-action/30 text-sf-action flex items-center justify-center mb-4 shadow-lg shadow-sf-action/10">
          <Store className="w-7 h-7 text-sf-action" />
        </div>
        <div className="flex items-center gap-2 text-sf-action font-semibold text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>جاري تهيئة سودافلو...</span>
        </div>
      </div>
    );
  }

  // Business screens require Firebase authentication; no local guest datastore.
  if (!currentUser || showAuthLanding) {
    return (
      <LandingPageView
        onLoginSuccess={() => {
          setShowAuthLanding(false);
        }}
      />
    );
  }

  if (!lastSyncedAt) {
    return <main className="min-h-screen bg-sf-canvas text-sf-text flex items-center justify-center p-4" dir="rtl">
      <section className="sf-card w-full max-w-lg p-6 space-y-4" aria-label="الاتصال بالسحابة">
        <Store className="w-8 h-8 text-sf-action" aria-hidden="true" />
        <h1 className="text-xl font-semibold">الاتصال بمؤسستك على Firebase</h1>
        <p className="text-sm text-sf-muted">يلزم اتصال بالسحابة لتحميل سجلاتك. لن تظهر أرصدة أو فواتير من نسخة محلية.</p>
        {syncError ? <p role="alert" className="text-sf-danger">{syncError}</p> : <p role="status">جاري تحميل البيانات السحابية…</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="sf-action" disabled={syncStatus === 'syncing'} onClick={() => void syncAllToCloud()}>إعادة المحاولة</button>
          <button type="button" className="sf-secondary" onClick={() => void logoutUser()}>تسجيل الخروج</button>
        </div>
      </section>
    </main>;
  }

  const handleOpenNewInvoice = (customer?: Customer) => {
    setPrefilledCustomer(customer || null);
    setIsNewInvoiceOpen(true);
  };

  const handleNavigate = (tab: string) => {
    setViewingInvoice(null);
    setActiveTab(tab);
  };

  const handleOpenInvoice = (invoice: Invoice) => {
    setActiveTab('invoices');
    setViewingInvoice(invoice);
  };

  const handlePaymentRecorded = (payment: Payment) => {
    // Open receipt modal right after payment is recorded
    setViewingReceipt(payment);
  };

  return (
    <div
      className="sf-app-shell min-h-screen bg-sf-canvas text-sf-text flex flex-col font-sans antialiased selection:bg-sf-action selection:text-sf-on-action transition-colors"
    >
      {/* Top Header */}
      <Header
        onOpenNewInvoice={() => handleOpenNewInvoice()}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
        onOpenAuth={() => setShowAuthLanding(true)}
        onOpenLegal={(tab) => setLegalModalTab(tab)}
      />

      {syncError && <div role="alert" className="no-print border-b border-sf-danger bg-sf-danger-bg text-sf-danger px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <span>{syncError}</span>
        <div className="flex gap-3"><button type="button" onClick={() => void syncAllToCloud()} className="underline">إعادة المحاولة</button><button type="button" aria-label="إغلاق التنبيه" onClick={dismissSyncError}>إغلاق</button></div>
      </div>}
      {/* Security Banner if member account is suspended in the active organization */}
      <SubscriptionBanner onManage={() => setIsSettingsOpen(true)} />
      {memberStatus === 'suspended' && (
        <div className="bg-sf-danger-bg/90 border-b border-sf-danger text-sf-danger px-4 py-2.5 flex items-center justify-between gap-3 text-xs shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              <strong>تنبيه أمني:</strong> حسابك في هذه المؤسسة معلق حالياً من قِبل الإدارة. تم تعطيل صلاحيات التعديل والإدخال والوصول إلى السجلات الحساسة.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="px-2.5 py-1 bg-sf-danger-bg/80 hover:bg-sf-danger-bg text-sf-danger rounded-lg text-xs font-semibold border border-sf-danger shrink-0 transition-colors"
          >
            إدارة المؤسسة
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="sf-content sf-main flex-1">
        <Suspense fallback={<div role="status" className="p-6 text-sf-muted">جاري التحميل…</div>}>
          {viewingInvoice ? (
            <InvoiceWorkspaceView
              invoice={invoices.find(item => item.id === viewingInvoice.id) || viewingInvoice}
              onBack={() => setViewingInvoice(null)}
              onOpenDocument={(invoice) => setPreviewingInvoice(invoice)}
              onOpenRecordPayment={(invoice) => setPayingInvoice(invoice)}
            />
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <DashboardView
                  onNavigate={handleNavigate}
                  onOpenNewInvoice={() => handleOpenNewInvoice()}
                  onViewInvoice={handleOpenInvoice}
                />
              )}

              {activeTab === 'invoices' && (
                <InvoicesView
                  onOpenNewInvoice={() => handleOpenNewInvoice()}
                  onViewInvoice={handleOpenInvoice}
                  onOpenRecordPayment={(inv) => setPayingInvoice(inv)}
                />
              )}

              {activeTab === 'customers' && (
                <CustomersView
                  onOpenNewInvoiceForCustomer={(cust) => handleOpenNewInvoice(cust)}
                  onViewInvoice={handleOpenInvoice}
                />
              )}

              {activeTab === 'products' && <ProductsView />}

              {activeTab === 'expenses' && isActionAllowed('expenses:read') && <ExpensesView />}

              {activeTab === 'accounting' && isActionAllowed('journal:read') && <AccountingView />}
            </>
          )}
        </Suspense>
      </main>

      {/* Structured Footer with Legal Pages */}
      <Footer onOpenLegal={(tab) => setLegalModalTab(tab)} />

      {/* Mobile Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={handleNavigate}
        onOpenNewInvoice={() => handleOpenNewInvoice()}
      />

      {/* Modals */}
      <Suspense fallback={<div role="status" className="fixed inset-0 z-50 bg-sf-ink/60 flex items-center justify-center text-white">جاري فتح النافذة…</div>}>
      {standaloneShareInvoice && <InvoiceShareDialog invoice={standaloneShareInvoice} onClose={() => setStandaloneShareInvoice(null)} />}
      {isNewInvoiceOpen && (<InvoiceFormModal
        isOpen={isNewInvoiceOpen}
        onClose={() => {
          setIsNewInvoiceOpen(false);
          setPrefilledCustomer(null);
        }}
        onInvoiceCreated={(invoice) => {
          handleOpenInvoice(invoice);
          setIsNewInvoiceOpen(false);
          setPrefilledCustomer(null);
        }}
        prefilledCustomer={prefilledCustomer}
      /> )}

      {previewingInvoice && (<InvoiceDetailModal
        invoice={invoices.find(i => i.id === previewingInvoice?.id) || previewingInvoice}
        onClose={() => setPreviewingInvoice(null)}
        onOpenRecordPayment={(inv) => setPayingInvoice(inv)}
      /> )}

      <PaymentModal
        invoice={invoices.find(i => i.id === payingInvoice?.id) || payingInvoice}
        isOpen={!!payingInvoice}
        onClose={() => setPayingInvoice(null)}
        onPaymentRecorded={handlePaymentRecorded}
      />

      {viewingReceipt && (<PaymentReceiptModal
        payment={viewingReceipt}
        onClose={() => setViewingReceipt(null)}
      /> )}

      {isSettingsOpen && (<SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      /> )}

      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
      />

      </Suspense>
      <LegalModal
        isOpen={!!legalModalTab}
        initialTab={legalModalTab || 'privacy'}
        onClose={() => setLegalModalTab(null)}
      />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Suspense fallback={<div role="status" className="p-8 text-sf-muted">جاري تحميل سودافلو…</div>}>{window.location.pathname === '/super-admin' || window.location.pathname.startsWith('/super-admin/') ? <SuperAdminPage /> : <MainLayout />}</Suspense>
    </AppProvider>
  );
}

export default App;
