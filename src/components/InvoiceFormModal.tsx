import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Invoice,
  InvoiceItem,
  Currency,
  CurrencyMode,
  Customer,
} from '../types';
import {
  X,
  Plus,
  Trash2,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  UserPlus,
  Lock,
} from 'lucide-react';
import {
  formatMoney,
  convertCurrency,
  calculateInvoiceFinancials,
  calculateLineItem,
  validateExchangeRate,
} from '../lib/currency';
import { getPlanConfig, isUnlimited } from '../lib/plans';

interface InvoiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceCreated?: (invoice: Invoice) => void;
  initialCustomer?: Customer;
  prefilledCustomer?: Customer | null;
}

export const InvoiceFormModal: React.FC<InvoiceFormModalProps> = ({
  isOpen,
  onClose,
  onInvoiceCreated,
  initialCustomer,
  prefilledCustomer,
}) => {
  const {
    customers,
    products,
    settings,
    getNextInvoiceNumber,
    createInvoice,
    addCustomer,
    subscription,
    counters,
  } = useApp();

  const planConfig = getPlanConfig(subscription?.plan);
  const maxInvoices = subscription?.max_invoices_per_month ?? planConfig.max_invoices_per_month;
  const currentInvoiceCount = counters?.invoice_count ?? 0;
  const isInvoiceLimitReached = !isUnlimited(maxInvoices) && currentInvoiceCount >= maxInvoices;

  // Invoice Fields
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('dual');
  const [exchangeRate, setExchangeRate] = useState<number>(settings.default_exchange_rate > 0 ? settings.default_exchange_rate : 0);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [notes, setNotes] = useState(settings.default_invoice_notes || '');
  const [paymentInstructions, setPaymentInstructions] = useState(settings.bank_details || '');

  // Items List
  const [items, setItems] = useState<InvoiceItem[]>([]);

  // Quick Add Customer Inline Modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustCurrency, setNewCustCurrency] = useState<Currency>('SDG');

  // Error State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Submission & Idempotency Lock
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [operationId, setOperationId] = useState<string>(() => `op-inv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);
  const submissionLockRef = useRef(false);

  // Initialize or Reset form on open
  useEffect(() => {
    if (isOpen) {
      setOperationId(`op-inv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);
      setIsSubmitting(false);
      submissionLockRef.current = false;
      setInvoiceNumber(getNextInvoiceNumber());
      setIssueDate(new Date().toISOString().split('T')[0]);
      setDueDate(new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);
      setExchangeRate(settings.default_exchange_rate > 0 ? settings.default_exchange_rate : 0);
      setCurrencyMode('dual');
      setDiscountType('fixed');
      setDiscountValue(0);
      setNotes(settings.default_invoice_notes || '');
      setPaymentInstructions(settings.bank_details || '');
      setErrorMessage(null);

      const targetCustomer = prefilledCustomer || initialCustomer;
      if (targetCustomer) {
        setSelectedCustomerId(targetCustomer.id);
      } else if (customers.length > 0) {
        setSelectedCustomerId(customers[0].id);
      } else {
        setSelectedCustomerId('');
      }

      // Add one default item
      setItems([
        {
          id: 'item-1',
          description: '',
          unit: 'قطعة',
          quantity: 1,
          unit_price: 0,
          currency: 'SDG',
          tax_rate: 0,
          discount_percent: 0,
          line_total: 0,
        },
      ]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Selected customer object
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  // Handle Item Changes
  const updateItem = (index: number, field: keyof InvoiceItem, val: any) => {
    const updated = [...items];
    const item = { ...updated[index], [field]: val };

    const decimals = item.currency === 'USD' ? (settings?.usd_decimals ?? 2) : (settings?.sdg_decimals ?? 0);
    const rule = settings?.rounding_rule ?? 'round';
    const line = calculateLineItem(item.quantity, item.unit_price, item.discount_percent, item.tax_rate, decimals, rule);
    item.line_total = line.total;
    updated[index] = item;
    setItems(updated);
  };

  // Add Item from Catalog
  const handleSelectProduct = (index: number, productId: string) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    const updated = [...items];
    const item = updated[index];
    item.product_id = prod.id;
    item.description = prod.name;
    item.unit = prod.unit;
    item.unit_price = item.currency === 'USD' ? prod.price_usd : prod.price_sdg;
    item.tax_rate = prod.tax_rate;

    const decimals = item.currency === 'USD' ? (settings?.usd_decimals ?? 2) : (settings?.sdg_decimals ?? 0);
    const rule = settings?.rounding_rule ?? 'round';
    const line = calculateLineItem(item.quantity || 1, item.unit_price, item.discount_percent, item.tax_rate, decimals, rule);
    item.line_total = line.total;

    updated[index] = item;
    setItems(updated);
  };

  // Add Free Item
  const handleAddNewItem = () => {
    setItems([
      ...items,
      {
        id: 'item-' + Date.now(),
        description: '',
        unit: 'قطعة',
        quantity: 1,
        unit_price: 0,
        currency: 'SDG',
        tax_rate: 0,
        discount_percent: 0,
        line_total: 0,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      alert('يجب أن تحتوي الفاتورة على بند واحد على الأقل');
      return;
    }
    setItems(items.filter((_, i) => i !== index));
  };

  // Authoritative Totals Calculations via Financial Engine
  const financials = calculateInvoiceFinancials(
    items,
    exchangeRate,
    discountType,
    discountValue,
    0,
    0,
    settings
  );

  const subtotalSdg = financials.subtotal_sdg;
  const subtotalUsd = financials.subtotal_usd;
  const taxTotalSdg = financials.tax_total_sdg;
  const taxTotalUsd = financials.tax_total_usd;
  const discountTotalSdg = financials.discount_total_sdg;
  const discountTotalUsd = financials.discount_total_usd;
  const grandTotalSdg = financials.grand_total_sdg;
  const grandTotalUsd = financials.grand_total_usd;

  // Quick Customer Creation
  const handleQuickCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    const created = await addCustomer({
      name: newCustName.trim(),
      phone: newCustPhone.trim(),
      address: newCustAddress.trim(),
      preferred_currency: newCustCurrency,
      balance_sdg: 0,
      balance_usd: 0,
    });

    setSelectedCustomerId(created.id);
    setShowAddCustomerModal(false);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustAddress('');
  };

  // Submit Invoice
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Prevent duplicate submission / double-clicks
    if (isSubmitting || submissionLockRef.current) {
      return;
    }

    // Subscription limit enforcement (client-side UX guardrail)
    if (isInvoiceLimitReached) {
      setErrorMessage(
        `عذراً، لقد استنفدت الحد المسموح به من الفواتير في باقتك الحالية (${currentInvoiceCount}/${maxInvoices} فاتورة). يرجى ترقية باقة اشتراكك لمتابعة إصدار الفواتير.`
      );
      return;
    }

    if (!selectedCustomerId) {
      setErrorMessage('يرجى اختيار عميل أو إضافة عميل جديد للفاتورة.');
      return;
    }

    if (items.some((i) => !i.description.trim() || Number(i.quantity) <= 0)) {
      setErrorMessage('يرجى التأكد من ملء وصف وكمية كل بند من بنود الفاتورة.');
      return;
    }

    const rateValidation = validateExchangeRate(exchangeRate);
    if (!rateValidation.isValid) {
      setErrorMessage(rateValidation.error || 'سعر الصرف غير صالح. يرجى إدخال سعر صرف أكبر من الصفر.');
      return;
    }

    // Lock submission immediately before starting async operation
    submissionLockRef.current = true;
    setIsSubmitting(true);

    try {
      const created = await createInvoice({
        operation_id: operationId,
        invoice_number: invoiceNumber || getNextInvoiceNumber(),
        customer_id: selectedCustomerId,
        customer_name: selectedCustomer ? selectedCustomer.name : 'عميل عام',
        customer_phone: selectedCustomer?.phone,
        customer_address: selectedCustomer?.address,
        issue_date: issueDate,
        due_date: dueDate,
        status: 'sent',
        currency_mode: currencyMode,
        exchange_rate_used: Number(exchangeRate), // Frozen exchange rate
        items,
        subtotal_sdg: subtotalSdg,
        subtotal_usd: subtotalUsd,
        discount_type: discountType,
        discount_value: discountValue,
        discount_total_sdg: discountTotalSdg,
        discount_total_usd: discountTotalUsd,
        tax_total_sdg: taxTotalSdg,
        tax_total_usd: taxTotalUsd,
        grand_total_sdg: grandTotalSdg,
        grand_total_usd: grandTotalUsd,
        paid_amount_sdg: 0,
        paid_amount_usd: 0,
        remaining_sdg: grandTotalSdg,
        remaining_usd: grandTotalUsd,
        notes,
        payment_instructions: paymentInstructions,
      });

      // 1. Verify successful creation and confirmed invoice ID
      if (created && created.id) {
        // Safe callback execution if provided
        if (typeof onInvoiceCreated === 'function') {
          try {
            onInvoiceCreated(created);
          } catch (callbackErr) {
            console.error('Error in onInvoiceCreated callback:', callbackErr);
          }
        }

        // Clean local error and submission lock
        setErrorMessage(null);
        submissionLockRef.current = false;
        setIsSubmitting(false);

        // Auto-close modal after confirmed persistence
        onClose();
      } else {
        throw new Error('فشل تأكيد حفظ الفاتورة في النظام.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء حفظ الفاتورة.');
      // Unlock on error to allow user retry
      submissionLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#050505]/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#0c0c0f] rounded-2xl shadow-2xl border border-[#1e1e24] max-w-4xl w-full my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 text-slate-100">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#1e1e24] flex items-center justify-between bg-[#121216] rounded-t-2xl">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <span>إنشاء فاتورة جديدة</span>
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {invoiceNumber}
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              دعم العرض المزدوج (جنيه سوداني + دولار) وتجميد سعر الصرف
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a1a24] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 text-xs sm:text-sm">
          {isInvoiceLimitReached && (
            <div className="p-3 bg-amber-950/50 border border-amber-600/60 rounded-xl text-amber-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                عذراً، لقد استنفدت الحد المسموح به من الفواتير في باقتك الحالية ({currentInvoiceCount}/{maxInvoices} فاتورة). يرجى ترقية باقة اشتراكك من الإعدادات لإصدار فواتير جديدة.
              </span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Section 1: Customer & Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-[#121216] p-4 rounded-xl border border-[#1e1e24]">
            {/* Customer Select */}
            <div className="sm:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-slate-300 text-xs">العميل *</label>
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(true)}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-0.5 transition-colors"
                >
                  <UserPlus className="w-3 h-3" />
                  + عميل جديد
                </button>
              </div>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                required
                className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="" className="bg-[#121216]">-- اختر عميل من القائمة --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#121216]">
                    {c.name} ({c.phone || 'بدون هاتف'})
                  </option>
                ))}
              </select>
              {selectedCustomer && (
                <div className="text-[11px] text-slate-400 mt-1">
                  الرصيد السابق: {formatMoney(selectedCustomer.balance_sdg, 'SDG', settings)} (
                  {formatMoney(selectedCustomer.balance_usd, 'USD', settings)})
                </div>
              )}
            </div>

            {/* Issue Date */}
            <div>
              <label className="block font-semibold text-slate-300 text-xs mb-1">تاريخ الإصدار</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                required
                className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Due Date */}
            <div>
              <label className="block font-semibold text-slate-300 text-xs mb-1">تاريخ الاستحقاق</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Section 2: Currency Settings & Frozen Rate */}
          <div className="bg-[#121216] border border-[#1e1e24] rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Lock className="w-3.5 h-3.5" />
                </div>
                <span className="font-bold text-xs sm:text-sm text-white">
                  إعدادات العملتين وتجميد سعر الصرف للفاتورة
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                سعر الصرف يُحفظ ثابتًا مع هذه الفاتورة
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              {/* Currency Display Mode */}
              <div>
                <label className="block font-semibold text-slate-300 text-xs mb-1">
                  طريقة عرض مبالغ الفاتورة
                </label>
                <div className="grid grid-cols-3 gap-1 bg-[#15151c] border border-[#22222d] p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setCurrencyMode('dual')}
                    className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-all ${
                      currencyMode === 'dual'
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    عرض مزدوج
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrencyMode('single_sdg')}
                    className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-all ${
                      currencyMode === 'single_sdg'
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    جنيه فقط
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrencyMode('single_usd')}
                    className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-all ${
                      currencyMode === 'single_usd'
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    دولار فقط
                  </button>
                </div>
              </div>

              {/* Frozen Exchange Rate Input */}
              <div>
                <label className="block font-semibold text-slate-300 text-xs mb-1">
                  سعر الصرف المجمّد (1 دولار أمريكي = كم جنيه سوداني؟)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    required
                    className="w-full bg-[#15151c] border border-emerald-500/40 rounded-lg px-3 py-2 text-xs font-bold font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="absolute left-3 top-2 text-xs text-slate-400 font-sans">
                    ج.س / $
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Invoice Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs sm:text-sm text-white">بنود الفاتورة</h3>
              <button
                type="button"
                onClick={handleAddNewItem}
                className="text-xs font-semibold text-slate-200 hover:bg-[#1a1a24] bg-[#121216] px-2.5 py-1 rounded-lg border border-[#22222d] shadow-2xs flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                + إضافة بند جديد
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="bg-[#121216] border border-[#1e1e24] rounded-xl p-3 sm:p-4 shadow-2xs space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    {/* Item Description or Product Picker */}
                    <div className="sm:col-span-4">
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-slate-300 text-[11px]">
                          البند #{index + 1}
                        </label>
                        {products.length > 0 && (
                          <select
                            onChange={(e) => handleSelectProduct(index, e.target.value)}
                            value=""
                            className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 rounded px-1.5 py-0.5"
                          >
                            <option value="" className="bg-[#121216]">اختر من المنتجات...</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id} className="bg-[#121216]">
                                {p.name} (المتوفر: {p.stock_quantity ?? 0} {p.unit})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <input
                        type="text"
                        placeholder="اسم الصنف أو الخدمة..."
                        value={item.description}
                        onChange={(e) => updateItem(index, 'description', e.target.value)}
                        required
                        className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                      {item.product_id && (() => {
                        const prod = products.find((p) => p.id === item.product_id);
                        if (!prod) return null;
                        const currentStock = prod.stock_quantity ?? 0;
                        const isOver = (Number(item.quantity) || 0) > currentStock;
                        return (
                          <div className="flex items-center justify-between text-[10px] mt-1">
                            <span className={isOver ? 'text-rose-400 font-bold' : 'text-emerald-400 font-medium'}>
                              المتبقي بالمخزن: {currentStock} {prod.unit}
                            </span>
                            {isOver && (
                              <span className="text-rose-400 font-bold bg-rose-950/40 px-1 py-0.2 rounded border border-rose-800/60">
                                تنبيه: تتجاوز المخزون
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Quantity */}
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-300 text-[11px] mb-1">
                        الكمية والوحدة
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          placeholder="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                          required
                          className="w-16 bg-[#15151c] border border-[#22222d] rounded-lg px-2 py-1.5 text-xs text-white text-center font-mono focus:outline-none focus:border-emerald-500"
                        />
                        <input
                          type="text"
                          placeholder="قطعة/جوال"
                          value={item.unit}
                          onChange={(e) => updateItem(index, 'unit', e.target.value)}
                          className="w-20 bg-[#15151c] border border-[#22222d] rounded-lg px-2 py-1.5 text-[11px] text-slate-300 text-center focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Unit Price & Currency */}
                    <div className="sm:col-span-3">
                      <label className="block font-semibold text-slate-300 text-[11px] mb-1">
                        سعر الوحدة والعملة
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          placeholder="0"
                          value={item.unit_price}
                          onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                          required
                          className="flex-1 bg-[#15151c] border border-[#22222d] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                        />
                        <select
                          value={item.currency}
                          onChange={(e) => updateItem(index, 'currency', e.target.value as Currency)}
                          className="w-16 bg-[#15151c] border border-[#22222d] rounded-lg px-1 py-1.5 text-[11px] font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                        >
                          <option value="SDG" className="bg-[#121216]">ج.س</option>
                          <option value="USD" className="bg-[#121216]">$</option>
                        </select>
                      </div>
                    </div>

                    {/* Line Total & Remove */}
                    <div className="sm:col-span-3 flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0">
                      <div className="text-left">
                        <span className="text-[10px] text-slate-400 block">الإجمالي للبند:</span>
                        <span className="font-mono font-bold text-xs text-white">
                          {formatMoney(item.line_total, item.currency, settings)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-md transition-colors"
                        title="حذف البند"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Discount & Summary Box */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 bg-[#121216] p-4 rounded-xl border border-[#1e1e24]">
            {/* Notes & Bank details */}
            <div className="sm:col-span-7 space-y-3">
              <div>
                <label className="block font-semibold text-slate-300 text-xs mb-1">
                  ملاحظات وشروط الفاتورة
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات تظهر في أسفل الفاتورة..."
                  className="w-full bg-[#15151c] border border-[#22222d] rounded-lg p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-300 text-xs mb-1">
                  بيانات السداد المصرفي (حساب بنكك / البنك)
                </label>
                <input
                  type="text"
                  value={paymentInstructions}
                  onChange={(e) => setPaymentInstructions(e.target.value)}
                  placeholder="مثال: حساب بنك الخرطوم (بنكك): 1234567 باسم محمد علي"
                  className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>

            {/* Calculations Box (Dual Display) */}
            <div className="sm:col-span-5 bg-[#15151c] border border-[#22222d] rounded-xl p-3.5 space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>المجموع الفرعي:</span>
                <span className="font-mono font-bold text-white">
                  {formatMoney(subtotalSdg, 'SDG', settings)}
                </span>
              </div>

              {/* Discount Input */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-300">الخصم:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    className="w-20 bg-[#121216] border border-[#262634] rounded px-1.5 py-0.5 text-xs font-mono text-center text-white focus:outline-none focus:border-emerald-500"
                  />
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as any)}
                    className="bg-[#121216] border border-[#262634] rounded px-1 py-0.5 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="fixed" className="bg-[#121216]">ج.س</option>
                    <option value="percent" className="bg-[#121216]">%</option>
                  </select>
                </div>
              </div>

              {discountTotalSdg > 0 && (
                <div className="flex items-center justify-between text-xs text-rose-400">
                  <span>قيمة الخصم:</span>
                  <span className="font-mono font-semibold">
                    - {formatMoney(discountTotalSdg, 'SDG', settings)}
                  </span>
                </div>
              )}

              {taxTotalSdg > 0 && (
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>إجمالي الضريبة:</span>
                  <span className="font-mono font-semibold text-white">
                    + {formatMoney(taxTotalSdg, 'SDG', settings)}
                  </span>
                </div>
              )}

              <div className="pt-2 border-t border-[#22222d]">
                <div className="text-[11px] font-semibold text-slate-300 mb-1">
                  الإجمالي النهائي (عرض مزدوج):
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono font-black text-base text-white">
                    {formatMoney(grandTotalSdg, 'SDG', settings)}
                  </span>
                  <span className="font-mono font-bold text-sm text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    {formatMoney(grandTotalUsd, 'USD', settings)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Buttons Footer */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#1e1e24]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-[#1a1a24] rounded-lg border border-[#262634] bg-[#121216] transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isInvoiceLimitReached}
              className={`px-6 py-2 text-xs font-bold rounded-lg shadow-lg transition-all flex items-center gap-1.5 ${
                isInvoiceLimitReached
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : isSubmitting
                  ? 'bg-emerald-500/50 text-slate-900 cursor-not-allowed opacity-75'
                  : 'text-slate-950 bg-emerald-500 hover:bg-emerald-400 active:scale-95 shadow-emerald-500/20'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>جاري إصدار الفاتورة...</span>
                </>
              ) : isInvoiceLimitReached ? (
                <>
                  <Lock className="w-4 h-4 text-slate-500" />
                  <span>تم استنفاد باقة الفواتير</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-slate-950" />
                  <span>إصدار الفاتورة وحفظها</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Quick Add Customer Sub-Modal */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 z-60 bg-[#050505]/80 flex items-center justify-center p-4">
          <div className="bg-[#0c0c0f] rounded-xl shadow-xl border border-[#1e1e24] max-w-sm w-full p-4 space-y-3 text-slate-100">
            <div className="flex items-center justify-between border-b border-[#1e1e24] pb-2">
              <h4 className="font-bold text-sm text-white">إضافة عميل سريع</h4>
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleQuickCreateCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">اسم العميل *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="مثال: محلات النصر (علي أحمد)"
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-2.5 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  placeholder="0912345678"
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-2.5 py-1.5 text-white placeholder-slate-500 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">العنوان / المنطقة</label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  placeholder="الخرطوم / بحري / أم درمان..."
                  className="w-full bg-[#121216] border border-[#22222c] rounded-lg px-2.5 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#1e1e24]">
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  className="px-3 py-1.5 border border-[#262634] text-slate-300 hover:bg-[#1a1a24] rounded-lg bg-[#14141c]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg shadow-lg shadow-emerald-500/20"
                >
                  حفظ العميل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
