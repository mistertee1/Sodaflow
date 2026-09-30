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
    <header className="bg-[#0c0c0f] border-b border-[#1e1e24] sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
        {/* Logo & Store Info */}
        <div className="flex items-center gap-3">
          {settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg' ? (
            <div className="w-11 h-11 rounded-xl bg-[#14141c] border border-[#c59b48]/30 p-1 flex items-center justify-center overflow-hidden shadow-sm">
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
              <h1 className="font-bold text-base sm:text-lg text-white leading-tight">
                {settings.business_name || 'حسابك (اضغط لضبط اسم المتجر)'}
              </h1>
              <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-[#c59b48]/15 text-[#d4a34b] border border-[#c59b48]/40 font-bold">
                حسابك
              </span>
              <span className="hidden sm:inline-flex text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 font-bold">
                (ج.س / $)
              </span>
            </div>
            <p className="text-xs text-slate-400 font-normal mt-0.5 flex items-center gap-2 flex-wrap">
              {settings.phone ? (
                <span>{settings.phone}</span>
              ) : (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-amber-400 hover:text-amber-300 text-[11px] font-medium underline"
                >
                  إعداد بيانات المتجر والحساب
                </button>
              )}
              {currentUser ? (
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                  syncStatus === 'synced' ? 'text-emerald-400' : 'text-amber-400'
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
                  className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 text-[11px] font-medium underline"
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
          <div className="bg-[#121216] border border-[#1e1e24] text-slate-200 rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs shadow-xs">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-medium">سعر الصرف:</span>
              <span className="font-bold font-mono text-sm text-emerald-400">
                1 $ = {formatMoney(settings.default_exchange_rate, 'SDG', settings)}
              </span>
            </div>
            <button
              onClick={() => {
                setTempRate(settings.default_exchange_rate.toString());
                setIsEditingRate(true);
              }}
              title="تعديل سعر الصرف اليومي"
              className="p-1 rounded-lg bg-[#181820] hover:bg-[#22222c] text-slate-300 border border-[#272733] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Onboarding / Guide Tour Button */}
          {onOpenOnboarding && (
            <button
              onClick={onOpenOnboarding}
              title="التعريف بالخدمات والمزايا"
              className="bg-[#15151c] hover:bg-[#1d1d26] text-slate-300 hover:text-white border border-[#22222d] text-xs px-2.5 py-2 rounded-xl flex items-center gap-1.5 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline">خدمات النظام</span>
            </button>
          )}

          {/* Quick New Invoice Button */}
          <button
            id="btn-quick-new-invoice"
            onClick={onOpenNewInvoice}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>فاتورة جديدة</span>
          </button>

          {/* Google Auth Status / Login Button */}
          {!authLoading && (
            <div>
              {currentUser ? (
                <div className="flex items-center gap-2 bg-[#121216] border border-[#1e1e24] rounded-xl py-1 px-2.5 text-xs text-slate-200">
                  {currentUser.photoURL ? (
                    <img
                      src={currentUser.photoURL}
                      alt={currentUser.displayName || 'User'}
                      referrerPolicy="no-referrer"
                      className="w-6 h-6 rounded-full border border-emerald-500/40"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center font-bold text-[10px]">
                      {currentUser.displayName ? currentUser.displayName[0] : 'U'}
                    </div>
                  )}
                  <span className="max-w-[80px] sm:max-w-[120px] truncate hidden sm:inline font-bold text-white">
                    {currentUser.displayName || currentUser.email}
                  </span>
                  <button
                    onClick={handleLogout}
                    title="تسجيل الخروج"
                    className="text-slate-400 hover:text-rose-400 transition-colors p-0.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenAuth || handleGoogleLogin}
                  title="تسجيل الدخول أو إنشاء حساب سحابي"
                  className="bg-[#15151c] hover:bg-[#1f1f2a] text-slate-100 border border-[#292936] text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 transition-colors font-bold shadow-xs"
                >
                  <LogIn className="w-3.5 h-3.5 text-emerald-400" />
                  <span>دخول / تسجيل</span>
                </button>
              )}
            </div>
          )}

          {/* Theme Mode Toggle Button (Dark / Light) */}
          <button
            onClick={toggleTheme}
            title={theme === 'light' ? 'التحويل إلى الوضع الداكن (Dark Mode)' : 'التحويل إلى الوضع الفاتح (Light Mode)'}
            className="p-2 rounded-xl text-slate-400 hover:text-amber-400 bg-[#121216] hover:bg-[#1a1a22] border border-[#1e1e24] transition-colors flex items-center justify-center"
            aria-label="تبديل وضع السمة"
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4 text-indigo-500 hover:text-indigo-600 transition-colors" />
            ) : (
              <Sun className="w-4 h-4 text-amber-400 hover:text-amber-300 transition-colors" />
            )}
          </button>

          {/* Legal & Support Button */}
          {onOpenLegal && (
            <button
              onClick={() => onOpenLegal('contact')}
              title="مركز الدعم والسياسات"
              className="p-2 rounded-xl text-slate-400 hover:text-emerald-400 bg-[#121216] hover:bg-[#1a1a22] border border-[#1e1e24] transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          )}

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            title="الإعدادات"
            className="p-2 rounded-xl text-slate-400 hover:text-white bg-[#121216] hover:bg-[#1a1a22] border border-[#1e1e24] transition-colors"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </div>

      {authError && (
        <div className="bg-rose-950/40 border-t border-rose-900/50 px-4 py-2 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            <span>{authError}</span>
          </div>
          <button onClick={() => setAuthError(null)} className="text-rose-400 hover:underline">
            إغلاق
          </button>
        </div>
      )}

      {/* Quick Edit Exchange Rate Modal */}
      {isEditingRate && (
        <div className="fixed inset-0 z-50 bg-[#050505]/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0c0c0f] rounded-2xl shadow-2xl border border-[#1e1e24] max-w-sm w-full p-5 animate-in fade-in zoom-in-95 text-slate-100">
            <h3 className="font-bold text-base text-white mb-2">تحديث سعر الصرف الحالي</h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              أدخل سعر صرف الدولار مقابل الجنيه السوداني في السوق اليوم. الفواتير السابقة لن تتأثر لأن سعرها
              مجمّد وقت الإصدار.
            </p>
            <form onSubmit={handleSaveRate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
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
                    className="w-full text-left font-mono font-bold text-lg px-3 py-2 bg-[#121216] border border-[#1e1e24] rounded-xl text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-sans">
                    ج.س / $
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditingRate(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-300 bg-[#16161d] hover:bg-[#20202a] rounded-xl border border-[#272733] transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 transition-colors"
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
