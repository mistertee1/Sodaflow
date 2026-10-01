import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Expense, Currency } from '../types';
import {
  Plus,
  Receipt,
  Trash2,
  Camera,
  X,
  CheckCircle2,
  Calendar,
  DollarSign,
  Image as ImageIcon,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { formatMoney, convertCurrency, safeAdd, validateExchangeRate } from '../lib/currency';
import {
  uploadOrganizationImage,
  validateImageFile,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from '../services/storageService';

export const ExpensesView: React.FC = () => {
  const { expenses, addExpense, deleteExpense, settings, currentUser, currentOrg, isActionAllowed } = useApp();

  const submitLock = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [currency, setCurrency] = useState<Currency>('SDG');
  const [expenseExchangeRate, setExpenseExchangeRate] = useState<number>(settings.default_exchange_rate || 0);
  const [category, setCategory] = useState('نقل وترحيل');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const rate = settings.default_exchange_rate || 0;

  const defaultCategories = [
    'نقل وترحيل',
    'إيجار المحل / المستودع',
    'مشتريات بضاعة وتوريدات',
    'رواتب ومكافآت عمال',
    'كهرباء وماء وخدمات',
    'صيانة وتجهيزات',
    'أخرى',
  ];

  const safeExpenses = Array.isArray(expenses) ? expenses : [];

  // Calculate total expenses with safeAdd
  const totalSdg = safeExpenses.reduce((acc, exp) => {
    if (!exp) return acc;
    if (exp.currency === 'SDG') return safeAdd(acc, exp.amount, 0);
    const expRate = exp.exchange_rate_used || settings.default_exchange_rate || 0;
    if (expRate <= 0) return acc;
    return safeAdd(acc, convertCurrency(exp.amount, exp.currency, 'SDG', expRate, settings), 0);
  }, 0);

  const totalUsd = safeExpenses.reduce((acc, exp) => {
    if (!exp) return acc;
    if (exp.currency === 'USD') return safeAdd(acc, exp.amount, 2);
    const expRate = exp.exchange_rate_used || settings.default_exchange_rate || 0;
    if (expRate <= 0) return acc;
    return safeAdd(acc, convertCurrency(exp.amount, exp.currency, 'USD', expRate, settings), 2);
  }, 0);

  const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadError(null);

    // 1. Client-side file size and format validation before starting upload
    const validation = validateImageFile(file, MAX_IMAGE_FILE_SIZE_BYTES);
    if (!validation.isValid) {
      setUploadError(validation.error || 'ملف الإيصال غير صالح.');
      return;
    }

    // 2. Authentication check
    if (!currentUser) {
      setUploadError('يرجى تسجيل الدخول بحساب المؤسسة أولاً لرفع إيصال المصروف سحابياً.');
      return;
    }

    const orgId = currentOrg && currentOrg.id !== 'local-guest-org' ? currentOrg.id : `org-${currentUser.uid}`;

    setIsUploadingReceipt(true);
    setUploadProgress(0);

    try {
      const downloadUrl = await uploadOrganizationImage({
        file,
        orgId,
        folder: 'receipts',
        onProgress: (pct) => setUploadProgress(pct),
      });
      setReceiptImage(downloadUrl);
    } catch (err: any) {
      console.error('Failed to upload receipt to Firebase Storage:', err);
      setUploadError(err.message || 'فشل رفع صورة الإيصال إلى التخزين السحابي.');
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    setErrorMessage(null);
    if (isUploadingReceipt) {
      setErrorMessage('يرجى الانتظار حتى يكتمل رفع صورة الإيصال إلى التخزين السحابي.');
      return;
    }
    if (!title.trim() || amount <= 0) return;

    let finalRate = expenseExchangeRate > 0 ? expenseExchangeRate : (settings.default_exchange_rate || 0);
    if (currency === 'USD') {
      const rateVal = validateExchangeRate(finalRate);
      if (!rateVal.isValid) {
        setErrorMessage(rateVal.error || 'يرجى إدخال سعر صرف صالح وموجب للمصروف بالعملة الأجنبية.');
        return;
      }
      finalRate = rateVal.rate;
    }

    submitLock.current = true; setIsSaving(true);
    try {
    await addExpense({
      title: title.trim(),
      amount: Number(amount),
      currency,
      category,
      date,
      notes: notes.trim() || '',
      receipt_image: receiptImage || '',
      exchange_rate_used: finalRate,
    });

    setIsAddModalOpen(false);
    setTitle('');
    setAmount(0);
    setReceiptImage(null);
    setNotes('');
    setErrorMessage(null);
    setUploadError(null);
    setUploadProgress(0);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "تعذر تسجيل المصروف."); }
    finally { submitLock.current = false; setIsSaving(false); }
  };

  const handleDelete = async (id: string, expTitle: string) => {
    if (window.confirm(`هل أنت متأكد من عكس المصروف "${expTitle}"؟`)) {
      try { await deleteExpense(id); } catch (error) { setErrorMessage(error instanceof Error ? error.message : "تعذر عكس المصروف."); }
    }
  };

  return (
    <div className="space-y-5 pb-16">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-sf-surface p-4 rounded-2xl border border-sf-border shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-sf-text">سجل المصروفات اليومية</h2>
          <p className="text-xs text-sf-muted">
            تسجيل النفقات بالجنيه والدولار مع إرفاق صور الإيصالات عبر الكاميرا
          </p>
        </div>
        <button
          disabled={!isActionAllowed('expenses:create')} onClick={() => setIsAddModalOpen(true)}
          className="bg-sf-action hover:bg-sf-action-hover text-sf-on-action text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-sf-action/20 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4 text-sf-on-action" />
          <span>تسجيل مصروف جديد</span>
        </button>
      </div>

      {/* Totals Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-sf-surface p-4 sm:p-5 rounded-2xl border border-sf-border shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-sf-muted font-semibold block mb-0.5">إجمالي المصروفات بالجنيه:</span>
            <span className="text-xl font-black font-mono text-sf-text">
              {formatMoney(totalSdg, 'SDG', settings)}
            </span>
          </div>
          <div className="p-2.5 bg-sf-warning-bg/10 text-sf-warning rounded-xl border border-sf-warning/20">
            <Receipt className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-sf-surface p-4 sm:p-5 rounded-2xl border border-sf-border shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-sf-muted font-semibold block mb-0.5">ما يعادل بالدولار:</span>
            <span className="text-xl font-black font-mono text-sf-action">
              {formatMoney(totalUsd, 'USD', settings)}
            </span>
          </div>
          <div className="p-2.5 bg-sf-action/10 text-sf-action rounded-xl border border-sf-action/20">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Expenses List */}
      {safeExpenses.length === 0 ? (
        <div className="bg-sf-surface border border-sf-border rounded-2xl p-10 text-center text-sf-muted shadow-sm">
          <Receipt className="w-10 h-10 mx-auto mb-2 text-sf-muted" />
          <p className="text-sm font-medium text-sf-text">لم يتم تسجيل أي مصروفات بعد</p>
        </div>
      ) : (
        <div className="divide-y divide-sf-border bg-sf-surface border border-sf-border rounded-2xl overflow-hidden shadow-sm">
          {(safeExpenses || []).map((exp) => (
            <div
              key={exp.id}
              className="p-4 hover:bg-sf-raised transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-sf-text">{exp.title}</span>
                  <span className="text-[11px] bg-sf-raised text-sf-text px-2 py-0.5 rounded-md border border-sf-border font-medium">
                    {exp.category}
                  </span>
                </div>
                <div className="text-xs text-sf-muted flex items-center gap-2">
                  <span className="flex items-center gap-1 font-mono">
                    <Calendar className="w-3 h-3 text-sf-muted" />
                    {exp.date}
                  </span>
                  {exp.notes && <span>• {exp.notes}</span>}
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-4">
                <div className="text-left font-mono">
                  <span className="font-bold text-base text-sf-text block">
                    {formatMoney(exp.amount, exp.currency, settings)}
                  </span>
                  <span className="text-[11px] text-sf-action font-semibold">
                    {exp.currency === 'SDG'
                      ? formatMoney(convertCurrency(exp.amount, 'SDG', 'USD', rate, settings), 'USD', settings)
                      : formatMoney(convertCurrency(exp.amount, 'USD', 'SDG', rate, settings), 'SDG', settings)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {exp.receipt_image && (
                    <button
                      onClick={() => setPreviewImage(exp.receipt_image!)}
                      title="عرض صورة الإيصال المرفقة"
                      className="p-1.5 bg-sf-selected/60 hover:bg-sf-selected/60 text-sf-action rounded-lg border border-sf-action/60 transition-colors shadow-xs"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    disabled={!isActionAllowed('expenses:delete')} onClick={() => handleDelete(exp.id, exp.title)}
                    title="عكس المصروف"
                    className="p-1.5 text-sf-muted hover:text-sf-danger hover:bg-sf-danger-bg/30 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Expense Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-sf-surface rounded-2xl shadow-2xl border border-sf-border max-w-md w-full p-5 sm:p-6 animate-in fade-in zoom-in-95 text-xs sm:text-sm text-sf-text">
            <div className="flex items-center justify-between border-b border-sf-border pb-3 mb-4">
              <h3 className="font-bold text-base text-sf-text">تسجيل مصروف جديد</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-sf-muted hover:text-sf-text"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {errorMessage && (
                <div className="p-2.5 rounded-xl bg-sf-danger-bg/10 border border-sf-danger/20 text-sf-danger text-xs flex items-center gap-2">
                  <span>{errorMessage}</span>
                </div>
              )}
              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  بيان المصروف *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: إيجار المحل لشهر سبتمبر"
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-sf-text mb-1 text-xs">المبلغ *</label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs font-mono font-bold text-sf-action focus:outline-none focus:border-sf-action"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-sf-text mb-1 text-xs">العملة</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action font-semibold"
                  >
                    <option value="SDG" className="bg-sf-raised">جنيه سوداني (ج.س)</option>
                    <option value="USD" className="bg-sf-raised">دولار أمريكي ($)</option>
                  </select>
                </div>
              </div>

              {currency === 'USD' && (
                <div>
                  <label className="block font-semibold text-sf-text mb-1 text-xs">
                    سعر الصرف المعتمد (ج.س لكل 1$) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.0001"
                    required
                    value={expenseExchangeRate || ''}
                    onChange={(e) => setExpenseExchangeRate(Number(e.target.value))}
                    placeholder="مثال: 2750"
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs font-mono text-sf-warning focus:outline-none focus:border-sf-warning"
                  />
                  <p className="text-[10px] text-sf-muted mt-1">
                    سعر صرف موثق لمعادلة المصروف بالدفاتر المحاسبية.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-sf-text mb-1 text-xs">التصنيف</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                  >
                    {defaultCategories.map((c) => (
                      <option key={c} value={c} className="bg-sf-raised">
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-sf-text mb-1 text-xs">التاريخ</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                  />
                </div>
              </div>

              {/* Receipt Image Attachment (Camera) */}
              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">
                  صورة الإيصال أو الفاتورة (كاميرا أو ملف)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    capture="environment"
                    ref={fileInputRef}
                    disabled={isUploadingReceipt}
                    onChange={handleImageCapture}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={isUploadingReceipt}
                    onClick={() => fileInputRef.current?.click()}
                    className={`px-3 py-2 bg-sf-raised hover:bg-sf-raised text-sf-text rounded-xl border border-sf-border text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs ${
                      isUploadingReceipt ? 'opacity-60 cursor-not-allowed' : ''
                    }`}
                  >
                    {isUploadingReceipt ? (
                      <>
                        <Loader2 className="w-4 h-4 text-sf-action animate-spin" />
                        <span>جاري الرفع السحابي ({uploadProgress}%)...</span>
                      </>
                    ) : (
                      <>
                        <Camera className="w-4 h-4 text-sf-action" />
                        <span>التقاط بالكاميرا / اختيار صورة</span>
                      </>
                    )}
                  </button>
                  {receiptImage && !isUploadingReceipt && (
                    <div className="flex items-center gap-1 text-xs text-sf-action font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>تم حفظ الصورة سحابياً</span>
                      <button
                        type="button"
                        onClick={() => setReceiptImage(null)}
                        className="text-sf-danger hover:underline mr-1 text-[11px]"
                      >
                        إزالة
                      </button>
                    </div>
                  )}
                </div>

                {isUploadingReceipt && (
                  <div className="w-full bg-sf-raised rounded-full h-1.5 overflow-hidden mt-2">
                    <div
                      className="bg-sf-action h-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}

                {uploadError && (
                  <div className="p-2.5 mt-2 rounded-xl bg-sf-danger-bg/60 border border-sf-danger/60 text-sf-danger text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-sf-danger shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">ملاحظة</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات توضيحية..."
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-sf-border">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-sf-border bg-sf-raised rounded-xl text-xs font-semibold text-sf-text hover:bg-sf-raised transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving || isUploadingReceipt}
                  className="px-5 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action rounded-xl text-xs font-bold shadow-lg shadow-sf-action/20 flex items-center gap-1.5 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4 text-sf-on-action" />
                  <span>تسجيل المصروف</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-60 bg-sf-canvas/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 max-w-lg w-full max-h-[90vh] flex flex-col items-center shadow-2xl text-sf-text">
            <div className="w-full flex justify-between items-center mb-2 pb-2 border-b border-sf-border">
              <span className="font-bold text-xs text-sf-text">صورة الإيصال المرفقة</span>
              <button
                onClick={() => setPreviewImage(null)}
                className="text-sf-muted hover:text-sf-text p-1 rounded-lg hover:bg-sf-raised"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={previewImage}
              alt="Receipt"
              className="max-h-[70vh] object-contain rounded-xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
