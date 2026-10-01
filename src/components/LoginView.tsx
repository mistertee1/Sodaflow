import React, { useState } from 'react';
import {
  signInWithGoogle,
  loginWithEmailOrPhone,
  registerMerchant,
  isIframeEnvironment,
} from '../lib/firebase';
import { BrandLogo } from './BrandLogo';
import {
  Store,
  ShieldCheck,
  RefreshCw,
  Package,
  Share2,
  AlertCircle,
  ArrowLeft,
  Sparkles,
  ExternalLink,
  Mail,
  Phone,
  Lock,
  UserPlus,
  LogIn,
  KeyRound,
} from 'lucide-react';

interface LoginViewProps {
  onContinueAsGuest: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onContinueAsGuest }) => {
  const [activeTab, setActiveTab] = useState<'google' | 'credentials'>('google');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // Credentials state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isInIframe = isIframeEnvironment();

  const handleOpenInNewTab = () => {
    try {
      window.open(window.location.href, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.warn('Google login in LoginView:', err?.code);
      if (err?.code === 'auth/network-request-failed') {
        setError(
          'تعذر فتح نافذة Google للمصادقة من داخل إطار المعاينة المضمن (بسبب قيود المتصفح على ملفات تعريف الارتباط للطرف الثالث). يمكنك استخدام تسجيل الدخول بالبريد/رقم الهاتف، أو المتابعة كضيف، أو فتح التطبيق في نافذة مستقلة.'
        );
      } else if (err?.code === 'auth/popup-blocked') {
        setError('تم حظر النافذة المنبثقة بواسطة المتصفح. يرجى السماح بالنوافذ المنبثقة والمحاولة مجدداً.');
      } else if (err?.code === 'auth/popup-closed-by-user') {
        setError('تم إغلاق نافذة تسجيل الدخول.');
      } else {
        setError(err?.friendlyMessage || 'تعذر إكمال تسجيل الدخول بحساب Google. يمكنك الدخول بالبريد/الهاتف أو كضيف.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!identifier.trim() || !password) {
      setError('يرجى إدخال البريد أو رقم الهاتف وكلمة المرور.');
      return;
    }

    if (password.length < 6) {
      setError('كلمة المرور يجب أن لا تقل عن 6 خانات.');
      return;
    }

    setLoading(true);
    try {
      if (authMode === 'register') {
        await registerMerchant(identifier, password, displayName.trim() || 'تاجر سودافلو');
        setSuccessMsg('تم إنشاء الحساب بنجاح، جاري التحويل...');
      } else {
        await loginWithEmailOrPhone(identifier, password);
        setSuccessMsg('تم تسجيل الدخول بنجاح...');
      }
    } catch (err: any) {
      console.warn('Credentials auth notice:', err?.code);
      setError(
        err?.friendlyMessage ||
          (authMode === 'register'
            ? 'تعذر إنشاء الحساب. تأكد من صحة البيانات أو حاول تسجيل الدخول إذا كنت مسجلاً مسبقاً.'
            : 'بيانات الدخول غير صحيحة. تأكد من البريد أو رقم الهاتف وكلمة المرور.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-sf-canvas text-sf-text flex flex-col justify-between selection:bg-sf-action selection:text-sf-on-action relative overflow-hidden">
      {/* Background Decorative Emerald Glows */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-sf-action/10 rounded-full blur-3xl pointer-events-none -mt-20"></div>
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-sf-action/5 rounded-full blur-3xl pointer-events-none -mb-20"></div>

      {/* Top Simple Bar */}
      <header className="max-w-6xl w-full mx-auto px-4 py-6 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <BrandLogo size="md" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-base sm:text-lg text-sf-text tracking-tight">
                سودافلو
              </h1>
              <span className="text-xs px-2 py-1 rounded-full bg-sf-action/15 text-sf-action border border-sf-action/40 font-semibold">
                SudaFlow
              </span>
            </div>
            <p className="text-xs text-sf-action font-medium">نظام الفوترة السحابية والمخزون</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isInIframe && (
            <button
              onClick={handleOpenInNewTab}
              className="text-xs text-sf-warning hover:text-sf-warning bg-sf-warning-bg/40 hover:bg-sf-warning-bg/50 border border-sf-warning/60 px-3 py-2 rounded-xl transition-all hidden sm:flex items-center gap-2"
              title="فتح التطبيق في نافذة مستقلة لتجاوز قيود النوافذ المنبثقة"
            >
              <span>فتح في نافذة مستقلة</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={onContinueAsGuest}
            className="text-xs text-sf-muted hover:text-sf-text bg-sf-raised hover:bg-sf-raised border border-sf-border px-4 py-2 rounded-xl transition-all flex items-center gap-2"
          >
            <span>المتابعة كضيف</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Login Card Section */}
      <main className="max-w-5xl w-full mx-auto px-4 py-6 sm:py-8 flex-1 flex flex-col justify-center relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left/Main Column: Welcome & Value Propositions */}
          <div className="lg:col-span-6 space-y-6 text-right">
            <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-sf-selected/70 text-sf-action text-xs font-semibold border border-sf-action/50 shadow-inner">
              <Sparkles className="w-3.5 h-3.5 text-sf-action" />
              <span>إدارة تجارية متكاملة ومصممة للسوق السوداني</span>
            </div>

            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-sf-text leading-tight">
              فواتير احترافية مزدوجة، تجميد لسعر الصرف، ومراقبة دقيقة للمخزون
            </h2>

            <p className="text-xs sm:text-sm text-sf-muted leading-relaxed">
              النظام الأول المصمم لتمكين التجار وأصحاب المحلات في السودان من إصدار الفواتير بالجنيه السوداني والدولار، ومتابعة نقص المخزون، مع إرسال تذكيرات سداد فورية عبر واتساب وربط الحساب البنكي (بنكك).
            </p>

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="bg-sf-surface border border-sf-border p-3 rounded-xl flex items-start gap-3">
                <div className="p-2 rounded-lg bg-sf-action/10 text-sf-action shrink-0">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-sf-text mb-1">تجميد سعر الصرف</h4>
                  <p className="text-xs text-sf-muted leading-snug">
                    تثبيت سعر صرف الدولار لكل فاتورة لحمايتك من تقلبات العملة.
                  </p>
                </div>
              </div>

              <div className="bg-sf-surface border border-sf-border p-3 rounded-xl flex items-start gap-3">
                <div className="p-2 rounded-lg bg-sf-action/10 text-sf-action shrink-0">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-sf-text mb-1">تنبيهات المخزون</h4>
                  <p className="text-xs text-sf-muted leading-snug">
                    خصم فوري عند كل بيع وتنبيه عند الوصول لحد الأمان.
                  </p>
                </div>
              </div>

              <div className="bg-sf-surface border border-sf-border p-3 rounded-xl flex items-start gap-3">
                <div className="p-2 rounded-lg bg-sf-action/10 text-sf-action shrink-0">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-sf-text mb-1">واتساب وبنكك</h4>
                  <p className="text-xs text-sf-muted leading-snug">
                    مشاركة الفاتورة وبيانات الحساب البنكي بضغطة زر واحدة.
                  </p>
                </div>
              </div>

              <div className="bg-sf-surface border border-sf-border p-3 rounded-xl flex items-start gap-3">
                <div className="p-2 rounded-lg bg-sf-action/10 text-sf-action shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-sf-text mb-1">حفظ سحابي مشفر</h4>
                  <p className="text-xs text-sf-muted leading-snug">
                    مزامنة فورية ودعم كامل للعمل دون انقطاع حتى مع ضعف الشبكة.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Multi-Method Authentication Box */}
          <div className="lg:col-span-6">
            <div className="bg-sf-surface border border-sf-border rounded-xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="text-right">
                  <h3 className="text-lg font-semibold text-sf-text">الدخول لمنظومة سودافلو</h3>
                  <p className="text-xs text-sf-muted">اختر طريقة تسجيل الدخول المناسبة لك</p>
                </div>
                <BrandLogo size="md" />
              </div>

              {/* Authentication Mode Tabs */}
              <div className="grid grid-cols-2 p-1 bg-sf-raised rounded-xl border border-sf-border mb-4 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('google');
                    setError(null);
                  }}
                  className={`py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'google'
                      ? 'bg-sf-action text-sf-on-action shadow-md'
                      : 'text-sf-muted hover:text-sf-text'
                  }`}
                >
                  <span>حساب Google</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('credentials');
                    setError(null);
                  }}
                  className={`py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'credentials'
                      ? 'bg-sf-action text-sf-on-action shadow-md'
                      : 'text-sf-muted hover:text-sf-text'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>البريد أو الهاتف</span>
                </button>
              </div>

              {/* Status & Error Messages */}
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-sf-danger-bg/50 border border-sf-danger/60 text-xs text-sf-danger text-right space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-sf-danger shrink-0 mt-1" />
                    <span className="leading-relaxed">{error}</span>
                  </div>

                  {/* Fallback actions if Google OAuth popup fails */}
                  {activeTab === 'google' && (
                    <div className="pt-2 border-t border-sf-danger/40 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('credentials');
                          setError(null);
                        }}
                        className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sf-text font-medium text-xs transition-colors"
                      >
                        الدخول بالبريد / الهاتف
                      </button>
                      <button
                        type="button"
                        onClick={onContinueAsGuest}
                        className="px-3 py-1 rounded-lg bg-sf-action/20 hover:bg-sf-action/30 text-sf-action font-medium text-xs transition-colors"
                      >
                        المتابعة كضيف محلياً
                      </button>
                      {isInIframe && (
                        <button
                          type="button"
                          onClick={handleOpenInNewTab}
                          className="px-3 py-1 rounded-lg bg-sf-warning-bg/20 hover:bg-sf-warning-bg/30 text-sf-warning font-medium text-xs flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>نافذة مستقلة</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {successMsg && (
                <div className="mb-4 p-3 rounded-xl bg-sf-selected/60 border border-sf-action/70 text-xs text-sf-action text-right flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-sf-action shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Tab 1: Google Authentication */}
              {activeTab === 'google' && (
                <div className="space-y-4 text-right">
                  <p className="text-xs text-sf-muted leading-relaxed">
                    سجّل الدخول بنقرة واحدة لربط فواتيرك ومنتجاتك بحسابك السحابي الآمن.
                  </p>

                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full bg-sf-surface hover:bg-sf-raised text-sf-text font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 shadow-lg hover:shadow-xl transition-all duration-(--sf-motion-state) active:scale-[0.98] disabled:opacity-50"
                  >
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
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
                    <span className="text-sm font-semibold">
                      {loading ? 'جاري الاتصال بـ Google...' : 'المتابعة بحساب Google'}
                    </span>
                  </button>

                  {isInIframe && (
                    <div className="p-3 rounded-lg bg-sf-raised border border-sf-border flex items-center justify-between text-xs text-sf-muted">
                      <span>هل تواجه قيود النوافذ المنبثقة؟</span>
                      <button
                        type="button"
                        onClick={handleOpenInNewTab}
                        className="text-sf-warning hover:text-sf-warning font-semibold flex items-center gap-1"
                      >
                        <span>فتح بنافذة جديدة</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Email or Sudanese Phone + Password */}
              {activeTab === 'credentials' && (
                <form onSubmit={handleCredentialsSubmit} className="space-y-3 text-right">
                  {authMode === 'register' && (
                    <div>
                      <label className="block text-xs font-semibold text-sf-text mb-1">
                        اسم المتجر أو التاجر
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="مثال: متجر البركة للأجهزة"
                          className="w-full bg-sf-raised border border-sf-border focus:border-sf-action rounded-xl px-4 py-2 text-xs text-sf-text placeholder-sf-muted outline-none transition-colors"
                        />
                        <Store className="w-4 h-4 text-sf-muted absolute left-3 top-2.5" />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-sf-text mb-1">
                      البريد الإلكتروني أو رقم الهاتف السوداني
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="0912345678 أو merchant@gmail.com"
                        dir="ltr"
                        className="w-full bg-sf-raised border border-sf-border focus:border-sf-action rounded-xl px-4 py-2 text-xs text-sf-text placeholder-sf-muted outline-none transition-colors text-right"
                      />
                      <Phone className="w-4 h-4 text-sf-muted absolute left-3 top-2.5" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-sf-text mb-1">
                      كلمة المرور (6 خانات على الأقل)
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        dir="ltr"
                        className="w-full bg-sf-raised border border-sf-border focus:border-sf-action rounded-xl px-4 py-2 text-xs text-sf-text placeholder-sf-muted outline-none transition-colors text-right"
                      />
                      <Lock className="w-4 h-4 text-sf-muted absolute left-3 top-2.5" />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-sf-action/20 transition-all active:scale-[0.98] disabled:opacity-50 mt-2"
                  >
                    {loading ? (
                      <span>جاري المعالجة...</span>
                    ) : authMode === 'register' ? (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>إنشاء حساب تاجر جديد</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>تسجيل الدخول</span>
                      </>
                    )}
                  </button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode(authMode === 'login' ? 'register' : 'login');
                        setError(null);
                      }}
                      className="text-xs text-sf-muted hover:text-sf-action transition-colors"
                    >
                      {authMode === 'login'
                        ? 'ليس لديك حساب؟ اضغط لإنشاء حساب تاجر جديد'
                        : 'لديك حساب مسجل بالفعل؟ اضغط لتسجيل الدخول'}
                    </button>
                  </div>
                </form>
              )}

              {/* Divider for Instant Guest Access */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-sf-border"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-sf-surface text-sf-muted">أو البدء الفوري بدون تسجيل</span>
                </div>
              </div>

              <button
                type="button"
                onClick={onContinueAsGuest}
                className="w-full bg-sf-raised hover:bg-sf-raised text-sf-action border border-sf-action/30 font-semibold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <span>المتابعة كضيف (تخزين محلي فوري)</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>

              <div className="mt-4 pt-3 border-t border-sf-border flex items-center justify-center gap-2 text-xs text-sf-muted">
                <ShieldCheck className="w-3.5 h-3.5 text-sf-action" />
                <span>حماية سحابية مشفرة 100% عبر Firebase & Cloud Run</span>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Simple Footer */}
      <footer className="max-w-6xl w-full mx-auto px-4 py-4 text-center text-xs text-sf-muted border-t border-sf-border relative z-10">
        <p>© {new Date().getFullYear()} نظام سودافلو — المحاسبة والفوترة الذكية للشركات والمتاجر في السودان</p>
      </footer>
    </div>
  );
};
