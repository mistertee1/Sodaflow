import React from 'react';
import { formatDisplayMoney, displayBookLabel } from '../../lib/displayCurrency';
import type { MerchantSettings } from '../../types';
import { calculateTrialBalance, calculateIncomeStatement, calculateBalanceSheet, calculateCashFlowStatement } from '../../services/accountingService';
import { BookOpen, Plus, RotateCcw, CheckCircle2, AlertCircle, Search, Filter, ArrowDownLeft, ArrowUpRight, TrendingUp, FileSpreadsheet, Coins, DollarSign, Layers, Scale, Calendar, Tag, ShieldCheck, Lock, Unlock, Landmark, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
interface Props { trialBalance: ReturnType<typeof calculateTrialBalance>; incomeStatement: ReturnType<typeof calculateIncomeStatement>; balanceSheet: ReturnType<typeof calculateBalanceSheet>; cashFlow: ReturnType<typeof calculateCashFlowStatement>; settings: MerchantSettings; theme: 'light'|'dark'; }
export const IncomeReport: React.FC<Props> = ({ trialBalance, incomeStatement, balanceSheet, cashFlow, settings, theme }) => {
  const formatMoney = (value: number, source: string) => formatDisplayMoney(value, source, settings);
  const bookLabel = (source: string) => displayBookLabel(source, settings);
  return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Sales Revenue */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-4 shadow-sm">
              <span className="text-xs text-sf-muted font-semibold block mb-1">إيرادات النشاط والإيرادات الأخرى</span>
              <div className="text-lg font-semibold font-mono text-sf-text">
                {formatMoney(incomeStatement.sales_revenue_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted mt-1">
                {formatMoney(incomeStatement.sales_revenue_usd, 'USD')}
              </div>
            </div>

            {/* Gross Profit */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-4 shadow-sm">
              <span className="text-xs text-sf-muted font-semibold block mb-1">مجمل الربح (Gross Profit)</span>
              <div className="text-lg font-semibold font-mono text-sf-text">
                {incomeStatement.costs_complete === false ? 'غير مكتمل' : formatMoney(incomeStatement.gross_profit_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted mt-1">
                {incomeStatement.costs_complete === false ? 'غير مكتمل' : formatMoney(incomeStatement.gross_profit_usd, 'USD')}
              </div>
            </div>

            {/* Operating Expenses */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-4 shadow-sm">
              <span className="text-xs text-sf-muted font-semibold block mb-1">المصروفات التشغيلية</span>
              <div className="text-lg font-semibold font-mono text-sf-danger">
                {formatMoney(incomeStatement.total_operating_expenses_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted mt-1">
                {formatMoney(incomeStatement.total_operating_expenses_usd, 'USD')}
              </div>
            </div>

            {/* Net Profit */}
            <div className="bg-sf-surface border border-sf-action/30 rounded-xl p-4 shadow-sm ">
              <span className="text-xs text-sf-text font-semibold block mb-1">صافي الربح النهائي</span>
              <div className="text-xl font-semibold font-mono text-sf-text">
                {incomeStatement.costs_complete === false ? 'غير مكتمل' : formatMoney(incomeStatement.net_profit_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted mt-1">
                {incomeStatement.costs_complete === false ? 'غير مكتمل' : formatMoney(incomeStatement.net_profit_usd, 'USD')}
              </div>
            </div>
          </div>

          {/* Detailed Statement Breakdown */}
          <div className="bg-sf-surface border border-sf-border rounded-xl p-5 sm:p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-sm text-sf-text border-b border-sf-border pb-3">
              تفاصيل قائمة الدخل المحاسبية
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-sf-border">
                <span className="font-semibold text-sf-text">إيرادات النشاط والإيرادات الأخرى</span>
                <span className="font-mono font-semibold text-sf-text">
                  {formatMoney(incomeStatement.sales_revenue_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-sf-border">
                <span className="font-semibold text-sf-text">تكلفة البضاعة المباعة (COGS)</span>
                <span className="font-mono font-semibold text-sf-danger">
                  ({formatMoney(incomeStatement.cogs_sdg, 'SDG')})
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-sf-border font-semibold bg-sf-raised px-3 rounded-lg">
                <span className="text-sf-text">= مجمل الربح</span>
                <span className="font-mono text-sf-text text-sm">
                  {incomeStatement.costs_complete === false ? 'غير مكتمل' : formatMoney(incomeStatement.gross_profit_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-sf-border">
                <span className="font-semibold text-sf-text">المصروفات التشغيلية والعمومية</span>
                <span className="font-mono font-semibold text-sf-danger">
                  ({formatMoney(incomeStatement.total_operating_expenses_sdg, 'SDG')})
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-sf-border">
                <span className="font-semibold text-sf-text">فروقات أسعار الصرف (أرباح / خسائر العملة)</span>
                <span
                  className={`font-mono font-semibold ${
                    incomeStatement.fx_gain_loss_sdg >= 0 ? 'text-sf-text' : 'text-sf-danger'
                  }`}
                >
                  {formatMoney(incomeStatement.fx_gain_loss_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-3 font-semibold bg-sf-selected/40 border border-sf-action/40 px-3.5 rounded-xl mt-4">
                <span className="text-sf-text text-sm">صافي الأرباح القابلة للتوزيع</span>
                <span className="font-mono text-sf-text text-base">
                  {incomeStatement.costs_complete === false ? 'غير مكتمل' : formatMoney(incomeStatement.net_profit_sdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>
        </div>

);
};
