import React, { useState } from 'react';
import { BrandLogo } from './BrandLogo';
import {
  signInWithGoogle,
  loginWithEmail,
  registerMerchant,
  requestPasswordReset,
} from '../lib/firebase';
import {
  Store,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  FileText,
  Package,
  Share2,
  AlertCircle,
  ArrowLeft,
  Sparkles,
  Lock,
  Mail,
  KeyRound,
  User,
  Building2,
  DollarSign,
  Printer,
  ChevronRight,
  Eye,
  EyeOff,
  Calculator,
  Laptop,
  Check,
  Sun,
  Moon,
} from 'lucide-react';
import { formatMoney, safeMul } from '../lib/currency';
import { Footer } from './Footer';
import { LegalModal, LegalTab } from './LegalModal';
import { AdBanner } from './AdBanner';
import { useApp } from '../context/AppContext';

interface LandingPageViewProps {
  onContinueAsGuest: () => void;
  onLoginSuccess: () => void;
}

type AuthMode = 'login' | 'register' | 'forgot_password';

export const LandingPageView: React.FC<LandingPageViewProps> = ({
  onContinueAsGuest,
  onLoginSuccess,
}) => {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form Fields
  const [identifier, setIdentifier] = useState(''); // email
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { theme, toggleTheme, settings } = useApp();

  // Interactive Live Calculator for Visitor Preview
  const [calcAmount, setCalcAmount] = useState<number>(100); // 100 USD
  const [calcRate, setCalcRate] = useState<number>(settings?.default_exchange_rate || 2000);
  const [legalTab, setLegalTab] = useState<LegalTab | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      onLoginSuccess();
    } catch (err: any) {
      console.warn('Google login notice in LandingPage:', err?.code);
      if (err?.code === 'auth/popup-blocked') {
        setError('تم حظر النافذة المنبثقة بواسطة المتصفح. يرجى السماح بالنوافذ المنبثقة والمحاولة مجدداً.');
      } else {
        setError(err?.friendlyMessage || 'تعذر تسجيل الدخول بحساب Google. يمكنك التسجيل بالبريد وكلمة المرور أو المتابعة كضيف.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      if (authMode === 'login') {
        if (!identifier.trim() || !password) {
          throw new Error('يرجى إدخال البريد الإلكتروني وكلمة المرور.');
        }
        await loginWithEmail(identifier, password);
        onLoginSuccess();
      } else if (authMode === 'register') {
        if (!identifier.trim() || !password) {
          throw new Error('يرجى إدخال جميع الحقول الإلزامية.');
        }
        if (password.length < 6) {
          throw new Error('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام.');
        }
        if (password !== confirmPassword) {
          throw new Error('كلمتا المرور غير متطابقتين.');
        }
        await registerMerchant(
          identifier,
          password,
          merchantName ? `${merchantName} (${businessName || 'متجر'})` : businessName || 'تاجر'
        );
        onLoginSuccess();
      } else if (authMode === 'forgot_password') {
        if (!identifier.trim()) {
          throw new Error('يرجى إدخال بريدك الإلكتروني لاستلام رابط إعادة التعيين.');
        }
        await requestPasswordReset(identifier);
        setSuccessMessage('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني. تفقد صندوق الوارد.');
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      let msg = err.message || 'حدث خطأ أثناء المصادقة.';
      if (err?.code === 'auth/user-not-found' || err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
        msg = 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
      } else if (err?.code === 'auth/email-already-in-use') {
        msg = 'هذا الحساب مسجل مسبقاً. يمكنك تسجيل الدخول مباشرة.';
      } else if (err?.code === 'auth/weak-password') {
        msg = 'كلمة المرور ضعيفة جداً، يرجى اختيار كلمة أقوى (6 خانات على الأقل).';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`min-h-screen ${
        theme === 'light' ? 'bg-sf-canvas text-sf-text' : 'bg-sf-canvas text-sf-text'
      } flex flex-col justify-between selection:bg-sf-action selection:text-sf-on-action relative overflow-x-hidden font-sans antialiased transition-colors duration-(--sf-motion-state)`}
    >
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-sf-canvas/90 backdrop-blur-md border-b border-sf-border">
        <div className="sf-content py-4 flex flex-wrap items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo size="md" showText />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:flex items-center gap-4 text-xs font-medium text-sf-muted pl-2 border-l border-sf-border">
              <button
                onClick={() => setLegalTab('privacy')}
                className="hover:text-sf-action transition-colors"
              >
                سياسة الخصوصية
              </button>
              <button
                onClick={() => setLegalTab('about')}
                className="hover:text-sf-action transition-colors"
              >
                من نحن
              </button>
              <button
                onClick={() => setLegalTab('contact')}
                className="hover:text-sf-action transition-colors"
              >
                اتصل بنا
              </button>
            </div>

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              title={theme === 'light' ? 'التحويل إلى الوضع الداكن (Dark Mode)' : 'التحويل إلى الوضع الفاتح (Light Mode)'}
              className="p-2 rounded-xl text-sf-text hover:text-sf-text bg-sf-raised hover:bg-sf-raised border border-sf-border transition-all flex items-center justify-center"
              aria-label="تبديل وضع السمة"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4 text-sf-info hover:text-sf-info transition-colors" />
              ) : (
                <Sun className="w-4 h-4 text-sf-warning hover:text-sf-warning transition-colors" />
              )}
            </button>

            <button
              onClick={onContinueAsGuest}
              className="hidden sm:flex text-xs text-sf-text hover:text-sf-text bg-sf-raised hover:bg-sf-raised border border-sf-border px-4 py-2 rounded-xl transition-all flex items-center gap-2 font-medium"
            >
              <span>تجربة كضيف (محلي)</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setAuthMode('register');
                document.getElementById('sudaflow-auth')?.scrollIntoView({ behavior: 'auto', block: 'start' });
              }}
              className="hidden sm:inline-flex text-xs font-semibold bg-sf-action hover:bg-sf-action-hover text-sf-on-action px-4 py-2 rounded-xl shadow-lg shadow-sf-action/20 transition-all"
            >
              إنشاء حساب جديد
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="sf-content py-8 sm:py-12 space-y-12 relative z-10 flex-1">
        
        {/* Hero Section with Auth Box */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          
          {/* Hero Pitch (Right on RTL) */}
          <div className="lg:col-span-7 space-y-6 text-right pt-2">
            <p className="text-sm text-sf-muted">شغلك أوضح.</p>
            <h1 className="sf-display">فواتيرك ومخزونك في مكان واحد.</h1>
            <p className="text-base text-sf-muted max-w-xl">إصدار الفواتير، متابعة التحصيل، وعرض قيم الجنيه السوداني والدولار.</p>
            <figure className="sf-card overflow-hidden">
              <img src="/brand/previews/app-light.svg" alt="مثال شاشة الفواتير في سودافلو ببيانات تجريبية" className="sf-logo-light w-full" width="980" height="580" />
              <img src="/brand/previews/app-dark.svg" alt="مثال شاشة الفواتير في سودافلو ببيانات تجريبية" className="sf-logo-dark w-full" width="980" height="580" />
              <figcaption className="px-4 py-3 text-xs text-sf-muted border-t border-sf-border">بيانات تجريبية لعرض الواجهة؛ ليست سجلات متجرك أو أسعار صرف حالية.</figcaption>
            </figure>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={onContinueAsGuest} className="sf-action inline-flex items-center gap-2">ابدأ التجربة<ArrowLeft aria-hidden="true" /></button>
              <a href="#sudaflow-auth" className="sf-secondary inline-flex items-center">تسجيل الدخول أو إنشاء حساب</a>
            </div>

            {/* Quick Benefits Bullet List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="flex items-center gap-3 text-xs text-sf-text">
                <div className="w-5 h-5 rounded-full bg-sf-action/20 text-sf-action flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>تجميد سعر صرف السوق الموازي لكل فاتورة</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-sf-text">
                <div className="w-5 h-5 rounded-full bg-sf-action/20 text-sf-action flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>الفواتير باسم متجرك وشعاره</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-sf-text">
                <div className="w-5 h-5 rounded-full bg-sf-action/20 text-sf-action flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>إرسال مطالبات فواتير PDF عبر واتساب بضغطة زر</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-sf-text">
                <div className="w-5 h-5 rounded-full bg-sf-action/20 text-sf-action flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>سندات قبض لسداد تطبيق بنكك وفوري وكاش</span>
              </div>
            </div>

            {/* Live Interactive Currency Preview Tool */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-4 sm:p-6 mt-6 shadow-xl">
              <div className="flex items-center justify-between mb-3 border-b border-sf-border pb-3">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-sf-action" />
                  <span className="font-semibold text-xs text-sf-text">حاسبة العملات · تجربة محلية</span>
                </div>
                <span className="text-xs text-sf-text font-mono font-semibold">مثال تجريبي</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-xs text-sf-muted mb-1">المبلغ بالدولار (USD):</label>
                  <input
                    type="number"
                    min="1"
                    value={calcAmount}
                    onChange={(e) => setCalcAmount(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text font-mono font-semibold text-sm focus:outline-none focus:border-sf-action"
                  />
                </div>
                <div>
                  <label className="block text-xs text-sf-muted mb-1">سعر الصرف التجريبي (SDG / USD):</label>
                  <input
                    type="number"
                    min="1"
                    value={calcRate}
                    onChange={(e) => setCalcRate(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text font-mono font-semibold text-sm focus:outline-none focus:border-sf-action"
                  />
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-sf-border flex items-center justify-between bg-sf-raised p-3 rounded-xl text-xs">
                <span className="text-sf-muted">إجمالي الفاتورة المجمّد بالجنيه:</span>
                <span className="font-mono font-semibold text-sm text-sf-text">
                  {formatMoney(safeMul(calcAmount, calcRate, settings.sdg_decimals), 'SDG', settings)}
                </span>
              </div>
            </div>
          </div>

          {/* Auth Card (Left on RTL) */}
          <div id="sudaflow-auth" className="lg:col-span-5 scroll-mt-24">
            <div className="bg-sf-surface border border-sf-border rounded-xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              
              {/* Card Header & Tabs */}
              <div className="flex rounded-xl bg-sf-raised p-1 border border-sf-border mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    authMode === 'login'
                      ? 'bg-sf-action text-sf-on-action shadow-md'
                      : 'text-sf-muted hover:text-sf-text'
                  }`}
                >
                  تسجيل الدخول
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    authMode === 'register'
                      ? 'bg-sf-action text-sf-on-action shadow-md'
                      : 'text-sf-muted hover:text-sf-text'
                  }`}
                >
                  حساب جديد
                </button>
              </div>

              {/* Title & subtitle */}
              <div className="text-right mb-6">
                <h3 className="text-lg font-semibold text-sf-text">
                  {authMode === 'login' && 'مرحباً بعودتك'}
                  {authMode === 'register' && 'إنشاء حساب تاجر سحابي'}
                  {authMode === 'forgot_password' && 'استرجاع كلمة المرور'}
                </h3>
                <p className="text-xs text-sf-muted mt-1">
                  {authMode === 'login' && 'أدخل بيانات حسابك للوصول إلى فواتيرك ومخزونك السحابي.'}
                  {authMode === 'register' && 'أنشئ حسابك لبدء حفظ وإصدار الفواتير المزدوجة ومزامنتها.'}
                  {authMode === 'forgot_password' && 'أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.'}
                </p>
              </div>

              {/* Notifications */}
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-sf-danger-bg/60 border border-sf-danger/60 text-xs text-sf-danger text-right flex items-start gap-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-sf-danger shrink-0 mt-1" />
                  <span>{error}</span>
                </div>
              )}

              {successMessage && (
                <div className="mb-4 p-3 rounded-xl bg-sf-selected/60 border border-sf-action/60 text-xs text-sf-action text-right flex items-start gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-sf-action shrink-0 mt-1" />
                  <span>{successMessage}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleAuthSubmit} className="space-y-4 text-right">
                {authMode === 'register' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-sf-text mb-1">اسم التاجر / المالك</label>
                      <div className="relative">
                        <input
                          type="text"
                          required
                          value={merchantName}
                          onChange={(e) => setMerchantName(e.target.value)}
                          placeholder="مثال: محمد أحمد"
                          className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action pl-12"
                        />
                        <User className="w-4 h-4 text-sf-muted absolute left-3 top-2.5" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-sf-text mb-1">اسم المتجر أو المؤسسة</label>
                      <div className="relative">
                        <input
                          type="text"
                          required
                          value={businessName}
                          onChange={(e) => setBusinessName(e.target.value)}
                          placeholder="مثال: مؤسسة النيل للتجارة"
                          className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action pl-12"
                        />
                        <Building2 className="w-4 h-4 text-sf-muted absolute left-3 top-2.5" />
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-semibold text-sf-text mb-1">
                    {authMode === 'forgot_password' ? 'البريد الإلكتروني المسجل' : 'البريد الإلكتروني أو رقم الهاتف'}
                  </label>
                  <div className="relative">
                    <input
                      type={authMode === 'forgot_password' ? 'email' : 'text'}
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={authMode === 'forgot_password' ? 'your-email@example.com' : 'بريد إلكتروني أو رقم هاتف (09xxxxxxx)'}
                      className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action pl-12 text-left font-sans"
                    />
                    <Mail className="w-4 h-4 text-sf-muted absolute left-3 top-2.5" />
                  </div>
                </div>

                {authMode !== 'forgot_password' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-sf-text">كلمة المرور</label>
                      {authMode === 'login' && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuthMode('forgot_password');
                            setError(null);
                            setSuccessMessage(null);
                          }}
                          className="text-xs text-sf-action hover:underline"
                        >
                          نسيت كلمة المرور؟
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action pl-12 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-sf-muted hover:text-sf-text absolute left-3 top-2.5"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {authMode === 'register' && (
                  <div>
                    <label className="block text-xs font-semibold text-sf-text mb-1">تأكيد كلمة المرور</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action pl-12 font-mono"
                      />
                      <KeyRound className="w-4 h-4 text-sf-muted absolute left-3 top-2.5" />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold py-3 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-sf-action/20 transition-all active:scale-[0.98] disabled:opacity-50 mt-2"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : authMode === 'login' ? (
                    'دخول الحساب السحابي'
                  ) : authMode === 'register' ? (
                    'إنشاء حساب تاجر جديد'
                  ) : (
                    'إرسال رابط إعادة التعيين'
                  )}
                </button>
              </form>

              {authMode === 'forgot_password' && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setError(null);
                    }}
                    className="text-xs text-sf-muted hover:text-sf-text underline"
                  >
                    العودة لتسجيل الدخول
                  </button>
                </div>
              )}

              {/* Divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-sf-border"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-sf-surface text-sf-muted">أو دخول سريع</span>
                </div>
              </div>

              {/* Google Button */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-all text-xs"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>المتابعة بحساب Google</span>
              </button>

              {/* Guest Access Alternative */}
              <div className="mt-4 pt-3 border-t border-sf-border">
                <button
                  type="button"
                  onClick={onContinueAsGuest}
                  className="w-full bg-sf-raised hover:bg-sf-raised text-sf-text hover:text-sf-text border border-sf-border font-medium py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-2 transition-all"
                >
                  <span>استكشاف النظام كضيف (تخزين محلي مؤقت)</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-sf-muted">
                <ShieldCheck className="w-3.5 h-3.5 text-sf-action" />
                <span>صلاحيات وصول حسب دور المستخدم والمؤسسة</span>
              </div>
            </div>
          </div>
        </section>

        {/* Strategic AdSense Placement */}
        <div className="max-w-4xl mx-auto px-2">
          <AdBanner format="horizontal" label="إعلان ممول / Google AdSense" />
        </div>

        {/* Feature Highlights Grid */}
        <section className="space-y-6 pt-2">
          <div className="text-center space-y-2 max-w-2xl mx-auto">
            <h3 className="text-xl sm:text-2xl font-semibold text-sf-text">
              كل ما يحتاجه التاجر لإدارة فواتيره ومخزونه بدقة
            </h3>
            <p className="text-xs sm:text-sm text-sf-muted">
              صُممت ميزات النظام خصيصاً لتناسب احتياجات المحلات والشركات والتجار في الأسواق السودانية
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            {/* 1. Rate Freeze */}
            <div className="bg-sf-surface border border-sf-border hover:border-sf-action/40 p-6 rounded-xl transition-all space-y-3">
              <div className="w-9 h-9 rounded-xl bg-sf-action/10 text-sf-action flex items-center justify-center">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-sf-text">تجميد سعر الصرف لكل فاتورة</h4>
              <p className="text-xs text-sf-muted leading-relaxed">
                كل فاتورة تحتفظ بسعر الصرف الذي أدخلته عند الإصدار. يظهر هذا السعر في المستند وفي سجل الفاتورة.
              </p>
            </div>

            {/* 2. Dual Currency */}
            <div className="bg-sf-surface border border-sf-border hover:border-sf-action/40 p-6 rounded-xl transition-all space-y-3">
              <div className="w-9 h-9 rounded-xl bg-sf-action/10 text-sf-action flex items-center justify-center">
                <DollarSign className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-sf-text">فواتير مزدوجة العملة (ج.س / $)</h4>
              <p className="text-xs text-sf-muted leading-relaxed">
                عرض المبالغ بالجنيه والدولار معاً في الفاتورة والبنود، مع دعم التحويل الآلي وفق ضوابط التقريب المحددة.
              </p>
            </div>

            {/* 3. Logo & Branding */}
            <div className="bg-sf-surface border border-sf-border hover:border-sf-action/40 p-6 rounded-xl transition-all space-y-3">
              <div className="w-9 h-9 rounded-xl bg-sf-action/10 text-sf-action flex items-center justify-center">
                <Printer className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-sf-text">شعار المتجر على المستندات</h4>
              <p className="text-xs text-sf-muted leading-relaxed">
                ارفع شعار متجرك المخصص ليظهر تلقائياً في ترويسة فواتير البيع المطبوعة وسندات القبض وبصيغة PDF.
              </p>
            </div>

            {/* 4. Inventory & Alerts */}
            <div className="bg-sf-surface border border-sf-border hover:border-sf-action/40 p-6 rounded-xl transition-all space-y-3">
              <div className="w-9 h-9 rounded-xl bg-sf-action/10 text-sf-action flex items-center justify-center">
                <Package className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-sf-text">إدارة وجرد المخزون</h4>
              <p className="text-xs text-sf-muted leading-relaxed">
                خصم تلقائي لكميات المنتجات عند كل بيع مع تنبيهات فورية للأصناف التي أوشكت على النفاد في المتجر.
              </p>
            </div>

            {/* 5. Bankak & Receipts */}
            <div className="bg-sf-surface border border-sf-border hover:border-sf-action/40 p-6 rounded-xl transition-all space-y-3">
              <div className="w-9 h-9 rounded-xl bg-sf-action/10 text-sf-action flex items-center justify-center">
                <Share2 className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-sf-text">تسجيل الدفعات وإصدار سندات القبض</h4>
              <p className="text-xs text-sf-muted leading-relaxed">
                إدراج رقم حساب بنكك تلقائياً للعملاء، وتسجيل دفعات السداد الجزئي والكامل وإصدار سند قبض باسم المتجر.
              </p>
            </div>

            {/* 6. Multi-Device Cloud */}
            <div className="bg-sf-surface border border-sf-border hover:border-sf-action/40 p-6 rounded-xl transition-all space-y-3">
              <div className="w-9 h-9 rounded-xl bg-sf-action/10 text-sf-action flex items-center justify-center">
                <Laptop className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-sf-text">مزامنة سحابية متعددة الأجهزة</h4>
              <p className="text-xs text-sf-muted leading-relaxed">
                ادخل لنفس حسابك من متجرك، هاتفك، أو لابتوبك والوصول إلى بيانات مؤسستك المحفوظة بعد تسجيل الدخول.
              </p>
            </div>

          </div>
        </section>

      </main>

      {/* Modern Compliant Footer with Legal Pages */}
      <Footer onOpenLegal={(tab) => setLegalTab(tab)} />

      {/* Legal & Utility Modal */}
      <LegalModal
        isOpen={!!legalTab}
        initialTab={legalTab || 'privacy'}
        onClose={() => setLegalTab(null)}
      />
    </div>
  );
};
