import { useDisplayMoney } from '../context/useDisplayMoney';
import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Package, TrendingUp, DollarSign, Layers } from 'lucide-react';
import { Invoice, Product, MerchantSettings } from '../types';
import { convertCurrency, safeAdd } from '../lib/currency';

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
  const { formatMoney, bookLabel, enabled, code: displayCode, amount: displayValue } = useDisplayMoney();
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
        // Frozen native quotes belong to the issued invoice, never today's currency settings.
        const sourceSettings = { ...settings, currency_rates: inv.currency_rates_used || {} };
        const revSdg = item.currency === 'SDG' ? lineTotal : rate > 0 ? convertCurrency(lineTotal, item.currency, 'SDG', rate, sourceSettings) : 0;
        const revUsd = item.currency === 'USD' ? lineTotal : rate > 0 ? convertCurrency(lineTotal, item.currency, 'USD', rate, sourceSettings) : 0;


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
      return (enabled ? (displayValue(b.revenueSdg, 'SDG') ?? 0) - (displayValue(a.revenueSdg, 'SDG') ?? 0) : b.revenueSdg - a.revenueSdg) || b.quantity - a.quantity;
    });

    // Take top 5
    const top5 = items.slice(0, 5);

    // Format for Recharts
    return (top5 || []).map((item, index) => {
      // Short name for chart axis (truncate if too long)
      const shortName = item.name.length > 18 ? item.name.substring(0, 16) + '...' : item.name;
      const value = metric === 'quantity' ? item.quantity : enabled ? displayValue(item.revenueSdg, 'SDG') ?? 0 : item.revenueSdg;

      return {
        ...item,
        rank: index + 1,
        shortName,
        value,
      };
    });
  }, [invoices, products, settings, metric]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-sf-surface border border-sf-border text-sf-text p-3 rounded-xl shadow-xl text-xs space-y-2 z-50">
          <div className="font-semibold text-sf-text flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sf-raised"></span>
            <span>{data.name}</span>
          </div>
          <div className="text-sf-muted flex items-center justify-between gap-4">
            <span>الكمية المباعة:</span>
            <span className="font-mono font-semibold text-sf-text">
              {data.quantity} {data.unit}
            </span>
          </div>
          <div className="text-sf-muted flex items-center justify-between gap-4 border-t border-sf-border pt-1">
            <span>إجمالي الإيرادات:</span>
            <span className="font-mono font-semibold text-sf-text">
              {formatMoney(data.revenueSdg, 'SDG', settings)}
            </span>
          </div>
          <div className="text-sf-muted text-xs text-left font-mono">
            {bookLabel('USD')}: {formatMoney(data.revenueUsd, 'USD', settings)}
          </div>
          {data.invoiceCount > 0 && (
            <div className="text-xs text-sf-muted border-t border-sf-border pt-1">
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
    <div className="bg-sf-surface border border-sf-border rounded-xl p-4 sm:p-6 shadow-xs space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sf-raised text-sf-text border border-sf-border">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm sm:text-base text-sf-text flex items-center gap-2">
              <span>أكثر 5 منتجات مبيعًا</span>
              <span className="text-xs font-mono px-2 py-1 rounded-full bg-sf-raised text-sf-text border border-sf-border font-semibold">
                Top 5
              </span>
            </h3>
            <p className="text-xs text-sf-muted">
              تحليل فوري لحركة المبيعات والمنتجات الأكثر طلبًا من واقع الفواتير
            </p>
          </div>
        </div>

        {/* Metric Toggle */}
        <div className="inline-flex p-1 rounded-xl bg-sf-raised border border-sf-border text-xs">
          <button
            type="button"
            onClick={() => setMetric('quantity')}
            className={`px-3 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
              metric === 'quantity'
                ? 'bg-sf-raised text-sf-text font-semibold shadow-xs'
                : 'text-sf-muted hover:text-sf-text'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>حسب الكمية</span>
          </button>
          <button
            type="button"
            onClick={() => setMetric('revenue')}
            className={`px-3 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
              metric === 'revenue'
                ? 'bg-sf-raised text-sf-text font-semibold shadow-xs'
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
          <p className="text-xs text-sf-muted mt-1">
            لا توجد مبيعات مسجلة حتى الآن. أضف أول فاتورة لبدء التحليل والمتابعة.
          </p>
        </div>
      ) : (
        <div className="w-full">
          <div className="h-64 sm:h-72 w-full pt-2" dir="ltr" role="img" aria-label={metric === 'quantity' ? 'الكمية المباعة حسب المنتج؛ التفاصيل في الجدول' : `إيرادات الفواتير (${enabled ? displayCode : 'SDG'}) حسب المنتج؛ التفاصيل في الجدول`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={safeChartData}
                margin={{ top: 15, right: 10, left: 10, bottom: 25 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" vertical={false} />
                <XAxis
                  dataKey="shortName"
                  stroke="var(--sf-text-muted)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--sf-border)' }}
                  interval={0}
                  angle={-10}
                  textAnchor="end"
                  height={45}
                />
                <YAxis
                  stroke="var(--sf-text-muted)"
                  fontSize={14}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--sf-border)' }}
                  tickFormatter={(val) =>
                    metric === 'quantity'
                      ? val.toLocaleString()
                      : val >= 1000000
                      ? `${(val / 1000000).toFixed(1)}M`
                      : val >= 1000
                      ? `${(val / 1000).toFixed(0)}K`
                      : enabled ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(val) : val.toString()
                  }
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--sf-surface-raised)' }} />
                <Bar
                  dataKey="value"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                  name={metric === 'quantity' ? 'الكمية المباعة' : `إيراد الفواتير (${bookLabel('SDG')})`}
                  fill="var(--sf-action)"
                >
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <details className="border-t border-sf-border pt-4">
            <summary className="text-sm text-sf-text cursor-pointer">عرض أرقام الرسم في جدول</summary>
            <div className="sf-table-scroll mt-4" role="region" aria-label="أرقام مبيعات المنتجات" tabIndex={0}>
              <table className="sf-table min-w-[560px]">
                <caption>الكمية والإيراد من الفواتير الصادرة؛ يستبعد المسودات والملغاة والمبطلة.</caption>
                <thead><tr><th scope="col">المنتج</th><th scope="col">الكمية</th><th scope="col">الإيراد ({bookLabel('SDG')})</th><th scope="col">{bookLabel('USD')}</th></tr></thead>
                <tbody>{safeChartData.map(item => <tr key={item.id}>
                  <td>{item.name}</td>
                  <td><bdi dir="ltr" className="sf-number">{item.quantity}</bdi> {item.unit}</td>
                  <td><bdi dir="ltr" className="sf-number">{formatMoney(item.revenueSdg, 'SDG', settings)}</bdi></td>
                  <td><bdi dir="ltr" className="sf-number">{formatMoney(item.revenueUsd, 'USD', settings)}</bdi></td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
};
