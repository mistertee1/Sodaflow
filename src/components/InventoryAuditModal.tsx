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
import { Dialog } from './Dialog';

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

  const unknownCostCount = products.filter(p => p.track_inventory && p.cost_status !== 'valued').length;
  const totalValueSdg = products.reduce(
    (acc, p) => acc + (p.track_inventory && p.cost_status === 'valued' ? p.inventory_value_sdg || 0 : 0),
    0
  );
  const totalValueUsd = products.reduce(
    (acc, p) => acc + (p.track_inventory && p.cost_status === 'valued' ? p.inventory_value_usd || 0 : 0),
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
    <Dialog label="جرد المخزون" onClose={onClose} className="fixed inset-0 z-50 bg-sf-canvas/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-sf-surface border border-sf-border rounded-xl max-w-5xl w-full shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 text-sf-text">
        {/* Header */}
        <div className="p-4 sm:p-6 bg-sf-raised border-b border-sf-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sf-action/10 border border-sf-action/30 flex items-center justify-center text-sf-action">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-semibold text-sf-text">
                  إدارة الجرد وسجل حركات المخزون
                </h2>
                <span className="text-xs font-semibold bg-sf-selected text-sf-action border border-sf-action/40 px-2 py-1 rounded-full">
                  دفتر الأستاذ للمخزون
                </span>
              </div>
              <p className="text-xs text-sf-muted">
                متابعة حركة البضائع، تسوية الجرد، ومطابقة الرصيد الحسابي مع الفعلي
              </p>
            </div>
          </div>
          <button aria-label="إغلاق النافذة"
            onClick={onClose}
            className="p-2 rounded-lg text-sf-muted hover:text-sf-text hover:bg-sf-raised transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-4 sm:px-6 pt-3 bg-sf-surface border-b border-sf-border">
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'audit'
                ? 'border-sf-action text-sf-action'
                : 'border-transparent text-sf-muted hover:text-sf-text'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>الجرد والتسوية المباشرة</span>
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'ledger'
                ? 'border-sf-action text-sf-action'
                : 'border-transparent text-sf-muted hover:text-sf-text'
            }`}
          >
            <History className="w-4 h-4" />
            <span>سجل الحركات (Ledger)</span>
            <span className="bg-sf-raised text-sf-text text-xs px-2 py-1 rounded-full">
              {inventoryMovements.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('reconcile')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'reconcile'
                ? 'border-sf-action text-sf-action'
                : 'border-transparent text-sf-muted hover:text-sf-text'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>المطابقة وسلامة البيانات</span>
          </button>
        </div>

        {/* Overview Stat Cards */}
        <div className="p-4 bg-sf-surface border-b border-sf-border grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-sf-raised rounded-xl border border-sf-border">
            <span className="text-xs text-sf-muted block mb-1">إجمالي الأصناف</span>
            <div className="text-base sm:text-lg font-semibold text-sf-text font-mono">
              {products.length} <span className="text-xs font-normal text-sf-muted">صنف</span>
            </div>
          </div>

          <div className="p-3 bg-sf-raised rounded-xl border border-sf-border">
            <span className="text-xs text-sf-muted block mb-1">إجمالي القطع بالمخزن</span>
            <div className="text-base sm:text-lg font-semibold text-sf-text font-mono">
              {totalItemsCount.toLocaleString()}{' '}
              <span className="text-xs font-normal text-sf-muted">وحدة</span>
            </div>
          </div>

          <div className="p-3 bg-sf-raised rounded-xl border border-sf-border">
            <span className="text-xs text-sf-muted block mb-1">قيمة المخزون (ج.س)</span>
            <div className="text-sm sm:text-base font-semibold text-sf-text font-mono truncate">
              {unknownCostCount ? 'التكلفة غير مكتملة' : formatMoney(totalValueSdg, 'SDG', settings)}
            </div>
          </div>

          <div className="p-3 bg-sf-raised rounded-xl border border-sf-border">
            <span className="text-xs text-sf-muted block mb-1">قيمة المخزون ($)</span>
            <div className="text-sm sm:text-base font-semibold text-sf-text font-mono truncate">
              {unknownCostCount ? 'التكلفة غير مكتملة' : formatMoney(totalValueUsd, 'USD', settings)}
            </div>
          </div>
        </div>

        {/* TAB 1: AUDIT & ADJUSTMENT */}
        {activeTab === 'audit' && (
          <>
            <div className="p-4 border-b border-sf-border flex flex-col sm:flex-row items-center justify-between gap-3 bg-sf-surface">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 absolute right-3 top-2.5 text-sf-muted" />
                <input
                  type="text"
                  placeholder="بحث بالاسم أو التصنيف..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pr-12 pl-3 py-2 bg-sf-raised border border-sf-border rounded-xl text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                <button
                  onClick={() => setFilterLowStockOnly(!filterLowStockOnly)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
                    filterLowStockOnly
                      ? 'bg-sf-warning-bg/20 text-sf-warning border border-sf-warning/30'
                      : 'bg-sf-raised text-sf-muted hover:text-sf-text border border-sf-border'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>منخفض المخزون فقط ({lowStockCount})</span>
                </button>

                {Object.keys(editingStocks).length > 0 && (
                  <button
                    onClick={handleSaveAllChanges}
                    className="px-4 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs rounded-lg shadow-md shadow-sf-action/20 flex items-center gap-2 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>حفظ الكل ({Object.keys(editingStocks).length})</span>
                  </button>
                )}
              </div>
            </div>

            {saveSuccessMsg && (
              <div className="m-4 p-3 bg-sf-action/10 border border-sf-action/30 rounded-xl text-sf-action text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{saveSuccessMsg}</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredProducts.length === 0 ? (
                <div className="text-center py-12 text-sf-muted">
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
                      className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                        isModified
                          ? 'bg-sf-raised border-sf-action/50'
                          : isOut
                          ? 'bg-sf-danger-bg/10 border-sf-danger/30'
                          : isLow
                          ? 'bg-sf-warning-bg/10 border-sf-warning/30'
                          : 'bg-sf-raised border-sf-border'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="text-xs sm:text-sm font-semibold text-sf-text truncate">
                            {product.name}
                          </h4>
                          {product.category && (
                            <span className="text-xs text-sf-muted bg-sf-raised px-2 py-1 rounded">
                              {product.category}
                            </span>
                          )}
                          {isOut ? (
                            <span className="text-xs font-semibold text-sf-danger bg-sf-danger-bg/60 border border-sf-danger/40 px-2 py-1 rounded-full">
                              نفد المخزون (0)
                            </span>
                          ) : isLow ? (
                            <span className="text-xs font-semibold text-sf-warning bg-sf-warning-bg/60 border border-sf-warning/40 px-2 py-1 rounded-full">
                              منخفض (حد الأمان: {minLimit})
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-sf-action bg-sf-selected/60 border border-sf-action/40 px-2 py-1 rounded-full">
                              متوفر
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-sf-muted">
                          <span>
                            سعر الصنف:{' '}
                            <strong className="text-sf-text">
                              {formatMoney(product.price_sdg, 'SDG', settings)}
                            </strong>
                          </span>
                          <span>•</span>
                          <span>
                            قيمة المخزون بالتكلفة:{' '}
                            <strong className="text-sf-text font-mono">
                              {product.cost_status === 'valued' ? formatMoney(product.inventory_value_sdg || 0, 'SDG', settings) : 'تكلفة غير موثقة'}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <div className="flex items-center bg-sf-surface border border-sf-border rounded-lg p-1">
                          <button
                            type="button"
                            onClick={() => handleStockChange(product.id, currentStock - 1)}
                            className="p-2 rounded hover:bg-sf-raised text-sf-muted hover:text-sf-text"
                            title="إنقاص 1"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>

                          <input
                            type="number"
                            min="0"
                            value={currentStock}
                            onChange={(e) => handleStockChange(product.id, parseInt(e.target.value) || 0)}
                            className="w-16 text-center bg-transparent text-xs font-semibold font-mono text-sf-text focus:outline-none"
                          />

                          <button
                            type="button"
                            onClick={() => handleStockChange(product.id, currentStock + 1)}
                            className="p-2 rounded hover:bg-sf-raised text-sf-muted hover:text-sf-text"
                            title="زيادة 1"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <span className="text-xs text-sf-muted w-12 text-center truncate">
                          {product.unit || 'وحدة'}
                        </span>

                        {isModified && (
                          <button
                            onClick={() => handleSaveItemStock(product.id)}
                            className="px-3 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs rounded-lg flex items-center gap-1 shadow-sm transition-all"
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
              <div className="text-center py-16 text-sf-muted">
                <History className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-semibold text-sf-muted">لا توجد حركات مخزون مسجلة حتى الآن</p>
                <p className="text-xs text-sf-muted mt-1">
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
                      className="p-3 bg-sf-raised border border-sf-border rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1 ${
                            isDeduction
                              ? 'bg-sf-danger-bg/10 text-sf-danger border border-sf-danger/20'
                              : 'bg-sf-action/10 text-sf-action border border-sf-action/20'
                          }`}
                        >
                          {isDeduction ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-sf-text">{mov.product_name}</span>
                            <span
                              className={`text-xs font-semibold px-2 py-1 rounded ${
                                mov.type === 'SALE'
                                  ? 'bg-sf-info-bg text-sf-info border border-sf-info/40'
                                  : mov.type === 'VOID_REVERSAL'
                                  ? 'bg-sf-selected text-sf-action border border-sf-action/40'
                                  : 'bg-sf-warning-bg text-sf-warning border border-sf-warning/40'
                              }`}
                            >
                              {mov.type === 'SALE'
                                ? 'بيع بموجب فاتورة'
                                : mov.type === 'VOID_REVERSAL'
                                ? 'إرجاع إبطال فاتورة'
                                : 'تسوية جرد فعلي'}
                            </span>
                          </div>
                          <p className="text-xs text-sf-muted mt-1">{mov.reason}</p>
                          <span className="text-xs text-sf-muted">
                            {new Date(mov.created_at).toLocaleString('ar-SD')}
                          </span>
                        </div>
                      </div>

                      <div className="text-left sm:text-right w-full sm:w-auto border-t sm:border-t-0 border-sf-border pt-2 sm:pt-0">
                        <div
                          className={`font-mono font-semibold text-sm ${
                            isDeduction ? 'text-sf-danger' : 'text-sf-text'
                          }`}
                        >
                          {mov.quantity > 0 ? `+${mov.quantity}` : mov.quantity}
                        </div>
                        <div className="text-xs text-sf-muted font-mono">
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
            <div className="p-4 bg-sf-raised border border-sf-action/20 rounded-xl">
              <div className="flex items-center gap-2 text-sf-action text-sm font-semibold mb-1">
                <ShieldCheck className="w-5 h-5" />
                <span>فحص المطابقة المحاسبية للمخزون (Audit Trail Consistency)</span>
              </div>
              <p className="text-xs text-sf-muted">
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
                        ? 'bg-sf-raised border-sf-border'
                        : 'bg-sf-danger-bg/20 border-sf-danger/40'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-xs text-sf-text">{p.name}</div>
                      <div className="text-xs text-sf-muted mt-1">
                        الرصيد الفعلي: <strong className="text-sf-text">{rec.currentStock}</strong> وحدة |
                        الرصيد الدفتري المحسوب:{' '}
                        <strong className="text-sf-action">{rec.calculatedStock}</strong> وحدة
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {rec.isConsistent ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-sf-action bg-sf-selected/60 border border-sf-action/40 px-2 py-1 rounded-lg">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>متطابق 100%</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-semibold text-sf-danger bg-sf-danger-bg/60 border border-sf-danger/40 px-2 py-1 rounded-lg">
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
        <div className="p-4 bg-sf-raised border-t border-sf-border flex items-center justify-between">
          <div className="text-xs text-sf-muted flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-sf-action" />
            <span>يتم توثيق كل تغيير برقم حركة وتسلسل زمني غير قابل للتعديل</span>
          </div>

          <button
            onClick={onClose}
            className="px-6 py-2 bg-sf-raised hover:bg-sf-raised text-sf-text text-xs font-semibold rounded-xl transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </Dialog>
  );
};

