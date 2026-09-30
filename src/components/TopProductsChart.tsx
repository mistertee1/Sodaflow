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

    const validInvoices = safeInvoices.filter((inv) => inv && inv.status !== 'cancelled');

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
          existing.quantity = safeAdd(existing.quantity, qty, 2);
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
  const barColors = ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b'];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-slate-200 text-slate-900 p-3 rounded-xl shadow-xl text-xs space-y-1.5 z-50">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-900"></span>
            <span>{data.name}</span>
          </div>
          <div className="text-slate-600 flex items-center justify-between gap-4">
            <span>الكمية المباعة:</span>
            <span className="font-mono font-bold text-slate-900">
              {data.quantity} {data.unit}
            </span>
          </div>
          <div className="text-slate-600 flex items-center justify-between gap-4 border-t border-slate-100 pt-1">
            <span>إجمالي الإيرادات:</span>
            <span className="font-mono font-bold text-emerald-700">
              {formatMoney(data.revenueSdg, 'SDG', settings)}
            </span>
          </div>
          <div className="text-slate-500 text-[10px] text-left font-mono">
            ≈ {formatMoney(data.revenueUsd, 'USD', settings)}
          </div>
          {data.invoiceCount > 0 && (
            <div className="text-[10px] text-slate-400 border-t border-slate-100 pt-1">
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
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-slate-100 text-slate-900 border border-slate-200">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900 flex items-center gap-2">
              <span>أكثر 5 منتجات مبيعًا</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200 font-semibold">
                Top 5
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              تحليل فوري لحركة المبيعات والمنتجات الأكثر طلبًا من واقع الفواتير
            </p>
          </div>
        </div>

        {/* Metric Toggle */}
        <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setMetric('quantity')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              metric === 'quantity'
                ? 'bg-slate-900 text-white font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
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
                ? 'bg-slate-900 text-white font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>حسب الإيراد</span>
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      {!hasSales || safeChartData.length === 0 ? (
        <div className="h-56 flex flex-col items-center justify-center text-slate-400 border border-dashed border-slate-200 rounded-xl p-6 text-center">
          <Package className="w-8 h-8 mb-2 opacity-40 text-slate-500" />
          <p className="text-xs text-slate-700 font-semibold">سيظهر الرسم البياني عند تسجيل المبيعات</p>
          <p className="text-[11px] text-slate-500 mt-1">
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
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="shortName"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                  interval={0}
                  angle={-10}
                  textAnchor="end"
                  height={45}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
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
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
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
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 pt-3 border-t border-slate-100">
            {safeChartData.map((item, idx) => (
              <div
                key={item.id}
                className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl p-2.5 flex sm:flex-col justify-between items-center sm:items-start gap-2 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono font-black ${
                      idx === 0
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    #{item.rank}
                  </span>
                  <span className="font-semibold text-xs text-slate-800 truncate max-w-[130px] sm:max-w-full" title={item.name}>
                    {item.name}
                  </span>
                </div>
                <div className="text-left sm:w-full sm:flex sm:justify-between sm:items-baseline sm:pt-1 sm:border-t sm:border-slate-200">
                  <span className="font-mono font-bold text-xs text-slate-900">
                    {item.quantity} {item.unit}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
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
