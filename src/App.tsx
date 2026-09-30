import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { DashboardView } from './components/DashboardView';
import { InvoicesView } from './components/InvoicesView';
import { CustomersView } from './components/CustomersView';
import { ProductsView } from './components/ProductsView';
import { ExpensesView } from './components/ExpensesView';
import { AccountingView } from './components/AccountingView';
import { InvoiceFormModal } from './components/InvoiceFormModal';
import { InvoiceDetailModal } from './components/InvoiceDetailModal';
import { PaymentModal } from './components/PaymentModal';
import { PaymentReceiptModal } from './components/PaymentReceiptModal';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingModal } from './components/OnboardingModal';
import { LandingPageView } from './components/LandingPageView';
import { Footer } from './components/Footer';
import { LegalModal, LegalTab } from './components/LegalModal';
import { Invoice, Customer, Payment } from './types';
import { RefreshCw, Store } from 'lucide-react';
import { trackPageView } from './lib/analytics';

function MainLayout() {
  const { currentUser, authLoading, theme, memberStatus } = useApp();
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
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-slate-100 p-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/10">
          <Store className="w-7 h-7 text-emerald-400" />
        </div>
        <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>جاري تهيئة نظام التاجر السوداني...</span>
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
        theme === 'light' ? 'bg-[#f8fafc] text-slate-900' : 'bg-[#050505] text-slate-100'
      } flex flex-col font-sans antialiased selection:bg-emerald-500 selection:text-slate-950 transition-colors duration-200`}
    >
      {/* Top Header */}
      <Header
        onOpenNewInvoice={() => handleOpenNewInvoice()}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
        onOpenAuth={() => setShowAuthLanding(true)}
        onOpenLegal={(tab) => setLegalModalTab(tab)}
      />

      {/* Security Banner if member account is suspended in the active organization */}
      {memberStatus === 'suspended' && (
        <div className="bg-rose-950/90 border-b border-rose-800 text-rose-200 px-4 py-2.5 flex items-center justify-between gap-3 text-xs shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              <strong>تنبيه أمني:</strong> حسابك في هذه المؤسسة معلق حالياً من قِبل الإدارة. تم تعطيل صلاحيات التعديل والإدخال والوصول إلى السجلات الحساسة.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="px-2.5 py-1 bg-rose-900/80 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-bold border border-rose-700 shrink-0 transition-colors"
          >
            إدارة المؤسسة
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-3 sm:p-6 mb-16 sm:mb-6">
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

        {activeTab === 'expenses' && <ExpensesView />}

        {activeTab === 'accounting' && <AccountingView />}
      </main>

      {/* Structured Footer with Legal Pages */}
      <Footer onOpenLegal={(tab) => setLegalModalTab(tab)} />

      {/* Mobile Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={(tab) => setActiveTab(tab)}
        onOpenNewInvoice={() => handleOpenNewInvoice()}
      />

      {/* Modals */}
      <InvoiceFormModal
        isOpen={isNewInvoiceOpen}
        onClose={() => {
          setIsNewInvoiceOpen(false);
          setPrefilledCustomer(null);
        }}
        onInvoiceCreated={() => {
          setIsNewInvoiceOpen(false);
          setPrefilledCustomer(null);
        }}
        prefilledCustomer={prefilledCustomer}
      />

      <InvoiceDetailModal
        invoice={viewingInvoice}
        onClose={() => setViewingInvoice(null)}
        onOpenRecordPayment={(inv) => setPayingInvoice(inv)}
      />

      <PaymentModal
        invoice={payingInvoice}
        isOpen={!!payingInvoice}
        onClose={() => setPayingInvoice(null)}
        onPaymentRecorded={handlePaymentRecorded}
      />

      <PaymentReceiptModal
        payment={viewingReceipt}
        onClose={() => setViewingReceipt(null)}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
      />

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
      <MainLayout />
    </AppProvider>
  );
}

export default App;
