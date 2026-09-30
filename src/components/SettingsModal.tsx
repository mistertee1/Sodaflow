import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { BrandLogo } from './BrandLogo';
import {
  X,
  CheckCircle2,
  Building2,
  Lock,
  Download,
  Upload,
  RefreshCw,
  Sliders,
  LogIn,
  LogOut,
  ShieldCheck,
  Smartphone,
  Image as ImageIcon,
  Trash2,
  Cloud,
  Check,
  Store,
  Sun,
  Moon,
  Loader2,
  AlertCircle,
  Zap,
  TrendingUp,
  CreditCard,
  Sparkles,
} from 'lucide-react';
import { signInWithGoogle, logout } from '../lib/firebase';
import { validateExchangeRate, formatMoney, getCurrencySymbol } from '../lib/currency';
import { Currency, SubscriptionPlan } from '../types';
import { PLAN_TIERS, getPlanConfig, isUnlimited } from '../lib/plans';
import { TeamManagementSection } from './TeamManagementSection';
import {
  uploadOrganizationImage,
  validateImageFile,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from '../services/storageService';

const AVAILABLE_CURRENCIES: { code: Currency; label: string }[] = [
  { code: 'SDG', label: 'جنيه سوداني (SDG)' },
  { code: 'USD', label: 'دولار أمريكي (USD)' },
  { code: 'SAR', label: 'ريال سعودي (SAR)' },
  { code: 'AED', label: 'درهم إماراتي (AED)' },
  { code: 'EUR', label: 'يورو (EUR)' },
  { code: 'GBP', label: 'جنيه إسترليني (GBP)' },
  { code: 'EGP', label: 'جنيه مصري (EGP)' },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const {
    settings,
    updateSettings,
    currentUser,
    currentOrg,
    syncStatus,
    lastSyncedAt,
    syncAllToCloud,
    exportDataJson,
    importDataJson,
    resetToSampleData,
    theme,
    setTheme,
    logoutUser,
    subscription,
    counters,
    updateSubscriptionPlan,
    orgMembers,
    userRole,
  } = useApp();

  const [businessName, setBusinessName] = useState(settings.business_name);
  const [phone, setPhone] = useState(settings.phone);
  const [address, setAddress] = useState(settings.address || '');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [updatingPlan, setUpdatingPlan] = useState(false);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(settings.logo_url);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [logoUploadProgress, setLogoUploadProgress] = useState(0);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [bankDetails, setBankDetails] = useState(settings.bank_details || '');
  const [defaultRate, setDefaultRate] = useState<number>(settings.default_exchange_rate || 0);
  const [primaryCurrency, setPrimaryCurrency] = useState<Currency>(settings.primary_currency || 'SDG');
  const [secondaryCurrency, setSecondaryCurrency] = useState<Currency>(settings.secondary_currency || 'USD');
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoice_prefix || 'INV-');
  const [defaultNotes, setDefaultNotes] = useState(settings.default_invoice_notes || '');
  const [roundingRule, setRoundingRule] = useState<'round' | 'ceil' | 'floor'>(
    settings.rounding_rule || 'round'
  );

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setLogoUploadError(null);

    // 1. Client-side file size & MIME validation before upload
    const validation = validateImageFile(file, MAX_IMAGE_FILE_SIZE_BYTES);
    if (!validation.isValid) {
      setLogoUploadError(validation.error || 'ملف الشعار غير صالح.');
      return;
    }

    // 2. Authentication check
    if (!currentUser) {
      setLogoUploadError('يرجى تسجيل الدخول بحساب المؤسسة أولاً لرفع الشعار إلى التخزين السحابي.');
      return;
    }

    const orgId = currentOrg && currentOrg.id !== 'local-guest-org' ? currentOrg.id : `org-${currentUser.uid}`;

    setIsUploadingLogo(true);
    setLogoUploadProgress(0);

    try {
      const downloadUrl = await uploadOrganizationImage({
        file,
        orgId,
        folder: 'logos',
        onProgress: (pct) => setLogoUploadProgress(pct),
      });
      setLogoUrl(downloadUrl);
    } catch (err: any) {
      console.error('Failed to upload logo to Firebase Storage:', err);
      setLogoUploadError(err.message || 'فشل رفع الشعار إلى التخزين السحابي.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isUploadingLogo) {
      alert('يرجى الانتظار حتى يكتمل رفع الشعار إلى التخزين السحابي.');
      return;
    }
    const rateVal = validateExchangeRate(defaultRate);
    if (!rateVal.isValid) {
      alert(rateVal.error || 'يرجى إدخال سعر صرف افتراضي صحيح وموجب للمنشأة.');
      return;
    }

    await updateSettings({
      business_name: businessName.trim(),
      phone: phone.trim(),
      address: address.trim() || '',
      logo_url: logoUrl || '',
      bank_details: bankDetails.trim() || '',
      default_exchange_rate: rateVal.rate,
      primary_currency: primaryCurrency,
      secondary_currency: secondaryCurrency,
      currencies_configured: true,
      invoice_prefix: invoicePrefix.trim(),
      default_invoice_notes: defaultNotes.trim(),
      rounding_rule: roundingRule,
    });
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 900);
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    await syncAllToCloud();
    setIsSyncing(false);
  };

  const handleExportBackup = () => {
    const json = exportDataJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sudanese_merchant_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const ok = importDataJson(content);
        if (ok) {
          setImportStatus('تم استيراد النسخة الاحتياطية بنجاح!');
        } else {
          setImportStatus('فشل استيراد الملف. تأكد من صحة الملف.');
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#050505]/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#0c0c0f] rounded-2xl shadow-2xl border border-[#1e1e24] max-w-2xl w-full my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 text-xs sm:text-sm text-slate-100">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#1e1e24] bg-[#121216] rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">إعدادات المتجر وسعر الصرف</h2>
              <p className="text-xs text-slate-400">تخصيص بيانات الفواتير وسعر الصرف والعملتين والمزامنة السحابية</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#1a1a24] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Container */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {saveSuccess && (
            <div className="p-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>تم حفظ كافة الإعدادات وتحديث سعر الصرف بنجاح!</span>
            </div>
          )}

          {/* Section 1: Account & Cloud Sync */}
          <div className="bg-[#121216] p-4 rounded-xl border border-[#1e1e24] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-xs text-white">حساب التاجر والمزامنة السحابية</h3>
              </div>
              <div className="flex items-center gap-2">
                {currentUser && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-medium ${
                    syncStatus === 'synced'
                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50'
                      : syncStatus === 'syncing'
                      ? 'bg-amber-950/80 text-amber-400 border border-amber-800/50'
                      : 'bg-slate-900 text-slate-400 border border-slate-700'
                  }`}>
                    {syncStatus === 'synced' ? '✓ متصل ومزامَن' : syncStatus === 'syncing' ? 'جاري المزامنة...' : 'جاهز'}
                  </span>
                )}
              </div>
            </div>

            {currentUser ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-[#16161f] p-3 rounded-lg border border-[#22222d]">
                  <div className="flex items-center gap-3">
                    {currentUser.photoURL ? (
                      <img
                        src={currentUser.photoURL}
                        alt="User"
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full ring-2 ring-emerald-500/40"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center font-bold text-xs">
                        {currentUser.displayName?.[0] || 'U'}
                      </div>
                    )}
                    <div>
                      <div className="font-bold text-xs text-white">{currentUser.displayName || 'تاجر'}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{currentUser.email}</div>
                      <div className="text-[10px] text-emerald-400 mt-0.5">
                        ✓ حساب سحابي آمن ومشفر عبر Firebase
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => logoutUser()}
                    className="px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-950/40 rounded-lg border border-rose-800/60 flex items-center gap-1 font-medium transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>تسجيل خروج</span>
                  </button>
                </div>

                {/* Cloud Sync Manual Trigger */}
                <div className="flex items-center justify-between pt-1 text-xs">
                  <div className="text-[11px] text-slate-400">
                    {lastSyncedAt ? (
                      <span>آخر مزامنة سحابية: {lastSyncedAt.toLocaleTimeString('ar-EG')}</span>
                    ) : (
                      <span>المزامنة التلقائية مع السحابة مفعلة</span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={handleManualSync}
                    className="bg-[#1a1a24] hover:bg-[#242432] text-emerald-400 border border-[#2d2d3f] px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'جاري المزامنة...' : 'مزامنة السحابة الآن'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#16161f] p-3 rounded-lg border border-[#22222d]">
                  <div>
                    <p className="text-xs text-white font-medium">
                      أنت تستخدم التطبيق في الوضع المحلي حالياً (كضيف).
                    </p>
                    <p className="text-[11px] text-slate-400">
                      سجّل دخولك لحفظ فواتيرك ومخزونك سحابياً والوصول إليها من أكثر من جهاز.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={authLoading}
                    onClick={async () => {
                      setAuthLoading(true);
                      setAuthError(null);
                      try {
                        await signInWithGoogle();
                      } catch (err: any) {
                        console.warn('Google login in settings notice:', err?.code);
                        setAuthError(err?.friendlyMessage || 'تعذر تسجيل الدخول من نافذة المعاينة المضمنة. يمكنك فتح التطبيق في نافذة مستقلة.');
                      } finally {
                        setAuthLoading(false);
                      }
                    }}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-colors disabled:opacity-50"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{authLoading ? 'جاري الاتصال...' : 'دخول سحابي سريع'}</span>
                  </button>
                </div>
                {authError && (
                  <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/50 text-[11px] text-rose-300 text-right">
                    {authError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section: Subscription Plan & Usage Limits (خطة الاشتراك وحدود الاستخدام) */}
          <div className="bg-[#121216] p-4 rounded-xl border border-[#1e1e24] space-y-4">
            <div className="flex items-center justify-between border-b border-[#1e1e24] pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs text-white">خطة الاشتراك وحدود الاستخدام</h3>
                  <p className="text-[11px] text-slate-400">إدارة الباقة الحالية ومتابعة استهلاك الفواتير والعملاء والمنتجات</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800/50">
                  باقة {getPlanConfig(subscription?.plan || 'Free').arabic_name}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-800/40">
                  نشط
                </span>
              </div>
            </div>

            {planSuccess && (
              <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{planSuccess}</span>
              </div>
            )}

            {planError && (
              <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-600/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{planError}</span>
              </div>
            )}

            {/* Current Plan Overview Card */}
            {(() => {
              const currentPlan = getPlanConfig(subscription?.plan || 'Free');
              const maxInvoices = subscription?.max_invoices_per_month ?? currentPlan.max_invoices_per_month;
              const maxMembers = subscription?.max_members ?? currentPlan.max_members;
              const maxCustomers = subscription?.max_customers ?? currentPlan.max_customers;
              const maxProducts = subscription?.max_products ?? currentPlan.max_products;

              const invoiceCount = counters?.invoice_count ?? 0;
              const customerCount = counters?.customer_count ?? 0;
              const productCount = counters?.product_count ?? 0;
              const memberCount = orgMembers?.length || 1;

              const invPct = isUnlimited(maxInvoices) ? 0 : Math.min(100, Math.round((invoiceCount / maxInvoices) * 100));
              const custPct = isUnlimited(maxCustomers) ? 0 : Math.min(100, Math.round((customerCount / maxCustomers) * 100));
              const prodPct = isUnlimited(maxProducts) ? 0 : Math.min(100, Math.round((productCount / maxProducts) * 100));
              const memPct = isUnlimited(maxMembers) ? 0 : Math.min(100, Math.round((memberCount / maxMembers) * 100));

              const getBarColor = (pct: number) => {
                if (pct >= 100) return 'bg-rose-500';
                if (pct >= 80) return 'bg-amber-500';
                return 'bg-emerald-500';
              };

              const getBadgeColor = (pct: number) => {
                if (pct >= 100) return 'text-rose-400 bg-rose-950/50 border-rose-800/60';
                if (pct >= 80) return 'text-amber-400 bg-amber-950/50 border-amber-800/60';
                return 'text-emerald-400 bg-emerald-950/50 border-emerald-800/60';
              };

              return (
                <div className="space-y-4">
                  <div className="bg-[#16161f] p-3.5 rounded-xl border border-[#22222d] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{currentPlan.arabic_name}</span>
                        <span className="text-xs text-slate-400 font-mono">({currentPlan.name})</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{currentPlan.description}</p>
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <span className="text-base font-bold text-emerald-400 font-mono">{currentPlan.price_usd_monthly}</span>
                    </div>
                  </div>

                  {/* Usage vs Limits Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Invoices */}
                    <div className="bg-[#16161f] p-3 rounded-xl border border-[#22222d] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-300">الفواتير الشهرية</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-md font-mono border ${getBadgeColor(invPct)}`}>
                          {invoiceCount} / {isUnlimited(maxInvoices) ? '∞ غير محدود' : maxInvoices}
                        </span>
                      </div>
                      <div className="w-full bg-[#0d0d12] rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${getBarColor(invPct)}`}
                          style={{ width: isUnlimited(maxInvoices) ? '10%' : `${invPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <span>{isUnlimited(maxInvoices) ? 'باقة غير محدودة' : `${invPct}% مستهلك`}</span>
                        {invPct >= 100 && <span className="text-rose-400 font-bold">وصلت للحد الأقصى</span>}
                      </div>
                    </div>

                    {/* Customers */}
                    <div className="bg-[#16161f] p-3 rounded-xl border border-[#22222d] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-300">قاعدة العملاء</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-md font-mono border ${getBadgeColor(custPct)}`}>
                          {customerCount} / {isUnlimited(maxCustomers) ? '∞ غير محدود' : maxCustomers}
                        </span>
                      </div>
                      <div className="w-full bg-[#0d0d12] rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${getBarColor(custPct)}`}
                          style={{ width: isUnlimited(maxCustomers) ? '10%' : `${custPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <span>{isUnlimited(maxCustomers) ? 'باقة غير محدودة' : `${custPct}% مستهلك`}</span>
                        {custPct >= 100 && <span className="text-rose-400 font-bold">وصلت للحد الأقصى</span>}
                      </div>
                    </div>

                    {/* Products */}
                    <div className="bg-[#16161f] p-3 rounded-xl border border-[#22222d] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-300">المنتجات والمخزون</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-md font-mono border ${getBadgeColor(prodPct)}`}>
                          {productCount} / {isUnlimited(maxProducts) ? '∞ غير محدود' : maxProducts}
                        </span>
                      </div>
                      <div className="w-full bg-[#0d0d12] rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${getBarColor(prodPct)}`}
                          style={{ width: isUnlimited(maxProducts) ? '10%' : `${prodPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <span>{isUnlimited(maxProducts) ? 'باقة غير محدودة' : `${prodPct}% مستهلك`}</span>
                        {prodPct >= 100 && <span className="text-rose-400 font-bold">وصلت للحد الأقصى</span>}
                      </div>
                    </div>

                    {/* Members */}
                    <div className="bg-[#16161f] p-3 rounded-xl border border-[#22222d] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-300">أعضاء الفريق</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-md font-mono border ${getBadgeColor(memPct)}`}>
                          {memberCount} / {isUnlimited(maxMembers) ? '∞ غير محدود' : maxMembers}
                        </span>
                      </div>
                      <div className="w-full bg-[#0d0d12] rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${getBarColor(memPct)}`}
                          style={{ width: isUnlimited(maxMembers) ? '10%' : `${memPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <span>{isUnlimited(maxMembers) ? 'باقة غير محدودة' : `${memPct}% مستهلك`}</span>
                        {memPct >= 100 && <span className="text-rose-400 font-bold">وصلت للحد الأقصى</span>}
                      </div>
                    </div>
                  </div>

                  {/* Plan Switcher / Upgrade Tier Selection */}
                  <div className="pt-3 border-t border-[#1e1e24] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span>ترقية أو تغيير باقة الاشتراك</span>
                      </h4>
                      {updatingPlan && (
                        <div className="flex items-center gap-1.5 text-xs text-indigo-400">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>جاري التحديث...</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {(Object.keys(PLAN_TIERS) as SubscriptionPlan[]).map((planKey) => {
                        const tier = PLAN_TIERS[planKey];
                        const isCurrent = (subscription?.plan || 'Free') === planKey;
                        const canChange = userRole === 'Owner' || userRole === 'Admin';

                        return (
                          <button
                            key={planKey}
                            type="button"
                            disabled={isCurrent || updatingPlan || !canChange}
                            onClick={async () => {
                              if (isCurrent || updatingPlan || !canChange) return;
                              setUpdatingPlan(true);
                              setPlanError(null);
                              setPlanSuccess(null);
                              try {
                                await updateSubscriptionPlan(planKey);
                                setPlanSuccess(`تم تحديث باقة المؤسسة إلى ${tier.arabic_name} بنجاح`);
                              } catch (err: any) {
                                setPlanError(err.message || 'فشل تحديث باقة الاشتراك');
                              } finally {
                                setUpdatingPlan(false);
                              }
                            }}
                            className={`p-2.5 rounded-xl border text-right transition-all flex flex-col justify-between ${
                              isCurrent
                                ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-lg shadow-indigo-950/30'
                                : canChange
                                ? 'bg-[#16161f] border-[#22222d] hover:border-slate-600 text-slate-300 hover:text-white cursor-pointer'
                                : 'bg-[#16161f]/50 border-[#22222d] text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs">{tier.arabic_name}</span>
                                {isCurrent && (
                                  <span className="w-2 h-2 rounded-full bg-emerald-400" title="الباقة الحالية" />
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 block mt-0.5">{tier.price_usd_monthly}</span>
                            </div>
                            <div className="mt-2 pt-1.5 border-t border-white/5 text-[9px] text-slate-400">
                              {isUnlimited(tier.max_invoices_per_month) ? 'فواتير غير محدودة' : `${tier.max_invoices_per_month} فاتورة`}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {!(userRole === 'Owner' || userRole === 'Admin') && (
                      <p className="text-[10px] text-amber-400/80">
                        * ترقية وتغيير باقات الاشتراك متاح لمالكي ومديري المؤسسة فقط.
                      </p>
                    )}
                  </div>

                  {/* Enforcement Scope Disclosure */}
                  <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-300 text-xs">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>نطاق التحقق والفرض (Enforcement Scope)</span>
                    </div>
                    <p className="leading-relaxed">
                      يتم فحص حدود الباقات الحالية عبر واجهة التطبيق (Client-side UX guardrails) لحماية المتجر من استنفاد الحصص وتوفير تنبيهات فورية للمستخدم. يتم تتبع الاستهلاك تلقائياً وبشكل ذري عبر عدادات المؤسسة السحابية (<code className="font-mono text-[10px] text-indigo-300">meta/counters</code>). الفرض الصارم عبر قواعد أمان فايربيس (Server-side Rules) يجري تعميمه لضمان موثوقية كاملة.
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Section: Multi-Tenant Team & Organization Management */}
          <TeamManagementSection />

          {/* Section: Theme Mode (المظهر: الوضع الداكن / الوضع الفاتح) */}
          <div className="bg-[#121216] p-4 rounded-xl border border-[#1e1e24] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs text-white flex items-center gap-1.5">
                <Sun className="w-4 h-4 text-amber-400" />
                <span>مظهر وتصميم الواجهة (Theme Mode)</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                {theme === 'light' ? 'الوضع الفاتح مفعّل' : 'الوضع الداكن مفعّل'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`p-3 rounded-xl border text-right transition-all flex items-center gap-3 ${
                  theme === 'dark'
                    ? 'border-emerald-500 bg-emerald-950/30 text-white ring-1 ring-emerald-500'
                    : 'border-[#22222d] bg-[#16161f] text-slate-400 hover:text-white hover:border-[#333344]'
                }`}
              >
                <div className="p-2 rounded-lg bg-[#0c0c11] border border-[#22222d] text-emerald-400">
                  <Moon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold">الوضع الداكن (Dark)</div>
                  <div className="text-[10px] text-slate-400">مريح للعين وموفر للطاقة</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`p-3 rounded-xl border text-right transition-all flex items-center gap-3 ${
                  theme === 'light'
                    ? 'border-emerald-500 bg-emerald-50 text-slate-900 ring-1 ring-emerald-500'
                    : 'border-[#22222d] bg-[#16161f] text-slate-400 hover:text-white hover:border-[#333344]'
                }`}
              >
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-600">
                  <Sun className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold">الوضع الفاتح (Light)</div>
                  <div className="text-[10px] text-slate-400">واضح ومناسب للطباعة والنهار</div>
                </div>
              </button>
            </div>
          </div>

          {/* Section: Store Logo & Brand (رفع وتغيير لوقو المتجر) */}
          <div className="bg-[#121216] p-4 rounded-xl border border-[#1e1e24] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs text-white flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-emerald-400" />
                <span>شعار وهوية المتجر (لوقو الفواتير المطبوعة)</span>
              </h3>
              <span className="text-[11px] text-slate-400">يظهر على الفاتورة وسند القبض</span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 bg-[#16161f] p-3.5 rounded-lg border border-[#22222d]">
              {/* Logo Preview */}
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-[#2b2b3b] bg-[#0d0d12] flex items-center justify-center overflow-hidden shrink-0 relative group">
                {logoUrl && logoUrl !== '/hisabuk_logo.jpg' ? (
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="w-full h-full object-contain p-1"
                  />
                ) : (
                  <div className="p-1">
                    <BrandLogo size="md" />
                  </div>
                )}
              </div>

              {/* Upload & Actions */}
              <div className="flex-1 space-y-2 text-right w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-300 font-semibold">
                    ارفع شعار متجرك أو اعتمد شعار منظومة «حِسَابُك»
                  </p>
                  {(!logoUrl || logoUrl === '/hisabuk_logo.jpg') && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#c59b48]/15 text-[#d4a34b] border border-[#c59b48]/40 font-bold">
                      شعار حسابك المعتمد
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-snug">
                  سيتم تضمين هذا الشعار تلقائياً في أعلى الفواتير المطبوعة وسندات القبض المالي وملفات PDF.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label
                    className={`cursor-pointer px-3 py-1.5 bg-[#1f1f2c] hover:bg-[#28283a] text-slate-200 hover:text-white border border-[#303044] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                      isUploadingLogo ? 'opacity-60 pointer-events-none' : ''
                    }`}
                  >
                    {isUploadingLogo ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                        <span>جاري الرفع السحابي ({logoUploadProgress}%)...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{logoUrl && logoUrl !== '/hisabuk_logo.jpg' ? 'تغيير الشعار' : 'رفع شعار مخصص'}</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      disabled={isUploadingLogo}
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>

                  {logoUrl && logoUrl !== '/hisabuk_logo.jpg' && !isUploadingLogo && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl('/hisabuk_logo.jpg')}
                      className="px-2.5 py-1.5 text-xs text-[#d4a34b] hover:bg-[#c59b48]/10 border border-[#c59b48]/40 rounded-lg flex items-center gap-1 transition-colors"
                      title="استعادة شعار حسابك الرسمي"
                    >
                      <span>اعتماد شعار حسابك</span>
                    </button>
                  )}

                  {logoUrl && !isUploadingLogo && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl(undefined)}
                      className="px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-950/40 border border-rose-800/50 rounded-lg flex items-center gap-1 transition-colors"
                      title="حذف الشعار"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>

                {isUploadingLogo && (
                  <div className="w-full bg-[#1e1e28] rounded-full h-1.5 overflow-hidden mt-1.5">
                    <div
                      className="bg-emerald-500 h-full transition-all duration-200"
                      style={{ width: `${logoUploadProgress}%` }}
                    />
                  </div>
                )}

                {logoUploadError && (
                  <div className="p-2.5 bg-rose-950/50 border border-rose-800/60 rounded-lg text-rose-300 text-xs flex items-center gap-2 mt-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{logoUploadError}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Business Info */}
          <div className="space-y-3">
            <h3 className="font-bold text-xs text-white flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <span>بيانات المتجر والتاجر (تظهر في الفواتير المطبوعة)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-300 mb-1 text-xs">
                  اسم المتجر أو المؤسسة *
                </label>
                <input
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1 text-xs">رقم الهاتف *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-300 mb-1 text-xs">العنوان والمدينة</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="مثال: الخرطوم - السوق العربي / بورتسودان"
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-300 mb-1 text-xs">
                  بيانات حساب بنكك للتحويلات (تظهر للعملاء في الفواتير والإشعارات)
                </label>
                <input
                  type="text"
                  value={bankDetails}
                  onChange={(e) => setBankDetails(e.target.value)}
                  placeholder="مثال: بنك الخرطوم (بنكك): 1234567 باسم محمد علي"
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Dual Currency & Rate (Requirement: إمكانية تعديل سعر الصرف يدوياً وتحديد العملات صراحة) */}
          <div className="space-y-3 bg-[#121216] p-4 rounded-xl border border-[#1e1e24]">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs text-white flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-emerald-400" />
                <span>تهيئة العملات وسعر الصرف والتقريب</span>
              </h3>
              <span className="text-[11px] text-emerald-400 font-mono font-bold">
                1 {getCurrencySymbol(secondaryCurrency)} = {defaultRate > 0 ? defaultRate.toLocaleString() : 'غير محدد'} {getCurrencySymbol(primaryCurrency)}
              </span>
            </div>

            {/* Currency configuration: Primary and Secondary Currencies */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2 border-b border-[#1e1e24]">
              <div>
                <label className="block font-semibold text-slate-300 mb-1 text-xs">
                  العملة الأساسية للمنشأة (Primary Currency) *
                </label>
                <select
                  value={primaryCurrency}
                  onChange={(e) => setPrimaryCurrency(e.target.value as Currency)}
                  className="w-full bg-[#15151c] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {AVAILABLE_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-[#121216]">
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  العملة التي تُقيد بها الدفاتر المحاسبية وميزان المراجعة
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1 text-xs">
                  العملة الثانوية / الأجنبية (Secondary Currency) *
                </label>
                <select
                  value={secondaryCurrency}
                  onChange={(e) => setSecondaryCurrency(e.target.value as Currency)}
                  className="w-full bg-[#15151c] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {AVAILABLE_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-[#121216]">
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  العملة الموازية المستخدمة في التسعير أو التحويل الثنائي
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-300 mb-1 text-xs">
                  سعر الصرف الافتراضي (1 {getCurrencySymbol(secondaryCurrency)} = كم {getCurrencySymbol(primaryCurrency)}) *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    value={defaultRate}
                    onChange={(e) => setDefaultRate(Number(e.target.value))}
                    className="w-full bg-[#15151c] border border-emerald-500/40 rounded-lg px-3 py-2 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="absolute left-3 top-2 text-xs text-slate-400 font-sans">
                    {getCurrencySymbol(primaryCurrency)} / {getCurrencySymbol(secondaryCurrency)}
                  </span>
                </div>

                {/* UI convenience presets: Quick-fill shortcuts for user convenience only. Never automatically applied. */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <button
                    type="button"
                    title="إنقاص 50"
                    onClick={() => setDefaultRate((prev) => Math.max(1, prev - 50))}
                    className="px-2 py-0.5 text-[11px] font-mono font-bold rounded bg-[#1b1b24] text-slate-300 hover:text-white border border-[#2a2a38]"
                  >
                    -50
                  </button>
                  <button
                    type="button"
                    title="زيادة 50"
                    onClick={() => setDefaultRate((prev) => prev + 50)}
                    className="px-2 py-0.5 text-[11px] font-mono font-bold rounded bg-[#1b1b24] text-slate-300 hover:text-white border border-[#2a2a38]"
                  >
                    +50
                  </button>
                  {[2600, 2700, 2750, 2800, 2850, 2900].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      title={`تعبئة سريعة للقيمة ${preset}`}
                      onClick={() => setDefaultRate(preset)}
                      className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                        defaultRate === preset
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-black'
                          : 'bg-[#181822] text-slate-400 border-[#262636] hover:text-slate-200'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <p className="text-[10px] text-slate-400 mt-1.5">
                  سعر الصرف في كل فاتورة يُجمّد تلقائيًا وقت إصدارها لحماية حساباتك
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1 text-xs">طريقة التقريب</label>
                <select
                  value={roundingRule}
                  onChange={(e) => setRoundingRule(e.target.value as any)}
                  className="w-full bg-[#15151c] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="round" className="bg-[#121216]">لأقرب رقم (الافتراضي)</option>
                  <option value="ceil" className="bg-[#121216]">للأعلى (سقف)</option>
                  <option value="floor" className="bg-[#121216]">للأدنى (أرضية)</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1.5">
                  العملة الأساسية تُقرّب حسب منازلها المقررة، والعملة الثانوية لخانتين عشريتين
                </p>
              </div>
            </div>
          </div>

          {/* Section 4: Invoices Customization */}
          <div className="space-y-3">
            <h3 className="font-bold text-xs text-white">تخصيص الفواتير</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-300 mb-1 text-xs">
                  بادئة ترقيم الفواتير
                </label>
                <input
                  type="text"
                  value={invoicePrefix}
                  onChange={(e) => setInvoicePrefix(e.target.value)}
                  placeholder="مثال: INV-2026-"
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1 text-xs">
                  ملاحظات الفاتورة الافتراضية
                </label>
                <input
                  type="text"
                  value={defaultNotes}
                  onChange={(e) => setDefaultNotes(e.target.value)}
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Data Backup & Demo Data */}
          <div className="pt-3 border-t border-[#1e1e24] space-y-3">
            <h3 className="font-bold text-xs text-white">النسخ الاحتياطي وإدارة البيانات</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportBackup}
                className="px-3 py-2 bg-[#16161f] hover:bg-[#20202c] text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-[#262636] shadow-2xs transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>تصدير نسخة احتياطية (JSON)</span>
              </button>

              <label className="px-3 py-2 bg-[#16161f] hover:bg-[#20202c] text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-[#262636] shadow-2xs cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                <span>استيراد نسخة احتياطية</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  if (window.confirm('هل تريد إعادة تعيين البيانات إلى البيانات التجريبية الأولية؟')) {
                    resetToSampleData();
                  }
                }}
                className="px-3 py-2 text-slate-400 hover:text-slate-200 text-xs font-medium mr-auto transition-colors"
              >
                إعادة ضبط البيانات التجريبية
              </button>
            </div>
            {importStatus && <p className="text-xs text-emerald-400 font-semibold">{importStatus}</p>}
          </div>

          {/* Footer Save Button */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1e1e24]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[#262636] rounded-lg text-xs font-semibold text-slate-300 hover:bg-[#1a1a24] bg-[#14141c] transition-colors"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              className="px-6 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-bold shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 transition-colors active:scale-95"
            >
              <CheckCircle2 className="w-4 h-4 text-slate-950" />
              <span>حفظ كافة الإعدادات</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
