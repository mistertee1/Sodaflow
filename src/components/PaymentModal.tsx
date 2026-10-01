import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Invoice, Currency, PaymentMethod, Payment } from '../types';
import { X, CheckCircle2, CreditCard, AlertCircle, Receipt } from 'lucide-react';
import { formatMoney, convertCurrency, safeSub, validateExchangeRate } from '../lib/currency';
import { receivableCurrency, paymentQuote } from '../domain/financial';
import { applyRounding } from '../lib/currency';
import { Dialog } from './Dialog';

interface PaymentModalProps {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
  onPaymentRecorded: (payment: Payment) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  invoice,
  isOpen,
  onClose,
  onPaymentRecorded,
}) => {
  const { recordPayment, settings } = useApp();

  const [amount, setAmount] = useState<number>(0);
  const [currency, setCurrency] = useState<Currency>('SDG');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bankak');
  const [exchangeRateUsed, setExchangeRateUsed] = useState<number>(settings.default_exchange_rate);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const retryKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (invoice && isOpen) {
      // Default amount to remaining balance
      const native = receivableCurrency(invoice);
      setAmount(native === 'USD' ? invoice.remaining_usd : invoice.remaining_sdg);
      setCurrency(native);
      retryKey.current = crypto.randomUUID();
      submitLock.current = false;
      setPaymentMethod('bankak');
      setExchangeRateUsed(invoice.exchange_rate_used || settings.default_exchange_rate);
      setReferenceNumber('');
      setNotes('');
      setError(null);
    }
  }, [invoice?.id, isOpen]);

  if (!isOpen || !invoice) return null;

  const invRate = invoice.exchange_rate_used || settings.default_exchange_rate || 0;
  const rateDiff = safeSub(exchangeRateUsed, invRate, 2);

  const handleCurrencySwitch = (newCurr: Currency) => {
    try { setAmount(fullAmount(newCurr)); setCurrency(newCurr); setError(null); }
    catch (error) { setError(error instanceof Error ? error.message : 'سعر الصرف غير صالح.'); }
  };

  const fullAmount = (target: Currency) => {
    const native = receivableCurrency(invoice), remaining = native === 'USD' ? invoice.remaining_usd : invoice.remaining_sdg;
    return target === native ? remaining : convertCurrency(remaining, native, target, exchangeRateUsed, settings);
  };

  const handleQuickFill = (type: 'full' | 'half') => {
    try { const remaining = fullAmount(currency); setAmount(type === 'full' ? remaining : applyRounding(remaining / 2, currency === 'USD' ? 2 : 0)); }
    catch (error) { setError(error instanceof Error ? error.message : 'سعر الصرف غير صالح.'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    setError(null);

    if (amount <= 0) {
      setError('المبلغ المدفوع يجب أن يكون أكبر من الصفر.');
      return;
    }

    const rateVal = validateExchangeRate(exchangeRateUsed);
    if ((currency === 'USD' || invoice.grand_total_usd > 0) && !rateVal.isValid) {
      setError(rateVal.error || 'يرجى إدخال سعر صرف صالح وموجب للدفع.');
      return;
    }

    try { paymentQuote(invoice, amount, currency as 'SDG' | 'USD', rateVal.rate || 0); }
    catch (error) { setError(error instanceof Error ? error.message : 'مبلغ الدفعة غير صالح.'); return; }
    submitLock.current = true; setIsSubmitting(true);
    try {
      const payment = await recordPayment({
        invoice_id: invoice.id,
        amount: Number(amount),
        currency,
        payment_method: paymentMethod,
        exchange_rate_used: rateVal.rate || 0,
        idempotency_key: retryKey.current,
        reference_number: referenceNumber.trim() || '',
        notes: notes.trim() || '',
      });

      onPaymentRecorded(payment);
      onClose();
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تسجيل الدفعة.');
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog label="تسجيل دفعة" onClose={() => { if (!isSubmitting) onClose(); }} className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-sf-surface rounded-xl shadow-2xl border border-sf-border max-w-md w-full p-6 sm:p-6 animate-in fade-in zoom-in-95 text-xs sm:text-sm text-sf-text">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sf-border pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-sf-action/10 text-sf-action border border-sf-action/20">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-sf-text">تسجيل دفعة جديدة</h3>
              <p className="text-xs text-sf-muted font-mono">فاتورة #{invoice.invoice_number}</p>
            </div>
          </div>
          <button disabled={isSubmitting} aria-label="إغلاق النافذة"
            onClick={onClose}
            className="p-1 rounded-md text-sf-muted hover:text-sf-text hover:bg-sf-raised transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 mb-3 bg-sf-danger-bg/40 border border-sf-danger/60 rounded-lg text-sf-danger text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-sf-danger shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Invoice Summary Card */}
        <div className="bg-sf-raised p-3 rounded-xl border border-sf-border mb-4 space-y-1 text-xs">
          <div className="flex justify-between text-sf-muted">
            <span>العميل:</span>
            <span className="font-semibold text-sf-text">{invoice.customer_name}</span>
          </div>
          <div className="flex justify-between text-sf-muted">
            <span>إجمالي الفاتورة:</span>
            <span className="font-mono font-semibold text-sf-text">
              {formatMoney(invoice.grand_total_sdg, 'SDG', settings)} ({formatMoney(invoice.grand_total_usd, 'USD', settings)})
            </span>
          </div>
          <div className="flex justify-between text-sf-danger font-semibold pt-1 border-t border-sf-border">
            <span>المتبقي المطلوب:</span>
            <span className="font-mono">
              {formatMoney(invoice.remaining_sdg, 'SDG', settings)} ({formatMoney(invoice.remaining_usd, 'USD', settings)})
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Currency Selection */}
          <div>
            <label className="block font-semibold text-sf-text mb-1 text-xs">عملة الدفع</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleCurrencySwitch('SDG')}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-all ${
                  currency === 'SDG'
                    ? 'bg-sf-action text-sf-on-action border-sf-action shadow-sm'
                    : 'bg-sf-raised text-sf-text border-sf-border hover:bg-sf-raised'
                }`}
              >
                جنيه سوداني (ج.س)
              </button>
              <button
                type="button"
                onClick={() => handleCurrencySwitch('USD')}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-all ${
                  currency === 'USD'
                    ? 'bg-sf-action text-sf-on-action border-sf-action shadow-sm'
                    : 'bg-sf-raised text-sf-text border-sf-border hover:bg-sf-raised'
                }`}
              >
                دولار أمريكي ($)
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-sf-text text-xs">المبلغ المدفوع *</label>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleQuickFill('full')}
                  className="text-sf-action hover:text-sf-action font-medium"
                >
                  كامل المبلغ
                </button>
                <span className="text-sf-muted">•</span>
                <button
                  type="button"
                  onClick={() => handleQuickFill('half')}
                  className="text-sf-muted hover:text-sf-text font-medium"
                >
                  النصف
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0.01"
                value={amount}
                aria-label="مبلغ الدفعة"
                onChange={(e) => setAmount(Number(e.target.value))}
                required
                className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-base font-semibold font-mono text-sf-text focus:outline-none focus:border-sf-action"
              />
              <span className="absolute left-3 top-2.5 text-xs text-sf-action font-semibold">
                {currency === 'SDG' ? 'ج.س' : 'USD'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-sf-muted mt-1">
              <span>سعر الصرف عند إصدار الفاتورة: 1$ = {formatMoney(invRate, 'SDG', settings)}</span>
            </div>
          </div>

          {/* Exchange Rate at Payment */}
          <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-sf-text">سعر الصرف عند السداد (ج.س لكل $)</label>
              <span className="text-xs text-sf-muted font-mono">
                الحالي: {formatMoney(exchangeRateUsed, 'SDG', settings)}
              </span>
            </div>
            <input
              type="number"
              step="any"
              min="1"
              value={exchangeRateUsed}
              aria-label="سعر الصرف عند السداد"
              onChange={(e) => setExchangeRateUsed(Number(e.target.value))}
              className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs font-mono font-semibold text-sf-text focus:outline-none focus:border-sf-action"
            />
            {rateDiff !== 0 && (
              <div
                className={`text-xs p-2 rounded-lg border font-medium flex items-center justify-between ${
                  rateDiff > 0
                    ? 'bg-sf-selected/40 border-sf-action/50 text-sf-action'
                    : 'bg-sf-danger-bg/40 border-sf-danger/50 text-sf-danger'
                }`}
              >
                <span>
                  {rateDiff > 0 ? 'أرباح فروقات عملة (FX Gain)' : 'خسائر فروقات عملة (FX Loss)'}:
                </span>
                <span className="font-mono font-semibold dir-ltr">
                  {rateDiff > 0 ? `+${rateDiff}` : rateDiff} ج.س/$
                </span>
              </div>
            )}
          </div>

          {/* Payment Method */}
          <div>
            <label className="block font-semibold text-sf-text mb-1 text-xs">طريقة السداد</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
            >
              <option value="bankak" className="bg-sf-raised">تطبيق بنكك (بنك الخرطوم)</option>
              <option value="fawry" className="bg-sf-raised">تطبيق فوري (بنك فيصل)</option>
              <option value="cash" className="bg-sf-raised">نقدًا (كاش)</option>
              <option value="bank_transfer" className="bg-sf-raised">تحويل مصرفي</option>
              <option value="other" className="bg-sf-raised">أخرى</option>
            </select>
          </div>

          {/* Reference / Bank Transaction ID */}
          <div>
            <label className="block font-semibold text-sf-text mb-1 text-xs">
              رقم العملية / إشعار بنكك (اختياري)
            </label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="مثال: رقم المعاملة في تطبيق بنكك..."
              className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action font-mono"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block font-semibold text-sf-text mb-1 text-xs">ملاحظات إضافية</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات حول الدفعة..."
              className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
            />
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-sf-border">
            <button disabled={isSubmitting}
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-sf-text hover:bg-sf-raised rounded-lg border border-sf-border bg-sf-raised transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 text-xs font-semibold text-sf-on-action bg-sf-action hover:bg-sf-action-hover rounded-lg shadow-lg shadow-sf-action/20 flex items-center gap-2 transition-all disabled:opacity-50 "
            >
              <CheckCircle2 className="w-4 h-4 text-sf-on-action" />
              <span>تأكيد استلام الدفعة</span>
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
};
