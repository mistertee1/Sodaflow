import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Customer, Currency, Invoice } from '../types';
import {
  Search,
  Plus,
  Phone,
  MapPin,
  FileText,
  CreditCard,
  Edit2,
  Trash2,
  X,
  Share2,
  Calendar,
  CheckCircle2,
  UserCheck,
  Users,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { formatMoney, getInvoiceStatusInfo } from '../lib/currency';
import { getPlanConfig, isUnlimited } from '../lib/plans';

interface CustomersViewProps {
  onOpenNewInvoiceForCustomer: (customer: Customer) => void;
  onViewInvoice: (invoice: Invoice) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  onOpenNewInvoiceForCustomer,
  onViewInvoice,
}) => {
  const {
    customers,
    invoices,
    payments,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    settings,
    counters,
    subscription,
    isActionAllowed,
  } = useApp();

  const planConfig = getPlanConfig(subscription?.plan);
  const maxCustomers = subscription?.max_customers ?? planConfig.max_customers;
  const currentCustomerCount = counters?.customer_count ?? 0;
  const isCustomerLimitReached = !isUnlimited(maxCustomers) && currentCustomerCount >= maxCustomers;

  const submitLock = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [preferredCurrency, setPreferredCurrency] = useState<Currency>('SDG');
  const [notes, setNotes] = useState('');

  const safeCustomers = Array.isArray(customers) ? customers : [];
  const filteredCustomers = safeCustomers.filter(
    (c) =>
      c &&
      ((c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.phone || '').includes(searchTerm) ||
      (c.address && c.address.toLowerCase().includes(searchTerm.toLowerCase())))
  );

  const handleOpenAdd = () => {
    setEditingCustomer(null);
    setModalError(null);
    setName('');
    setPhone('');
    setEmail('');
    setAddress('');
    setPreferredCurrency('SDG');
    setNotes('');
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditingCustomer(c);
    setModalError(null);
    setName(c.name);
    setPhone(c.phone);
    setEmail(c.email || '');
    setAddress(c.address || '');
    setPreferredCurrency(c.preferred_currency);
    setNotes(c.notes || '');
    setIsAddModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    if (!name.trim()) return;

    if (!editingCustomer && isCustomerLimitReached) {
      setModalError(
        `عذراً، لقد استنفدت الحد الأقصى المسموح به للعملاء في باقتك الحالية (${currentCustomerCount}/${maxCustomers} عميل). يرجى ترقية باقة اشتراكك لإضافة المزيد من العملاء.`
      );
      return;
    }

    submitLock.current = true; setIsSaving(true);
    try {
      setModalError(null);
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || '',
          address: address.trim() || '',
          preferred_currency: preferredCurrency,
          notes: notes.trim() || '',
        });
      } else {
        await addCustomer({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || '',
          address: address.trim() || '',
          preferred_currency: preferredCurrency,
          balance_sdg: 0,
          balance_usd: 0,
          notes: notes.trim() || '',
        });
      }

      setIsAddModalOpen(false);
    } catch (err: any) {
      setModalError(err.message || 'حدث خطأ أثناء حفظ بيانات العميل');
    } finally { submitLock.current = false; setIsSaving(false); }
  };

  const handleDelete = async (id: string, customerName: string) => {
    if (window.confirm(`هل أنت متأكد من حذف العميل "${customerName}"؟`)) {
      try { await deleteCustomer(id); } catch (error) { setModalError(error instanceof Error ? error.message : "تعذر الحذف."); }
    }
  };

  // Customer Statement Details
  const customerInvoices = statementCustomer
    ? (invoices || []).filter((inv) => inv && inv.customer_id === statementCustomer.id)
    : [];

  const customerPayments = statementCustomer
    ? (payments || []).filter((p) => p && p.customer_id === statementCustomer.id)
    : [];

  const handleShareStatement = (cust: Customer) => {
    const text = `*كشف حساب العميل: ${cust.name}*
من: ${settings.business_name}
التاريخ: ${new Date().toISOString().split('T')[0]}

الرصيد المستحق الحالي:
• بالجنيه السوداني: *${formatMoney(cust.balance_sdg, 'SDG', settings)}*
• بالدولار الأمريكي: *${formatMoney(cust.balance_usd, 'USD', settings)}*

شكراً لتعاملكم الدائم معنا.
${settings.phone}`;

    const encoded = encodeURIComponent(text);
    const p = cust.phone ? cust.phone.replace(/[^0-9]/g, '') : '';
    const url = p
      ? `https://api.whatsapp.com/send?phone=${p.startsWith('249') ? p : '249' + (p.startsWith('0') ? p.slice(1) : p)}&text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;

    window.open(url, '_blank');
  };

  return (
    <div className="space-y-5 pb-16">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-sf-surface p-4 rounded-2xl border border-sf-border shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-sf-text">سجل العملاء والأرصدة</h2>
          <p className="text-xs text-sf-muted">
            متابعة ديون ومعاملات كل عميل بالجنيه السوداني والدولار مع كشف حساب فوري
          </p>
        </div>
        <button
          disabled={!isActionAllowed('customers:create')} onClick={handleOpenAdd}
          className="bg-sf-action hover:bg-sf-action-hover text-sf-on-action text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-sf-action/20 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4 text-sf-on-action" />
          <span>إضافة عميل جديد</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-sf-muted absolute right-3 top-3" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="بحث باسم العميل أو رقم الهاتف أو المنطقة..."
          className="w-full bg-sf-surface border border-sf-border rounded-xl pr-9 pl-4 py-2.5 text-xs sm:text-sm text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action shadow-sm"
        />
      </div>

      {/* Customers List */}
      {safeCustomers.length === 0 ? (
        <div className="bg-sf-surface border border-sf-border rounded-2xl p-12 text-center text-sf-muted shadow-sm">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40 text-sf-muted" />
          <p className="text-base font-bold text-sf-text mb-1">لا توجد بيانات عملاء حتى الآن</p>
          <p className="text-xs text-sf-muted max-w-md mx-auto mb-5">
            أضف عملاءك لتتبع حساباتهم، ديونهم المستحقة بالجنيه والدولار، ومشاركة كشوف الحسابات.
          </p>
          <button
            disabled={!isActionAllowed('customers:create')} onClick={handleOpenAdd}
            className="px-5 py-2.5 bg-sf-action hover:bg-sf-action-hover text-sf-on-action text-xs sm:text-sm font-black rounded-xl shadow-lg shadow-sf-action/20 inline-flex items-center gap-2 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 text-sf-on-action" />
            <span>+ إضافة عميل جديد</span>
          </button>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="bg-sf-surface border border-sf-border rounded-2xl p-10 text-center text-sf-muted shadow-sm">
          <p className="text-sm font-medium text-sf-text">لم يتم العثور على أي عملاء يطابقون البحث</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {(filteredCustomers || []).map((cust) => {
            const hasDebt = cust.balance_sdg > 0 || cust.balance_usd > 0;
            return (
              <div
                key={cust.id}
                className="bg-sf-surface border border-sf-border hover:border-sf-border rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col justify-between transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h3 className="font-bold text-base text-sf-text">{cust.name}</h3>
                      <div className="flex items-center gap-2 text-xs text-sf-muted mt-0.5">
                        {cust.phone && (
                          <span className="flex items-center gap-1 font-mono">
                            <Phone className="w-3 h-3 text-sf-action" />
                            {cust.phone}
                          </span>
                        )}
                        {cust.address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-sf-muted" />
                            {cust.address}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        disabled={!isActionAllowed('customers:update')} onClick={() => handleOpenEdit(cust)}
                        title="تعديل بيانات العميل"
                        className="p-1.5 text-sf-muted hover:text-sf-text hover:bg-sf-raised rounded-lg transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={!isActionAllowed('customers:delete')} onClick={() => handleDelete(cust.id, cust.name)}
                        title="حذف العميل"
                        className="p-1.5 text-sf-muted hover:text-sf-danger hover:bg-sf-danger-bg/30 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Balance Display (Dual Currency) */}
                  <div className="bg-sf-raised rounded-xl p-3 border border-sf-border my-3 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-sf-muted block mb-0.5">الرصيد المستحق (الديون):</span>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`font-mono font-bold text-sm ${
                            hasDebt ? 'text-sf-danger font-black' : 'text-sf-text'
                          }`}
                        >
                          {formatMoney(cust.balance_sdg, 'SDG', settings)}
                        </span>
                        <span className="font-mono text-xs text-sf-action font-semibold">
                          ({formatMoney(cust.balance_usd, 'USD', settings)})
                        </span>
                      </div>
                    </div>
                    {hasDebt ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sf-danger-bg/80 text-sf-danger border border-sf-danger/60 font-bold">
                        مطلوب سداد
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sf-selected/80 text-sf-action border border-sf-action/60 font-medium">
                        خالص
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-sf-border">
                  <button
                    onClick={() => setStatementCustomer(cust)}
                    className="flex-1 py-2 px-2 text-xs font-semibold text-sf-text bg-sf-raised hover:bg-sf-raised border border-sf-border rounded-xl text-center transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 text-sf-action" />
                    <span>كشف الحساب</span>
                  </button>

                  <button
                    onClick={() => onOpenNewInvoiceForCustomer(cust)}
                    className="flex-1 py-2 px-2 text-xs font-bold text-sf-on-action bg-sf-action hover:bg-sf-action-hover rounded-xl text-center transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-sf-action/20"
                  >
                    <Plus className="w-3.5 h-3.5 text-sf-on-action" />
                    <span>فاتورة جديدة</span>
                  </button>

                  <button
                    onClick={() => handleShareStatement(cust)}
                    title="مشاركة كشف الحساب عبر واتساب"
                    className="p-2 text-sf-action bg-sf-selected/60 hover:bg-sf-selected/60 rounded-xl border border-sf-action/60 transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-sf-surface rounded-2xl shadow-2xl border border-sf-border max-w-md w-full p-5 sm:p-6 animate-in fade-in zoom-in-95 text-xs sm:text-sm text-sf-text">
            <div className="flex items-center justify-between border-b border-sf-border pb-3 mb-4">
              <h3 className="font-bold text-base text-sf-text">
                {editingCustomer ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-sf-muted hover:text-sf-text"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!editingCustomer && isCustomerLimitReached && (
              <div className="mb-4 p-3 bg-sf-warning-bg/50 border border-sf-warning/60 rounded-xl text-sf-warning text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-sf-warning shrink-0" />
                <span>
                  عذراً، لقد استنفدت الحد المسموح به للعملاء في باقتك الحالية ({currentCustomerCount}/{maxCustomers} عميل). يرجى ترقية باقة اشتراكك من الإعدادات لإضافة عملاء جدد.
                </span>
              </div>
            )}

            {modalError && (
              <div className="mb-4 p-3 bg-sf-danger-bg/80 border border-sf-danger/60 rounded-xl text-sf-danger text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-sf-danger shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  اسم العميل أو المحل *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: محلات البركة (أحمد إبراهيم)"
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
                />
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">رقم الهاتف *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="مثال: 0912345678"
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  العنوان / المنطقة
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="الخرطوم، أم درمان، بورتسودان..."
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
                />
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  العملة المفضلة للتعامل
                </label>
                <select
                  value={preferredCurrency}
                  onChange={(e) => setPreferredCurrency(e.target.value as Currency)}
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                >
                  <option value="SDG" className="bg-sf-raised">جنيه سوداني (ج.س)</option>
                  <option value="USD" className="bg-sf-raised">دولار أمريكي ($)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">ملاحظات إضافية</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات حول طريقة الدفع أو التعامل..."
                  className="w-full bg-sf-raised border border-sf-border rounded-xl p-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-sf-border">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-sf-border bg-sf-raised rounded-xl text-xs font-semibold text-sf-text hover:bg-sf-raised"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !editingCustomer && isCustomerLimitReached}
                  className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                    !editingCustomer && isCustomerLimitReached
                      ? 'bg-sf-raised text-sf-muted cursor-not-allowed border border-sf-border'
                      : 'bg-sf-action hover:bg-sf-action-hover text-sf-on-action shadow-lg shadow-sf-action/20 active:scale-95'
                  }`}
                >
                  {!editingCustomer && isCustomerLimitReached ? (
                    <>
                      <Lock className="w-4 h-4 text-sf-muted" />
                      <span>تم استنفاد باقة العملاء</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-sf-on-action" />
                      <span>{editingCustomer ? 'حفظ التعديلات' : 'إضافة العميل'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statement of Account Modal */}
      {statementCustomer && (
        <div className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-sf-surface rounded-2xl shadow-2xl border border-sf-border max-w-2xl w-full my-auto max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 text-xs sm:text-sm text-sf-text">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-sf-border bg-sf-raised rounded-t-2xl flex items-center justify-between">
              <div>
                <span className="text-[11px] text-sf-muted block">كشف حساب العميل</span>
                <h3 className="font-bold text-base text-sf-text">{statementCustomer.name}</h3>
                <p className="text-xs text-sf-action font-mono">{statementCustomer.phone}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleShareStatement(statementCustomer)}
                  className="px-3.5 py-1.5 text-xs font-bold bg-sf-action hover:bg-sf-action-hover text-sf-on-action rounded-xl flex items-center gap-1.5 shadow-lg shadow-sf-action/20"
                >
                  <Share2 className="w-3.5 h-3.5 text-sf-on-action" />
                  <span>واتساب</span>
                </button>
                <button
                  onClick={() => setStatementCustomer(null)}
                  className="p-1.5 text-sf-muted hover:text-sf-text rounded-lg hover:bg-sf-raised"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
              {/* Balances Highlight */}
              <div className="bg-sf-raised border border-sf-warning/40 p-4 rounded-xl flex items-center justify-between shadow-xs">
                <div>
                  <span className="text-xs font-semibold text-sf-warning block mb-1">
                    صافي الرصيد المستحق على العميل:
                  </span>
                  <div className="font-mono font-black text-xl text-sf-warning">
                    {formatMoney(statementCustomer.balance_sdg, 'SDG', settings)}
                  </div>
                </div>
                <div className="text-left font-mono">
                  <span className="text-xs text-sf-muted block">ما يعادل بالدولار:</span>
                  <span className="font-bold text-base text-sf-action">
                    {formatMoney(statementCustomer.balance_usd, 'USD', settings)}
                  </span>
                </div>
              </div>

              {/* Invoices List for this customer */}
              <div>
                <h4 className="font-bold text-xs text-sf-text mb-2">
                  سجل الفواتير الصادرة للعميل ({customerInvoices.length})
                </h4>
                {customerInvoices.length === 0 ? (
                  <p className="text-xs text-sf-muted py-3 text-center bg-sf-raised rounded-xl border border-sf-border">
                    لا توجد فواتير سابقة لهذا العميل.
                  </p>
                ) : (
                  <div className="border border-sf-border rounded-xl overflow-hidden divide-y divide-sf-border text-xs">
                    {(customerInvoices || []).map((inv) => {
                      const st = getInvoiceStatusInfo(inv.status);
                      return (
                        <div
                          key={inv.id}
                          className="p-3 hover:bg-sf-raised flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sf-text">{inv.invoice_number}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded border ${st.bg} ${st.color}`}>
                                {st.label}
                              </span>
                            </div>
                            <span className="text-[10px] text-sf-muted block mt-0.5">
                              {inv.issue_date} • سعر الصرف: 1$ = {formatMoney(inv.exchange_rate_used, 'SDG', settings)}
                            </span>
                          </div>
                          <div className="text-left">
                            <div className="font-mono font-bold text-sf-text">
                              {formatMoney(inv.grand_total_sdg, 'SDG', settings)}
                            </div>
                            {inv.remaining_sdg > 0 && inv.status !== 'paid' && (
                              <div className="text-[10px] text-sf-danger font-mono">
                                باقي: {formatMoney(inv.remaining_sdg, 'SDG', settings)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Payments List for this customer */}
              {customerPayments.length > 0 && (
                <div>
                  <h4 className="font-bold text-xs text-sf-text mb-2">
                    سجل الدفعات المستلمة من العميل ({customerPayments.length})
                  </h4>
                  <div className="border border-sf-border rounded-xl overflow-hidden divide-y divide-sf-border text-xs">
                    {(customerPayments || []).map((p) => (
                      <div key={p.id} className="p-2.5 flex items-center justify-between">
                        <div>
                          <span className="font-mono text-sf-muted">{p.payment_date.split('T')[0]}</span>
                          <span className="text-sf-text mr-2">• فاتورة #{p.invoice_number}</span>
                        </div>
                        <span className="font-mono font-bold text-sf-action">
                          {formatMoney(p.amount, p.currency, settings)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
