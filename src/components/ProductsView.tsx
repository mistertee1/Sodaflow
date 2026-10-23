import { useDisplayMoney } from '../context/useDisplayMoney';
import { assertAvailableProductName, productDuplicateGroups } from '../domain/productIdentity';
import BigNumber from 'bignumber.js';
import { productPriceQuote, productPricingMode } from '../domain/productPricing';
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
import { convertCurrency } from '../lib/currency';
import { getPlanConfig, isUnlimited } from '../lib/plans';
import { acquisitionCost } from '../domain/inventoryCost';
import { PayablesCenter } from './accounting/PayablesCenter';
import { InventoryCostCenter } from './InventoryCostCenter';
import { InventoryAuditModal } from './InventoryAuditModal';
import { Dialog } from './Dialog';

export const ProductsView: React.FC = () => {
  const { formatMoney, pair, nativeMoney, enabled, code: displayCode } = useDisplayMoney();
  const {
    currentOrg,
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
  const [showPurchasing, setShowPurchasing] = useState(false);
  const [openingCost, setOpeningCost] = useState(0);
  const [costCurrency, setCostCurrency] = useState<'SDG' | 'USD'>('SDG');
  const [costRate, setCostRate] = useState(settings.default_exchange_rate || 0);
  const [zeroCostReason, setZeroCostReason] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Pre-configured safety threshold for low stock alert
  const [alertThreshold, setAlertThreshold] = useState<number>(10);
  const handleAlertThresholdChange = (val: number) => setAlertThreshold(val);

  // Form Fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('قطعة');
  const [priceSdg, setPriceSdg] = useState<number>(0);
  const [priceUsd, setPriceUsd] = useState<number>(0);
  const [pricingMode, setPricingMode] = useState<NonNullable<Product['pricing_mode']>>('usd_reference');
  const [markupPercent, setMarkupPercent] = useState(0);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [category, setCategory] = useState('');
  const [stockQuantity, setStockQuantity] = useState<number>(50);
  const [minStockAlert, setMinStockAlert] = useState<number>(10);
  const [trackInventory, setTrackInventory] = useState<boolean>(true);

  const rate = settings.manual_exchange_rate && settings.manual_exchange_rate > 0 ? settings.manual_exchange_rate : settings.default_exchange_rate || 0;

  let openingValue: { sdg: number; usd: number } | null = null, openingCostError = '';
  if (!editingProduct && trackInventory && currentOrg?.accounting_version === 2 && stockQuantity > 0) {
    try { openingValue = acquisitionCost(stockQuantity, { cost_currency: costCurrency, unit_cost: openingCost, exchange_rate_used: costRate, zero_cost_reason: zeroCostReason }); }
    catch (error) { openingCostError = error instanceof Error ? error.message : 'راجع التكلفة.'; }
  }

  const safeProducts = Array.isArray(products) ? products : [];
  const duplicateGroups = productDuplicateGroups(safeProducts);
  const duplicateIds = new Set(duplicateGroups.flatMap(group => group.products.map(product => product.id)));

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

    return matchesSearch && matchesCategory && matchesStock && (!showDuplicatesOnly || !duplicateGroups.length || duplicateIds.has(p.id));
  });

  const handleOpenAdd = () => {
    setOpeningCost(0); setCostCurrency('SDG'); setCostRate(settings.default_exchange_rate || 0); setZeroCostReason('');
    setEditingProduct(null);
    setName('');
    setDescription('');
    setUnit('قطعة');
    setPriceSdg(0);
    setPriceUsd(0);
    setPricingMode(currentOrg?.accounting_version === 2 ? 'usd_cost_plus' : 'usd_reference'); setMarkupPercent(0);
    setTaxRate(0);
    setCategory('');
    setStockQuantity(currentOrg?.accounting_version === 2 ? 0 : 50);
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
    setPriceUsd(p.pricing_reference_usd ?? p.price_usd);
    setPricingMode(productPricingMode(p)); setMarkupPercent(p.pricing_markup_percent ?? 0);
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
      setPriceUsd(new BigNumber(priceSdg).div(rate).decimalPlaces(8, BigNumber.ROUND_HALF_UP).toNumber());
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
      assertAvailableProductName(safeProducts, name, editingProduct?.id, editingProduct?.name);
      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          name: name.trim(),
          description: description.trim() || '',
          unit: unit.trim() || 'قطعة',
          price_sdg: Number(priceSdg),
          price_usd: new BigNumber(priceUsd).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toNumber(),
          pricing_mode: pricingMode, pricing_reference_usd: priceUsd, pricing_markup_percent: markupPercent,
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
          price_usd: new BigNumber(priceUsd).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toNumber(),
          pricing_mode: pricingMode, pricing_reference_usd: priceUsd, pricing_markup_percent: markupPercent,
          tax_rate: Number(taxRate),
          category: category.trim() || '',
          is_active: true,
          stock_quantity: Number(stockQuantity),
          ...(currentOrg?.accounting_version === 2 && trackInventory && stockQuantity > 0 ? { cost_currency: costCurrency, unit_cost: openingCost, exchange_rate_used: costRate, zero_cost_reason: zeroCostReason } : {}),
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
    <div className="space-y-6 pb-16">
      <InventoryCostCenter />
      {isActionAllowed('payables:read') && <section className="space-y-3"><button type="button" className="sf-secondary" aria-expanded={showPurchasing} onClick={() => setShowPurchasing(value => !value)}>الموردون ومنتجاتهم والمشتريات والذمم الدائنة</button>{showPurchasing && <PayablesCenter key={currentOrg?.id} />}</section>}
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-sf-surface p-4 sm:p-6 rounded-xl border border-sf-border shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-sf-text">كتالوج المنتجات وإدارة المخزون</h2>
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-sf-selected/70 text-sf-action border border-sf-action/40">
              جرد تلقائي
            </span>
          </div>
          <p className="text-xs text-sf-muted mt-1">
            تحديد الأسعار بالعملتين، ومتابعة الكميات المتبقية مع خصم آلي عند إصدار كل فاتورة
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            disabled={!isActionAllowed('products:stock_adjustment')} onClick={() => setIsAuditModalOpen(true)}
            className="bg-sf-raised hover:bg-sf-raised text-sf-action border border-sf-action/30 text-xs sm:text-sm font-semibold px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm "
          >
            <ClipboardList className="w-4 h-4 text-sf-action" />
            <span>جرد المخزون</span>
          </button>

          <button
            disabled={!isActionAllowed('products:create')} onClick={handleOpenAdd}
            className="bg-sf-action hover:bg-sf-action-hover text-sf-on-action text-xs sm:text-sm font-semibold px-4 py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-sf-action/20 transition-all "
          >
            <Plus className="w-4 h-4 text-sf-on-action" />
            <span>إضافة منتج جديد</span>
          </button>
        </div>
      </div>

      {/* Stock Summary Mini Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-sf-surface rounded-xl border border-sf-border">
          <span className="text-xs text-sf-muted block mb-1">إجمالي الأصناف المسجلة</span>
          <div className="text-lg font-semibold text-sf-text font-mono">{products.length} صنف</div>
        </div>

        <div className="p-3 bg-sf-surface rounded-xl border border-sf-border">
          <span className="text-xs text-sf-muted block mb-1">إجمالي القطع في المخزن</span>
          <div className="text-lg font-semibold text-sf-text font-mono">
            {totalStockItems.toLocaleString()} وحدة
          </div>
        </div>

        <button
          onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
          className={`p-3 rounded-xl border text-right transition-all ${
            stockFilter === 'low'
              ? 'bg-sf-warning-bg/50 border-sf-warning/60 ring-1 ring-sf-warning'
              : 'bg-sf-surface border-sf-border hover:border-sf-border'
          }`}
        >
          <span className="text-xs text-sf-muted block mb-1">أصناف منخفضة (أقل من {alertThreshold})</span>
          <div className="text-lg font-semibold text-sf-warning font-mono flex items-center justify-between">
            <span>{lowStockCount} أصناف</span>
            {lowStockCount > 0 && <AlertTriangle className="w-4 h-4 text-sf-warning animate-pulse" />}
          </div>
        </button>

        <button
          onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')}
          className={`p-3 rounded-xl border text-right transition-all ${
            stockFilter === 'out'
              ? 'bg-sf-danger-bg/50 border-sf-danger/60 ring-1 ring-sf-danger'
              : 'bg-sf-surface border-sf-border hover:border-sf-border'
          }`}
        >
          <span className="text-xs text-sf-muted block mb-1">نفد من المخزن (0)</span>
          <div className="text-lg font-semibold text-sf-danger font-mono flex items-center justify-between">
            <span>{outOfStockCount} أصناف</span>
            {outOfStockCount > 0 && <AlertTriangle className="w-4 h-4 text-sf-danger animate-pulse" />}
          </div>
        </button>
      </div>

      {/* Pre-configured Safety Threshold & Quick Alert Bar */}
      <div className="bg-sf-surface border border-sf-border p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sf-warning-bg/10 text-sf-warning border border-sf-warning/20">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-sf-text flex items-center gap-2">
              <span>حد التنبيه المسبق لنقص المخزون:</span>
              <span className="font-mono text-sf-text bg-sf-selected/60 px-2 py-1 rounded-md border border-sf-action/40">
                {alertThreshold} وحدة
              </span>
            </h4>
            <p className="text-xs text-sf-muted">
              يتم إبراز أي صنف يقل رصيده عن هذا الحد تلقائياً بعلامة تحذيرية
            </p>
          </div>
        </div>

        {/* Quick Threshold Presets */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-sf-muted">تغيير الحد:</span>
          {[5, 10, 15, 20, 30, 50].map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => handleAlertThresholdChange(val)}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg border transition-all ${
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
            <span className="text-xs text-sf-muted">قطعة</span>
          </div>
        </div>
      </div>

      {/* Prominent Alert Banner when critical products exist */}
      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="bg-sf-warning-bg border border-sf-warning rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md shadow-none animate-in fade-in">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-sf-warning-bg/20 text-sf-warning shrink-0">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-semibold text-sm text-sf-text">
                  تنبيه: تم رصد {lowStockCount + outOfStockCount} صنف بحاجة لتوريد عاجل
                </h4>
                {outOfStockCount > 0 && (
                  <span className="px-2 py-1 rounded-full bg-sf-danger-bg text-sf-danger border border-sf-danger/50 text-xs font-semibold">
                    {outOfStockCount} صنف نافد تماماً
                  </span>
                )}
                {lowStockCount > 0 && (
                  <span className="px-2 py-1 rounded-full bg-sf-warning-bg text-sf-warning border border-sf-warning/50 text-xs font-semibold">
                    {lowStockCount} صنف أقل من حد الأمان ({alertThreshold})
                  </span>
                )}
              </div>
              <p className="text-xs text-sf-text mt-1">
                يمكنك مراجعة وتعديل الكميات مباشرة من بطاقة كل منتج أو فتح شاشة الجرد الشامل.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                stockFilter === 'low'
                  ? 'bg-sf-warning-bg text-sf-warning border-sf-warning'
                  : 'bg-sf-warning-bg/15 text-sf-warning hover:bg-sf-warning-bg/25 border-sf-warning/40'
              }`}
            >
              {stockFilter === 'low' ? 'إلغاء التصفية' : 'إبراز المنخفضة فقط'}
            </button>
            <button
              disabled={!isActionAllowed('products:stock_adjustment')} onClick={() => setIsAuditModalOpen(true)}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-sf-action/15 text-sf-action hover:bg-sf-action/25 border border-sf-action/40 transition-all flex items-center gap-2"
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
            className="w-full bg-sf-surface border border-sf-border rounded-xl pr-12 pl-4 py-3 text-xs sm:text-sm text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action shadow-sm"
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
            className="px-3 py-2 bg-sf-raised text-sf-text hover:text-sf-text border border-sf-border rounded-xl text-xs flex items-center gap-2"
          >
            <X className="w-3.5 h-3.5" />
            <span>إلغاء تصفية المخزون</span>
          </button>
        )}
      </div>

      {/* Products Grid */}
      {duplicateGroups.length > 0 && <section role="region" aria-label="مراجعة المنتجات المكررة" className="rounded-xl border border-sf-warning/40 bg-sf-warning-bg p-4 space-y-2">
        <h3 className="text-sm font-semibold">منتجات مكررة تحتاج مراجعة: {duplicateGroups.length} أسماء</h3>
        <p className="text-xs">{duplicateGroups.slice(0, 3).map(group => group.products[0].name).join('، ')} — النسخ القديمة محتفظة بأرقامها وحركاتها. راجع أسماء الأصناف المختلفة؛ لاستلام كمية استخدم المنتج الموجود.</p>
        <button type="button" onClick={() => { if (!showDuplicatesOnly) { setSearchTerm(''); setSelectedCategory('all'); setStockFilter('all'); } setShowDuplicatesOnly(!showDuplicatesOnly); }} className="text-xs font-semibold underline">{showDuplicatesOnly ? 'إظهار كل المنتجات' : 'عرض المنتجات المكررة'}</button>
      </section>}

      {safeProducts.length === 0 ? (
        <div className="bg-sf-surface border border-sf-border rounded-xl p-12 text-center text-sf-muted shadow-sm">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-40 text-sf-muted" />
          <p className="text-base font-semibold text-sf-text mb-1">لا توجد أصناف أو بضائع في المخزون حتى الآن</p>
          <p className="text-xs text-sf-muted max-w-md mx-auto mb-6">
            أضف منتجاتك وبضائعك مع تحديد أسعار البيع بالجنيه والدولار، وحدود الأمان لجرد المخازن.
          </p>
          <button
            disabled={!isActionAllowed('products:create')} onClick={handleOpenAdd}
            className="px-6 py-3 bg-sf-action hover:bg-sf-action-hover text-sf-on-action text-xs sm:text-sm font-semibold rounded-xl shadow-lg shadow-sf-action/20 inline-flex items-center gap-2 transition-all "
          >
            <Plus className="w-4 h-4 text-sf-on-action" />
            <span>+ إضافة أول منتج</span>
          </button>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="bg-sf-surface border border-sf-border rounded-xl p-12 text-center text-sf-muted shadow-sm">
          <Package className="w-10 h-10 mx-auto mb-2 text-sf-muted" />
          <p className="text-sm font-medium text-sf-text">لم يتم العثور على أي منتجات مطابقة</p>
          <button
            disabled={!isActionAllowed('products:create')} onClick={handleOpenAdd}
            className="mt-3 text-xs text-sf-action hover:underline font-semibold"
          >
            + إضافة منتج جديد الآن
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(filteredProducts || []).map((p) => {
            const currentStock = p.stock_quantity ?? 0;
            const minAlert = p.min_stock_alert ?? alertThreshold;
            const isOut = currentStock === 0;
            const isLow = currentStock <= minAlert && currentStock > 0;
            let localPrice: number | undefined = p.price_sdg, usdPrice: number | undefined = p.price_usd, priceError = '';
            if (productPricingMode(p) !== 'manual') {
              try { const quote = productPriceQuote(p, 'SDG', rate, settings.currency_rates, settings.rounding_rule); localPrice = quote.unit_price; usdPrice = quote.evidence.reference_usd; }
              catch (error) { localPrice = undefined; usdPrice = undefined; priceError = error instanceof Error ? error.message : 'تعذر حساب السعر المرجعي.'; }
            }

            return (
              <div
                key={p.id}
                data-product-id={p.id}
                className={`bg-sf-surface border rounded-xl p-4 shadow-sm flex flex-col justify-between transition-all ${
                  isOut
                    ? 'border-sf-danger bg-sf-danger-bg'
                    : isLow
                    ? 'border-sf-warning bg-sf-warning-bg'
                    : 'border-sf-border hover:border-sf-border'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-sm text-sf-text leading-snug flex items-center gap-2 flex-wrap">
                      <span>{p.name}</span>
                      {isOut && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-sf-danger-bg/90 border border-sf-danger/80 text-sf-danger text-xs font-semibold animate-pulse shadow-xs">
                          <AlertTriangle className="w-3.5 h-3.5 text-sf-danger shrink-0" />
                          <span>نافد</span>
                        </span>
                      )}
                      {isLow && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-sf-warning-bg/90 border border-sf-warning/80 text-sf-warning text-xs font-semibold animate-pulse shadow-xs">
                          <AlertTriangle className="w-3.5 h-3.5 text-sf-warning shrink-0" />
                          <span>تنبيه نقص</span>
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        disabled={!isActionAllowed('products:update')} onClick={() => handleOpenEdit(p)}
                        className="p-2 text-sf-muted hover:text-sf-text hover:bg-sf-raised rounded-lg transition-colors"
                        title="تعديل المنتج والكمية"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={!isActionAllowed('products:delete')} onClick={() => handleDelete(p.id, p.name)}
                        className="p-2 text-sf-muted hover:text-sf-danger hover:bg-sf-danger-bg/30 rounded-lg transition-colors"
                        title="حذف المنتج"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {p.description && (
                    <p className="text-xs text-sf-muted mb-2 line-clamp-2">{p.description}</p>
                  )}

                  <div className="flex items-center gap-2 flex-wrap text-xs mb-3">
                    <span className="bg-sf-raised border border-sf-border text-sf-text px-2 py-1 rounded-md font-medium">
                      الوحدة: {p.unit}
                    </span>
                    {p.category && (
                      <span className="bg-sf-raised text-sf-action px-2 py-1 rounded-md font-semibold border border-sf-action/20">
                        {p.category}
                      </span>
                    )}
                  </div>

                  {/* Stock Level Badge */}
                  <div className="mb-3">
                    {isOut ? (
                      <div className="text-xs font-semibold text-sf-danger bg-sf-danger-bg/60 border border-sf-danger/40 px-3 py-1 rounded-xl flex items-center justify-between">
                        <span>نفد من المخزن</span>
                        <span className="font-mono">0 {p.unit}</span>
                      </div>
                    ) : isLow ? (
                      <div className="text-xs font-semibold text-sf-warning bg-sf-warning-bg/60 border border-sf-warning/40 px-3 py-1 rounded-xl flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          مخزون منخفض (حد الأمان {minAlert})
                        </span>
                        <span className="font-mono">{currentStock} {p.unit}</span>
                      </div>
                    ) : (
                      <div className="text-xs font-semibold text-sf-action bg-sf-selected/60 border border-sf-action/40 px-3 py-1 rounded-xl flex items-center justify-between">
                        <span>المتبقي في المخزن</span>
                        <span className="font-mono">{currentStock} {p.unit}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Price Box */}
                <div className="bg-sf-raised p-3 rounded-xl border border-sf-border flex items-center justify-between">
                  <div>
                    <span className="text-xs text-sf-muted block">{enabled ? `السعر (${displayCode})` : 'السعر بالجنيه:'}</span>
                    <span className="font-mono font-semibold text-sm text-sf-text">
                      {enabled ? (productPricingMode(p) === 'manual' && !usdPrice && localPrice ? formatMoney(localPrice, 'SDG', settings) : (usdPrice === undefined ? '—' : formatMoney(usdPrice, 'USD', settings))) : (localPrice === undefined ? '—' : nativeMoney(localPrice, 'SDG', settings))}
                    </span>
                  </div>
                  <div className="text-left" hidden={enabled}>
                    <span className="text-xs text-sf-muted block">السعر بالدولار:</span>
                    <span className="font-mono font-semibold text-xs text-sf-text">
                      {usdPrice === undefined ? '—' : formatMoney(usdPrice, 'USD', settings)}
                    </span>
                  </div>
                </div>
                <p className={`text-xs mt-2 ${priceError ? 'text-sf-warning' : 'text-sf-muted'}`}>{priceError || (productPricingMode(p) === 'manual' ? 'سعر يدوي — حدد مرجع الدولار لتحديثه مع الصرف.' : productPricingMode(p) === 'usd_cost_plus' ? `تكلفة الدولار + ربح ${p.pricing_markup_percent ?? 0}%؛ السعر يتحدث مع الصرف.` : 'سعر البيع مرتبط بالدولار ويتحدث مع الصرف.')}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {isAddModalOpen && (
        <Dialog label="إضافة أو تعديل منتج" onClose={() => { if (!isSaving) setIsAddModalOpen(false); }} className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-sf-surface rounded-xl shadow-2xl border border-sf-border max-w-md w-full p-6 sm:p-6 animate-in fade-in zoom-in-95 text-xs sm:text-sm text-sf-text my-auto">
            <div className="flex items-center justify-between border-b border-sf-border pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-sf-action/10 text-sf-action">
                  <Package className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-base text-sf-text">
                  {editingProduct ? 'تعديل المنتج وبيانات المخزون' : 'إضافة منتج وتحديد المخزون'}
                </h3>
              </div>
              <button disabled={isSaving} aria-label="إغلاق النافذة"
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

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
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
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-sf-text mb-1 text-xs">الفئة / التصنيف</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="مواد غذائية، مشروبات..."
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                  />
                </div>
              </div>

              {/* INVENTORY TRACKING INPUTS */}
              <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="trackInv"
                      checked={trackInventory}
                      disabled={!!editingProduct || currentOrg?.accounting_version === 2}
                      onChange={(e) => setTrackInventory(e.target.checked)}
                      className="rounded accent-sf-action text-sf-action w-4 h-4 cursor-pointer"
                    />
                    <label htmlFor="trackInv" className="font-semibold text-xs text-sf-text cursor-pointer">
                      تفعيل مراقبة وجرد المخزون التلقائي
                    </label>
                  </div>
                  <span className="text-xs text-sf-action bg-sf-selected/60 px-2 py-1 rounded border border-sf-action/40">
                    خصم تلقائي عند البيع
                  </span>
                </div>

                {trackInventory && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-xs font-semibold text-sf-text mb-1">
                        الكمية الحالية في المخزن
                      </label>
                      <input
                        type="number"
                        min="0"
                        aria-label="كمية المخزون الافتتاحية"
                        value={stockQuantity}
                        disabled={!!editingProduct}
                        onChange={(e) => setStockQuantity(Number(e.target.value))}
                        className="w-full bg-sf-surface border border-sf-border rounded-xl px-3 py-2 text-xs font-mono font-semibold text-sf-text focus:outline-none focus:border-sf-action"
                        placeholder="0"
                      />
                      {!editingProduct && currentOrg?.accounting_version === 2 && <p className="text-xs text-sf-muted mt-1">هذه كمية افتتاحية مملوكة بالفعل وتُثبت مقابل حقوق الملكية. للمشتريات الجديدة أضف المنتج بكمية صفر ثم سجّل فاتورة المورد من المخزون.</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-sf-text mb-1">
                        حد التنبيه عند النقصان
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={minStockAlert}
                        onChange={(e) => setMinStockAlert(Number(e.target.value))}
                        className="w-full bg-sf-surface border border-sf-border rounded-xl px-3 py-2 text-xs font-mono font-semibold text-sf-warning focus:outline-none focus:border-sf-action"
                        placeholder="10"
                      />
                    </div>
                  </div>
                )}
              </div>

              {!editingProduct && trackInventory && currentOrg?.accounting_version === 2 && stockQuantity > 0 && <fieldset disabled={isSaving} className="space-y-3 border border-sf-border rounded-xl p-3">
                <legend>حساب تكلفة المخزون الافتتاحي</legend>
                <label className="block">تكلفة الوحدة<input aria-label="تكلفة الوحدة الافتتاحية" className="sf-field w-full" type="number" min="0" step="0.00000001" required value={openingCost} onChange={e => setOpeningCost(Number(e.target.value))} /></label>
                <label className="block">عملة التكلفة<select aria-label="عملة التكلفة الافتتاحية" className="sf-field w-full" value={costCurrency} onChange={e => setCostCurrency(e.target.value as 'SDG' | 'USD')}><option>SDG</option><option>USD</option></select></label>
                <label className="block">سعر صرف التكلفة<input aria-label="صرف التكلفة الافتتاحية" className="sf-field w-full" type="number" min="0.00000001" step="0.00000001" required value={costRate} onChange={e => setCostRate(Number(e.target.value))} /></label>
                {openingCost === 0 && <label className="block">سبب التكلفة الصفرية<input aria-label="سبب التكلفة الافتتاحية الصفرية" className="sf-field w-full" required value={zeroCostReason} onChange={e => setZeroCostReason(e.target.value)} /></label>}
                {openingValue && <p role="status">إجمالي تكلفة المخزون: {pair(openingValue.sdg, openingValue.usd)}</p>}
                {openingCostError && <p role="alert">{openingCostError}</p>}
              </fieldset>}

              {/* Dual Price Inputs with Auto Sync */}
              <div className="bg-sf-raised p-3 rounded-xl border border-sf-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-sf-text">الدولار هو مرجع التسعير</span>
                  <span className="text-xs text-sf-warning bg-sf-warning-bg/60 px-2 py-1 rounded border border-sf-warning/40">
                    {rate > 0 ? `1$ = ${nativeMoney(rate, 'SDG', settings)}` : 'سعر الصرف غير محدد بالإعدادات'}
                  </span>
                </div>

                <label className="block text-xs font-semibold">طريقة تسعير المنتج<select aria-label="طريقة تسعير المنتج" value={pricingMode} onChange={e => setPricingMode(e.target.value as typeof pricingMode)} className="mt-1 block w-full bg-sf-surface border border-sf-border rounded-xl p-2"><option value="usd_reference">سعر بيع مرجعي بالدولار</option><option value="usd_cost_plus" disabled={!trackInventory}>تكلفة الدولار + نسبة ربح</option><option value="manual">سعر يدوي مستقل</option></select></label>
                {pricingMode === 'usd_cost_plus' ? <div className="space-y-2">
                  <label className="block text-xs">نسبة الربح فوق التكلفة %<input aria-label="نسبة الربح فوق التكلفة" type="number" min="0" max="10000" step="0.0001" required value={markupPercent} onChange={e => setMarkupPercent(Number(e.target.value))} className="mt-1 block w-full bg-sf-surface border border-sf-border rounded-xl p-2" /></label>
                  <p className="text-xs text-sf-muted">يُستخدم متوسط تكلفة المخزون الموثقة بالدولار، ثم يضاف الربح ويحوّل بسعر صرف الفاتورة. سجل الاستلام مع سعر صرف الشراء الأصلي أولاً؛ الكمية الفارغة أو التكلفة الناقصة لا تعطي سعراً تخمينياً.</p>
                </div> : <>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <label className="block text-xs font-semibold text-sf-text mb-1">
                      السعر بالجنيه (ج.س)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={priceSdg}
                      aria-label="سعر بيع المنتج بالجنيه"
                      onChange={(e) => { const value = Number(e.target.value); setPriceSdg(value); if (pricingMode === 'usd_reference' && rate > 0) setPriceUsd(new BigNumber(value).div(rate).decimalPlaces(8, BigNumber.ROUND_HALF_UP).toNumber()); }}
                      className="w-full bg-sf-surface border border-sf-border rounded-xl px-3 py-2 text-xs font-mono font-semibold text-sf-text focus:outline-none focus:border-sf-action"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-sf-text mb-1">
                      السعر بالدولار ($)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={priceUsd}
                      aria-label="مرجع سعر البيع بالدولار"
                      onChange={(e) => { const value = Number(e.target.value); setPriceUsd(value); if (pricingMode === 'usd_reference' && rate > 0) setPriceSdg(convertCurrency(value, 'USD', 'SDG', rate, settings)); }}
                      className="w-full bg-sf-surface border border-sf-border rounded-xl px-3 py-2 text-xs font-mono font-semibold text-sf-text focus:outline-none focus:border-sf-action"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
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
                {pricingMode === 'usd_reference' && <p className="text-xs text-sf-muted">سعر البيع بالجنيه يتحدث تلقائياً مع الصرف. القيمة المدخلة هنا سعر بيع وليست تكلفة شراء. تغيير المرجع يؤثر على الفواتير الجديدة فقط.</p>}
                </>}
              </div>

              <div>
                <label className="block font-semibold text-sf-text mb-1 text-xs">الوصف (اختياري)</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="وصف مختصر للمنتج أو المواصفات..."
                  className="w-full bg-sf-raised border border-sf-border rounded-xl p-2 text-xs text-sf-text placeholder-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-sf-border">
                <button disabled={isSaving}
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-sf-border bg-sf-raised rounded-xl text-xs font-semibold text-sf-text hover:bg-sf-raised transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !!openingCostError || !editingProduct && isProductLimitReached}
                  className={`px-6 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                    !editingProduct && isProductLimitReached
                      ? 'bg-sf-raised text-sf-muted cursor-not-allowed border border-sf-border'
                      : 'bg-sf-action hover:bg-sf-action-hover text-sf-on-action shadow-lg shadow-sf-action/20 '
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
        </Dialog>
      )}

      {/* Inventory Audit Modal */}
      <InventoryAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
      />
    </div>
  );
};

