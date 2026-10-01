import React, { useState } from 'react';
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
  const { settings, updateSettings, currentUser, authLoading, syncStatus, lastSyncedAt, theme, toggleTheme, logoutUser } = useApp();
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [tempRate, setTempRate] = useState(settings.default_exchange_rate.toString());
  const [authError, setAuthError] = useState<string | null>(null);

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateNum = parseFloat(tempRate);
    if (!isNaN(rateNum) && rateNum > 0) {
      await updateSettings({ default_exchange_rate: rateNum });
      setIsEditingRate(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.warn('Google login notice in header:', err?.code);
      setAuthError(err?.friendlyMessage || 'تعذر تسجيل الدخول بحساب Google. يمكنك المتابعة محلياً.');
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
    <header className="bg-sf-surface border-b border-sf-border sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
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
            <BrandLogo size="md" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base sm:text-lg text-sf-text leading-tight">
                {settings.business_name || 'سودافلو — اضبط اسم متجرك'}
              </h1>
              <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-sf-action/15 text-sf-action border border-sf-action/40 font-bold">
                سودافلو
              </span>
              <span className="hidden sm:inline-flex text-[11px] px-2 py-0.5 rounded-full bg-sf-selected/80 text-sf-action border border-sf-action/50 font-bold">
                (ج.س / $)
              </span>
            </div>
            <p className="text-xs text-sf-muted font-normal mt-0.5 flex items-center gap-2 flex-wrap">
              {settings.phone ? (
                <span>{settings.phone}</span>
              ) : (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-sf-warning hover:text-sf-warning text-[11px] font-medium underline"
                >
                  إعداد بيانات المتجر والحساب
                </button>
              )}
              {currentUser ? (
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                  syncStatus === 'synced' ? 'text-sf-action' : 'text-sf-warning'
                }`}>
                  <Cloud className="w-3 h-3" />
                  <span>
                    {syncStatus === 'synced'
                      ? 'مزامَن سحابياً'
                      : syncStatus === 'syncing'
                      ? 'جاري المزامنة...'
                      : 'سحابي متصل'}
                  </span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onOpenAuth || onOpenSettings}
                  className="inline-flex items-center gap-1 text-sf-warning hover:text-sf-warning text-[11px] font-medium underline"
                >
                  <CloudOff className="w-3 h-3" />
                  <span>وضع الضيف (اضغط لإنشاء حساب سحابي)</span>
                </button>
              )}
            </p>
          </div>
        </div>

        {/* Currency Badge & Actions */}
        <div className="flex items-center flex-wrap gap-2 mr-auto sm:mr-0">
          {/* Exchange Rate Badge */}
          <div className="bg-sf-raised border border-sf-border text-sf-text rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs shadow-xs">
            <div className="flex flex-col">
              <span className="text-[10px] text-sf-muted font-medium">سعر الصرف:</span>
              <span className="font-bold font-mono text-sm text-sf-action">
                1 $ = {formatMoney(settings.default_exchange_rate, 'SDG', settings)}
              </span>
            </div>
            <button
              onClick={() => {
                setTempRate(settings.default_exchange_rate.toString());
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
              className="bg-sf-raised hover:bg-sf-raised text-sf-text hover:text-sf-text border border-sf-border text-xs px-2.5 py-2 rounded-xl flex items-center gap-1.5 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-sf-action" />
              <span className="hidden md:inline">خدمات النظام</span>
            </button>
          )}

          {/* Quick New Invoice Button */}
          <button
            id="btn-quick-new-invoice"
            onClick={onOpenNewInvoice}
            className="bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-black text-xs sm:text-sm px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-sf-action/20 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 text-sf-on-action" />
            <span>فاتورة جديدة</span>
          </button>

          {/* Google Auth Status / Login Button */}
          {!authLoading && (
            <div>
              {currentUser ? (
                <div className="flex items-center gap-2 bg-sf-raised border border-sf-border rounded-xl py-1 px-2.5 text-xs text-sf-text">
                  {currentUser.photoURL ? (
                    <img
                      src={currentUser.photoURL}
                      alt={currentUser.displayName || 'User'}
                      referrerPolicy="no-referrer"
                      className="w-6 h-6 rounded-full border border-sf-action/40"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-sf-action text-sf-on-action flex items-center justify-center font-bold text-[10px]">
                      {currentUser.displayName ? currentUser.displayName[0] : 'U'}
                    </div>
                  )}
                  <span className="max-w-[80px] sm:max-w-[120px] truncate hidden sm:inline font-bold text-sf-text">
                    {currentUser.displayName || currentUser.email}
                  </span>
                  <button
                    onClick={handleLogout}
                    title="تسجيل الخروج"
                    className="text-sf-muted hover:text-sf-danger transition-colors p-0.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenAuth || handleGoogleLogin}
                  title="تسجيل الدخول أو إنشاء حساب سحابي"
                  className="bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 transition-colors font-bold shadow-xs"
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
        <div className="bg-sf-danger-bg/40 border-t border-sf-danger/50 px-4 py-2 text-xs text-sf-danger flex items-center justify-between">
          <div className="flex items-center gap-1.5">
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
        <div className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-sf-surface rounded-2xl shadow-2xl border border-sf-border max-w-sm w-full p-5 animate-in fade-in zoom-in-95 text-sf-text">
            <h3 className="font-bold text-base text-sf-text mb-2">تحديث سعر الصرف الحالي</h3>
            <p className="text-xs text-sf-muted mb-4 leading-relaxed">
              أدخل سعر صرف الدولار مقابل الجنيه السوداني في السوق اليوم. الفواتير السابقة لن تتأثر لأن سعرها
              مجمّد وقت الإصدار.
            </p>
            <form onSubmit={handleSaveRate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-sf-text mb-1">
                  سعر الصرف (1 دولار أمريكي = كم جنيه سوداني؟)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={tempRate}
                    onChange={(e) => setTempRate(e.target.value)}
                    autoFocus
                    required
                    className="w-full text-left font-mono font-bold text-lg px-3 py-2 bg-sf-raised border border-sf-border rounded-xl text-sf-action focus:outline-none focus:border-sf-action"
                  />
                  <span className="absolute left-3 top-2.5 text-xs text-sf-muted font-sans">
                    ج.س / $
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditingRate(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-sf-text bg-sf-raised hover:bg-sf-raised rounded-xl border border-sf-border transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-sf-on-action bg-sf-action hover:bg-sf-action-hover rounded-xl shadow-lg shadow-sf-action/20 flex items-center gap-1.5 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  حفظ السعر الجديد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
