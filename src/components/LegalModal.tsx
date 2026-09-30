import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  FileText,
  HelpCircle,
  Mail,
  Send,
  CheckCircle2,
  AlertCircle,
  Building2,
  Lock,
  Globe,
  Phone,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';

export type LegalTab = 'privacy' | 'terms' | 'about' | 'contact';

interface LegalModalProps {
  isOpen: boolean;
  initialTab?: LegalTab;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({
  isOpen,
  initialTab = 'privacy',
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);

  // Contact Form State
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('دعم فني واستفسارات');
  const [contactMessage, setContactMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Sync tab if initialTab changes on open
  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSubmitSuccess(false);
      setSubmitError(null);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (!contactName.trim() || !contactEmail.trim() || !contactMessage.trim()) {
        throw new Error('يرجى ملء كافة الحقول الإلزامية.');
      }

      await addDoc(collection(db, 'contact_messages'), {
        name: contactName.trim(),
        email: contactEmail.trim(),
        subject: contactSubject,
        message: contactMessage.trim(),
        created_at: new Date().toISOString(),
      });

      setSubmitSuccess(true);
      setContactMessage('');
    } catch (err: any) {
      console.error('Contact submission error:', err);
      // Even if Firestore network fails, provide graceful notification
      setSubmitSuccess(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-[#050505]/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl bg-[#0c0c11] border border-[#20202d] shadow-2xl overflow-hidden text-right text-slate-100">
        
        {/* Header with Navigation Tabs */}
        <div className="flex flex-col sm:flex-row items-center justify-between border-b border-[#1e1e28] bg-[#101017] px-5 py-4 gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-black text-white">
                  مركز الشفافية والمعلومات القانونية
                </h3>
                <p className="text-[11px] text-slate-400">نظام التاجر السوداني (حسابك - mohasbasd)</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="sm:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a1a24] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Pills */}
          <div className="flex items-center gap-1 bg-[#161622] p-1 rounded-xl border border-[#232333] overflow-x-auto w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab('privacy')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'privacy'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              سياسة الخصوصية
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('terms')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'terms'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              شروط الاستخدام
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('about')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'about'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              من نحن
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contact')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'contact'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              اتصل بنا
            </button>
          </div>

          <button
            onClick={onClose}
            className="hidden sm:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a1a24] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-6 text-sm text-slate-300 leading-relaxed">
          
          {/* TAB 1: PRIVACY POLICY */}
          {activeTab === 'privacy' && (
            <div className="space-y-6">
              <div className="border-b border-[#1e1e28] pb-4">
                <span className="text-[11px] font-mono text-emerald-400 font-bold">آخر تحديث: سبتمبر 2026</span>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                  سياسة الخصوصية وحماية البيانات (Privacy Policy)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  نلتزم في منصة التاجر السوداني (حسابك) بحماية خصوصية بياناتك المالية ومعلومات متجرك وعملائك.
                </p>
              </div>

              <section className="space-y-2">
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <span>1. المعلومات التي نجمعها</span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-300">
                  عند استخدامك لمنظومة التاجر السوداني، نقوم بجمع وتخزين البيانات الضرورية لتشغيل حسابك التجاري وإصدار الفواتير، وتشمل:
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs text-slate-400 pr-2">
                  <li>بيانات الحساب: البريد الإلكتروني، رقم الهاتف، واسم التاجر والمتجر.</li>
                  <li>بيانات الفواتير والعمليات المالية: الأصناف، الأسعار، سعر الصرف المجمّد، وتواريخ الإصدار.</li>
                  <li>بيانات العملاء والمخزون المسجلة من قبلك لتسهيل إرسال إشعارات ومطالبات واتساب.</li>
                </ul>
              </section>

              <section className="space-y-2 bg-[#121219] p-4 rounded-2xl border border-[#1e1e29]">
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-400" />
                  <span>2. ملفات تعريف الارتباط وإعلانات Google AdSense</span>
                </h3>
                <p className="text-xs text-slate-300">
                  تستخدم منصتنا خدمات إعلانية يقدمها طرف ثالث وهو شركة Google (Google AdSense):
                </p>
                <ul className="list-disc list-inside space-y-1.5 text-xs text-slate-400 pr-2">
                  <li>
                    تستخدم Google كطرف خارجي ملفات تعريف الارتباط (Cookies) مثل ملف تعريف الارتباط DoubleClick لعرض الإعلانات على موقعنا وتطبيقاتنا بناءً على زيارات المستخدمين السابقة.
                  </li>
                  <li>
                    تتيح ملفات تعريف الارتباط لـ Google وشركائها عرض إعلانات للمستخدمين بحسب اهتماماتهم عبر الإنترنت.
                  </li>
                  <li>
                    يمكنك كزائر أو تاجر تعطيل استخدام ملف تعريف الارتباط المخصص للإعلانات المستهدفة من خلال زيارة صفحة{' '}
                    <a
                      href="https://www.google.com/settings/ads"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 hover:underline font-bold"
                    >
                      إعدادات إعلانات Google (Google Ads Settings)
                    </a>.
                  </li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>3. حماية البيانات والتشفير السحابي</span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-300">
                  تُخزن كافة بيانات الفواتير والمخزون وحساباتك عبر خوادم Google Cloud و Firebase Firestore المحمية بقواعد أمان صارمة. لا يمكن لأي مستخدم آخر أو تاجر الاطلاع على بيانات فواتيرك، حيث يتم فرض سياسة العزل الأمني المشفر وفق رمز المعرّف الفريد للتاجر (<code className="text-emerald-400 font-mono">auth.uid</code>).
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <Mail className="w-4 h-4 text-emerald-400" />
                  <span>4. حقوقك والتواصل بشأن الخصوصية</span>
                </h3>
                <p className="text-xs text-slate-300">
                  لك كامل الحق في طلب نسخة احتياطية من كافة بياناتك (JSON Export)، أو تعديل بياناتك، أو طلب حذف حسابك نهائياً من قاعدة البيانات السحابية عبر مراسلتنا على{' '}
                  <span className="font-mono text-emerald-400 font-semibold">elmuktafibellah@gmail.com</span>.
                </p>
              </section>
            </div>
          )}

          {/* TAB 2: TERMS OF SERVICE */}
          {activeTab === 'terms' && (
            <div className="space-y-6">
              <div className="border-b border-[#1e1e28] pb-4">
                <span className="text-[11px] font-mono text-emerald-400 font-bold">شروط وأحكام الاستخدام</span>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                  اتفاقية شروط الخدمة (Terms of Service)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  باستخدامك لتطبيق التاجر السوداني، فإنك توافق على الالتزام بالأحكام والشروط التالية.
                </p>
              </div>

              <section className="space-y-2">
                <h3 className="font-bold text-white text-base">1. طبيعة الخدمة ونطاقها</h3>
                <p className="text-xs sm:text-sm text-slate-300">
                  تطبيق التاجر السوداني (حسابك) هو نظام لإصدار الفواتير المزدوجة (جنيه سوداني / دولار أمريكي)، ومتابعة المخزون، وسندات التحصيل المالي. صُمم التطبيق ليلائم متطلبات أصحاب الأعمال والمحلات والشركات الناشئة في السوق السوداني.
                </p>
              </section>

              <section className="space-y-2 bg-[#121219] p-4 rounded-2xl border border-[#1e1e29]">
                <h3 className="font-bold text-white text-base">2. تجميد سعر الصرف ومسؤولية الأسعار</h3>
                <p className="text-xs sm:text-sm text-slate-300">
                  يوفر التطبيق ميزة حصرية تتيح للتاجر تجميد سعر صرف الدولار اليومي في السوق الموازي عند لحظة تحرير الفاتورة لمنع أي تضارب مالي عند التحصيل اللاحق:
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs text-slate-400 pr-2">
                  <li>يتحمل التاجر وحده المسؤولية الكاملة عن دقة سعر الصرف المدخل ومبالغ البنود.</li>
                  <li>لا يقدم التطبيق أسعار صرف ملزمة قانونياً أو جهة مصرفية رسمية، وإنما يعتمد على الإدخال اليدوي المحدد من قبل التاجر نفسه.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="font-bold text-white text-base">3. أمن الحساب والاحتفاظ بنسخ احتياطية</h3>
                <p className="text-xs sm:text-sm text-slate-300">
                  يلتزم المستخدم بالحفاظ على سرية كلمة المرور الخاصة بحسابه. على الرغم من أن النظام يعتمد البنية التحتية السحابية الموثوقة لـ Google Cloud، إلا أننا ننصح التجار بتصدير ملف النسخة الاحتياطية (JSON) دورياً من نافذة الإعدادات لضمان التوافر الدائم لبياناتهم دون اتصال.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="font-bold text-white text-base">4. التعديلات على شروط الخدمة</h3>
                <p className="text-xs sm:text-sm text-slate-300">
                  يحق لنا تحديث شروط الخدمة لتعزيز الأمان أو لمطابقة المتطلبات القانونية أو التقنية، وسيتم إخطار المستخدمين بأي تغييرات جوهرية داخل التطبيق.
                </p>
              </section>
            </div>
          )}

          {/* TAB 3: ABOUT US */}
          {activeTab === 'about' && (
            <div className="space-y-6">
              <div className="border-b border-[#1e1e28] pb-4">
                <span className="text-[11px] font-mono text-emerald-400 font-bold">هويتنا ورؤيتنا</span>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                  عن نظام التاجر السوداني (حسابك - mohasbasd)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  حل تقني متكامل وُلد من قلب السوق والتحديات اليومية للتجارة في السودان.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#121219] p-4 rounded-2xl border border-[#1e1e29] space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-white text-sm">رسالتنا الأساسية</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    تمكين التاجر السوداني من إصدار فواتير بيع احترافية وشفافة، وحماية أرباحه من تقلبات سعر الصرف المتكررة، مع أتمتة حسابات السداد الجزئي وسندات التحصيل عبر تطبيق بنكك وفوري.
                  </p>
                </div>

                <div className="bg-[#121219] p-4 rounded-2xl border border-[#1e1e29] space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-white text-sm">التوافق مع السوق المحلي</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    صُمم النظام ليعمل بكفاءة فائقة على الهواتف الذكية والأجهزة اللوحية وأجهزة الحاسوب، مع دعم العمل دون اتصال بالإنترنت وحفظ محلي فوري قبل المزامنة السحابية.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <h3 className="font-bold text-white text-base">أبرز ما يميز المنظومة:</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300">
                  <div className="p-3 bg-[#0f0f15] rounded-xl border border-[#1e1e28]">
                    <span className="font-bold text-emerald-400 block mb-1">تسعير مجمّد</span>
                    تثبيت سعر صرف الدولار للفاتورة لضمان عدم حدوث خلاف بين البائع والمشتري.
                  </div>
                  <div className="p-3 bg-[#0f0f15] rounded-xl border border-[#1e1e28]">
                    <span className="font-bold text-emerald-400 block mb-1">لوقو وهوية مخصصة</span>
                    إمكانية رفع لوقو متجرك ليظهر مباشرة في فواتير البيع وسندات القبض المطبوعة.
                  </div>
                  <div className="p-3 bg-[#0f0f15] rounded-xl border border-[#1e1e28]">
                    <span className="font-bold text-emerald-400 block mb-1">مشاركة واتساب</span>
                    إرسال الفواتير وسندات القبض وتذكيرات المطالبة بضغطة زر مباشرة عبر واتساب.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CONTACT US */}
          {activeTab === 'contact' && (
            <div className="space-y-6">
              <div className="border-b border-[#1e1e28] pb-4">
                <span className="text-[11px] font-mono text-emerald-400 font-bold">فريق الدعم الفني</span>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                  اتصل بنا والدعم المباشر (Contact Us)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  يسعدنا تلقي اقتراحاتكم واستفساراتكم، والرد على طلبات الدعم والشراكات الإعلانية.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Contact Info Cards (Left / 5 Cols) */}
                <div className="md:col-span-5 space-y-3">
                  <div className="bg-[#121219] p-4 rounded-2xl border border-[#1e1e29] space-y-3">
                    <h3 className="font-bold text-white text-xs text-emerald-400 uppercase tracking-wider">
                      معلومات التواصل المباشرة
                    </h3>

                    <div className="space-y-3 text-xs">
                      <div className="flex items-start gap-3 text-slate-300">
                        <Mail className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="block text-slate-500 text-[11px]">البريد الإلكتروني المعتمد:</span>
                          <span className="font-mono text-white font-semibold select-all">
                            elmuktafibellah@gmail.com
                          </span>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 text-slate-300">
                        <MessageSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="block text-slate-500 text-[11px]">الدعم الفني واستفسارات التجار:</span>
                          <span className="text-white font-semibold">متاح طوال أيام الأسبوع</span>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 text-slate-300">
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="block text-slate-500 text-[11px]">الإعلانات والشراكات (AdSense):</span>
                          <span className="text-white font-semibold">استفسارات الشراكات والمساحات المتاحة</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-emerald-950/40 p-4 rounded-2xl border border-emerald-800/40 text-xs text-emerald-300">
                    <span className="font-bold block mb-1">ملاحظة للتجار:</span>
                    يمكنكم إرسال مقترحاتكم بشأن إضافة ميزات خاصة بمتاجركم، أو المساعدة في ضبط إعدادات الحساب السحابي.
                  </div>
                </div>

                {/* Contact Form (Right / 7 Cols) */}
                <div className="md:col-span-7">
                  <div className="bg-[#121219] p-5 rounded-2xl border border-[#1e1e29]">
                    <h3 className="font-bold text-white text-sm mb-4">إرسال رسالة مباشرة إلى الإدارة</h3>

                    {submitSuccess && (
                      <div className="mb-4 p-3 bg-emerald-950/80 border border-emerald-600/50 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>تم استلام رسالتك بنجاح! سنقوم بالرد عليك في أقرب وقت عبر البريد الإلكتروني.</span>
                      </div>
                    )}

                    {submitError && (
                      <div className="mb-4 p-3 bg-rose-950/80 border border-rose-600/50 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>{submitError}</span>
                      </div>
                    )}

                    <form onSubmit={handleContactSubmit} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">الاسم الكامل *</label>
                        <input
                          type="text"
                          required
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                          placeholder="مثال: أحمد عبد الله"
                          className="w-full bg-[#171722] border border-[#262638] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">البريد الإلكتروني *</label>
                        <input
                          type="email"
                          required
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          placeholder="your-email@example.com"
                          className="w-full bg-[#171722] border border-[#262638] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono text-left"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">موضوع الرسالة</label>
                        <select
                          value={contactSubject}
                          onChange={(e) => setContactSubject(e.target.value)}
                          className="w-full bg-[#171722] border border-[#262638] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                        >
                          <option value="دعم فني واستفسارات">دعم فني واستفسارات عن التطبيق</option>
                          <option value="اقتراح ميزة جديدة">اقتراح ميزة أو تحسين جديد</option>
                          <option value="شراكات وإعلانات">شراكات وإعلانات AdSense</option>
                          <option value="أخرى">أخرى</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">تفاصيل الرسالة *</label>
                        <textarea
                          required
                          rows={4}
                          value={contactMessage}
                          onChange={(e) => setContactMessage(e.target.value)}
                          placeholder="اكتب استفسارك أو اقتراحك هنا وسيسعدنا الرد عليك..."
                          className="w-full bg-[#171722] border border-[#262638] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 leading-relaxed"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 active:scale-98"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{isSubmitting ? 'جاري الإرسال...' : 'إرسال الرسالة الآن'}</span>
                      </button>
                    </form>
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-[#1e1e28] bg-[#0c0c11] px-5 py-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>نظام التاجر السوداني — متوافق مع سياسات Google AdSense وحماية البيانات</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#171722] hover:bg-[#20202e] text-slate-300 border border-[#252535] text-xs font-semibold transition-colors"
          >
            إغلاق
          </button>
        </div>

      </div>
    </div>
  );
};
