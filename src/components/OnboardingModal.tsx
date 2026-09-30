import React, { useState } from 'react';
import {
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  DollarSign,
  Package,
  Clock,
  Receipt,
  Cloud,
  LogIn,
  X,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { signInWithGoogle } from '../lib/firebase';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const { currentUser } = useApp();

  const [authError, setAuthError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleAuth = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
      onClose();
    } catch (e: any) {
      console.warn('Sign in notice from onboarding modal:', e?.code);
      setAuthError(e?.friendlyMessage || 'تعذر تسجيل الدخول بحساب Google. يمكنك إكمال التجربة المحلية.');
    }
  };

  const features = [
    {
      icon: DollarSign,
      title: 'نظام فوترة مزدوج (جنيه سوداني + دولار)',
      desc: 'إصدار فواتير بأسعار الصرف اللحظية مع تجميد السعر تلقائيًا لكل فاتورة لحماية حساباتك وتجارتك من تقلبات الأسعار.',
      badge: 'دقة مالية',
    },
    {
      icon: Package,
      title: 'جرد المخزون وحساب المنتجات المتبقية',
      desc: 'مراقبة حية للكميات المتوفرة، خصم تلقائي للمخزون عند البيع، تنبيهات قبل نفاد البضاعة، وأداة جرد سريعة لتسوية الفروقات.',
      badge: 'جديد ومحدّث',
    },
    {
      icon: Clock,
      title: 'رصد الفواتير المتأخرة وتذكيرات واتساب',
      desc: 'قائمة ذكية بالديون والمتأخرات مع زر إرسال تذكير سداد مباشر للعميل عبر تطبيق واتساب يتضمن تفاصيل الفاتورة وحساب بنكك.',
      badge: 'تحصيل سريع',
    },
    {
      icon: Receipt,
      title: 'سندات قبض وإيصالات استلام رسمية',
      desc: 'توثيق مدفوعات بنكك والنقدية فورياً، مع توليد سند قبض أنيق بصيغة رسمية قابل للطباعة والمشاركة الفورية.',
      badge: 'موثوقية',
    },
    {
      icon: Cloud,
      title: 'مزامنة سحابية فائقة بحساب Google',
      desc: 'سجّل بحساب Google الخاص بك لتُحفظ كل تعديلاتك وفواتيرك ومخزونك في السيرفر السحابي فورياً وآمناً ومدى الحياة.',
      badge: 'سحابي 100%',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[#050505]/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 text-slate-100">
        {/* Modal Banner Header */}
        <div className="relative p-6 sm:p-8 bg-gradient-to-b from-[#141d17] to-[#0c0c0f] border-b border-[#1e1e24]">
          <button
            onClick={onClose}
            className="absolute left-4 top-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#18181f] transition-colors"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/40 px-2.5 py-0.5 rounded-full">
                منظومة الفوترة والمخزون المتقدمة
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                مرحباً بك في نظام التاجر السوداني الذكي
              </h2>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-xl">
            نظام متكامل مصمم خصيصاً للأنشطة والمتاجر والمؤسسات التجارية في السودان؛ يتعامل بمرونة مع العملتين (ج.س / $)، ويدير المخزون والمتأخرات وسندات بنكك السحابية.
          </p>
        </div>

        {/* Features List */}
        <div className="p-6 space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar">
          {features.map((f, idx) => {
            const Icon = f.icon;
            return (
              <div
                key={idx}
                className="flex items-start gap-3.5 p-3.5 rounded-xl bg-[#121216] border border-[#1e1e24] hover:border-emerald-500/30 transition-colors"
              >
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0 mt-0.5">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="text-xs sm:text-sm font-bold text-white">{f.title}</h4>
                    <span className="text-[10px] font-semibold text-emerald-400/90 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 whitespace-nowrap">
                      {f.badge}
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-400 leading-normal">{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Actions & Google Sign-In */}
        <div className="p-5 sm:p-6 bg-[#09090b] border-t border-[#1e1e24] flex flex-col gap-3">
          {authError && (
            <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-[11px] text-rose-300 text-right">
              {authError}
            </div>
          )}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs text-center sm:text-right">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>بياناتك معزولة ومحمية تلقائياً بحساب Google</span>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              {currentUser ? (
                <button
                  onClick={onClose}
                  className="w-full sm:w-auto px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  <span>الانتقال للوحة التحكم</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <>
                  <button
                    onClick={onClose}
                    className="flex-1 sm:flex-initial px-4 py-2.5 bg-[#141418] hover:bg-[#1a1a20] border border-[#262630] text-slate-300 font-semibold text-xs rounded-xl transition-colors"
                  >
                    استكشاف تجريبي
                  </button>
                  <button
                    onClick={handleGoogleAuth}
                    className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>تسجيل الدخول عبر Google</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
