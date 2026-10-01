import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Product } from '../types';
import {
  Search,
  Plus,
  Package,
  Edit2,
  Trash2,
  X,
  CheckCircle2,
  AlertTriangle,
  ClipboardList,
  Layers,
  Sparkles,
  ArrowDownUp,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { formatMoney, convertCurrency } from '../lib/currency';
import { getPlanConfig, isUnlimited } from '../lib/plans';
import { InventoryAuditModal } from './InventoryAuditModal';

export const ProductsView: React.FC = () => {
  const {
    products,
    addProduct,
    updateProduct,
    deleteProduct,
    settings,
    counters,
    subscription,
    isActionAllowed,
  } = useApp();

  const planConfig = getPlanConfig(subscription?.plan);
  const maxProducts = subscription?.max_products ?? planConfig.max_products;
  const currentProductCount = counters?.product_count ?? 0;
  const isProductLimitReached = !isUnlimited(maxProducts) && currentProductCount >= maxProducts;

  const submitLock = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Pre-configured safety threshold for low stock alert
  const [alertThreshold, setAlertThreshold] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sudanese_merchant_stock_alert_threshold');
      return saved ? Number(saved) : 10;
    } catch {
      return 10;
    }
  });

  const handleAlertThresholdChange = (val: number) => {
    setAlertThreshold(val);
    localStorage.setItem('sudanese_merchant_stock_alert_threshold', val.toString());
  };

  // Form Fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('قطعة');
  const [priceSdg, setPriceSdg] = useState<number>(0);
  const [priceUsd, setPriceUsd] = useState<number>(0);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [category, setCategory] = useState('');
  const [stockQuantity, setStockQuantity] = useState<number>(50);
  const [minStockAlert, setMinStockAlert] = useState<number>(10);
  const [trackInventory, setTrackInventory] = useState<boolean>(true);

  const rate = settings.default_exchange_rate || 0;

  const safeProducts = Array.isArray(products) ? products : [];

  // Categories list
  const categories = Array.from(
    new Set(safeProducts.map((p) => p?.category).filter(Boolean) as string[])
  );

  // Total stock items & low stock count based on either product min alert or pre-configured safety threshold
  const totalStockItems = safeProducts.reduce((sum, p) => sum + (p?.stock_quantity || 0), 0);
  
  const lowStockProductsList = safeProducts.filter((p) => {
    if (!p || typeof p.stock_quantity !== 'number') return false;
    const threshold = p.min_stock_alert ?? alertThreshold;
    return p.stock_quantity <= threshold && p.stock_quantity > 0;
  });

  const outOfStockProductsList = safeProducts.filter(
    (p) => p && typeof p.stock_quantity === 'number' && p.stock_quantity === 0
  );

  const lowStockCount = lowStockProductsList.length;
  const outOfStockCount = outOfStockProductsList.length;

  const filteredProducts = safeProducts.filter((p) => {
    if (!p) return false;
    const matchesSearch =
      (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;

    const currentQty = p.stock_quantity ?? 0;
    const effectiveAlert = p.min_stock_alert ?? alertThreshold;

    let matchesStock = true;
    if (stockFilter === 'low') {
      matchesStock = currentQty <= effectiveAlert && currentQty > 0;
    } else if (stockFilter === 'out') {
      matchesStock = currentQty === 0;
    }

    return matchesSearch && matchesCategory && matchesStock;
  });

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setName('');
    setDescription('');
    setUnit('قطعة');
    setPriceSdg(0);
    setPriceUsd(0);
    setTaxRate(0);
    setCategory('');
    setStockQuantity(50);
    setMinStockAlert(10);
    setTrackInventory(true);
    setModalError(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setDescription(p.description || '');
    setUnit(p.unit);
    setPriceSdg(p.price_sdg);
    setPriceUsd(p.price_usd);
    setTaxRate(p.tax_rate);
    setCategory(p.category || '');
    setStockQuantity(p.stock_quantity ?? 0);
    setMinStockAlert(p.min_stock_alert ?? 10);
    setTrackInventory(p.track_inventory ?? true);
    setModalError(null);
    setIsAddModalOpen(true);
  };

  // Sync SDG price to USD
  const handleSyncPriceToUsd = () => {
    if (priceSdg > 0 && rate > 0) {
      setPriceUsd(convertCurrency(priceSdg, 'SDG', 'USD', rate, settings));
    }
  };

  // Sync USD price to SDG
  const handleSyncPriceToSdg = () => {
    if (priceUsd > 0 && rate > 0) {
      setPriceSdg(convertCurrency(priceUsd, 'USD', 'SDG', rate, settings));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    if (!name.trim()) return;

    if (!editingProduct && isProductLimitReached) {
      setModalError(
        `عذراً، لقد استنفدت الحد الأقصى المسموح به للمنتجات في باقتك الحالية (${currentProductCount}/${maxProducts} منتج). يرجى ترقية باقة اشتراكك لإضافة منتجات جديدة.`
      );
      return;
    }

    submitLock.current = true; setIsSaving(true);
    try {
      setModalError(null);
      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          name: name.trim(),
          description: description.trim() || '',
          unit: unit.trim() || 'قطعة',
          price_sdg: Number(priceSdg),
          price_usd: Number(priceUsd),
          tax_rate: Number(taxRate),
          category: category.trim() || '',
          min_stock_alert: Number(minStockAlert),
        });
      } else {
        await addProduct({
          name: name.trim(),
          description: description.trim() || '',
          unit: unit.trim() || 'قطعة',
          price_sdg: Number(priceSdg),
          price_usd: Number(priceUsd),
          tax_rate: Number(taxRate),
          category: category.trim() || '',
          is_active: true,
          stock_quantity: Number(stockQuantity),
          min_stock_alert: Number(minStockAlert),
          track_inventory: trackInventory,
        });
      }

      setIsAddModalOpen(false);
    } catch (err: any) {
      setModalError(err.message || 'حدث خطأ أثناء حفظ المنتج');
    } finally { submitLock.current = false; setIsSaving(false); }
  };

  const handleDelete = async (id: string, prodName: string) => {
    if (window.confirm(`هل أنت متأكد من حذف المنتج "${prodName}"؟`)) {
      try { await deleteProduct(id); } catch (error) { setModalError(error instanceof Error ? error.message : "تعذر الحذف."); }
    }
  };

  return (
    <div className="space-y-5 pb-16">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-sf-surface p-4 sm:p-5 rounded-2xl border border-sf-border shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-sf-text">كتالوج المنتجات وإدارة المخزون</h2>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-sf-selected/70 text-sf-action border border-sf-action/40">
              جرد تلقائي
            </span>
          </div>
          <p className="text-xs text-sf-muted mt-0.5">
            تحديد الأسعار بالعملتين، ومتابعة الكميات المتبقية مع خصم آلي عند إصدار كل فاتورة
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            disabled={!isActionAllowed('products:stock_adjustment')} onClick={() => setIsAuditModalOpen(true)}
            className="bg-sf-raised hover:bg-sf-raised text-sf-action border border-sf-action/30 text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95"
          >
            <ClipboardList className="w-4 h-4 text-sf-action" />
            <span>جرد المخزون</span>
          </button>

          <button
            disabled={!isActionAllowed('products:create')} onClick={handleOpenAdd}
            className="bg-sf-action hover:bg-sf-action-hover text-sf-on-action text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-sf-action/20 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 text-sf-on-action" />
            <span>إضافة منتج جديد</span>
          </button>
        </div>
      </div>

      {/* Stock Summary Mini Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-sf-surface rounded-xl border border-sf-border">
          <span className="text-[11px] text-sf-muted block mb-0.5">إجمالي الأصناف المسجلة</span>
          <div className="text-lg font-black text-sf-text font-mono">{products.length} صنف</div>
        </div>

        <div className="p-3 bg-sf-surface rounded-xl border border-sf-border">
          <span className="text-[11px] text-sf-muted block mb-0.5">إجمالي القطع في المخزن</span>
          <div className="text-lg font-black text-sf-action font-mono">
            {totalStockItems.toLocaleString()} وحدة
          </div>
        </div>

        <button
          onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
          className={`p-3 rounded-xl border text-right transition-all ${
            stockFilter === 'low'
              ? 'bg-sf-warning-bg/50 border-sf-warning/60 ring-1 ring-amber-500/30'
              : 'bg-sf-surface border-sf-border hover:border-sf-border'
          }`}
        >
          <span className="text-[11px] text-sf-muted block mb-0.5">أصناف منخفضة (أقل من {alertThreshold})</span>
          <div className="text-lg font-black text-sf-warning font-mono flex items-center justify-between">
            <span>{lowStockCount} أصناف</span>
            {lowStockCount > 0 && <AlertTriangle className="w-4 h-4 text-sf-warning animate-pulse" />}
          </div>
        </button>

        <button
          onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')}
          className={`p-3 rounded-xl border text-right transition-all ${
            stockFilter === 'out'
              ? 'bg-sf-danger-bg/50 border-sf-danger/60 ring-1 ring-rose-500/30'
              : 'bg-sf-surface border-sf-border hover:border-sf-border'
          }`}
        >
          <span className="text-[11px] text-sf-muted block mb-0.5">نفد من المخزن (0)</span>
          <div className="text-lg font-black text-sf-danger font-mono flex items-center justify-between">
            <span>{outOfStockCount} أصناف</span>
            {outOfStockCount > 0 && <AlertTriangle className="w-4 h-4 text-sf-danger animate-pulse" />}
          </div>
        </button>
      </div>

      {/* Pre-configured Safety Threshold & Quick Alert Bar */}
      <div className="bg-sf-surface border border-sf-border p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-sf-warning-bg/10 text-sf-warning border border-sf-warning/20">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-sf-text flex items-center gap-1.5">
              <span>حد التنبيه المسبق لنقص المخزون:</span>
              <span className="font-mono text-sf-action bg-sf-selected/60 px-2 py-0.5 rounded-md border border-sf-action/40">
                {alertThreshold} وحدة
              </span>
            </h4>
            <p className="text-[11px] text-sf-muted">
              يتم إبراز أي صنف يقل رصيده عن هذا الحد تلقائياً بعلامة تحذيرية
            </p>
          </div>
        </div>

        {/* Quick Threshold Presets */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-sf-muted">تغيير الحد:</span>
          {[5, 10, 15, 20, 30, 50].map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => handleAlertThresholdChange(val)}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg border transition-all ${
                alertThreshold === val
                  ? 'bg-sf-action text-sf-on-action border-sf-action shadow-sm shadow-sf-action/20'
                  : 'bg-sf-raised text-sf-text border-sf-border hover:border-sf-border'
              }`}
            >
              {val}
            </button>
          ))}
          <div className="flex items-center gap-1 mr-1">
            <input
              type="number"
              min="1"
              max="999"
              value={alertThreshold}
              onChange={(e) => handleAlertThresholdChange(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 bg-sf-raised border border-sf-border text-sf-text text-xs font-mono px-2 py-1 rounded-lg text-center focus:outline-none focus:border-sf-action"
              title="تحديد حد مخصص"
            />
            <span className="text-[10px] text-sf-muted">قطعة</span>
          </div>
        </div>
      </div>

      {/* Prominent Alert Banner when critical products exist */}
      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="bg-gradient-to-r from-amber-950/40 via-sf-ink to-rose-950/30 border border-sf-warning/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md shadow-amber-950/20 animate-in fade-in">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-sf-warning-bg/20 text-sf-warning shrink-0">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-bold text-sm text-sf-text">
                  تنبيه: تم رصد {lowStockCount + outOfStockCount} صنف بحاجة لتوريد عاجل
                </h4>
                {outOfStockCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-sf-danger-bg text-sf-danger border border-sf-danger/50 text-[10px] font-bold">
                    {outOfStockCount} صنف نافد تماماً
                  </span>
                )}
                {lowStockCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-sf-warning-bg text-sf-warning border border-sf-warning/50 text-[10px] font-bold">
                    {lowStockCount} صنف أقل من حد الأمان ({alertThreshold})
                  </span>
                )}
              </div>
              <p className="text-xs text-sf-text mt-0.5">
                يمكنك مراجعة وتعديل الكميات مباشرة من بطاقة كل منتج أو فتح شاشة الجرد الشامل.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                stockFilter === 'low'
                  ? 'bg-sf-warning-bg text-sf-warning border-sf-warning'
                  : 'bg-sf-warning-bg/15 text-sf-warning hover:bg-sf-warning-bg/25 border-sf-warning/40'
              }`}
            >
              {stockFilter === 'low' ? 'إلغاء التصفية' : 'إبراز المنخفضة فقط'}
            </button>
            <button
              disabled={!isActionAllowed('products:stock_adjustment')} onClick={() => setIsAuditModalOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-sf-action/15 text-sf-action hover:bg-sf-action/25 border border-sf-action/40 transition-all flex items-center gap-1.5"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>جرد وتوريد</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-sf-muted absolute right-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث عن منتج بالاسم أو الوصف أو الفئة..."
            className="w-full bg-sf-surface border border-sf-border rounded-xl pr-9 pl-4 py-2.5 text-xs sm:text-sm text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action shadow-sm"
          />
        </div>

        {categories.length > 0 && (
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-sf-surface border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action shadow-sm"
          >
            <option value="all">كافة الفئات</option>
            {(categories || []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        {stockFilter !== 'all' && (
          <button
            onClick={() => setStockFilter('all')}
            className="px-3 py-2 bg-sf-raised text-sf-text hover:text-sf-text border border-sf-border rounded-xl text-xs flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            <span>إلغاء تصفية المخزون</span>
          </button>
        )}
      </div>

      {/* Products Grid */}
      {safeProducts.length === 0 ? (
        <div className="bg-sf-surface border border-sf-border rounded-2xl p-12 text-center text-sf-muted shadow-sm">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-40 text-sf-muted" />
          <p className="text-base font-bold text-sf-text mb-1">لا توجد أصناف أو بضائع في المخزون حتى الآن</p>
          <p className="text-xs text-sf-muted max-w-md mx-auto mb-5">
            أضف منتجاتك وبضائعك مع تحديد أسعار البيع بالجنيه والدولار، وحدود الأمان لجرد المخازن.
          </p>
          <button
            disabled={!isActionAllowed('products:create')} onClick={handleOpenAdd}
            className="px-5 py-2.5 bg-sf-action hover:bg-sf-action-hover text-sf-on-action text-xs sm:text-sm font-black rounded-xl shadow-lg shadow-sf-action/20 inline-flex items-center gap-2 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 text-sf-on-action" />
            <span>+ إضافة أول منتج</span>
          </button>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="bg-sf-surface border border-sf-border rounded-2xl p-10 text-center text-sf-muted shadow-sm">
          <Package className="w-10 h-10 mx-auto mb-2 text-sf-muted" />
          <p className="text-sm font-medium text-sf-text">لم يتم العثور على أي منتجات مطابقة</p>
          <button
            disabled={!isActionAllowed('products:create')} onClick={handleOpenAdd}
            className="mt-3 text-xs text-sf-action hover:underline font-bold"
          >
            + إضافة منتج جديد الآن
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {(filteredProducts || []).map((p) => {
            const currentStock = p.stock_quantity ?? 0;
            const minAlert = p.min_stock_alert ?? alertThreshold;
            const isOut = currentStock === 0;
            const isLow = currentStock <= minAlert && currentStock > 0;

            return (
              <div
                key={p.id}
                className={`bg-sf-surface border rounded-2xl p-4 shadow-sm flex flex-col justify-between transition-all ${
                  isOut
                    ? 'border-sf-danger/70 bg-gradient-to-b from-rose-950/35 to-sf-ink ring-1 ring-rose-500/40 shadow-lg shadow-rose-950/30'
                    : isLow
                    ? 'border-sf-warning/70 bg-gradient-to-b from-amber-950/30 to-sf-ink ring-1 ring-amber-500/40 shadow-lg shadow-amber-950/20'
                    : 'border-sf-border hover:border-sf-border'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h3 className="font-bold text-sm text-sf-text leading-snug flex items-center gap-1.5 flex-wrap">
                      <span>{p.name}</span>
                      {isOut && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sf-danger-bg/90 border border-sf-danger/80 text-sf-danger text-[10px] font-bold animate-pulse shadow-xs">
                          <AlertTriangle className="w-3.5 h-3.5 text-sf-danger shrink-0" />
                          <span>نافد</span>
                        </span>
                      )}
                      {isLow && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sf-warning-bg/90 border border-sf-warning/80 text-sf-warning text-[10px] font-bold animate-pulse shadow-xs">
                          <AlertTriangle className="w-3.5 h-3.5 text-sf-warning shrink-0" />
                          <span>تنبيه نقص</span>
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        disabled={!isActionAllowed('products:update')} onClick={() => handleOpenEdit(p)}
                        className="p-1.5 text-sf-muted hover:text-sf-text hover:bg-sf-raised rounded-lg transition-colors"
                        title="تعديل المنتج والكمية"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={!isActionAllowed('products:delete')} onClick={() => handleDelete(p.id, p.name)}
                        className="p-1.5 text-sf-muted hover:text-sf-danger hover:bg-sf-danger-bg/30 rounded-lg transition-colors"
                        title="حذف المنتج"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {p.description && (
                    <p className="text-xs text-sf-muted mb-2 line-clamp-2">{p.description}</p>
                  )}

                  <div className="flex items-center gap-2 flex-wrap text-[11px] mb-3">
                    <span className="bg-sf-raised border border-sf-border text-sf-text px-2 py-0.5 rounded-md font-medium">
                      الوحدة: {p.unit}
                    </span>
                    {p.category && (
                      <span className="bg-sf-raised text-sf-action px-2 py-0.5 rounded-md font-semibold border border-sf-action/20">
                        {p.category}
                      </span>
                    )}
                  </div>

                  {/* Stock Level Badge */}
                  <div className="mb-3">
                    {isOut ? (
                      <div className="text-[11px] font-bold text-sf-danger bg-sf-danger-bg/60 border border-sf-danger/40 px-2.5 py-1 rounded-xl flex items-center justify-between">
                        <span>نفد من المخزن</span>
                        <span className="font-mono">0 {p.unit}</span>
                      </div>
                    ) : isLow ? (
                      <div className="text-[11px] font-bold text-sf-warning bg-sf-warning-bg/60 border border-sf-warning/40 px-2.5 py-1 rounded-xl flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          مخزون منخفض (حد الأمان {minAlert})
                        </span>
                        <span className="font-mono">{currentStock} {p.unit}</span>
                      </div>
                    ) : (
                      <div className="text-[11px] font-bold text-sf-action bg-sf-selected/60 border border-sf-action/40 px-2.5 py-1 rounded-xl flex items-center justify-between">
                        <span>المتبقي في المخزن</span>
                        <span className="font-mono">{currentStock} {p.unit}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Price Box */}
                <div className="bg-sf-raised p-2.5 rounded-xl border border-sf-border flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-sf-muted block">السعر بالجنيه:</span>
                    <span className="font-mono font-bold text-sm text-sf-text">
                      {formatMoney(p.price_sdg, 'SDG', settings)}
                    </span>
                  </div>
                  <div className="text-left">
                    <span className="text-[10px] text-sf-muted block">السعر بالدولار:</span>
                    <span className="font-mono font-bold text-xs text-sf-action">
                      {formatMoney(p.price_usd, 'USD', settings)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-sf-surface rounded-2xl shadow-2xl border border-sf-border max-w-md w-full p-5 sm:p-6 animate-in fade-in zoom-in-95 text-xs sm:text-sm text-sf-text my-auto">
            <div className="flex items-center justify-between border-b border-sf-border pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-sf-action/10 text-sf-action">
                  <Package className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-sf-text">
                  {editingProduct ? 'تعديل المنتج وبيانات المخزون' : 'إضافة منتج وتحديد المخزون'}
                </h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-sf-muted hover:text-sf-text hover:bg-sf-raised rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!editingProduct && isProductLimitReached && (
              <div className="mb-4 p-3 bg-sf-warning-bg/50 border border-sf-warning/60 rounded-xl text-sf-warning text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-sf-warning shrink-0" />
                <span>
                  عذراً، لقد استنفدت الحد المسموح به للمنتجات في باقتك الحالية ({currentProductCount}/{maxProducts} منتج). يرجى ترقية باقة اشتراكك من الإعدادات لإضافة منتجات جديدة.
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
                  اسم المنتج أو الخدمة *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: سكر كنانة (جوال 50 كيلو)"
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-sf-text mb-1 text-xs">وحدة القياس</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="قطعة، جوال، كرتونة، شوال..."
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-sf-text mb-1 text-xs">الفئة / التصنيف</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="مواد غذائية، مشروبات..."
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
                  />
                </div>
              </div>

              {/* INVENTORY TRACKING INPUTS */}
              <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      id="trackInv"
                      checked={trackInventory}
                      disabled={!!editingProduct}
                      onChange={(e) => setTrackInventory(e.target.checked)}
                      className="rounded accent-sf-action text-sf-action w-4 h-4 cursor-pointer"
                    />
                    <label htmlFor="trackInv" className="font-bold text-xs text-sf-text cursor-pointer">
                      تفعيل مراقبة وجرد المخزون التلقائي
                    </label>
                  </div>
                  <span className="text-[10px] text-sf-action bg-sf-selected/60 px-2 py-0.5 rounded border border-sf-action/40">
                    خصم تلقائي عند البيع
                  </span>
                </div>

                {trackInventory && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-sf-text mb-1">
                        الكمية الحالية في المخزن
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={stockQuantity}
                        disabled={!!editingProduct}
                        onChange={(e) => setStockQuantity(Number(e.target.value))}
                        className="w-full bg-sf-surface border border-sf-border rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-sf-action focus:outline-none focus:border-sf-action"
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-sf-text mb-1">
                        حد التنبيه عند النقصان
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={minStockAlert}
                        onChange={(e) => setMinStockAlert(Number(e.target.value))}
                        className="w-full bg-sf-surface border border-sf-border rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-sf-warning focus:outline-none focus:border-sf-action"
                        placeholder="10"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Dual Price Inputs with Auto Sync */}
              <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-sf-text">تحديد الأسعار بالعملتين</span>
                  <span className="text-[10px] text-sf-warning bg-sf-warning-bg/60 px-2 py-0.5 rounded border border-sf-warning/40">
                    {rate > 0 ? `1$ = ${formatMoney(rate, 'SDG', settings)}` : 'سعر الصرف غير محدد بالإعدادات'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <label className="block text-[11px] font-semibold text-sf-text mb-1">
                      السعر بالجنيه (ج.س)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={priceSdg}
                      onChange={(e) => setPriceSdg(Number(e.target.value))}
                      className="w-full bg-sf-surface border border-sf-border rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-sf-text focus:outline-none focus:border-sf-action"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-sf-text mb-1">
                      السعر بالدولار ($)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={priceUsd}
                      onChange={(e) => setPriceUsd(Number(e.target.value))}
                      className="w-full bg-sf-surface border border-sf-border rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-sf-action focus:outline-none focus:border-sf-action"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1">
                  <button
                    type="button"
                    onClick={handleSyncPriceToUsd}
                    className="text-sf-action hover:underline flex items-center gap-1 font-semibold"
                  >
                    <span>احسب الدولار من الجنيه</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncPriceToSdg}
                    className="text-sf-muted hover:text-sf-text hover:underline flex items-center gap-1 font-medium"
                  >
                    <span>احسب الجنيه من الدولار</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">الوصف (اختياري)</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="وصف مختصر للمنتج أو المواصفات..."
                  className="w-full bg-sf-raised border border-sf-border rounded-xl p-2 text-xs text-sf-text placeholder-slate-500 focus:outline-none focus:border-sf-action"
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
                  disabled={isSaving || !editingProduct && isProductLimitReached}
                  className={`px-5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                    !editingProduct && isProductLimitReached
                      ? 'bg-sf-raised text-sf-muted cursor-not-allowed border border-sf-border'
                      : 'bg-sf-action hover:bg-sf-action-hover text-sf-on-action shadow-lg shadow-sf-action/20 active:scale-95'
                  }`}
                >
                  {!editingProduct && isProductLimitReached ? (
                    <>
                      <Lock className="w-4 h-4 text-sf-muted" />
                      <span>تم استنفاد باقة المنتجات</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-sf-on-action" />
                      <span>{editingProduct ? 'حفظ التعديلات' : 'إضافة المنتج'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inventory Audit Modal */}
      <InventoryAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
      />
    </div>
  );
};
