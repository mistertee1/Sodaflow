import React, { useState } from 'react';
import { BrandLogo } from './BrandLogo';
import {
  signInWithGoogle,
  loginWithEmailOrPhone,
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
  Phone,
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
  const [identifier, setIdentifier] = useState(''); // email or phone
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { theme, toggleTheme, settings } = useApp();

  // Interactive Live Calculator for Visitor Preview
  const [calcAmount, setCalcAmount] = useState<number>(100); // 100 USD
  const [calcRate, setCalcRate] = useState<number>(settings?.default_exchange_rate || 0);
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
          throw new Error('يرجى إدخال البريد الإلكتروني أو رقم الهاتف وكلمة المرور.');
        }
        await loginWithEmailOrPhone(identifier, password);
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
        msg = 'البريد أو رقم الهاتف أو كلمة المرور غير صحيحة.';
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
        theme === 'light' ? 'bg-[#f8fafc] text-slate-900' : 'bg-[#050505] text-slate-100'
      } flex flex-col justify-between selection:bg-emerald-500 selection:text-slate-950 relative overflow-x-hidden font-sans antialiased transition-colors duration-200`}
    >
      {/* Background Ambience / Glows */}
      <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none -mt-32"></div>
      <div className="absolute bottom-1/3 left-1/4 w-[500px] h-[500px] bg-emerald-600/5 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-[#07070a]/90 backdrop-blur-md border-b border-[#1a1a24]">
        <div className="max-w-6xl w-full mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo size="md" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-base sm:text-lg text-white tracking-tight leading-tight">
                  حِسَابُك
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#c59b48]/15 text-[#d4a34b] border border-[#c59b48]/40 font-bold">
                  Hisabuk
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/90 text-emerald-400 border border-emerald-800/60 font-mono font-bold">
                  (ج.س / $)
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-normal">منظومة الفواتير المزدوجة والمخزون السحابي</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:flex items-center gap-4 text-xs font-medium text-slate-400 pl-2 border-l border-[#1e1e28]">
              <button
                onClick={() => setLegalTab('privacy')}
                className="hover:text-emerald-400 transition-colors"
              >
                سياسة الخصوصية
              </button>
              <button
                onClick={() => setLegalTab('about')}
                className="hover:text-emerald-400 transition-colors"
              >
                من نحن
              </button>
              <button
                onClick={() => setLegalTab('contact')}
                className="hover:text-emerald-400 transition-colors"
              >
                اتصل بنا
              </button>
            </div>

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              title={theme === 'light' ? 'التحويل إلى الوضع الداكن (Dark Mode)' : 'التحويل إلى الوضع الفاتح (Light Mode)'}
              className="p-2 rounded-xl text-slate-300 hover:text-white bg-[#121218] hover:bg-[#1c1c24] border border-[#22222f] transition-all flex items-center justify-center"
              aria-label="تبديل وضع السمة"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4 text-indigo-500 hover:text-indigo-600 transition-colors" />
              ) : (
                <Sun className="w-4 h-4 text-amber-400 hover:text-amber-300 transition-colors" />
              )}
            </button>

            <button
              onClick={onContinueAsGuest}
              className="text-xs text-slate-300 hover:text-white bg-[#121218] hover:bg-[#1c1c24] border border-[#22222f] px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 font-medium"
            >
              <span>تجربة كضيف (محلي)</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setAuthMode('register');
                window.scrollTo({ top: 400, behavior: 'smooth' });
              }}
              className="hidden sm:inline-flex text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-2 rounded-xl shadow-lg shadow-emerald-500/20 transition-all"
            >
              إنشاء حساب جديد
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl w-full mx-auto px-4 py-8 sm:py-12 space-y-16 relative z-10 flex-1">
        
        {/* Hero Section with Auth Box */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          
          {/* Hero Pitch (Right on RTL) */}
          <div className="lg:col-span-7 space-y-6 text-right pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/80 text-emerald-400 text-xs font-bold border border-emerald-800/60 shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>مُصمم لواقع التجارة وسوق العملات المتقلب</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#c59b48]/15 text-[#d4a34b] text-xs font-bold border border-[#c59b48]/40 shadow-xs">
                <span>هوية «حِسَابُك» المالية</span>
              </div>
            </div>

            <h2 className="text-3xl sm:text-5xl font-black text-white leading-[1.25] tracking-tight">
              منظومة <span className="text-[#d4a34b]">«حِسَابُك»</span> الذكية <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-l from-emerald-400 to-teal-200">
                بعملتين وتجميد لسعر الصرف
              </span>
            </h2>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              تخلّص من خسائر تقلب سعر الدولار. أصدر فواتيرك بالجنيه والدولار معاً بسعر صرف مجمّد، تحكم في مخزونك، احصل على سندات قبض بنكك وفوري، ومزامنة آمنة تحفظ بياناتك من أي جهاز.
            </p>

            {/* Quick Benefits Bullet List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="flex items-center gap-2.5 text-xs text-slate-300">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>تجميد سعر صرف السوق الموازي لكل فاتورة</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-300">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>اعتماد هوية «حسابك» أو رفع لوقو متجرك الخاص</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-300">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>إرسال مطالبات فواتير PDF عبر واتساب بضغطة زر</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-300">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>سندات قبض لسداد تطبيق بنكك وفوري وكاش</span>
              </div>
            </div>

            {/* Live Interactive Currency Preview Tool */}
            <div className="bg-[#0c0c11] border border-[#1e1e28] rounded-2xl p-4 sm:p-5 mt-6 shadow-xl">
              <div className="flex items-center justify-between mb-3 border-b border-[#1e1e28] pb-2.5">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-xs text-white">تجربة فورية: محاكي تسعير الفاتورة المزدوجة</span>
                </div>
                <span className="text-[11px] text-emerald-400 font-mono font-bold">سوق موازي مجمّد</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">المبلغ بالدولار ($):</label>
                  <input
                    type="number"
                    min="1"
                    value={calcAmount}
                    onChange={(e) => setCalcAmount(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-[#14141c] border border-[#262635] rounded-xl px-3 py-2 text-white font-mono font-bold text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">سعر الصرف (ج.س لكل $):</label>
                  <input
                    type="number"
                    min="1"
                    value={calcRate}
                    onChange={(e) => setCalcRate(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-[#14141c] border border-[#262635] rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="mt-3.5 pt-3 border-t border-[#1a1a24] flex items-center justify-between bg-[#12121a] p-2.5 rounded-xl text-xs">
                <span className="text-slate-400">إجمالي الفاتورة المجمّد بالجنيه:</span>
                <span className="font-mono font-black text-sm text-emerald-400">
                  {safeMul(calcAmount, calcRate, 0).toLocaleString()} ج.س
                </span>
              </div>
            </div>
          </div>

          {/* Auth Card (Left on RTL) */}
          <div className="lg:col-span-5">
            <div className="bg-[#0b0b10] border border-[#20202d] rounded-3xl p-6 sm:p-7 shadow-2xl relative overflow-hidden">
              
              {/* Card Header & Tabs */}
              <div className="flex rounded-xl bg-[#14141d] p-1 border border-[#232332] mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                    authMode === 'login'
                      ? 'bg-emerald-500 text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-white'
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
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                    authMode === 'register'
                      ? 'bg-emerald-500 text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  حساب جديد
                </button>
              </div>

              {/* Title & subtitle */}
              <div className="text-right mb-5">
                <h3 className="text-lg font-black text-white">
                  {authMode === 'login' && 'مرحباً بعودتك'}
                  {authMode === 'register' && 'إنشاء حساب تاجر سحابي'}
                  {authMode === 'forgot_password' && 'استرجاع كلمة المرور'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {authMode === 'login' && 'أدخل بيانات حسابك للوصول إلى فواتيرك ومخزونك السحابي.'}
                  {authMode === 'register' && 'أنشئ حسابك لبدء حفظ وإصدار الفواتير المزدوجة ومزامنتها.'}
                  {authMode === 'forgot_password' && 'أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.'}
                </p>
              </div>

              {/* Notifications */}
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-xs text-rose-300 text-right flex items-start gap-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {successMessage && (
                <div className="mb-4 p-3 rounded-xl bg-emerald-950/60 border border-emerald-700/60 text-xs text-emerald-300 text-right flex items-start gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{successMessage}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleAuthSubmit} className="space-y-4 text-right">
                {authMode === 'register' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">اسم التاجر / المالك</label>
                      <div className="relative">
                        <input
                          type="text"
                          required
                          value={merchantName}
                          onChange={(e) => setMerchantName(e.target.value)}
                          placeholder="مثال: محمد أحمد"
                          className="w-full bg-[#12121a] border border-[#222230] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-9"
                        />
                        <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">اسم المتجر أو المؤسسة</label>
                      <div className="relative">
                        <input
                          type="text"
                          required
                          value={businessName}
                          onChange={(e) => setBusinessName(e.target.value)}
                          placeholder="مثال: مؤسسة النيل للتجارة"
                          className="w-full bg-[#12121a] border border-[#222230] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-9"
                        />
                        <Building2 className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {authMode === 'forgot_password' ? 'البريد الإلكتروني المسجل' : 'البريد الإلكتروني أو رقم الهاتف'}
                  </label>
                  <div className="relative">
                    <input
                      type={authMode === 'forgot_password' ? 'email' : 'text'}
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={authMode === 'forgot_password' ? 'your-email@example.com' : 'بريد إلكتروني أو رقم هاتف (09xxxxxxx)'}
                      className="w-full bg-[#12121a] border border-[#222230] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-9 text-left font-sans"
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  </div>
                </div>

                {authMode !== 'forgot_password' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-300">كلمة المرور</label>
                      {authMode === 'login' && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuthMode('forgot_password');
                            setError(null);
                            setSuccessMessage(null);
                          }}
                          className="text-[11px] text-emerald-400 hover:underline"
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
                        className="w-full bg-[#12121a] border border-[#222230] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-9 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-slate-500 hover:text-slate-300 absolute left-3 top-2.5"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {authMode === 'register' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">تأكيد كلمة المرور</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-[#12121a] border border-[#222230] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-9 font-mono"
                      />
                      <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.98] disabled:opacity-50 mt-2"
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
                    className="text-xs text-slate-400 hover:text-white underline"
                  >
                    العودة لتسجيل الدخول
                  </button>
                </div>
              )}

              {/* Divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#1e1e28]"></div>
                </div>
                <div className="relative flex justify-center text-[11px]">
                  <span className="px-2 bg-[#0b0b10] text-slate-500">أو دخول سريع</span>
                </div>
              </div>

              {/* Google Button */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full bg-[#14141d] hover:bg-[#1a1a25] text-slate-200 border border-[#272737] font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2.5 transition-all text-xs"
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
              <div className="mt-4 pt-3 border-t border-[#1e1e28]">
                <button
                  type="button"
                  onClick={onContinueAsGuest}
                  className="w-full bg-[#12121a] hover:bg-[#181822] text-slate-300 hover:text-white border border-[#20202e] font-medium py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
                >
                  <span>استكشاف النظام كضيف (تخزين محلي مؤقت)</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>حماية سحابية مشفرة 100% عبر Firebase Firestore</span>
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
            <h3 className="text-xl sm:text-2xl font-black text-white">
              كل ما يحتاجه التاجر لإدارة فواتيره ومخزونه بدقة
            </h3>
            <p className="text-xs sm:text-sm text-slate-400">
              صُممت ميزات النظام خصيصاً لتناسب احتياجات المحلات والشركات والتجار في الأسواق السودانية
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            {/* 1. Rate Freeze */}
            <div className="bg-[#0b0b10] border border-[#1e1e28] hover:border-emerald-500/40 p-5 rounded-2xl transition-all space-y-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm text-white">تجميد سعر الصرف لكل فاتورة</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                كل فاتورة تصدر تسجّل سعر صرف السوق الموازي الذي كان فعالاً وقتها، ولا تتأثر الفواتير القديمة بأي ارتفاع لاحق للدولار.
              </p>
            </div>

            {/* 2. Dual Currency */}
            <div className="bg-[#0b0b10] border border-[#1e1e28] hover:border-emerald-500/40 p-5 rounded-2xl transition-all space-y-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <DollarSign className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm text-white">فواتير مزدوجة العملة (ج.س / $)</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                عرض المبالغ بالجنيه والدولار معاً في الفاتورة والبنود، مع دعم التحويل الآلي وفق ضوابط التقريب المحددة.
              </p>
            </div>

            {/* 3. Logo & Branding */}
            <div className="bg-[#0b0b10] border border-[#1e1e28] hover:border-emerald-500/40 p-5 rounded-2xl transition-all space-y-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Printer className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm text-white">لوقو المتجر والطباعة الرسمية</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                ارفع شعار متجرك المخصص ليظهر تلقائياً في ترويسة فواتير البيع المطبوعة وسندات القبض وبصيغة PDF.
              </p>
            </div>

            {/* 4. Inventory & Alerts */}
            <div className="bg-[#0b0b10] border border-[#1e1e28] hover:border-emerald-500/40 p-5 rounded-2xl transition-all space-y-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Package className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm text-white">إدارة وجرد المخزون الذكي</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                خصم تلقائي لكميات المنتجات عند كل بيع مع تنبيهات فورية للأصناف التي أوشكت على النفاد في المتجر.
              </p>
            </div>

            {/* 5. Bankak & Receipts */}
            <div className="bg-[#0b0b10] border border-[#1e1e28] hover:border-emerald-500/40 p-5 rounded-2xl transition-all space-y-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Share2 className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm text-white">ربط بنكك وسندات القبض الفورية</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                إدراج رقم حساب بنكك تلقائياً للعملاء، وتسجيل دفعات السداد الجزئي والكامل وتوليد سند قبض مالي موثق.
              </p>
            </div>

            {/* 6. Multi-Device Cloud */}
            <div className="bg-[#0b0b10] border border-[#1e1e28] hover:border-emerald-500/40 p-5 rounded-2xl transition-all space-y-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Laptop className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm text-white">مزامنة سحابية متعددة الأجهزة</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                ادخل لنفس حسابك من متجرك، هاتفك، أو لابتوبك والبيانات محفوظة ومحمية بسحابة Firebase ضد الضياع.
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
