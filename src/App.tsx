import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
const DashboardView = lazy(() => import('./components/DashboardView').then(module => ({ default: module.DashboardView })));
const InvoicesView = lazy(() => import('./components/InvoicesView').then(module => ({ default: module.InvoicesView })));
const CustomersView = lazy(() => import('./components/CustomersView').then(module => ({ default: module.CustomersView })));
const ProductsView = lazy(() => import('./components/ProductsView').then(module => ({ default: module.ProductsView })));
const ExpensesView = lazy(() => import('./components/ExpensesView').then(module => ({ default: module.ExpensesView })));
const AccountingView = lazy(() => import('./components/AccountingView').then(module => ({ default: module.AccountingView })));
const InvoiceFormModal = lazy(() => import('./components/InvoiceFormModal').then(module => ({ default: module.InvoiceFormModal })));
const InvoiceDetailModal = lazy(() => import('./components/InvoiceDetailModal').then(module => ({ default: module.InvoiceDetailModal })));
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
  const { currentUser, authLoading, theme, memberStatus, syncError, dismissSyncError, syncAllToCloud, isActionAllowed, currentOrg, invoices } = useApp();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isNewInvoiceOpen, setIsNewInvoiceOpen] = useState(false);
  const [prefilledCustomer, setPrefilledCustomer] = useState<Customer | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Payment | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [showAuthLanding, setShowAuthLanding] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalTab | null>(null);

  useEffect(() => {
    setViewingInvoice(null); setPayingInvoice(null); setViewingReceipt(null); setIsNewInvoiceOpen(false); setPrefilledCustomer(null);
  }, [currentOrg?.id, currentUser?.uid]);

  // Track virtual page views for SPA navigation in Google Analytics
  useEffect(() => {
    trackPageView(`/${activeTab}`, `محاسبة وفواتير - ${activeTab}`);
  }, [activeTab]);

  const [guestMode, setGuestMode] = useState<boolean>(() => {
    return localStorage.getItem('mohasbasd_guest_session') === 'true';
  });

  // Synchronize guest state whenever auth user state changes
  useEffect(() => {
    if (!currentUser) {
      setGuestMode(localStorage.getItem('mohasbasd_guest_session') === 'true');
    } else {
      setGuestMode(false);
    }
  }, [currentUser]);

  // Check if first-time user to show onboarding tour
  useEffect(() => {
    const hasSeen = localStorage.getItem('sudanese_merchant_has_seen_tour_v2');
    if (!hasSeen && (currentUser || guestMode)) {
      setIsOnboardingOpen(true);
      localStorage.setItem('sudanese_merchant_has_seen_tour_v2', 'true');
    }
  }, [currentUser, guestMode]);

  // Loading screen while Firebase Auth state initializes
  if (authLoading) {
    return (
      <div className="min-h-screen bg-sf-canvas flex flex-col items-center justify-center text-sf-text p-4">
        <div className="w-14 h-14 rounded-2xl bg-sf-action/10 border border-sf-action/30 text-sf-action flex items-center justify-center mb-4 shadow-lg shadow-sf-action/10">
          <Store className="w-7 h-7 text-sf-action" />
        </div>
        <div className="flex items-center gap-2 text-sf-action font-bold text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>جاري تهيئة سودافلو...</span>
        </div>
      </div>
    );
  }

  // If user is not logged in and hasn't chosen guest mode (or explicitly wants auth), show Landing Page
  if ((!currentUser && !guestMode) || showAuthLanding) {
    return (
      <LandingPageView
        onContinueAsGuest={() => {
          localStorage.setItem('mohasbasd_guest_session', 'true');
          setGuestMode(true);
          setShowAuthLanding(false);
        }}
        onLoginSuccess={() => {
          setGuestMode(false);
          setShowAuthLanding(false);
        }}
      />
    );
  }

  const handleOpenNewInvoice = (customer?: Customer) => {
    setPrefilledCustomer(customer || null);
    setIsNewInvoiceOpen(true);
  };

  const handlePaymentRecorded = (payment: Payment) => {
    // Open receipt modal right after payment is recorded
    setViewingReceipt(payment);
  };

  return (
    <div
      className={`min-h-screen ${
        theme === 'light' ? 'bg-sf-canvas text-sf-text' : 'bg-sf-canvas text-sf-text'
      } flex flex-col font-sans antialiased selection:bg-sf-action selection:text-sf-on-action transition-colors duration-200`}
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
            className="px-2.5 py-1 bg-sf-danger-bg/80 hover:bg-rose-800 text-sf-danger rounded-lg text-xs font-bold border border-sf-danger shrink-0 transition-colors"
          >
            إدارة المؤسسة
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-3 sm:p-6 mb-16 sm:mb-6">
<Suspense fallback={<div role="status" className="p-6 text-sf-muted">جاري التحميل…</div>}>
        {activeTab === 'dashboard' && (
          <DashboardView
            onNavigate={(tab) => setActiveTab(tab)}
            onOpenNewInvoice={() => handleOpenNewInvoice()}
            onViewInvoice={(inv) => setViewingInvoice(inv)}
          />
        )}

        {activeTab === 'invoices' && (
          <InvoicesView
            onOpenNewInvoice={() => handleOpenNewInvoice()}
            onViewInvoice={(inv) => setViewingInvoice(inv)}
            onOpenRecordPayment={(inv) => setPayingInvoice(inv)}
          />
        )}

        {activeTab === 'customers' && (
          <CustomersView
            onOpenNewInvoiceForCustomer={(cust) => handleOpenNewInvoice(cust)}
            onViewInvoice={(inv) => setViewingInvoice(inv)}
          />
        )}

        {activeTab === 'products' && <ProductsView />}

        {activeTab === 'expenses' && isActionAllowed('expenses:read') && <ExpensesView />}

        {activeTab === 'accounting' && isActionAllowed('journal:read') && <AccountingView />}
      </Suspense></main>

      {/* Structured Footer with Legal Pages */}
      <Footer onOpenLegal={(tab) => setLegalModalTab(tab)} />

      {/* Mobile Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={(tab) => setActiveTab(tab)}
        onOpenNewInvoice={() => handleOpenNewInvoice()}
      />

      {/* Modals */}
      <Suspense fallback={<div role="status" className="fixed inset-0 z-50 bg-sf-ink/60 flex items-center justify-center text-white">جاري فتح النافذة…</div>}>
      {isNewInvoiceOpen && (<InvoiceFormModal
        isOpen={isNewInvoiceOpen}
        onClose={() => {
          setIsNewInvoiceOpen(false);
          setPrefilledCustomer(null);
        }}
        onInvoiceCreated={(invoice) => {
          setViewingInvoice(invoice);
          setIsNewInvoiceOpen(false);
          setPrefilledCustomer(null);
        }}
        prefilledCustomer={prefilledCustomer}
      /> )}

      {viewingInvoice && (<InvoiceDetailModal
        invoice={invoices.find(i => i.id === viewingInvoice?.id) || viewingInvoice}
        onClose={() => setViewingInvoice(null)}
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
      <Suspense fallback={<div role="status" className="p-8 text-sf-muted">جاري تحميل سودافلو…</div>}><MainLayout /></Suspense>
    </AppProvider>
  );
}

export default App;
