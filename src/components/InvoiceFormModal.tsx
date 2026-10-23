import { productPriceQuote, productPricingMode, quoteCatalogItem } from '../domain/productPricing';
import { CURRENCIES, currencyDecimals, currencyLabel, isForeignCurrency, phoneRegion, transactionCurrency } from '../lib/currencyCatalog';
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
import { Dialog } from './Dialog';
import { ApprovalDecisionField, approvalRequirement } from './accounting/ApprovalDecisionField';

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
    branches,
    costCenters,
    projects,
    approvalPolicies,
    isActionAllowed,
    userRole,
  } = useApp();

  const planConfig = getPlanConfig(subscription?.plan);
  const lifetimeQuota = subscription.invoice_period === 'lifetime';
  const maxInvoices = lifetimeQuota ? subscription.max_invoices_total ?? 100 : subscription?.max_invoices_per_month ?? planConfig.max_invoices_per_month;
  const currentInvoiceCount = lifetimeQuota ? counters.lifetime_invoice_count ?? counters.invoice_count : counters?.monthly_invoice_count ?? 0;
  const isInvoiceLimitReached = !isUnlimited(maxInvoices) && currentInvoiceCount >= maxInvoices;

  // Invoice Fields
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [pricingCurrency, setPricingCurrency] = useState<Currency>(transactionCurrency(settings));
  const [currencyRates, setCurrencyRates] = useState(settings.currency_rates || {});
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('dual');
  const [exchangeRate, setExchangeRate] = useState<number>(() => {
    return (settings.manual_exchange_rate && settings.manual_exchange_rate > 0)
      ? settings.manual_exchange_rate
      : (settings.default_exchange_rate > 0 ? settings.default_exchange_rate : 0);
  });
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [notes, setNotes] = useState(settings.default_invoice_notes || '');
  const [paymentInstructions, setPaymentInstructions] = useState(settings.bank_details || '');
  const [branchId, setBranchId] = useState(''), [costCenterId, setCostCenterId] = useState(''), [projectId, setProjectId] = useState('');

  // Items List
  const [items, setItems] = useState<InvoiceItem[]>([]);

  // Quick Add Customer Inline Modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');

  // Error State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [creditApprovalReason, setCreditApprovalReason] = useState('');
  const [discountApprovalReason,setDiscountApprovalReason] = useState('');

  // Submission & Idempotency Lock
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [operationId, setOperationId] = useState<string>(() => crypto.randomUUID());
  const submissionLockRef = useRef(false);

  const recalculateDraftItem = (input: InvoiceItem): InvoiceItem => {
    let item = { ...input };
    if (item.price_source === 'catalog_usd') {
      const product = products.find(row => row.id === item.product_id);
      try {
        if (!product) throw Error('منتج البند غير متاح.');
        item = quoteCatalogItem(item, product, exchangeRate, currencyRates, settings.rounding_rule);
      } catch { item.unit_price = 0; delete item.price_reference; }
    }
    item.line_total = calculateLineItem(item.quantity, item.unit_price, item.discount_percent, item.tax_rate, currencyDecimals(item.currency), settings.rounding_rule ?? 'round').total;
    return item;
  };

  // Only unsaved automatic lines follow draft FX/cost changes. Manual edits and
  // all posted invoices keep their explicit/frozen prices.
  useEffect(() => {
    if (!isOpen) return;
    setItems(previous => {
      const next = previous.map(item => item.price_source === 'catalog_usd' ? recalculateDraftItem(item) : item);
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
    });
  }, [isOpen, exchangeRate, currencyRates, products, settings.rounding_rule]);

  // Initialize or Reset form on open
  useEffect(() => {
    if (isOpen) {
      setOperationId(crypto.randomUUID());
      setIsSubmitting(false);
      submissionLockRef.current = false;
      setInvoiceNumber(getNextInvoiceNumber());
      setIssueDate(new Date().toISOString().split('T')[0]);
      setDueDate(new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);
      const activeRate = (settings.manual_exchange_rate && settings.manual_exchange_rate > 0)
        ? settings.manual_exchange_rate
        : (settings.default_exchange_rate > 0 ? settings.default_exchange_rate : 0);
      setExchangeRate(activeRate);
      const defaultCurrency = transactionCurrency(settings);
      setPricingCurrency(defaultCurrency); setCurrencyRates(settings.currency_rates || {});
      setCurrencyMode(isForeignCurrency(defaultCurrency) ? 'single_foreign' : defaultCurrency === 'USD' ? 'single_usd' : 'dual');
      setDiscountType('fixed');
      setDiscountValue(0);
      setNotes(settings.default_invoice_notes || '');
      setPaymentInstructions(settings.bank_details || '');
      setErrorMessage(null);
      setCreditApprovalReason('');

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
          currency: transactionCurrency(settings),
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
    const value = ['quantity', 'unit_price', 'tax_rate', 'discount_percent'].includes(field) ? Number(val) : val;
    const item = { ...items[index], [field]: value };
    if (field === 'unit_price') { item.price_source = 'manual'; delete item.price_reference; }
    if (field === 'currency' && item.price_source !== 'catalog_usd') { item.unit_price = 0; delete item.price_reference; }
    setItems(previous => previous.map((row, i) => i === index ? recalculateDraftItem(item) : row));
  };

  const restoreCatalogPrice = (index: number) => {
    setItems(previous => previous.map((row, i) => i === index ? recalculateDraftItem({ ...row, price_source: 'catalog_usd' }) : row));
  };

  // Selecting a product uses its recorded USD reference, never today's FX to
  // fabricate an old purchase cost. Explicit manual catalog prices remain usable.
  const handleSelectProduct = (index: number, productId: string) => {
    const product = products.find(row => row.id === productId);
    if (!product) return;
    const item: InvoiceItem = { ...items[index], product_id: product.id, description: product.name, unit: product.unit, tax_rate: product.tax_rate };
    delete item.price_reference;
    if (productPricingMode(product) !== 'manual') item.price_source = 'catalog_usd';
    else {
      item.price_source = 'manual';
      item.unit_price = isForeignCurrency(item.currency) ? (validateExchangeRate(currencyRates[item.currency]).isValid && validateExchangeRate(exchangeRate).isValid ? convertCurrency(product.price_usd, 'USD', item.currency, exchangeRate, { ...settings, currency_rates: currencyRates }) : 0) : item.currency === 'USD' ? product.price_usd : product.price_sdg;
    }
    setItems(previous => previous.map((row, i) => i === index ? recalculateDraftItem(item) : row));
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
        currency: pricingCurrency,
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
  const pricingSettings = { ...settings, currency_rates: currencyRates };
  let calculationError = '';
  let financials = calculateInvoiceFinancials([], 0);
  try { financials = calculateInvoiceFinancials(items, exchangeRate, discountType, discountValue, 0, 0, pricingSettings); }
  catch (error) { calculationError = error instanceof Error ? error.message : 'أسعار العملات غير مكتملة.'; }
  const costExplanation = (item: InvoiceItem) => {
    if (item.price_source !== 'catalog_usd' || item.price_reference?.mode !== 'usd_cost_plus') return '';
    try {
      const product = products.find(row => row.id === item.product_id)!;
      const quote = productPriceQuote(product, item.currency, exchangeRate, currencyRates, settings.rounding_rule);
      return `تكلفة الوحدة المرجعية: ${quote.usd_cost} USD؛ مقابلها الآن: ${formatMoney(quote.current_cost_sdg!, 'SDG', settings)}؛ تغير المقابل بسبب الصرف: ${formatMoney(quote.fx_cost_difference_sdg!, 'SDG', settings)}؛ الربح فوق التكلفة: ${product.pricing_markup_percent ?? 0}%.`;
    } catch { return ''; }
  };
  const priceMessages = items.map(item => {
    if (item.price_source !== 'catalog_usd') return '';
    try { const product = products.find(row => row.id === item.product_id); if (!product) throw Error('منتج البند غير متاح.'); productPriceQuote(product, item.currency, exchangeRate, currencyRates, settings.rounding_rule); return ''; }
    catch (error) { return error instanceof Error ? error.message : 'تعذر تحديث السعر المرجعي.'; }
  });
  calculationError ||= priceMessages.find(Boolean) || '';

  const selectPricingCurrency = (currency: Currency) => {
    setPricingCurrency(currency);
    setCurrencyMode(isForeignCurrency(currency) ? 'single_foreign' : currency === 'USD' ? 'single_usd' : 'dual');
    setItems(previous => previous.map(item => recalculateDraftItem({ ...item, currency, unit_price: 0, line_total: 0 })));
  };
  const selectDisplayMode = (mode: CurrencyMode) => {
    if (isForeignCurrency(pricingCurrency)) selectPricingCurrency(mode === 'single_usd' ? 'USD' : 'SDG');
    setCurrencyMode(mode);
  };

  const subtotalSdg = financials.subtotal_sdg;
  const subtotalUsd = financials.subtotal_usd;
  const taxTotalSdg = financials.tax_total_sdg;
  const taxTotalUsd = financials.tax_total_usd;
  const discountTotalSdg = financials.discount_total_sdg;
  const discountTotalUsd = financials.discount_total_usd;
  const effectiveDiscountRate = Math.max(0,...items.map(item=>Number(item.discount_percent)||0),discountType==='percent'?discountValue:(subtotalSdg+discountTotalSdg)>0?discountTotalSdg*100/(subtotalSdg+discountTotalSdg):0);
  const discountApproval = approvalRequirement(approvalPolicies,'discount','PERCENT',effectiveDiscountRate,userRole);
  const grandTotalSdg = financials.grand_total_sdg;
  const grandTotalUsd = financials.grand_total_usd;
  const creditCurrency = currencyMode === 'single_usd' ? 'USD' : 'SDG';
  const creditLimit = creditCurrency === 'USD' ? selectedCustomer?.credit_limit_usd : selectedCustomer?.credit_limit_sdg;
  const creditBalance = creditCurrency === 'USD' ? selectedCustomer?.balance_usd || 0 : selectedCustomer?.balance_sdg || 0;
  const creditInvoiceAmount = creditCurrency === 'USD' ? grandTotalUsd : grandTotalSdg;
  const creditExposure = creditBalance + creditInvoiceAmount;
  const creditExceeded = creditLimit != null && creditExposure > creditLimit;
  const creditApprovalRequired = creditExceeded && selectedCustomer?.credit_policy === 'approval_required';
  const canApproveCredit = userRole === 'Owner' || userRole === 'Admin';

  // Quick Customer Creation
  const handleQuickCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    const created = await addCustomer({
      name: newCustName.trim(),
      phone: newCustPhone.trim(),
      address: newCustAddress.trim(),
      preferred_currency: pricingCurrency,
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
    if (creditApprovalRequired && !canApproveCredit) { setErrorMessage('تجاوز حد ائتمان العميل يتطلب اعتماد المالك أو المدير.'); return; }
    if (creditApprovalRequired && !creditApprovalReason.trim()) { setErrorMessage('اكتب سبب اعتماد تجاوز حد الائتمان.'); return; }
    if(discountApproval&&(!discountApproval.allowed||!discountApprovalReason.trim())){setErrorMessage(discountApproval.allowed?'اكتب سبب اعتماد الخصم.':`الخصم يتطلب اعتماد دور ${discountApproval.tier.required_role}.`);return;}

    const rateValidation = validateExchangeRate(exchangeRate);
    if (calculationError) { setErrorMessage(calculationError); return; }
    if (items.some(i => i.currency !== 'SDG') && !rateValidation.isValid) {
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
        currency_rates_used: isForeignCurrency(pricingCurrency) ? { [pricingCurrency]: currencyRates[pricingCurrency] } : undefined,
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
        ...(creditApprovalRequired ? { credit_limit_override_reason: creditApprovalReason.trim() } : {}),
        ...(discountApproval ? { approval_reason: discountApprovalReason.trim() } : {}),
        ...(branchId ? { branch_id: branchId } : {}),
        ...(costCenterId ? { cost_center_id: costCenterId } : {}),
        ...(projectId ? { project_id: projectId } : {}),
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
    <Dialog label="إنشاء فاتورة جديدة" onClose={() => { if (!isSubmitting) onClose(); }} className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-sf-surface rounded-xl shadow-2xl border border-sf-border max-w-4xl w-full my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 text-sf-text">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-sf-border flex items-center justify-between bg-sf-raised rounded-t-2xl">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-sf-text flex items-center gap-2">
              <span>إنشاء فاتورة جديدة</span>
              <span className="font-mono text-xs font-semibold px-2 py-1 rounded bg-sf-action/10 text-sf-text border border-sf-action/20">
                {invoiceNumber}
              </span>
            </h2>
            <p className="text-xs text-sf-muted">
              دعم العرض المزدوج (جنيه سوداني + دولار) وتجميد سعر الصرف
            </p>
          </div>
          <button disabled={isSubmitting} aria-label="إغلاق النافذة"
            onClick={onClose}
            className="p-2 rounded-lg text-sf-muted hover:text-sf-text hover:bg-sf-raised transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 text-xs sm:text-sm">
          {isInvoiceLimitReached && (
            <div className="p-3 bg-sf-warning-bg/50 border border-sf-warning/60 rounded-xl text-sf-warning text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-sf-warning shrink-0" />
              <span>
                عذراً، لقد استنفدت الحد المسموح به من الفواتير في باقتك الحالية ({currentInvoiceCount}/{maxInvoices} فاتورة). يرجى ترقية باقة اشتراكك من الإعدادات لإصدار فواتير جديدة.
              </span>
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="p-3 bg-sf-danger-bg/40 border border-sf-danger/60 rounded-xl text-sf-danger text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-sf-danger shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          {creditExceeded && <div data-testid="credit-limit-alert" className="p-3 bg-sf-warning-bg/50 border border-sf-warning/60 rounded-xl text-sf-warning text-xs space-y-2">
            <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0"/><span>التعرض بعد الفاتورة {formatMoney(creditExposure, creditCurrency, settings)} يتجاوز حد العميل {formatMoney(creditLimit!, creditCurrency, settings)}. {creditApprovalRequired ? 'يلزم اعتماد.' : 'سيُحفظ التحذير مع الفاتورة.'}</span></div>
            {creditApprovalRequired && canApproveCredit && <textarea aria-label="سبب اعتماد تجاوز حد الائتمان" value={creditApprovalReason} onChange={e=>setCreditApprovalReason(e.target.value)} rows={2} className="w-full bg-sf-surface border border-sf-warning rounded-lg p-2 text-sf-text" placeholder="سبب الاعتماد الموثق" />}
          </div>}

          {/* Section 1: Customer & Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-sf-raised p-4 rounded-xl border border-sf-border">
            {/* Customer Select */}
            <div className="sm:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-sf-text text-xs">العميل *</label>
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(true)}
                  className="text-xs text-sf-action hover:text-sf-action font-semibold flex items-center gap-1 transition-colors"
                >
                  <UserPlus className="w-3 h-3" />
                  + عميل جديد
                </button>
              </div>
              <select
                aria-label="عميل الفاتورة"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                required
                className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
              >
                <option value="" className="bg-sf-raised">-- اختر عميل من القائمة --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id} className="bg-sf-raised">
                    {c.name} ({c.phone || 'بدون هاتف'})
                  </option>
                ))}
              </select>
              {selectedCustomer && (
                <div className="text-xs text-sf-muted mt-1">
                  الرصيد السابق: {formatMoney(selectedCustomer.balance_sdg, 'SDG', settings)} (
                  {formatMoney(selectedCustomer.balance_usd, 'USD', settings)})
                </div>
              )}
            </div>

            {/* Issue Date */}
            <div>
              <label className="block font-semibold text-sf-text text-xs mb-1">تاريخ الإصدار</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                required
                className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
              />
            </div>

            {/* Due Date */}
            <div>
              <label className="block font-semibold text-sf-text text-xs mb-1">تاريخ الاستحقاق</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
              />
            </div>
          </div>

          {isActionAllowed('dimensions:read') && (branches.length > 0 || costCenters.length > 0 || projects.length > 0) && <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-sf-raised p-4 rounded-xl border border-sf-border"><legend className="px-1 font-semibold">أبعاد الفاتورة الاختيارية</legend>
            <label>الفرع<select aria-label="فرع الفاتورة" value={branchId} onChange={e=>setBranchId(e.target.value)} className="sf-field w-full"><option value="">بدون فرع</option>{branches.filter(row=>row.status==='active').map(row=><option key={row.id} value={row.id}>{row.code} — {row.name_ar}</option>)}</select></label>
            <label>مركز التكلفة<select aria-label="مركز تكلفة الفاتورة" value={costCenterId} onChange={e=>setCostCenterId(e.target.value)} className="sf-field w-full"><option value="">بدون مركز</option>{costCenters.filter(row=>row.status==='active').map(row=><option key={row.id} value={row.id}>{row.code} — {row.name_ar}</option>)}</select></label>
            <label>المشروع<select aria-label="مشروع الفاتورة" value={projectId} onChange={e=>setProjectId(e.target.value)} className="sf-field w-full"><option value="">بدون مشروع</option>{projects.filter(row=>row.status==='active').map(row=><option key={row.id} value={row.id}>{row.code} — {row.name_ar}</option>)}</select></label>
          </fieldset>}

          {/* Section 2: Currency Settings & Frozen Rate */}
          <div className="bg-sf-raised border border-sf-border rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-sf-action/10 text-sf-action border border-sf-action/20">
                  <Lock className="w-3.5 h-3.5" />
                </div>
                <span className="font-semibold text-xs sm:text-sm text-sf-text">
                  إعدادات العملتين وتجميد سعر الصرف للفاتورة
                </span>
              </div>
              <span className="text-xs text-sf-muted">
                سعر الصرف يُحفظ ثابتًا مع هذه الفاتورة
              </span>
            </div>

            <div className="space-y-2 bg-sf-raised border border-sf-border rounded-lg p-3">
              <label className="block text-xs font-semibold">عملة تسعير الفاتورة
                <select aria-label="عملة تسعير الفاتورة" className="w-full min-w-0 mt-1 bg-sf-surface border border-sf-border rounded-lg px-3 py-2 text-sf-text focus:outline-none focus:border-sf-action" value={pricingCurrency} onChange={event => selectPricingCurrency(event.target.value as Currency)}>
                  {CURRENCIES.map(row => <option value={row.code} key={row.code}>{currencyLabel(row.code)}</option>)}
                </select>
              </label>
              <p className="text-xs text-sf-muted">أسعار المنتجات المرتبطة بالدولار تتحدث مع الصرف والعملة. الأسعار اليدوية تُصفّر عند تغيير العملة لمراجعتها. سعر الفاتورة يتجمد بعد الحفظ.</p>
              {isForeignCurrency(pricingCurrency) && <label className="block text-xs">سعر عملة الفاتورة لكل دولار
                <input aria-label="سعر عملة الفاتورة لكل دولار" type="number" min="0.00000001" step="any" value={currencyRates[pricingCurrency] || ''} onChange={event => setCurrencyRates(previous => { const next = { ...previous }; if (event.target.value === '') delete next[pricingCurrency]; else next[pricingCurrency] = Number(event.target.value); return next; })} className="w-full min-w-0 mt-1 bg-sf-surface border border-sf-border rounded-lg px-3 py-2 text-sf-text focus:outline-none focus:border-sf-action" />
                <span className="block mt-1" dir="ltr">1 USD = {currencyRates[pricingCurrency] || '…'} {pricingCurrency}</span>
              </label>}
              <p className="text-xs">مفتاح واتساب للعميل الجديد: <bdi dir="ltr">+{phoneRegion(pricingCurrency, transactionCurrency(settings)).dialCode}</bdi></p>
              {calculationError && <p role="alert" className="text-xs text-sf-danger">{calculationError}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              {/* Currency Display Mode */}
              <div>
                <label className="block font-semibold text-sf-text text-xs mb-1">
                  طريقة عرض مبالغ الفاتورة
                </label>
                <div className="grid grid-cols-3 gap-1 bg-sf-raised border border-sf-border p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => selectDisplayMode('dual')}
                    className={`py-2 px-2 text-xs font-semibold rounded-md transition-all ${
                      currencyMode === 'dual'
                        ? 'bg-sf-action text-sf-on-action font-semibold shadow-xs'
                        : 'text-sf-muted hover:text-sf-text'
                    }`}
                  >
                    عرض مزدوج
                  </button>
                  <button
                    type="button"
                    onClick={() => selectDisplayMode('single_sdg')}
                    className={`py-2 px-2 text-xs font-semibold rounded-md transition-all ${
                      currencyMode === 'single_sdg'
                        ? 'bg-sf-action text-sf-on-action font-semibold shadow-xs'
                        : 'text-sf-muted hover:text-sf-text'
                    }`}
                  >
                    جنيه فقط
                  </button>
                  <button
                    type="button"
                    onClick={() => selectDisplayMode('single_usd')}
                    className={`py-2 px-2 text-xs font-semibold rounded-md transition-all ${
                      currencyMode === 'single_usd'
                        ? 'bg-sf-action text-sf-on-action font-semibold shadow-xs'
                        : 'text-sf-muted hover:text-sf-text'
                    }`}
                  >
                    دولار فقط
                  </button>
                </div>
              </div>

              {/* Frozen Exchange Rate Input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold text-sf-text text-xs">
                    {settings.freeze_exchange_rate !== false
                      ? 'سعر الصرف المجمّد (1 دولار أمريكي = كم جنيه سوداني؟)'
                      : 'سعر الصرف للفاتورة (1 دولار أمريكي = كم جنيه سوداني؟)'}
                  </label>
                  {settings.freeze_exchange_rate !== false ? (
                    <span className="text-[10px] text-sf-action bg-sf-selected border border-sf-action/30 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                      <Lock className="w-2.5 h-2.5" />
                      تجميد السعر مفعّل
                    </span>
                  ) : (
                    <span className="text-[10px] text-sf-muted bg-sf-raised border border-sf-border px-1.5 py-0.5 rounded font-medium">
                      تجميد السعر غير مفعّل
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="0.00000001"
                    min="0.00000001"
                    value={exchangeRate}
                    aria-label="سعر صرف الفاتورة"
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    required
                    className="w-full bg-sf-raised border border-sf-action/40 rounded-lg px-3 py-2 text-xs font-semibold font-mono text-sf-text focus:outline-none focus:border-sf-action"
                  />
                  <span className="absolute left-3 top-2 text-xs text-sf-muted font-sans">
                    ج.س / $
                  </span>
                </div>
                {settings.manual_exchange_rate && settings.manual_exchange_rate > 0 ? (
                  <p className="text-[10px] text-sf-action mt-1">
                    * مطبق من سعر الصرف اليدوي المخصص بالإعدادات ({settings.manual_exchange_rate.toLocaleString()} ج.س)
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Section 3: Invoice Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs sm:text-sm text-sf-text">بنود الفاتورة</h3>
              <button
                type="button"
                onClick={handleAddNewItem}
                className="text-xs font-semibold text-sf-text hover:bg-sf-raised bg-sf-raised px-3 py-1 rounded-lg border border-sf-border shadow-2xs flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-sf-action" />
                + إضافة بند جديد
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="bg-sf-raised border border-sf-border rounded-xl p-3 sm:p-4 shadow-2xs space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    {/* Item Description or Product Picker */}
                    <div className="sm:col-span-4">
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-sf-text text-xs">
                          البند #{index + 1}
                        </label>
                        {products.length > 0 && (
                          <select
                            aria-label={`منتج البند ${index + 1}`}
                            onChange={(e) => handleSelectProduct(index, e.target.value)}
                            value=""
                            className="text-xs text-sf-action bg-sf-selected/40 border border-sf-action/50 rounded px-2 py-1"
                          >
                            <option value="" className="bg-sf-raised">اختر من المنتجات...</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id} className="bg-sf-raised">
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
                        className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                      />
                      {item.product_id && (() => {
                        const prod = products.find((p) => p.id === item.product_id);
                        if (!prod) return null;
                        const currentStock = prod.stock_quantity ?? 0;
                        const isOver = (Number(item.quantity) || 0) > currentStock;
                        return (
                          <div className="flex items-center justify-between text-xs mt-1">
                            <span className={isOver ? 'text-sf-danger font-semibold' : 'text-sf-action font-medium'}>
                              المتبقي بالمخزن: {currentStock} {prod.unit}
                            </span>
                            {isOver && (
                              <span className="text-sf-danger font-semibold bg-sf-danger-bg/40 px-1 py-1 rounded border border-sf-danger/60">
                                تنبيه: تتجاوز المخزون
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Quantity */}
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-sf-text text-xs mb-1">
                        الكمية والوحدة
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          placeholder="1"
                          value={item.quantity}
                          aria-label={`كمية البند ${index + 1}`}
                          onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                          required
                          className="w-16 bg-sf-raised border border-sf-border rounded-lg px-2 py-2 text-xs text-sf-text text-center font-mono focus:outline-none focus:border-sf-action"
                        />
                        <input
                          type="text"
                          placeholder="قطعة/جوال"
                          value={item.unit}
                          onChange={(e) => updateItem(index, 'unit', e.target.value)}
                          className="w-20 bg-sf-raised border border-sf-border rounded-lg px-2 py-2 text-xs text-sf-text text-center focus:outline-none focus:border-sf-action"
                        />
                      </div>
                    </div>

                    {/* Unit Price & Currency */}
                    <div className="sm:col-span-3">
                      <label className="block font-semibold text-sf-text text-xs mb-1">
                        سعر الوحدة والعملة
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          placeholder="0"
                          value={item.unit_price}
                          aria-label={`سعر البند ${index + 1}`}
                          onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                          required
                          className="flex-1 bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text font-mono focus:outline-none focus:border-sf-action"
                        />
                        <select
                          aria-label={`عملة البند ${index + 1}`}
                          value={item.currency}
                          onChange={(e) => updateItem(index, 'currency', e.target.value as Currency)}
                          className="w-16 bg-sf-raised border border-sf-border rounded-lg px-1 py-2 text-xs font-semibold text-sf-action focus:outline-none focus:border-sf-action"
                        >
                          {isForeignCurrency(pricingCurrency) && <option value={pricingCurrency}>{pricingCurrency}</option>}
                          <option disabled={isForeignCurrency(pricingCurrency)} value="SDG" className="bg-sf-raised">ج.س</option>
                          <option disabled={isForeignCurrency(pricingCurrency)} value="USD" className="bg-sf-raised">$</option>
                        </select>
                      </div>
                      {item.product_id && <div className="mt-2 text-xs space-y-1" data-testid={`usd-price-line-${index + 1}`}>
                        {item.price_source === 'catalog_usd' ? <>
                          <p className="text-sf-action">{item.price_reference ? `مرجع الدولار: ${item.price_reference.reference_usd} USD — يتحدث تلقائياً` : priceMessages[index]}</p>
                          {item.price_reference?.mode === 'usd_cost_plus' && <p className="text-sf-muted">{costExplanation(item)}</p>}
                        </> : <p className="text-sf-muted">سعر يدوي</p>}
                        {productPricingMode(products.find(row => row.id === item.product_id) || { price_usd: 0, price_sdg: 0 }) !== 'manual' && <button type="button" className="text-sf-action underline" onClick={() => restoreCatalogPrice(index)}>تحديث السعر من مرجع الدولار</button>}
                      </div>}
                    </div>

                    {/* Line Total & Remove */}
                    <div className="sm:col-span-3 flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0">
                      <div className="text-left">
                        <span className="text-xs text-sf-muted block">الإجمالي للبند:</span>
                        <span className="font-mono font-semibold text-xs text-sf-text">
                          {formatMoney(item.line_total, item.currency, settings)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        className="p-2 text-sf-muted hover:text-sf-danger rounded-md transition-colors"
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
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 bg-sf-raised p-4 rounded-xl border border-sf-border">
            {/* Notes & Bank details */}
            <div className="sm:col-span-7 space-y-3">
              <div>
                <label className="block font-semibold text-sf-text text-xs mb-1">
                  ملاحظات وشروط الفاتورة
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات تظهر في أسفل الفاتورة..."
                  className="w-full bg-sf-raised border border-sf-border rounded-lg p-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>
              <div>
                <label className="block font-semibold text-sf-text text-xs mb-1">
                  بيانات السداد المصرفي (حساب بنكك / البنك)
                </label>
                <input
                  type="text"
                  value={paymentInstructions}
                  onChange={(e) => setPaymentInstructions(e.target.value)}
                  placeholder="مثال: حساب بنك الخرطوم (بنكك): 1234567 باسم محمد علي"
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action font-mono"
                />
              </div>
            </div>

            {/* Calculations Box (Dual Display) */}
            <div className="sm:col-span-5 bg-sf-raised border border-sf-border rounded-xl p-4 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-sf-text">
                <span>المجموع الفرعي:</span>
                <span className="font-mono font-semibold text-sf-text">
                  {formatMoney(subtotalSdg, 'SDG', settings)}
                </span>
              </div>

              {financials.pricing && <div className="text-sm font-semibold" data-testid="invoice-native-preview">إجمالي عملة الفاتورة: <bdi dir="ltr">{formatMoney(financials.pricing.total, financials.pricing.currency)}</bdi></div>}
              {/* Discount Input */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-sf-text">الخصم:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    className="w-20 bg-sf-raised border border-sf-border rounded px-2 py-1 text-xs font-mono text-center text-sf-text focus:outline-none focus:border-sf-action"
                  />
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as any)}
                    className="bg-sf-raised border border-sf-border rounded px-1 py-1 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                  >
                    <option value="fixed" className="bg-sf-raised">{isForeignCurrency(pricingCurrency) ? pricingCurrency : 'ج.س'}</option>
                    <option value="percent" className="bg-sf-raised">%</option>
                  </select>
                </div>
              </div>

              {discountTotalSdg > 0 && (
                <div className="flex items-center justify-between text-xs text-sf-danger">
                  <span>قيمة الخصم:</span>
                  <span className="font-mono font-semibold">
                    - {formatMoney(discountTotalSdg, 'SDG', settings)}
                  </span>
                </div>
              )}
              <ApprovalDecisionField requirement={discountApproval} reason={discountApprovalReason} setReason={setDiscountApprovalReason}/>

              {taxTotalSdg > 0 && (
                <div className="flex items-center justify-between text-xs text-sf-text">
                  <span>إجمالي الضريبة:</span>
                  <span className="font-mono font-semibold text-sf-text">
                    + {formatMoney(taxTotalSdg, 'SDG', settings)}
                  </span>
                </div>
              )}

              <div className="pt-2 border-t border-sf-border">
                <div className="text-xs font-semibold text-sf-text mb-1">
                  الإجمالي النهائي (عرض مزدوج):
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-base text-sf-text">
                    {formatMoney(grandTotalSdg, 'SDG', settings)}
                  </span>
                  <span className="font-mono font-semibold text-sm text-sf-text bg-sf-action/10 px-2 py-1 rounded border border-sf-action/20">
                    {formatMoney(grandTotalUsd, 'USD', settings)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Buttons Footer */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-sf-border">
            <button disabled={isSubmitting}
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-sf-text hover:bg-sf-raised rounded-lg border border-sf-border bg-sf-raised transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isInvoiceLimitReached || !!discountApproval&&!discountApproval.allowed}
              className={`px-6 py-2 text-xs font-semibold rounded-lg shadow-lg transition-all flex items-center gap-2 ${
                isInvoiceLimitReached
                  ? 'bg-sf-raised text-sf-muted cursor-not-allowed border border-sf-border'
                  : isSubmitting
                  ? 'bg-sf-action/50 text-sf-text cursor-not-allowed opacity-75'
                  : 'text-sf-on-action bg-sf-action hover:bg-sf-action-hover  shadow-sf-action/20'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-sf-border border-t-transparent rounded-full animate-spin" />
                  <span>جاري إصدار الفاتورة...</span>
                </>
              ) : isInvoiceLimitReached ? (
                <>
                  <Lock className="w-4 h-4 text-sf-muted" />
                  <span>تم استنفاد باقة الفواتير</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-sf-on-action" />
                  <span>إصدار الفاتورة وحفظها</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Quick Add Customer Sub-Modal */}
      {showAddCustomerModal && (
        <Dialog label="إضافة عميل سريع" onClose={() => setShowAddCustomerModal(false)} className="fixed inset-0 z-60 bg-sf-canvas/80 flex items-center justify-center p-4">
          <div className="bg-sf-surface rounded-xl shadow-xl border border-sf-border max-w-sm w-full p-4 space-y-3 text-sf-text">
            <div className="flex items-center justify-between border-b border-sf-border pb-2">
              <h4 className="font-semibold text-sm text-sf-text">إضافة عميل سريع</h4>
              <button aria-label="إغلاق النافذة"
                type="button"
                onClick={() => setShowAddCustomerModal(false)}
                className="text-sf-muted hover:text-sf-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleQuickCreateCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-sf-text mb-1">اسم العميل *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="مثال: محلات النصر (علي أحمد)"
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>
              <div>
                <label className="block font-medium text-sf-text mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  aria-label="هاتف العميل السريع" placeholder={phoneRegion(pricingCurrency, transactionCurrency(settings)).example}
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-sf-text placeholder-sf-muted font-mono focus:outline-none focus:border-sf-action"
                />
              </div>
              <div>
                <label className="block font-medium text-sf-text mb-1">العنوان / المنطقة</label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  placeholder="الخرطوم / بحري / أم درمان..."
                  className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-sf-border">
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  className="px-3 py-2 border border-sf-border text-sf-text hover:bg-sf-raised rounded-lg bg-sf-raised"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold rounded-lg shadow-lg shadow-sf-action/20"
                >
                  حفظ العميل
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
};
