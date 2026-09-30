import React, { useState } from 'react';
import {
  Package,
  X,
  Search,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Minus,
  Save,
  RotateCcw,
  Sparkles,
  History,
  CheckCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatMoney } from '../lib/currency';

interface InventoryAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InventoryAuditModal: React.FC<InventoryAuditModalProps> = ({ isOpen, onClose }) => {
  const { products, updateProductStock, inventoryMovements, reconcileProductStock, settings } = useApp();
  const [activeTab, setActiveTab] = useState<'audit' | 'ledger' | 'reconcile'>('audit');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);
  const [editingStocks, setEditingStocks] = useState<{ [productId: string]: number }>({});
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Filter products
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.category && p.category.toLowerCase().includes(searchTerm.toLowerCase()));

    const isLow =
      typeof p.stock_quantity === 'number' &&
      typeof p.min_stock_alert === 'number' &&
      p.stock_quantity <= p.min_stock_alert;

    if (filterLowStockOnly) {
      return matchesSearch && isLow;
    }
    return matchesSearch;
  });

  // Calculate totals
  const totalItemsCount = products.reduce((acc, p) => acc + (p.stock_quantity || 0), 0);
  const lowStockCount = products.filter(
    (p) =>
      typeof p.stock_quantity === 'number' &&
      typeof p.min_stock_alert === 'number' &&
      p.stock_quantity <= p.min_stock_alert
  ).length;

  const totalValueSdg = products.reduce(
    (acc, p) => acc + (p.stock_quantity || 0) * (p.price_sdg || 0),
    0
  );
  const totalValueUsd = products.reduce(
    (acc, p) => acc + (p.stock_quantity || 0) * (p.price_usd || 0),
    0
  );

  const handleStockChange = (productId: string, val: number) => {
    setEditingStocks((prev) => ({
      ...prev,
      [productId]: Math.max(0, val),
    }));
  };

  const handleSaveItemStock = async (productId: string) => {
    const newQty = editingStocks[productId];
    if (typeof newQty === 'number') {
      await updateProductStock(productId, newQty, 'تسوية جرد فعلي');
      setEditingStocks((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      setSaveSuccessMsg('تم تحديث جرد الصنف وتوثيقه في سجل الحركات بنجاح');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    }
  };

  const handleSaveAllChanges = async () => {
    const keys = Object.keys(editingStocks);
    for (const key of keys) {
      await updateProductStock(key, editingStocks[key], 'تسوية جرد جماعي');
    }
    setEditingStocks({});
    setSaveSuccessMsg(`تم تحديث جرد ${keys.length} منتجات وتوثيق حركاتها في السجل بنجاح!`);
    setTimeout(() => setSaveSuccessMsg(null), 3500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#050505]/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl max-w-5xl w-full shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 text-slate-100">
        {/* Header */}
        <div className="p-4 sm:p-6 bg-[#121216] border-b border-[#1e1e24] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  إدارة الجرد وسجل حركات المخزون
                </h2>
                <span className="text-[11px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                  دفتر الأستاذ للمخزون
                </span>
              </div>
              <p className="text-xs text-slate-400">
                متابعة حركة البضائع، تسوية الجرد، ومطابقة الرصيد الحسابي مع الفعلي
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e1e24] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-4 sm:px-6 pt-3 bg-[#0f0f13] border-b border-[#1e1e24]">
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-2.5 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all ${
              activeTab === 'audit'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>الجرد والتسوية المباشرة</span>
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            className={`pb-2.5 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all ${
              activeTab === 'ledger'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            <span>سجل الحركات (Ledger)</span>
            <span className="bg-[#1e1e26] text-slate-300 text-[10px] px-1.5 py-0.2 rounded-full">
              {inventoryMovements.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('reconcile')}
            className={`pb-2.5 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all ${
              activeTab === 'reconcile'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>المطابقة وسلامة البيانات</span>
          </button>
        </div>

        {/* Overview Stat Cards */}
        <div className="p-4 bg-[#09090b] border-b border-[#1e1e24] grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-[#121216] rounded-xl border border-[#1e1e24]">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي الأصناف</span>
            <div className="text-base sm:text-lg font-black text-white font-mono">
              {products.length} <span className="text-xs font-normal text-slate-400">صنف</span>
            </div>
          </div>

          <div className="p-3 bg-[#121216] rounded-xl border border-[#1e1e24]">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي القطع بالمخزن</span>
            <div className="text-base sm:text-lg font-black text-emerald-400 font-mono">
              {totalItemsCount.toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">وحدة</span>
            </div>
          </div>

          <div className="p-3 bg-[#121216] rounded-xl border border-[#1e1e24]">
            <span className="text-[11px] text-slate-400 block mb-1">قيمة المخزون (ج.س)</span>
            <div className="text-sm sm:text-base font-black text-emerald-400 font-mono truncate">
              {formatMoney(totalValueSdg, 'SDG', settings)}
            </div>
          </div>

          <div className="p-3 bg-[#121216] rounded-xl border border-[#1e1e24]">
            <span className="text-[11px] text-slate-400 block mb-1">قيمة المخزون ($)</span>
            <div className="text-sm sm:text-base font-black text-white font-mono truncate">
              {formatMoney(totalValueUsd, 'USD', settings)}
            </div>
          </div>
        </div>

        {/* TAB 1: AUDIT & ADJUSTMENT */}
        {activeTab === 'audit' && (
          <>
            <div className="p-4 border-b border-[#1e1e24] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#0c0c0f]">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="بحث بالاسم أو التصنيف..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pr-9 pl-3 py-2 bg-[#121216] border border-[#1e1e24] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                <button
                  onClick={() => setFilterLowStockOnly(!filterLowStockOnly)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    filterLowStockOnly
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-[#141418] text-slate-400 hover:text-white border border-[#222228]'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>منخفض المخزون فقط ({lowStockCount})</span>
                </button>

                {Object.keys(editingStocks).length > 0 && (
                  <button
                    onClick={handleSaveAllChanges}
                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-md shadow-emerald-500/20 flex items-center gap-1.5 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>حفظ الكل ({Object.keys(editingStocks).length})</span>
                  </button>
                )}
              </div>
            </div>

            {saveSuccessMsg && (
              <div className="m-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{saveSuccessMsg}</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {filteredProducts.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Package className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">لا توجد منتجات مطابقة لخيارات البحث أو التصفية</p>
                </div>
              ) : (
                filteredProducts.map((product) => {
                  const currentStock =
                    editingStocks[product.id] !== undefined
                      ? editingStocks[product.id]
                      : product.stock_quantity ?? 0;

                  const isModified = editingStocks[product.id] !== undefined;
                  const minLimit = product.min_stock_alert ?? 5;
                  const isLow = currentStock <= minLimit && currentStock > 0;
                  const isOut = currentStock === 0;

                  return (
                    <div
                      key={product.id}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                        isModified
                          ? 'bg-[#18221b] border-emerald-500/50'
                          : isOut
                          ? 'bg-rose-950/10 border-rose-900/30'
                          : isLow
                          ? 'bg-amber-950/10 border-amber-900/30'
                          : 'bg-[#121216] border-[#1e1e24]'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                            {product.name}
                          </h4>
                          {product.category && (
                            <span className="text-[10px] text-slate-400 bg-[#1c1c24] px-2 py-0.5 rounded">
                              {product.category}
                            </span>
                          )}
                          {isOut ? (
                            <span className="text-[10px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800/40 px-2 py-0.5 rounded-full">
                              نفد المخزون (0)
                            </span>
                          ) : isLow ? (
                            <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 rounded-full">
                              منخفض (حد الأمان: {minLimit})
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                              متوفر
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400">
                          <span>
                            سعر الصنف:{' '}
                            <strong className="text-slate-200">
                              {formatMoney(product.price_sdg, 'SDG', settings)}
                            </strong>
                          </span>
                          <span>•</span>
                          <span>
                            القيمة الإجمالية بالمخزن:{' '}
                            <strong className="text-emerald-400 font-mono">
                              {formatMoney(currentStock * product.price_sdg, 'SDG', settings)}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <div className="flex items-center bg-[#09090b] border border-[#222228] rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => handleStockChange(product.id, currentStock - 1)}
                            className="p-1.5 rounded hover:bg-[#1c1c22] text-slate-400 hover:text-white"
                            title="إنقاص 1"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>

                          <input
                            type="number"
                            min="0"
                            value={currentStock}
                            onChange={(e) => handleStockChange(product.id, parseInt(e.target.value) || 0)}
                            className="w-16 text-center bg-transparent text-xs font-bold font-mono text-white focus:outline-none"
                          />

                          <button
                            type="button"
                            onClick={() => handleStockChange(product.id, currentStock + 1)}
                            className="p-1.5 rounded hover:bg-[#1c1c22] text-slate-400 hover:text-white"
                            title="زيادة 1"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <span className="text-xs text-slate-400 w-12 text-center truncate">
                          {product.unit || 'وحدة'}
                        </span>

                        {isModified && (
                          <button
                            onClick={() => handleSaveItemStock(product.id)}
                            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1 shadow-sm transition-all"
                            title="حفظ الكمية المجرودة"
                          >
                            <Save className="w-3 h-3" />
                            <span>حفظ</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* TAB 2: INVENTORY MOVEMENTS LEDGER */}
        {activeTab === 'ledger' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {inventoryMovements.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <History className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-semibold text-slate-400">لا توجد حركات مخزون مسجلة حتى الآن</p>
                <p className="text-xs text-slate-500 mt-1">
                  تُسجل الحركات تلقائياً عند إنشاء الفواتير، إبطال الفواتير، أو تسويات الجرد
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {inventoryMovements.map((mov) => {
                  const isDeduction = mov.quantity < 0;
                  return (
                    <div
                      key={mov.id}
                      className="p-3 bg-[#121216] border border-[#1e1e24] rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5"
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            isDeduction
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {isDeduction ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-white">{mov.product_name}</span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                mov.type === 'SALE'
                                  ? 'bg-blue-950 text-blue-400 border border-blue-800/40'
                                  : mov.type === 'VOID_REVERSAL'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                                  : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                              }`}
                            >
                              {mov.type === 'SALE'
                                ? 'بيع بموجب فاتورة'
                                : mov.type === 'VOID_REVERSAL'
                                ? 'إرجاع إبطال فاتورة'
                                : 'تسوية جرد فعلي'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">{mov.reason}</p>
                          <span className="text-[10px] text-slate-500">
                            {new Date(mov.created_at).toLocaleString('ar-SD')}
                          </span>
                        </div>
                      </div>

                      <div className="text-left sm:text-right w-full sm:w-auto border-t sm:border-t-0 border-[#1e1e24] pt-2 sm:pt-0">
                        <div
                          className={`font-mono font-bold text-sm ${
                            isDeduction ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {mov.quantity > 0 ? `+${mov.quantity}` : mov.quantity}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          السابق: {mov.previous_stock} ← الناتج: {mov.resulting_stock}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: RECONCILIATION & INTEGRITY */}
        {activeTab === 'reconcile' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="p-4 bg-[#14141b] border border-emerald-500/20 rounded-xl">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold mb-1">
                <ShieldCheck className="w-5 h-5" />
                <span>فحص المطابقة المحاسبية للمخزون (Audit Trail Consistency)</span>
              </div>
              <p className="text-xs text-slate-400">
                يقوم النظام باحتساب الرصيد التاريخي بناءً على الحركات المسجلة ومقارنته بالرصيد الحالي لكل صنف.
              </p>
            </div>

            <div className="space-y-2">
              {products.map((p) => {
                const rec = reconcileProductStock(p.id);
                return (
                  <div
                    key={p.id}
                    className={`p-3 rounded-xl border flex items-center justify-between ${
                      rec.isConsistent
                        ? 'bg-[#121216] border-[#1e1e24]'
                        : 'bg-rose-950/20 border-rose-900/40'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-xs text-white">{p.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        الرصيد الفعلي: <strong className="text-slate-200">{rec.currentStock}</strong> وحدة |
                        الرصيد الدفتري المحسوب:{' '}
                        <strong className="text-emerald-400">{rec.calculatedStock}</strong> وحدة
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {rec.isConsistent ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-1 rounded-lg">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>متطابق 100%</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800/40 px-2 py-1 rounded-lg">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>فارق: {rec.difference}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 bg-[#121216] border-t border-[#1e1e24] flex items-center justify-between">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>يتم توثيق كل تغيير برقم حركة وتسلسل زمني غير قابل للتعديل</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#1c1c22] hover:bg-[#25252e] text-slate-200 text-xs font-bold rounded-xl transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
