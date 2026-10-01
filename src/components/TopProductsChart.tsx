import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Package, TrendingUp, DollarSign, Layers } from 'lucide-react';
import { Invoice, Product, MerchantSettings } from '../types';
import { formatMoney, convertCurrency, safeAdd } from '../lib/currency';

interface TopProductsChartProps {
  invoices?: Invoice[];
  products?: Product[];
  settings?: MerchantSettings;
}

export const TopProductsChart: React.FC<TopProductsChartProps> = ({
  invoices = [],
  products = [],
  settings = {} as MerchantSettings,
}) => {
  const [metric, setMetric] = useState<'quantity' | 'revenue'>('quantity');

  // Compute top products from non-cancelled invoices
  const topProductsData = useMemo(() => {
    const safeInvoices = Array.isArray(invoices) ? invoices : [];
    const safeProducts = Array.isArray(products) ? products : [];

    const salesMap = new Map<
      string,
      {
        id: string;
        name: string;
        quantity: number;
        unit: string;
        revenueSdg: number;
        revenueUsd: number;
        invoiceCount: number;
      }
    >();

    const validInvoices = safeInvoices.filter((inv) => inv && !['cancelled', 'void', 'draft'].includes(inv.status));

    validInvoices.forEach((inv) => {
      const rate = inv?.exchange_rate_used || settings?.default_exchange_rate || 0;
      const safeItems = Array.isArray(inv?.items) ? inv.items : [];

      safeItems.forEach((item) => {
        if (!item) return;
        const name = (item.description || 'منتج غير مسمى').trim();
        const key = item.product_id || name;
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unit_price) || 0;
        const lineTotal = Number(item.line_total) || (qty * price);
        const revSdg = item.currency === 'SDG' 
          ? lineTotal 
          : (rate > 0 ? convertCurrency(lineTotal, 'USD', 'SDG', rate, settings) : 0);
        const revUsd = item.currency === 'USD' 
          ? lineTotal 
          : (rate > 0 ? convertCurrency(lineTotal, 'SDG', 'USD', rate, settings) : 0);

        const existing = salesMap.get(key);
        if (existing) {
          existing.quantity = safeAdd(existing.quantity, qty, 6);
          existing.revenueSdg = safeAdd(existing.revenueSdg, revSdg, 0);
          existing.revenueUsd = safeAdd(existing.revenueUsd, revUsd, 2);
          existing.invoiceCount += 1;
          if (!existing.unit && item.unit) existing.unit = item.unit;
        } else {
          salesMap.set(key, {
            id: key,
            name,
            quantity: qty,
            unit: item.unit || 'وحدة',
            revenueSdg: revSdg,
            revenueUsd: revUsd,
            invoiceCount: 1,
          });
        }
      });
    });

    // If salesMap has fewer than 5 items, supplement from products catalogue to give a representative overview
    if (salesMap.size < 5 && safeProducts.length > 0) {
      safeProducts.forEach((prod) => {
        if (!prod) return;
        if (!salesMap.has(prod.id) && !salesMap.has(prod.name.trim())) {
          salesMap.set(prod.id, {
            id: prod.id,
            name: prod.name,
            quantity: 0,
            unit: prod.unit || 'وحدة',
            revenueSdg: 0,
            revenueUsd: 0,
            invoiceCount: 0,
          });
        }
      });
    }

    const items = Array.from(salesMap.values());

    // Sort according to selected metric
    items.sort((a, b) => {
      if (metric === 'quantity') {
        return b.quantity - a.quantity || b.revenueSdg - a.revenueSdg;
      }
      return b.revenueSdg - a.revenueSdg || b.quantity - a.quantity;
    });

    // Take top 5
    const top5 = items.slice(0, 5);

    // Format for Recharts
    return (top5 || []).map((item, index) => {
      // Short name for chart axis (truncate if too long)
      const shortName = item.name.length > 18 ? item.name.substring(0, 16) + '...' : item.name;
      const value = metric === 'quantity' ? item.quantity : Math.round(item.revenueSdg);

      return {
        ...item,
        rank: index + 1,
        shortName,
        value,
      };
    });
  }, [invoices, products, settings, metric]);

  // Color palette for the bars in inverted light theme
  const barColors = ['var(--sf-action)', 'var(--sf-info)', 'var(--sf-warning)', 'var(--sf-text-muted)', 'var(--sf-text)'];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-sf-surface border border-sf-border text-sf-text p-3 rounded-xl shadow-xl text-xs space-y-1.5 z-50">
          <div className="font-bold text-sf-text flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sf-raised"></span>
            <span>{data.name}</span>
          </div>
          <div className="text-sf-muted flex items-center justify-between gap-4">
            <span>الكمية المباعة:</span>
            <span className="font-mono font-bold text-sf-text">
              {data.quantity} {data.unit}
            </span>
          </div>
          <div className="text-sf-muted flex items-center justify-between gap-4 border-t border-sf-border pt-1">
            <span>إجمالي الإيرادات:</span>
            <span className="font-mono font-bold text-sf-action">
              {formatMoney(data.revenueSdg, 'SDG', settings)}
            </span>
          </div>
          <div className="text-sf-muted text-[10px] text-left font-mono">
            ≈ {formatMoney(data.revenueUsd, 'USD', settings)}
          </div>
          {data.invoiceCount > 0 && (
            <div className="text-[10px] text-sf-muted border-t border-sf-border pt-1">
              مذكور في {data.invoiceCount} فاتورة
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const safeChartData = Array.isArray(topProductsData) ? topProductsData : [];
  const hasSales = safeChartData.some((p) => p && (p.quantity || 0) > 0);

  return (
    <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-sf-raised text-sf-text border border-sf-border">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-sf-text flex items-center gap-2">
              <span>أكثر 5 منتجات مبيعًا</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-sf-raised text-sf-text border border-sf-border font-semibold">
                Top 5
              </span>
            </h3>
            <p className="text-[11px] text-sf-muted">
              تحليل فوري لحركة المبيعات والمنتجات الأكثر طلبًا من واقع الفواتير
            </p>
          </div>
        </div>

        {/* Metric Toggle */}
        <div className="inline-flex p-1 rounded-xl bg-sf-raised border border-sf-border text-xs">
          <button
            type="button"
            onClick={() => setMetric('quantity')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              metric === 'quantity'
                ? 'bg-sf-raised text-sf-text font-bold shadow-xs'
                : 'text-sf-muted hover:text-sf-text'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>حسب الكمية</span>
          </button>
          <button
            type="button"
            onClick={() => setMetric('revenue')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              metric === 'revenue'
                ? 'bg-sf-raised text-sf-text font-bold shadow-xs'
                : 'text-sf-muted hover:text-sf-text'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>حسب الإيراد</span>
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      {!hasSales || safeChartData.length === 0 ? (
        <div className="h-56 flex flex-col items-center justify-center text-sf-muted border border-dashed border-sf-border rounded-xl p-6 text-center">
          <Package className="w-8 h-8 mb-2 opacity-40 text-sf-muted" />
          <p className="text-xs text-sf-muted font-semibold">سيظهر الرسم البياني عند تسجيل المبيعات</p>
          <p className="text-[11px] text-sf-muted mt-1">
            لا توجد مبيعات مسجلة حتى الآن. أضف أول فاتورة لبدء التحليل والمتابعة.
          </p>
        </div>
      ) : (
        <div className="w-full">
          <div className="h-64 sm:h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={safeChartData}
                margin={{ top: 15, right: 10, left: 10, bottom: 25 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" vertical={false} />
                <XAxis
                  dataKey="shortName"
                  stroke="var(--sf-text-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--sf-border)' }}
                  interval={0}
                  angle={-10}
                  textAnchor="end"
                  height={45}
                />
                <YAxis
                  stroke="var(--sf-text-muted)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--sf-border)' }}
                  tickFormatter={(val) =>
                    metric === 'quantity'
                      ? val.toLocaleString()
                      : val >= 1000000
                      ? `${(val / 1000000).toFixed(1)}M`
                      : val >= 1000
                      ? `${(val / 1000).toFixed(0)}K`
                      : val.toString()
                  }
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--sf-surface-raised)' }} />
                <Bar
                  dataKey="value"
                  radius={[6, 6, 0, 0]}
                  animationDuration={900}
                >
                  {safeChartData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={barColors[index % barColors.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top 5 Micro Rank Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 pt-3 border-t border-sf-border">
            {safeChartData.map((item, idx) => (
              <div
                key={item.id}
                className="bg-sf-raised border border-sf-border hover:border-sf-border rounded-xl p-2.5 flex sm:flex-col justify-between items-center sm:items-start gap-2 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono font-black ${
                      idx === 0
                        ? 'bg-sf-raised text-sf-text'
                        : 'bg-sf-selected text-sf-muted'
                    }`}
                  >
                    #{item.rank}
                  </span>
                  <span className="font-semibold text-xs text-sf-text truncate max-w-[130px] sm:max-w-full" title={item.name}>
                    {item.name}
                  </span>
                </div>
                <div className="text-left sm:w-full sm:flex sm:justify-between sm:items-baseline sm:pt-1 sm:border-t sm:border-sf-border">
                  <span className="font-mono font-bold text-xs text-sf-text">
                    {item.quantity} {item.unit}
                  </span>
                  <span className="text-[10px] text-sf-muted font-mono hidden sm:inline">
                    {formatMoney(item.revenueSdg, 'SDG', settings)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
