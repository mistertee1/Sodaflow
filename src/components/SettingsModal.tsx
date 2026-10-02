import React, { useState, useEffect } from 'react';
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
import { Dialog } from './Dialog';

const AVAILABLE_CURRENCIES: { code: Currency; label: string }[] = [
  { code: 'SDG', label: 'جنيه سوداني (SDG)' },
  { code: 'USD', label: 'دولار أمريكي (USD)' },
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
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Rehydrate the form when opened or when the initial cloud snapshot becomes available.
  // Background polling must not overwrite an open form's edits.
  useEffect(() => {
    if (!isOpen) return;
    setBusinessName(settings.business_name);
    setPhone(settings.phone);
    setAddress(settings.address || '');
    setLogoUrl(settings.logo_url);
    setBankDetails(settings.bank_details || '');
    setDefaultRate(settings.default_exchange_rate || 0);
    setPrimaryCurrency(settings.primary_currency || 'SDG');
    setSecondaryCurrency(settings.secondary_currency || 'USD');
    setInvoicePrefix(settings.invoice_prefix || 'INV-');
    setDefaultNotes(settings.default_invoice_notes || '');
    setRoundingRule(settings.rounding_rule || 'round');
    setSaveError(null);
    setSaveSuccess(false);
  }, [isOpen, currentOrg?.id, userRole]);

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

    if (!currentOrg || currentOrg.id === 'local-guest-org' || userRole === 'Viewer') {
      setLogoUploadError('لم يكتمل تحميل المؤسسة أو لا تتوفر صلاحية تعديلها. أعد المزامنة أولاً ثم ارفع الشعار.');
      return;
    }
    const orgId = currentOrg.id;

    setIsUploadingLogo(true);
    setLogoUploadProgress(0);

    try {
      const downloadUrl = await uploadOrganizationImage({
        file,
        orgId,
        folder: 'logos',
        onProgress: (pct) => setLogoUploadProgress(pct),
      });
      await updateSettings({ logo_url: downloadUrl });
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
    if (isSaving) return;
    setSaveError(null);
    if (isUploadingLogo) {
      alert('يرجى الانتظار حتى يكتمل رفع الشعار إلى التخزين السحابي.');
      return;
    }
    const rateVal = defaultRate === 0 && !settings.currencies_configured
      ? { isValid: true, rate: 0, error: undefined }
      : validateExchangeRate(defaultRate);
    if (!rateVal.isValid) {
      alert(rateVal.error || 'يرجى إدخال سعر صرف افتراضي صحيح وموجب للمنشأة.');
      return;
    }

    setIsSaving(true);
    try {
    await updateSettings({
      business_name: businessName.trim(),
      phone: phone.trim(),
      address: address.trim() || '',
      logo_url: logoUrl || '',
      bank_details: bankDetails.trim() || '',
      default_exchange_rate: rateVal.rate,
      primary_currency: primaryCurrency,
      secondary_currency: secondaryCurrency,
      currencies_configured: rateVal.rate > 0,
      invoice_prefix: invoicePrefix.trim(),
      default_invoice_notes: defaultNotes.trim(),
      rounding_rule: roundingRule,
    });
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 900);
    } catch (error) {
      setSaveSuccess(false);
      setSaveError(error instanceof Error ? error.message : 'تعذر حفظ الإعدادات. أعد المحاولة.');
    } finally { setIsSaving(false); }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    await syncAllToCloud();
    setIsSyncing(false);
  };

  const handleExportBackup = async () => {
    try {
    const json = await exportDataJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sudanese_merchant_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    } catch (error) { setImportStatus(error instanceof Error ? error.message : "تعذر تصدير النسخة."); }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
        const content = event.target?.result as string;
        const ok = await importDataJson(content);
        if (ok) {
          setImportStatus('تم استيراد النسخة الاحتياطية بنجاح!');
        } else {
          setImportStatus('فشل استيراد الملف. تأكد من صحة الملف.');
        }
        } catch (error) { setImportStatus(error instanceof Error ? error.message : "تعذرت الاستعادة."); }
      };
      reader.readAsText(file);
    }
  };

  return (
    <Dialog label="إعدادات المؤسسة" onClose={onClose} className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-sf-surface rounded-xl shadow-2xl border border-sf-border max-w-2xl w-full my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 text-xs sm:text-sm text-sf-text">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-sf-border bg-sf-raised rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sf-action/10 text-sf-action border border-sf-action/20">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-sf-text">إعدادات المتجر وسعر الصرف</h2>
              <p className="text-xs text-sf-muted">تخصيص بيانات الفواتير وسعر الصرف والعملتين والمزامنة السحابية</p>
            </div>
          </div>
          <button aria-label="إغلاق النافذة"
            onClick={onClose}
            className="p-2 text-sf-muted hover:text-sf-text rounded-lg hover:bg-sf-raised transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Container */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {saveError && <div role="alert" className="p-3 bg-sf-danger-bg text-sf-danger rounded-xl">{saveError}</div>}
          {saveSuccess && (
            <div className="p-3 bg-sf-selected/80 border border-sf-action/50 rounded-xl text-sf-action text-xs flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-sf-action shrink-0" />
              <span>تم حفظ كافة الإعدادات وتحديث سعر الصرف بنجاح!</span>
            </div>
          )}

          {/* Section 1: Account & Cloud Sync */}
          <div className="bg-sf-raised p-4 rounded-xl border border-sf-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sf-action" />
                <h3 className="font-semibold text-xs text-sf-text">حساب التاجر والمزامنة السحابية</h3>
              </div>
              <div className="flex items-center gap-2">
                {currentUser && (
                  <span className={`text-xs px-2 py-1 rounded-full font-mono font-medium ${
                    syncStatus === 'synced'
                      ? 'bg-sf-selected/80 text-sf-text border border-sf-action/50'
                      : syncStatus === 'syncing'
                      ? 'bg-sf-warning-bg/80 text-sf-warning border border-sf-warning/50'
                      : 'bg-sf-raised text-sf-muted border border-sf-border'
                  }`}>
                    {syncStatus === 'synced' ? '✓ متصل ومزامَن' : syncStatus === 'syncing' ? 'جاري المزامنة...' : syncStatus === 'error' ? 'تعذر تأكيد المزامنة' : 'جاهز'}
                  </span>
                )}
              </div>
            </div>

            {currentUser ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-sf-raised p-3 rounded-lg border border-sf-border">
                  <div className="flex items-center gap-3">
                    {currentUser.photoURL ? (
                      <img
                        src={currentUser.photoURL}
                        alt="User"
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full ring-2 ring-sf-action/40"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-sf-action text-sf-on-action flex items-center justify-center font-semibold text-xs">
                        {currentUser.displayName?.[0] || 'U'}
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-xs text-sf-text">{currentUser.displayName || 'تاجر'}</div>
                      <div className="text-xs text-sf-muted font-mono">{currentUser.email}</div>
                      <div className="text-xs text-sf-action mt-1">
                        ✓ حساب سحابي آمن ومشفر عبر Firebase
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => logoutUser()}
                    className="px-3 py-2 text-xs text-sf-danger hover:bg-sf-danger-bg/40 rounded-lg border border-sf-danger/60 flex items-center gap-1 font-medium transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>تسجيل خروج</span>
                  </button>
                </div>

                {/* Cloud Sync Manual Trigger */}
                <div className="flex items-center justify-between pt-1 text-xs">
                  <div className="text-xs text-sf-muted">
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
                    className="bg-sf-raised hover:bg-sf-raised text-sf-action border border-sf-border px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'جاري المزامنة...' : 'مزامنة السحابة الآن'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-sf-raised p-3 rounded-lg border border-sf-border">
                  <div>
                    <p className="text-xs text-sf-text font-medium">
                      أنت تستخدم التطبيق في الوضع المحلي حالياً (كضيف).
                    </p>
                    <p className="text-xs text-sf-muted">
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
                    className="px-4 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action text-xs font-semibold rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-sf-action/20 transition-colors disabled:opacity-50"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{authLoading ? 'جاري الاتصال...' : 'دخول سحابي سريع'}</span>
                  </button>
                </div>
                {authError && (
                  <div role="alert" className="p-3 rounded-lg bg-sf-danger-bg/40 border border-sf-danger/50 text-xs text-sf-danger text-right">
                    {authError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section: Subscription Plan & Usage Limits (خطة الاشتراك وحدود الاستخدام) */}
          <div className="bg-sf-raised p-4 rounded-xl border border-sf-border space-y-4">
            <div className="flex items-center justify-between border-b border-sf-border pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-sf-info-bg/10 text-sf-info border border-sf-info/20">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-sf-text">خطة الاشتراك وحدود الاستخدام</h3>
                  <p className="text-xs text-sf-muted">إدارة الباقة الحالية ومتابعة استهلاك الفواتير والعملاء والمنتجات</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-3 py-1 rounded-full font-semibold bg-sf-info-bg/80 text-sf-info border border-sf-info/50">
                  باقة {getPlanConfig(subscription?.plan || 'Free').arabic_name}
                </span>
                <span className="text-xs px-2 py-1 rounded-full font-medium bg-sf-selected/70 text-sf-action border border-sf-action/40">
                  نشط
                </span>
              </div>
            </div>

            {planSuccess && (
              <div className="p-3 rounded-xl bg-sf-selected/80 border border-sf-action/50 text-sf-action text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-sf-action shrink-0" />
                <span>{planSuccess}</span>
              </div>
            )}

            {planError && (
              <div className="p-3 rounded-xl bg-sf-danger-bg/80 border border-sf-danger/50 text-sf-danger text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-sf-danger shrink-0" />
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

              const invoiceCount = counters?.monthly_invoice_count ?? 0;
              const customerCount = counters?.customer_count ?? 0;
              const productCount = counters?.product_count ?? 0;
              const memberCount = orgMembers?.length || 1;

              const invPct = isUnlimited(maxInvoices) ? 0 : Math.min(100, Math.round((invoiceCount / maxInvoices) * 100));
              const custPct = isUnlimited(maxCustomers) ? 0 : Math.min(100, Math.round((customerCount / maxCustomers) * 100));
              const prodPct = isUnlimited(maxProducts) ? 0 : Math.min(100, Math.round((productCount / maxProducts) * 100));
              const memPct = isUnlimited(maxMembers) ? 0 : Math.min(100, Math.round((memberCount / maxMembers) * 100));

              const getBarColor = (pct: number) => {
                if (pct >= 100) return 'bg-sf-danger-bg';
                if (pct >= 80) return 'bg-sf-warning-bg';
                return 'bg-sf-action';
              };

              const getBadgeColor = (pct: number) => {
                if (pct >= 100) return 'text-sf-danger bg-sf-danger-bg/50 border-sf-danger/60';
                if (pct >= 80) return 'text-sf-warning bg-sf-warning-bg/50 border-sf-warning/60';
                return 'text-sf-action bg-sf-selected/50 border-sf-action/60';
              };

              return (
                <div className="space-y-4">
                  <div className="bg-sf-raised p-4 rounded-xl border border-sf-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-sf-text">{currentPlan.arabic_name}</span>
                        <span className="text-xs text-sf-muted font-mono">({currentPlan.name})</span>
                      </div>
                      <p className="text-xs text-sf-muted mt-1">{currentPlan.description}</p>
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <span className="text-base font-semibold text-sf-text font-mono">{currentPlan.price_usd_monthly}</span>
                    </div>
                  </div>

                  {/* Usage vs Limits Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Invoices */}
                    <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-sf-text">الفواتير الشهرية</span>
                        <span className={`text-xs px-2 py-1 rounded-md font-mono border ${getBadgeColor(invPct)}`}>
                          {invoiceCount} / {isUnlimited(maxInvoices) ? '∞ غير محدود' : maxInvoices}
                        </span>
                      </div>
                      <div className="w-full bg-sf-surface rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-(--sf-motion-state) ${getBarColor(invPct)}`}
                          style={{ width: isUnlimited(maxInvoices) ? '10%' : `${invPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-xs text-sf-muted">
                        <span>{isUnlimited(maxInvoices) ? 'باقة غير محدودة' : `${invPct}% مستهلك`}</span>
                        {invPct >= 100 && <span className="text-sf-danger font-semibold">وصلت للحد الأقصى</span>}
                      </div>
                    </div>

                    {/* Customers */}
                    <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-sf-text">قاعدة العملاء</span>
                        <span className={`text-xs px-2 py-1 rounded-md font-mono border ${getBadgeColor(custPct)}`}>
                          {customerCount} / {isUnlimited(maxCustomers) ? '∞ غير محدود' : maxCustomers}
                        </span>
                      </div>
                      <div className="w-full bg-sf-surface rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-(--sf-motion-state) ${getBarColor(custPct)}`}
                          style={{ width: isUnlimited(maxCustomers) ? '10%' : `${custPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-xs text-sf-muted">
                        <span>{isUnlimited(maxCustomers) ? 'باقة غير محدودة' : `${custPct}% مستهلك`}</span>
                        {custPct >= 100 && <span className="text-sf-danger font-semibold">وصلت للحد الأقصى</span>}
                      </div>
                    </div>

                    {/* Products */}
                    <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-sf-text">المنتجات والمخزون</span>
                        <span className={`text-xs px-2 py-1 rounded-md font-mono border ${getBadgeColor(prodPct)}`}>
                          {productCount} / {isUnlimited(maxProducts) ? '∞ غير محدود' : maxProducts}
                        </span>
                      </div>
                      <div className="w-full bg-sf-surface rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-(--sf-motion-state) ${getBarColor(prodPct)}`}
                          style={{ width: isUnlimited(maxProducts) ? '10%' : `${prodPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-xs text-sf-muted">
                        <span>{isUnlimited(maxProducts) ? 'باقة غير محدودة' : `${prodPct}% مستهلك`}</span>
                        {prodPct >= 100 && <span className="text-sf-danger font-semibold">وصلت للحد الأقصى</span>}
                      </div>
                    </div>

                    {/* Members */}
                    <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-sf-text">أعضاء الفريق</span>
                        <span className={`text-xs px-2 py-1 rounded-md font-mono border ${getBadgeColor(memPct)}`}>
                          {memberCount} / {isUnlimited(maxMembers) ? '∞ غير محدود' : maxMembers}
                        </span>
                      </div>
                      <div className="w-full bg-sf-surface rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-(--sf-motion-state) ${getBarColor(memPct)}`}
                          style={{ width: isUnlimited(maxMembers) ? '10%' : `${memPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-xs text-sf-muted">
                        <span>{isUnlimited(maxMembers) ? 'باقة غير محدودة' : `${memPct}% مستهلك`}</span>
                        {memPct >= 100 && <span className="text-sf-danger font-semibold">وصلت للحد الأقصى</span>}
                      </div>
                    </div>
                  </div>

                  {/* Plan Switcher / Upgrade Tier Selection */}
                  <div className="pt-3 border-t border-sf-border space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-xs text-sf-text flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-sf-warning" />
                        <span>ترقية أو تغيير باقة الاشتراك</span>
                      </h4>
                      {updatingPlan && (
                        <div className="flex items-center gap-2 text-xs text-sf-info">
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
                                setImportStatus('تم تسجيل طلب تغيير الباقة. التفعيل يتم بعد اعتماد الاشتراك.');
                                setPlanSuccess(`تم تسجيل طلب ${tier.arabic_name}. التفعيل بعد اعتماد الاشتراك.`);
                              } catch (err: any) {
                                setPlanError(err.message || 'فشل تحديث باقة الاشتراك');
                              } finally {
                                setUpdatingPlan(false);
                              }
                            }}
                            className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between ${
                              isCurrent
                                ? 'bg-sf-info-bg/60 border-sf-info text-sf-text shadow-lg shadow-indigo-950/30'
                                : canChange
                                ? 'bg-sf-raised border-sf-border hover:border-sf-border text-sf-text hover:text-sf-text cursor-pointer'
                                : 'bg-sf-raised/50 border-sf-border text-sf-muted cursor-not-allowed'
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-xs">{tier.arabic_name}</span>
                                {isCurrent && (
                                  <span className="w-2 h-2 rounded-full bg-sf-action" title="الباقة الحالية" />
                                )}
                              </div>
                              <span className="text-xs text-sf-muted block mt-1">{tier.price_usd_monthly}</span>
                            </div>
                            <div className="mt-2 pt-2 border-t border-white/5 text-xs text-sf-muted">
                              {isUnlimited(tier.max_invoices_per_month) ? 'فواتير غير محدودة' : `${tier.max_invoices_per_month} فاتورة`}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {!(userRole === 'Owner' || userRole === 'Admin') && (
                      <p className="text-xs text-sf-warning/80">
                        * ترقية وتغيير باقات الاشتراك متاح لمالكي ومديري المؤسسة فقط.
                      </p>
                    )}
                  </div>

                  {/* Enforcement Scope Disclosure */}
                  <div className="p-3 bg-sf-raised/60 rounded-xl border border-sf-border text-xs text-sf-muted space-y-1">
                    <div className="flex items-center gap-2 font-semibold text-sf-text text-xs">
                      <ShieldCheck className="w-3.5 h-3.5 text-sf-action shrink-0" />
                      <span>نطاق التحقق والفرض (Enforcement Scope)</span>
                    </div>
                    <p className="leading-relaxed">
                      يتم فحص حدود الباقات الحالية عبر واجهة التطبيق (Client-side UX guardrails) لحماية المتجر من استنفاد الحصص وتوفير تنبيهات فورية للمستخدم. يتم تتبع الاستهلاك تلقائياً وبشكل ذري عبر عدادات المؤسسة السحابية (<code className="font-mono text-xs text-sf-info">meta/counters</code>). الفرض الصارم عبر قواعد أمان فايربيس (Server-side Rules) يجري تعميمه لضمان موثوقية كاملة.
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Section: Multi-Tenant Team & Organization Management */}
          <TeamManagementSection />

          {/* Section: Theme Mode (المظهر: الوضع الداكن / الوضع الفاتح) */}
          <div className="bg-sf-raised p-4 rounded-xl border border-sf-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs text-sf-text flex items-center gap-2">
                <Sun className="w-4 h-4 text-sf-warning" />
                <span>مظهر وتصميم الواجهة (Theme Mode)</span>
              </h3>
              <span className="text-xs text-sf-muted">
                {theme === 'light' ? 'الوضع الفاتح مفعّل' : 'الوضع الداكن مفعّل'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`p-3 rounded-xl border text-right transition-all flex items-center gap-3 ${
                  theme === 'dark'
                    ? 'border-sf-action bg-sf-selected/30 text-sf-text ring-1 ring-sf-action'
                    : 'border-sf-border bg-sf-raised text-sf-muted hover:text-sf-text hover:border-sf-border'
                }`}
              >
                <div className="p-2 rounded-lg bg-sf-surface border border-sf-border text-sf-action">
                  <Moon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold">الوضع الداكن (Dark)</div>
                  <div className="text-xs text-sf-muted">مريح للعين وموفر للطاقة</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`p-3 rounded-xl border text-right transition-all flex items-center gap-3 ${
                  theme === 'light'
                    ? 'border-sf-action bg-sf-selected text-sf-text ring-1 ring-sf-action'
                    : 'border-sf-border bg-sf-raised text-sf-muted hover:text-sf-text hover:border-sf-border'
                }`}
              >
                <div className="p-2 rounded-lg bg-sf-warning-bg border border-sf-warning text-sf-warning">
                  <Sun className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold">الوضع الفاتح (Light)</div>
                  <div className="text-xs text-sf-muted">واضح ومناسب للطباعة والنهار</div>
                </div>
              </button>
            </div>
          </div>

          {/* Section: Store Logo & Brand (رفع وتغيير لوقو المتجر) */}
          <div className="bg-sf-raised p-4 rounded-xl border border-sf-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs text-sf-text flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-sf-action" />
                <span>شعار وهوية المتجر (لوقو الفواتير المطبوعة)</span>
              </h3>
              <span className="text-xs text-sf-muted">يظهر على الفاتورة وسند القبض</span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 bg-sf-raised p-4 rounded-lg border border-sf-border">
              {/* Logo Preview */}
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-sf-border bg-sf-surface flex items-center justify-center overflow-hidden shrink-0 relative group">
                {logoUrl && logoUrl !== '/hisabuk_logo.jpg' ? (
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="w-full h-full object-contain p-1"
                  />
                ) : (
                  <div className="p-1">
                    <Building2 className="h-8 w-8 text-sf-muted" aria-label="لا يوجد شعار للمنشأة" />
                  </div>
                )}
              </div>

              {/* Upload & Actions */}
              <div className="flex-1 space-y-2 text-right w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-sf-text font-semibold">
                    ارفع شعار منشأتك ليظهر على مستنداتها
                  </p>
                  {(!logoUrl || logoUrl === '/hisabuk_logo.jpg') && (
                    <span className="text-xs px-2 py-1 rounded-full bg-sf-action/15 text-sf-action border border-sf-action/40 font-semibold">
                      لم يُضف شعار للمنشأة
                    </span>
                  )}
                </div>
                <p className="text-xs text-sf-muted leading-snug">
                  سيتم تضمين هذا الشعار تلقائياً في أعلى الفواتير المطبوعة وسندات القبض المالي وملفات PDF.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label
                    className={`cursor-pointer px-3 py-2 bg-sf-raised hover:bg-sf-raised text-sf-text hover:text-sf-text border border-sf-border rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
                      isUploadingLogo ? 'opacity-60 pointer-events-none' : ''
                    }`}
                  >
                    {isUploadingLogo ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 text-sf-action animate-spin" />
                        <span>جاري الرفع السحابي ({logoUploadProgress}%)...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5 text-sf-action" />
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

                  {logoUrl && !isUploadingLogo && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl('')}
                      className="px-3 py-2 text-xs text-sf-danger hover:bg-sf-danger-bg/40 border border-sf-danger/50 rounded-lg flex items-center gap-1 transition-colors"
                      title="حذف الشعار"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>

                {isUploadingLogo && (
                  <div className="w-full bg-sf-raised rounded-full h-1.5 overflow-hidden mt-2">
                    <div
                      className="bg-sf-action h-full transition-all duration-(--sf-motion-state)"
                      style={{ width: `${logoUploadProgress}%` }}
                    />
                  </div>
                )}

                {logoUploadError && (
                  <div className="p-3 bg-sf-danger-bg/50 border border-sf-danger/60 rounded-lg text-sf-danger text-xs flex items-center gap-2 mt-2">
                    <AlertCircle className="w-4 h-4 text-sf-danger shrink-0" />
                    <span>{logoUploadError}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Business Info */}
          <div className="space-y-3">
            <h3 className="font-semibold text-xs text-sf-text flex items-center gap-2">
              <Building2 className="w-4 h-4 text-sf-action" />
              <span>بيانات المتجر والتاجر (تظهر في الفواتير المطبوعة)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  اسم المتجر أو المؤسسة *
                </label>
                <input
                  type="text"
                  required
                  value={businessName}
                  aria-label="اسم المتجر أو المؤسسة"
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">رقم الهاتف *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-sf-text mb-1 text-xs">العنوان والمدينة</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="مثال: الخرطوم - السوق العربي / بورتسودان"
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  بيانات حساب بنكك للتحويلات (تظهر للعملاء في الفواتير والإشعارات)
                </label>
                <input
                  type="text"
                  value={bankDetails}
                  onChange={(e) => setBankDetails(e.target.value)}
                  placeholder="مثال: بنك الخرطوم (بنكك): 1234567 باسم محمد علي"
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action font-mono"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Dual Currency & Rate (Requirement: إمكانية تعديل سعر الصرف يدوياً وتحديد العملات صراحة) */}
          <div className="space-y-3 bg-sf-raised p-4 rounded-xl border border-sf-border">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs text-sf-text flex items-center gap-2">
                <Lock className="w-4 h-4 text-sf-action" />
                <span>تهيئة العملات وسعر الصرف والتقريب</span>
              </h3>
              <span className="text-xs text-sf-text font-mono font-semibold">
                1 {getCurrencySymbol(secondaryCurrency)} = {defaultRate > 0 ? defaultRate.toLocaleString() : 'غير محدد'} {getCurrencySymbol(primaryCurrency)}
              </span>
            </div>

            {/* Currency configuration: Primary and Secondary Currencies */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2 border-b border-sf-border">
              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  العملة الأساسية للمنشأة (Primary Currency) *
                </label>
                <select
                  value={primaryCurrency}
                  onChange={(e) => setPrimaryCurrency(e.target.value as Currency)}
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                >
                  {AVAILABLE_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-sf-raised">
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-sf-muted mt-1">
                  العملة التي تُقيد بها الدفاتر المحاسبية وميزان المراجعة
                </p>
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  العملة الثانوية / الأجنبية (Secondary Currency) *
                </label>
                <select
                  value={secondaryCurrency}
                  onChange={(e) => setSecondaryCurrency(e.target.value as Currency)}
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                >
                  {AVAILABLE_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-sf-raised">
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-sf-muted mt-1">
                  العملة الموازية المستخدمة في التسعير أو التحويل الثنائي
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
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
                    className="w-full bg-sf-raised border border-sf-action/40 rounded-lg px-3 py-2 text-xs font-mono font-semibold text-sf-text focus:outline-none focus:border-sf-action"
                  />
                  <span className="absolute left-3 top-2 text-xs text-sf-muted font-sans">
                    {getCurrencySymbol(primaryCurrency)} / {getCurrencySymbol(secondaryCurrency)}
                  </span>
                </div>

                {/* UI convenience presets: Quick-fill shortcuts for user convenience only. Never automatically applied. */}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    type="button"
                    title="إنقاص 50"
                    onClick={() => setDefaultRate((prev) => Math.max(1, prev - 50))}
                    className="px-2 py-1 text-xs font-mono font-semibold rounded bg-sf-raised text-sf-text hover:text-sf-text border border-sf-border"
                  >
                    -50
                  </button>
                  <button
                    type="button"
                    title="زيادة 50"
                    onClick={() => setDefaultRate((prev) => prev + 50)}
                    className="px-2 py-1 text-xs font-mono font-semibold rounded bg-sf-raised text-sf-text hover:text-sf-text border border-sf-border"
                  >
                    +50
                  </button>
                  {[2600, 2700, 2750, 2800, 2850, 2900].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      title={`تعبئة سريعة للقيمة ${preset}`}
                      onClick={() => setDefaultRate(preset)}
                      className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${
                        defaultRate === preset
                          ? 'bg-sf-action text-sf-on-action border-sf-action font-semibold'
                          : 'bg-sf-raised text-sf-muted border-sf-border hover:text-sf-text'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <p className="text-xs text-sf-muted mt-2">
                  سعر الصرف في كل فاتورة يُجمّد تلقائيًا وقت إصدارها لحماية حساباتك
                </p>
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">طريقة التقريب</label>
                <select
                  value={roundingRule}
                  onChange={(e) => setRoundingRule(e.target.value as any)}
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                >
                  <option value="round" className="bg-sf-raised">لأقرب رقم (الافتراضي)</option>
                  <option value="ceil" className="bg-sf-raised">للأعلى (سقف)</option>
                  <option value="floor" className="bg-sf-raised">للأدنى (أرضية)</option>
                </select>
                <p className="text-xs text-sf-muted mt-2">
                  العملة الأساسية تُقرّب حسب منازلها المقررة، والعملة الثانوية لخانتين عشريتين
                </p>
              </div>
            </div>
          </div>

          {/* Section 4: Invoices Customization */}
          <div className="space-y-3">
            <h3 className="font-semibold text-xs text-sf-text">تخصيص الفواتير</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  بادئة ترقيم الفواتير
                </label>
                <input
                  type="text"
                  value={invoicePrefix}
                  onChange={(e) => setInvoicePrefix(e.target.value)}
                  placeholder="مثال: INV-2026-"
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  ملاحظات الفاتورة الافتراضية
                </label>
                <input
                  type="text"
                  value={defaultNotes}
                  onChange={(e) => setDefaultNotes(e.target.value)}
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Data Backup & Demo Data */}
          <div className="pt-3 border-t border-sf-border space-y-3">
            <h3 className="font-semibold text-xs text-sf-text">النسخ الاحتياطي وإدارة البيانات</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportBackup}
                className="px-3 py-2 bg-sf-raised hover:bg-sf-raised text-sf-text rounded-lg text-xs font-semibold flex items-center gap-2 border border-sf-border shadow-2xs transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-sf-action" />
                <span>تصدير نسخة احتياطية (JSON)</span>
              </button>

              <label className="px-3 py-2 bg-sf-raised hover:bg-sf-raised text-sf-text rounded-lg text-xs font-semibold flex items-center gap-2 border border-sf-border shadow-2xs cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5 text-sf-action" />
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
                className="px-3 py-2 text-sf-muted hover:text-sf-text text-xs font-medium mr-auto transition-colors"
              >
                إعادة ضبط البيانات التجريبية
              </button>
            </div>
            {importStatus && <p className="text-xs text-sf-action font-semibold">{importStatus}</p>}
          </div>

          {/* Footer Save Button */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-sf-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-sf-border rounded-lg text-xs font-semibold text-sf-text hover:bg-sf-raised bg-sf-raised transition-colors"
            >
              إغلاق
            </button>
            <button
              type="button"
              disabled={isSaving || isUploadingLogo || (Boolean(currentUser) && userRole === 'Viewer')}
              onClick={() => handleSave()}
              className="px-6 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action rounded-lg text-xs font-semibold shadow-lg shadow-sf-action/20 flex items-center gap-2 transition-colors "
            >
              <CheckCircle2 className="w-4 h-4 text-sf-on-action" />
              <span>{isSaving ? 'جاري الحفظ...' : 'حفظ كافة الإعدادات'}</span>
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
