import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { signInWithGoogle, logout } from '../lib/firebase';
import { BrandLogo } from './BrandLogo';
import {
  Store,
  RefreshCw,
  Plus,
  LogIn,
  LogOut,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Cloud,
  CloudOff,
  Sparkles,
  HelpCircle,
  Sun,
  Moon,
} from 'lucide-react';
import { formatMoney } from '../lib/currency';
import { useDisplayMoney } from '../context/useDisplayMoney';
import { Dialog } from './Dialog';

interface HeaderProps {
  onOpenNewInvoice: () => void;
  onOpenSettings: () => void;
  onOpenOnboarding?: () => void;
  onOpenAuth?: () => void;
  onOpenLegal?: (tab: 'privacy' | 'terms' | 'about' | 'contact') => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenNewInvoice,
  onOpenSettings,
  onOpenOnboarding,
  onOpenAuth,
  onOpenLegal,
}) => {
  const { settings, updateSettings, currentUser, authLoading, syncStatus, lastSyncedAt, theme, toggleTheme, logoutUser, syncAllToCloud } = useApp();
  const { quote } = useDisplayMoney();
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [tempRate, setTempRate] = useState(settings.default_exchange_rate.toString());
  const [authError, setAuthError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [isSavingRate, setIsSavingRate] = useState(false);
  const rateSubmitLock = useRef(false);

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rateSubmitLock.current) return;
    const rateNum = parseFloat(tempRate);
    if (!Number.isFinite(rateNum) || rateNum <= 0) { setRateError('أدخل سعر صرف صالحاً أكبر من صفر.'); return; }
    rateSubmitLock.current = true;
    setIsSavingRate(true);
    setRateError(null);
    try {
      await updateSettings({ default_exchange_rate: rateNum });
      setIsEditingRate(false);
    } catch (error) {
      setRateError(error instanceof Error ? error.message : 'تعذر حفظ سعر الصرف. أعد المحاولة.');
    } finally {
      rateSubmitLock.current = false;
      setIsSavingRate(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.warn('Google login notice in header:', err?.code);
      setAuthError(err?.friendlyMessage || 'تعذر تسجيل الدخول بحساب Google. تحقق من الاتصال وأعد المحاولة.');
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <header className="bg-sf-surface border-b border-sf-border sticky top-0 z-30">
      <div className="sf-content py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Logo & Store Info */}
        <div className="flex items-center gap-3">
          {settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg' ? (
            <div className="w-11 h-11 rounded-xl bg-sf-raised border border-sf-action/30 p-1 flex items-center justify-center overflow-hidden shadow-sm">
              <img
                src={settings.logo_url}
                alt="Store Logo"
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <span className="lg:hidden"><BrandLogo size="md" /></span>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-base sm:text-lg text-sf-text leading-tight">
                {settings.business_name || 'سودافلو — اضبط اسم متجرك'}
              </h1>
              <span className="hidden sm:inline-flex text-xs px-2 py-1 rounded-full bg-sf-action/15 text-sf-action border border-sf-action/40 font-semibold">
                سودافلو
              </span>
              <span className="hidden sm:inline-flex text-xs px-2 py-1 rounded-full bg-sf-selected/80 text-sf-action border border-sf-action/50 font-semibold">
                {quote?.currency || 'SDG / USD'}
              </span>
            </div>
            <p className="text-xs text-sf-muted font-normal mt-1 flex items-center gap-2 flex-wrap">
              {settings.phone ? (
                <span>{settings.phone}</span>
              ) : (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-sf-warning hover:text-sf-warning text-xs font-medium underline"
                >
                  إعداد بيانات المتجر والحساب
                </button>
              )}
              {currentUser ? (
                <button
                  type="button"
                  onClick={() => void syncAllToCloud()}
                  title="المزامنة السحابية عبر Firebase (اضغط للمزامنة الفورية)"
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-lg border transition-all ${
                    syncStatus === 'synced'
                      ? 'text-sf-info bg-sf-info-bg/30 border-sf-info/30 hover:bg-sf-info-bg/50'
                      : syncStatus === 'syncing'
                      ? 'text-sf-warning bg-sf-warning-bg/30 border-sf-warning/30'
                      : syncStatus === 'error'
                      ? 'text-sf-danger bg-sf-danger-bg/30 border-sf-danger/30 hover:bg-sf-danger-bg/50'
                      : 'text-sf-muted bg-sf-raised border-sf-border hover:text-sf-text'
                  }`}
                >
                  <Cloud className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                  <span>
                    {syncStatus === 'synced'
                      ? 'مزامَن سحابياً مع Firebase'
                      : syncStatus === 'syncing'
                      ? 'جاري المزامنة...'
                      : syncStatus === 'error' ? 'تعذرت المزامنة (اضغط للمحاولة)' : 'بانتظار المزامنة'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenAuth || onOpenSettings}
                  title="اضغط لإنشاء حساب أو تسجيل الدخول وتفعيل المزامنة السحابية عبر Firebase"
                  className="inline-flex items-center gap-1 text-sf-warning hover:text-sf-warning text-xs font-medium underline"
                >
                  <CloudOff className="w-3.5 h-3.5" />
                  <span>تسجيل الدخول إلى الحساب السحابي</span>
                </button>
              )}
            </p>
          </div>
        </div>

        {/* Currency Badge & Actions */}
        <div className="flex items-center flex-wrap gap-2 mr-auto sm:mr-0">
          {/* Exchange Rate Badge */}
          <div className="bg-sf-raised border border-sf-border text-sf-text rounded-xl px-3 py-2 flex items-center gap-2 text-xs shadow-xs">
            <div className="flex flex-col">
              <span className="text-xs text-sf-muted font-medium">سعر الصرف:</span>
              <span className="font-semibold font-mono text-sm text-sf-text">
                1 USD = {quote ? formatMoney(quote.units_per_usd, quote.currency, settings) : formatMoney(settings.default_exchange_rate, 'SDG', settings)}
              </span>
            </div>
            <button
              onClick={() => {
                if (quote) { onOpenSettings(); return; }
                setTempRate(settings.default_exchange_rate.toString());
                setRateError(null);
                setIsEditingRate(true);
              }}
              title="تعديل سعر الصرف اليومي"
              className="p-1 rounded-lg bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Onboarding / Guide Tour Button */}
          {onOpenOnboarding && (
            <button
              onClick={onOpenOnboarding}
              title="التعريف بالخدمات والمزايا"
              className="bg-sf-raised hover:bg-sf-raised text-sf-text hover:text-sf-text border border-sf-border text-xs px-3 py-2 rounded-xl flex items-center gap-2 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-sf-action" />
              <span className="hidden md:inline">خدمات النظام</span>
            </button>
          )}

          {/* Quick New Invoice Button */}
          <button
            id="btn-quick-new-invoice"
            onClick={onOpenNewInvoice}
            className="bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs sm:text-sm px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg shadow-sf-action/20 transition-all "
          >
            <Plus className="w-4 h-4 text-sf-on-action" />
            <span>فاتورة جديدة</span>
          </button>

          {/* Google Auth Status / Login Button */}
          {!authLoading && (
            <div>
              {currentUser ? (
                <div className="flex items-center gap-2 bg-sf-raised border border-sf-border rounded-xl py-1 px-3 text-xs text-sf-text">
                  {currentUser.photoURL ? (
                    <img
                      src={currentUser.photoURL}
                      alt={currentUser.displayName || 'User'}
                      referrerPolicy="no-referrer"
                      className="w-6 h-6 rounded-full border border-sf-action/40"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-sf-action text-sf-on-action flex items-center justify-center font-semibold text-xs">
                      {currentUser.displayName ? currentUser.displayName[0] : 'U'}
                    </div>
                  )}
                  <span className="max-w-[80px] sm:max-w-[120px] truncate hidden sm:inline font-semibold text-sf-text">
                    {currentUser.displayName || currentUser.email}
                  </span>
                  <button
                    onClick={handleLogout}
                    title="تسجيل الخروج"
                    className="text-sf-muted hover:text-sf-danger transition-colors p-1"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenAuth || handleGoogleLogin}
                  title="تسجيل الدخول أو إنشاء حساب سحابي"
                  className="bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border text-xs px-3 py-2 rounded-xl flex items-center gap-2 transition-colors font-semibold shadow-xs"
                >
                  <LogIn className="w-3.5 h-3.5 text-sf-action" />
                  <span>دخول / تسجيل</span>
                </button>
              )}
            </div>
          )}

          {/* Theme Mode Toggle Button (Dark / Light) */}
          <button
            onClick={toggleTheme}
            title={theme === 'light' ? 'التحويل إلى الوضع الداكن (Dark Mode)' : 'التحويل إلى الوضع الفاتح (Light Mode)'}
            className="p-2 rounded-xl text-sf-muted hover:text-sf-warning bg-sf-raised hover:bg-sf-raised border border-sf-border transition-colors flex items-center justify-center"
            aria-label="تبديل وضع السمة"
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4 text-sf-info hover:text-sf-info transition-colors" />
            ) : (
              <Sun className="w-4 h-4 text-sf-warning hover:text-sf-warning transition-colors" />
            )}
          </button>

          {/* Legal & Support Button */}
          {onOpenLegal && (
            <button
              onClick={() => onOpenLegal('contact')}
              title="مركز الدعم والسياسات"
              className="p-2 rounded-xl text-sf-muted hover:text-sf-action bg-sf-raised hover:bg-sf-raised border border-sf-border transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          )}

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            title="الإعدادات"
            className="p-2 rounded-xl text-sf-muted hover:text-sf-text bg-sf-raised hover:bg-sf-raised border border-sf-border transition-colors"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </div>

      {authError && (
        <div role="alert" className="bg-sf-danger-bg/40 border-t border-sf-danger/50 px-4 py-2 text-xs text-sf-danger flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-sf-danger" />
            <span>{authError}</span>
          </div>
          <button onClick={() => setAuthError(null)} className="text-sf-danger hover:underline">
            إغلاق
          </button>
        </div>
      )}

      {/* Quick Edit Exchange Rate Modal */}
      {isEditingRate && (
        <Dialog label="تحديث سعر الصرف الحالي" onClose={() => { if (!isSavingRate) setIsEditingRate(false); }} className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-sf-surface rounded-xl shadow-2xl border border-sf-border max-w-sm w-full p-6 animate-in fade-in zoom-in-95 text-sf-text">
            <h3 className="font-semibold text-base text-sf-text mb-2">تحديث سعر الصرف الحالي</h3>
            <p className="text-xs text-sf-muted mb-4 leading-relaxed">
              أدخل سعر صرف الدولار مقابل الجنيه السوداني في السوق اليوم. الفواتير السابقة لن تتأثر لأن سعرها
              مجمّد وقت الإصدار.
            </p>
            <form onSubmit={handleSaveRate} className="space-y-4">
              <div>
                <label htmlFor="current-exchange-rate" className="block text-xs font-semibold text-sf-text mb-1">
                  سعر الصرف (1 دولار أمريكي = كم جنيه سوداني؟)
                </label>
                <div className="relative">
                  <input
                    id="current-exchange-rate"
                    aria-invalid={rateError ? true : undefined}
                    aria-describedby={rateError ? 'current-rate-error' : undefined}
                    disabled={isSavingRate}
                    type="number"
                    step="1"
                    min="1"
                    value={tempRate}
                    onChange={(e) => setTempRate(e.target.value)}
                    autoFocus
                    required
                    className="w-full text-left font-mono font-semibold text-lg px-3 py-2 bg-sf-raised border border-sf-border rounded-xl text-sf-text focus:outline-none focus:border-sf-action"
                  />
                  <span className="absolute left-3 top-2.5 text-xs text-sf-muted font-sans">
                    ج.س / $
                  </span>
                </div>
              </div>
              {rateError && <p id="current-rate-error" role="alert" className="text-sm text-sf-danger">تعذر حفظ سعر الصرف. بياناتك ما زالت في النموذج. {rateError}</p>}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSavingRate}
                  onClick={() => setIsEditingRate(false)}
                  className="px-4 py-2 text-xs font-medium text-sf-text bg-sf-raised hover:bg-sf-raised rounded-xl border border-sf-border transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSavingRate}
                  className="px-4 py-2 text-xs font-semibold text-sf-on-action bg-sf-action hover:bg-sf-action-hover rounded-xl shadow-lg shadow-sf-action/20 flex items-center gap-2 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {isSavingRate ? 'جارٍ حفظ سعر الصرف…' : rateError ? 'أعد المحاولة' : 'حفظ السعر الجديد'}
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      )}
    </header>
  );
};
