import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Invoice, Currency, PaymentMethod, Payment } from '../types';
import { X, CheckCircle2, CreditCard, AlertCircle, Receipt } from 'lucide-react';
import { formatMoney, convertCurrency, safeSub, validateExchangeRate } from '../lib/currency';

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

  useEffect(() => {
    if (invoice && isOpen) {
      // Default amount to remaining balance
      setAmount(invoice.remaining_sdg > 0 ? invoice.remaining_sdg : invoice.grand_total_sdg);
      setCurrency('SDG');
      setPaymentMethod('bankak');
      setExchangeRateUsed(invoice.exchange_rate_used || settings.default_exchange_rate);
      setReferenceNumber('');
      setNotes('');
      setError(null);
    }
  }, [invoice, isOpen, settings.default_exchange_rate]);

  if (!isOpen || !invoice) return null;

  const invRate = invoice.exchange_rate_used || settings.default_exchange_rate || 0;
  const rateDiff = safeSub(exchangeRateUsed, invRate, 2);

  const handleCurrencySwitch = (newCurr: Currency) => {
    setCurrency(newCurr);
    if (newCurr === 'USD') {
      setAmount(convertCurrency(invoice.remaining_sdg, 'SDG', 'USD', exchangeRateUsed, settings));
    } else {
      setAmount(invoice.remaining_sdg);
    }
  };

  const handleQuickFill = (type: 'full' | 'half') => {
    const totalRemaining = currency === 'SDG' ? invoice.remaining_sdg : invoice.remaining_usd;
    if (type === 'full') {
      setAmount(totalRemaining);
    } else {
      setAmount(Math.round(totalRemaining / 2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (amount <= 0) {
      setError('المبلغ المدفوع يجب أن يكون أكبر من الصفر.');
      return;
    }

    const rateVal = validateExchangeRate(exchangeRateUsed);
    if (!rateVal.isValid) {
      setError(rateVal.error || 'يرجى إدخال سعر صرف صالح وموجب للدفع.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payment = await recordPayment({
        invoice_id: invoice.id,
        amount: Number(amount),
        currency,
        payment_method: paymentMethod,
        exchange_rate_used: rateVal.rate,
        reference_number: referenceNumber.trim() || '',
        notes: notes.trim() || '',
      });

      onPaymentRecorded(payment);
      onClose();
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تسجيل الدفعة.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#050505]/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0c0c0f] rounded-2xl shadow-2xl border border-[#1e1e24] max-w-md w-full p-5 sm:p-6 animate-in fade-in zoom-in-95 text-xs sm:text-sm text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1e1e24] pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">تسجيل دفعة جديدة</h3>
              <p className="text-xs text-slate-400 font-mono">فاتورة #{invoice.invoice_number}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1a1a24] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-2.5 mb-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Invoice Summary Card */}
        <div className="bg-[#121216] p-3 rounded-xl border border-[#1e1e24] mb-4 space-y-1 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>العميل:</span>
            <span className="font-bold text-white">{invoice.customer_name}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>إجمالي الفاتورة:</span>
            <span className="font-mono font-bold text-white">
              {formatMoney(invoice.grand_total_sdg, 'SDG', settings)} ({formatMoney(invoice.grand_total_usd, 'USD', settings)})
            </span>
          </div>
          <div className="flex justify-between text-rose-400 font-bold pt-1 border-t border-[#1e1e24]">
            <span>المتبقي المطلوب:</span>
            <span className="font-mono">
              {formatMoney(invoice.remaining_sdg, 'SDG', settings)} ({formatMoney(invoice.remaining_usd, 'USD', settings)})
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Currency Selection */}
          <div>
            <label className="block font-semibold text-slate-300 mb-1 text-xs">عملة الدفع</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleCurrencySwitch('SDG')}
                className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all ${
                  currency === 'SDG'
                    ? 'bg-emerald-500 text-slate-950 border-emerald-500 shadow-sm'
                    : 'bg-[#121216] text-slate-300 border-[#22222d] hover:bg-[#181822]'
                }`}
              >
                جنيه سوداني (ج.س)
              </button>
              <button
                type="button"
                onClick={() => handleCurrencySwitch('USD')}
                className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all ${
                  currency === 'USD'
                    ? 'bg-emerald-500 text-slate-950 border-emerald-500 shadow-sm'
                    : 'bg-[#121216] text-slate-300 border-[#22222d] hover:bg-[#181822]'
                }`}
              >
                دولار أمريكي ($)
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-300 text-xs">المبلغ المدفوع *</label>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleQuickFill('full')}
                  className="text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  كامل المبلغ
                </button>
                <span className="text-slate-600">•</span>
                <button
                  type="button"
                  onClick={() => handleQuickFill('half')}
                  className="text-slate-400 hover:text-slate-200 font-medium"
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
                onChange={(e) => setAmount(Number(e.target.value))}
                required
                className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-3 py-2 text-base font-bold font-mono text-white focus:outline-none focus:border-emerald-500"
              />
              <span className="absolute left-3 top-2.5 text-xs text-emerald-400 font-bold">
                {currency === 'SDG' ? 'ج.س' : 'USD'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
              <span>سعر الصرف عند إصدار الفاتورة: 1$ = {formatMoney(invRate, 'SDG', settings)}</span>
            </div>
          </div>

          {/* Exchange Rate at Payment */}
          <div className="bg-[#121216] p-3 rounded-xl border border-[#1e1e24] space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">سعر الصرف عند السداد (ج.س لكل $)</label>
              <span className="text-[11px] text-slate-400 font-mono">
                الحالي: {formatMoney(exchangeRateUsed, 'SDG', settings)}
              </span>
            </div>
            <input
              type="number"
              step="any"
              min="1"
              value={exchangeRateUsed}
              onChange={(e) => setExchangeRateUsed(Number(e.target.value))}
              className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-emerald-500"
            />
            {rateDiff !== 0 && (
              <div
                className={`text-[11px] p-2 rounded-lg border font-medium flex items-center justify-between ${
                  rateDiff > 0
                    ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
                }`}
              >
                <span>
                  {rateDiff > 0 ? 'أرباح فروقات عملة (FX Gain)' : 'خسائر فروقات عملة (FX Loss)'}:
                </span>
                <span className="font-mono font-bold dir-ltr">
                  {rateDiff > 0 ? `+${rateDiff}` : rateDiff} ج.س/$
                </span>
              </div>
            )}
          </div>

          {/* Payment Method */}
          <div>
            <label className="block font-semibold text-slate-300 mb-1 text-xs">طريقة السداد</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="bankak" className="bg-[#121216]">تطبيق بنكك (بنك الخرطوم)</option>
              <option value="fawry" className="bg-[#121216]">تطبيق فوري (بنك فيصل)</option>
              <option value="cash" className="bg-[#121216]">نقدًا (كاش)</option>
              <option value="bank_transfer" className="bg-[#121216]">تحويل مصرفي</option>
              <option value="other" className="bg-[#121216]">أخرى</option>
            </select>
          </div>

          {/* Reference / Bank Transaction ID */}
          <div>
            <label className="block font-semibold text-slate-300 mb-1 text-xs">
              رقم العملية / إشعار بنكك (اختياري)
            </label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="مثال: رقم المعاملة في تطبيق بنكك..."
              className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block font-semibold text-slate-300 mb-1 text-xs">ملاحظات إضافية</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات حول الدفعة..."
              className="w-full bg-[#15151c] border border-[#22222d] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e1e24]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-[#1a1a24] rounded-lg border border-[#262634] bg-[#121216] transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 transition-all disabled:opacity-50 active:scale-95"
            >
              <CheckCircle2 className="w-4 h-4 text-slate-950" />
              <span>تأكيد استلام الدفعة</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
