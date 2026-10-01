import React, { useState, useRef } from 'react';
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
import { Dialog } from './Dialog';


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
  const contactKey = useRef(crypto.randomUUID());
  const contactLock = useRef(false);
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
    if (contactLock.current) return;
    contactLock.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (!contactName.trim() || !contactEmail.trim() || !contactMessage.trim()) {
        throw new Error('يرجى ملء كافة الحقول الإلزامية.');
      }

      const response = await fetch('/api/contact-messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        operationId: contactKey.current,
        name: contactName.trim(),
        email: contactEmail.trim(),
        subject: contactSubject,
        message: contactMessage.trim(),
      }) });
      const result = await response.json();
      if (!response.ok || !result.saved) throw new Error(result.error || 'تعذر تأكيد استلام الرسالة.');

      setSubmitSuccess(true);
      setContactMessage('');
      contactKey.current = crypto.randomUUID();
    } catch (err: any) {
      setSubmitSuccess(false);
      setSubmitError(err.message || 'تعذر حفظ الرسالة. أعد المحاولة.');
    } finally {
      contactLock.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog label="الدعم وسياسات سودافلو" onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-sf-canvas/85 backdrop-blur-md animate-in fade-in duration-(--sf-motion-state)">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-xl bg-sf-surface border border-sf-border shadow-2xl overflow-hidden text-right text-sf-text">
        
        {/* Header with Navigation Tabs */}
        <div className="flex flex-col sm:flex-row items-center justify-between border-b border-sf-border bg-sf-raised px-6 py-4 gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-sf-action/10 border border-sf-action/30 text-sf-action flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-sf-text">
                  مركز الشفافية والمعلومات القانونية
                </h3>
                <p className="text-xs text-sf-muted">سودافلو | SudaFlow</p>
              </div>
            </div>

            <button aria-label="إغلاق النافذة"
              onClick={onClose}
              className="sm:hidden p-2 rounded-lg text-sf-muted hover:text-sf-text hover:bg-sf-raised transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Pills */}
          <div className="flex items-center gap-1 bg-sf-raised p-1 rounded-xl border border-sf-border overflow-x-auto w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab('privacy')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'privacy'
                  ? 'bg-sf-action text-sf-on-action shadow-sm'
                  : 'text-sf-muted hover:text-sf-text'
              }`}
            >
              سياسة الخصوصية
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('terms')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'terms'
                  ? 'bg-sf-action text-sf-on-action shadow-sm'
                  : 'text-sf-muted hover:text-sf-text'
              }`}
            >
              شروط الاستخدام
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('about')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'about'
                  ? 'bg-sf-action text-sf-on-action shadow-sm'
                  : 'text-sf-muted hover:text-sf-text'
              }`}
            >
              من نحن
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contact')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'contact'
                  ? 'bg-sf-action text-sf-on-action shadow-sm'
                  : 'text-sf-muted hover:text-sf-text'
              }`}
            >
              اتصل بنا
            </button>
          </div>

          <button aria-label="إغلاق النافذة"
            onClick={onClose}
            className="hidden sm:inline-flex p-2 rounded-lg text-sf-muted hover:text-sf-text hover:bg-sf-raised transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 text-sm text-sf-text leading-relaxed">
          
          {/* TAB 1: PRIVACY POLICY */}
          {activeTab === 'privacy' && (
            <div className="space-y-6">
              <div className="border-b border-sf-border pb-4">
                <span className="text-xs font-mono text-sf-text font-semibold">آخر تحديث: سبتمبر 2026</span>
                <h2 className="text-xl sm:text-2xl font-semibold text-sf-text mt-1">
                  سياسة الخصوصية وحماية البيانات (Privacy Policy)
                </h2>
                <p className="text-xs text-sf-muted mt-1">
                  نلتزم في منصة سودافلو بحماية خصوصية بياناتك المالية ومعلومات متجرك وعملائك.
                </p>
              </div>

              <section className="space-y-2">
                <h3 className="font-semibold text-sf-text text-base flex items-center gap-2">
                  <Lock className="w-4 h-4 text-sf-action" />
                  <span>1. المعلومات التي نجمعها</span>
                </h3>
                <p className="text-xs sm:text-sm text-sf-text">
                  عند استخدامك لسودافلو، نقوم بجمع وتخزين البيانات الضرورية لتشغيل حسابك التجاري وإصدار الفواتير، وتشمل:
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs text-sf-muted pr-2">
                  <li>بيانات الحساب: البريد الإلكتروني، رقم الهاتف، واسم التاجر والمتجر.</li>
                  <li>بيانات الفواتير والعمليات المالية: الأصناف، الأسعار، سعر الصرف المجمّد، وتواريخ الإصدار.</li>
                  <li>بيانات العملاء والمخزون المسجلة من قبلك لتسهيل إرسال إشعارات ومطالبات واتساب.</li>
                </ul>
              </section>

              <section className="space-y-2 bg-sf-raised p-4 rounded-xl border border-sf-border">
                <h3 className="font-semibold text-sf-text text-base">2. التخزين المحلي والجلسة</h3>
                <p className="text-xs text-sf-text">
                  نستخدم تخزين المتصفح لحفظ تفضيل السمة وجلسة تسجيل الدخول. بيانات وضع الضيف محفوظة على هذا الجهاز. لا توجد خدمة إعلانات أو تحليلات مفعّلة في هذا الإصدار.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold text-sf-text text-base flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-sf-action" />
                  <span>3. حماية البيانات والتشفير السحابي</span>
                </h3>
                <p className="text-xs sm:text-sm text-sf-text">
                  في الحساب السحابي تُخزن البيانات في Firebase، ويُسمح بالوصول وفق عضوية المؤسسة ودور المستخدم. بيانات وضع الضيف تُحفظ محلياً؛ احتفظ بنسخة احتياطية قبل تغيير الجهاز أو مسح بيانات المتصفح.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold text-sf-text text-base flex items-center gap-2">
                  <Mail className="w-4 h-4 text-sf-action" />
                  <span>4. حقوقك والتواصل بشأن الخصوصية</span>
                </h3>
                <p className="text-xs text-sf-text">
                  لك كامل الحق في طلب نسخة احتياطية من كافة بياناتك (JSON Export)، أو تعديل بياناتك، أو طلب حذف حسابك نهائياً من قاعدة البيانات السحابية عبر مراسلتنا على{' '}
                  <span className="font-mono text-sf-text font-semibold">elmuktafibellah@gmail.com</span>.
                </p>
              </section>
            </div>
          )}

          {/* TAB 2: TERMS OF SERVICE */}
          {activeTab === 'terms' && (
            <div className="space-y-6">
              <div className="border-b border-sf-border pb-4">
                <span className="text-xs font-mono text-sf-text font-semibold">شروط وأحكام الاستخدام</span>
                <h2 className="text-xl sm:text-2xl font-semibold text-sf-text mt-1">
                  اتفاقية شروط الخدمة (Terms of Service)
                </h2>
                <p className="text-xs text-sf-muted mt-1">
                  باستخدامك لسودافلو، فإنك توافق على الالتزام بالأحكام والشروط التالية.
                </p>
              </div>

              <section className="space-y-2">
                <h3 className="font-semibold text-sf-text text-base">1. طبيعة الخدمة ونطاقها</h3>
                <p className="text-xs sm:text-sm text-sf-text">
                  سودافلو هو نظام لإصدار الفواتير المزدوجة (جنيه سوداني / دولار أمريكي)، ومتابعة المخزون، وسندات التحصيل المالي. صُمم التطبيق ليلائم متطلبات أصحاب الأعمال والمحلات والشركات الناشئة في السوق السوداني.
                </p>
              </section>

              <section className="space-y-2 bg-sf-raised p-4 rounded-xl border border-sf-border">
                <h3 className="font-semibold text-sf-text text-base">2. تجميد سعر الصرف ومسؤولية الأسعار</h3>
                <p className="text-xs sm:text-sm text-sf-text">
                  يوفر التطبيق ميزة حصرية تتيح للتاجر تجميد سعر صرف الدولار اليومي في السوق الموازي عند لحظة تحرير الفاتورة لمنع أي تضارب مالي عند التحصيل اللاحق:
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs text-sf-muted pr-2">
                  <li>يتحمل التاجر وحده المسؤولية الكاملة عن دقة سعر الصرف المدخل ومبالغ البنود.</li>
                  <li>لا يقدم التطبيق أسعار صرف ملزمة قانونياً أو جهة مصرفية رسمية، وإنما يعتمد على الإدخال اليدوي المحدد من قبل التاجر نفسه.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold text-sf-text text-base">3. أمن الحساب والاحتفاظ بنسخ احتياطية</h3>
                <p className="text-xs sm:text-sm text-sf-text">
                  يلتزم المستخدم بالحفاظ على سرية كلمة المرور الخاصة بحسابه. على الرغم من أن النظام يعتمد البنية التحتية السحابية الموثوقة لـ Google Cloud، إلا أننا ننصح التجار بتصدير ملف النسخة الاحتياطية (JSON) دورياً من نافذة الإعدادات لضمان التوافر الدائم لبياناتهم دون اتصال.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold text-sf-text text-base">4. التعديلات على شروط الخدمة</h3>
                <p className="text-xs sm:text-sm text-sf-text">
                  يحق لنا تحديث شروط الخدمة لتعزيز الأمان أو لمطابقة المتطلبات القانونية أو التقنية، وسيتم إخطار المستخدمين بأي تغييرات جوهرية داخل التطبيق.
                </p>
              </section>
            </div>
          )}

          {/* TAB 3: ABOUT US */}
          {activeTab === 'about' && (
            <div className="space-y-6">
              <div className="border-b border-sf-border pb-4">
                <span className="text-xs font-mono text-sf-text font-semibold">هويتنا ورؤيتنا</span>
                <h2 className="text-xl sm:text-2xl font-semibold text-sf-text mt-1">
                  عن سودافلو | SudaFlow
                </h2>
                <p className="text-xs text-sf-muted mt-1">
                  حل تقني متكامل وُلد من قلب السوق والتحديات اليومية للتجارة في السودان.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-sf-raised p-4 rounded-xl border border-sf-border space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-sf-action/10 text-sf-action flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h3 className="font-semibold text-sf-text text-sm">رسالتنا الأساسية</h3>
                  <p className="text-xs text-sf-muted leading-relaxed">
                    تمكين التاجر السوداني من إصدار فواتير بيع احترافية وشفافة، وحماية أرباحه من تقلبات سعر الصرف المتكررة، مع أتمتة حسابات السداد الجزئي وسندات التحصيل عبر تطبيق بنكك وفوري.
                  </p>
                </div>

                <div className="bg-sf-raised p-4 rounded-xl border border-sf-border space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-sf-action/10 text-sf-action flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <h3 className="font-semibold text-sf-text text-sm">التوافق مع السوق المحلي</h3>
                  <p className="text-xs text-sf-muted leading-relaxed">
                    صُمم النظام ليعمل بكفاءة فائقة على الهواتف الذكية والأجهزة اللوحية وأجهزة الحاسوب، مع دعم العمل دون اتصال بالإنترنت وحفظ محلي فوري قبل المزامنة السحابية.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <h3 className="font-semibold text-sf-text text-base">أبرز ما يميز المنظومة:</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-sf-text">
                  <div className="p-3 bg-sf-surface rounded-xl border border-sf-border">
                    <span className="font-semibold text-sf-action block mb-1">تسعير مجمّد</span>
                    تثبيت سعر صرف الدولار للفاتورة لضمان عدم حدوث خلاف بين البائع والمشتري.
                  </div>
                  <div className="p-3 bg-sf-surface rounded-xl border border-sf-border">
                    <span className="font-semibold text-sf-action block mb-1">لوقو وهوية مخصصة</span>
                    إمكانية رفع لوقو متجرك ليظهر مباشرة في فواتير البيع وسندات القبض المطبوعة.
                  </div>
                  <div className="p-3 bg-sf-surface rounded-xl border border-sf-border">
                    <span className="font-semibold text-sf-action block mb-1">مشاركة واتساب</span>
                    إرسال الفواتير وسندات القبض وتذكيرات المطالبة بضغطة زر مباشرة عبر واتساب.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CONTACT US */}
          {activeTab === 'contact' && (
            <div className="space-y-6">
              <div className="border-b border-sf-border pb-4">
                <span className="text-xs font-mono text-sf-text font-semibold">فريق الدعم الفني</span>
                <h2 className="text-xl sm:text-2xl font-semibold text-sf-text mt-1">
                  اتصل بنا والدعم المباشر (Contact Us)
                </h2>
                <p className="text-xs text-sf-muted mt-1">
                  يسعدنا تلقي اقتراحاتكم واستفساراتكم، والرد على طلبات الدعم والشراكات الإعلانية.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Contact Info Cards (Left / 5 Cols) */}
                <div className="md:col-span-5 space-y-3">
                  <div className="bg-sf-raised p-4 rounded-xl border border-sf-border space-y-3">
                    <h3 className="font-semibold text-sf-text text-xs text-sf-action uppercase tracking-wider">
                      معلومات التواصل المباشرة
                    </h3>

                    <div className="space-y-3 text-xs">
                      <div className="flex items-start gap-3 text-sf-text">
                        <Mail className="w-4 h-4 text-sf-action shrink-0 mt-1" />
                        <div>
                          <span className="block text-sf-muted text-xs">البريد الإلكتروني المعتمد:</span>
                          <span className="font-mono text-sf-text font-semibold select-all">
                            elmuktafibellah@gmail.com
                          </span>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 text-sf-text">
                        <MessageSquare className="w-4 h-4 text-sf-action shrink-0 mt-1" />
                        <div>
                          <span className="block text-sf-muted text-xs">الدعم الفني واستفسارات التجار:</span>
                          <span className="text-sf-text font-semibold">متاح طوال أيام الأسبوع</span>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 text-sf-text">
                        <ShieldCheck className="w-4 h-4 text-sf-action shrink-0 mt-1" />
                        <div>
                          <span className="block text-sf-muted text-xs">الإعلانات والشراكات (AdSense):</span>
                          <span className="text-sf-text font-semibold">استفسارات الشراكات والمساحات المتاحة</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-sf-selected/40 p-4 rounded-xl border border-sf-action/40 text-xs text-sf-action">
                    <span className="font-semibold block mb-1">ملاحظة للتجار:</span>
                    يمكنكم إرسال مقترحاتكم بشأن إضافة ميزات خاصة بمتاجركم، أو المساعدة في ضبط إعدادات الحساب السحابي.
                  </div>
                </div>

                {/* Contact Form (Right / 7 Cols) */}
                <div className="md:col-span-7">
                  <div className="bg-sf-raised p-6 rounded-xl border border-sf-border">
                    <h3 className="font-semibold text-sf-text text-sm mb-4">إرسال رسالة مباشرة إلى الإدارة</h3>

                    {submitSuccess && (
                      <div className="mb-4 p-3 bg-sf-selected/80 border border-sf-action/50 rounded-xl text-xs text-sf-action flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-sf-action shrink-0" />
                        <span>تم استلام رسالتك بنجاح! سنقوم بالرد عليك في أقرب وقت عبر البريد الإلكتروني.</span>
                      </div>
                    )}

                    {submitError && (
                      <div className="mb-4 p-3 bg-sf-danger-bg/80 border border-sf-danger/50 rounded-xl text-xs text-sf-danger flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-sf-danger shrink-0" />
                        <span>{submitError}</span>
                      </div>
                    )}

                    <form onSubmit={handleContactSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-sf-text mb-1">الاسم الكامل *</label>
                        <input
                          type="text"
                          required
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                          placeholder="مثال: أحمد عبد الله"
                          className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sf-text mb-1">البريد الإلكتروني *</label>
                        <input
                          type="email"
                          required
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          placeholder="your-email@example.com"
                          className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action font-mono text-left"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sf-text mb-1">موضوع الرسالة</label>
                        <select
                          value={contactSubject}
                          onChange={(e) => setContactSubject(e.target.value)}
                          className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                        >
                          <option value="دعم فني واستفسارات">دعم فني واستفسارات عن التطبيق</option>
                          <option value="اقتراح ميزة جديدة">اقتراح ميزة أو تحسين جديد</option>
                          <option value="شراكات وإعلانات">شراكات وإعلانات AdSense</option>
                          <option value="أخرى">أخرى</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sf-text mb-1">تفاصيل الرسالة *</label>
                        <textarea
                          required
                          rows={4}
                          value={contactMessage}
                          onChange={(e) => setContactMessage(e.target.value)}
                          placeholder="اكتب استفسارك أو اقتراحك هنا وسيسعدنا الرد عليك..."
                          className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action leading-relaxed"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-sf-action/20 transition-all disabled:opacity-50 active:scale-98"
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
        <div className="flex items-center justify-between border-t border-sf-border bg-sf-surface px-6 py-3 text-xs text-sf-muted">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sf-action"></span>
            <span>سودافلو | SudaFlow — شغلك أوضح.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border text-xs font-semibold transition-colors"
          >
            إغلاق
          </button>
        </div>

      </div>
    </Dialog>
  );
};
