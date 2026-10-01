import React from 'react';
import { formatMoney } from '../../lib/currency';
import type { MerchantSettings } from '../../types';
import { calculateTrialBalance, calculateIncomeStatement, calculateBalanceSheet, calculateCashFlowStatement } from '../../services/accountingService';
import { BookOpen, Plus, RotateCcw, CheckCircle2, AlertCircle, Search, Filter, ArrowDownLeft, ArrowUpRight, TrendingUp, FileSpreadsheet, Coins, DollarSign, Layers, Scale, Calendar, Tag, ShieldCheck, Lock, Unlock, Landmark, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
interface Props { trialBalance: ReturnType<typeof calculateTrialBalance>; incomeStatement: ReturnType<typeof calculateIncomeStatement>; balanceSheet: ReturnType<typeof calculateBalanceSheet>; cashFlow: ReturnType<typeof calculateCashFlowStatement>; settings: MerchantSettings; theme: 'light'|'dark'; }
export const IncomeReport: React.FC<Props> = ({ trialBalance, incomeStatement, balanceSheet, cashFlow, settings, theme }) => (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Sales Revenue */}
            <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 shadow-sm">
              <span className="text-xs text-sf-muted font-bold block mb-1">إجمالي إيراد المبيعات</span>
              <div className="text-lg font-black font-mono text-sf-action">
                {formatMoney(incomeStatement.sales_revenue_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted mt-1">
                {formatMoney(incomeStatement.sales_revenue_usd, 'USD')}
              </div>
            </div>

            {/* Gross Profit */}
            <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 shadow-sm">
              <span className="text-xs text-sf-muted font-bold block mb-1">مجمل الربح (Gross Profit)</span>
              <div className="text-lg font-black font-mono text-sky-400">
                {formatMoney(incomeStatement.gross_profit_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted mt-1">
                {formatMoney(incomeStatement.gross_profit_usd, 'USD')}
              </div>
            </div>

            {/* Operating Expenses */}
            <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 shadow-sm">
              <span className="text-xs text-sf-muted font-bold block mb-1">المصروفات التشغيلية</span>
              <div className="text-lg font-black font-mono text-sf-danger">
                {formatMoney(incomeStatement.total_operating_expenses_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted mt-1">
                {formatMoney(incomeStatement.total_operating_expenses_usd, 'USD')}
              </div>
            </div>

            {/* Net Profit */}
            <div className="bg-sf-surface border border-sf-action/30 rounded-2xl p-4 shadow-sm bg-gradient-to-br from-sf-ink to-emerald-950/20">
              <span className="text-xs text-sf-action font-black block mb-1">صافي الربح النهائي</span>
              <div className="text-xl font-black font-mono text-sf-action">
                {formatMoney(incomeStatement.net_profit_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-action/70 mt-1">
                {formatMoney(incomeStatement.net_profit_usd, 'USD')}
              </div>
            </div>
          </div>

          {/* Detailed Statement Breakdown */}
          <div className="bg-sf-surface border border-sf-border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-sm text-sf-text border-b border-sf-border pb-3">
              تفاصيل قائمة الدخل المحاسبية
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-sf-border">
                <span className="font-bold text-sf-text">إيرادات النشاط التجاري (المبيعات)</span>
                <span className="font-mono font-bold text-sf-action">
                  {formatMoney(incomeStatement.sales_revenue_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-sf-border">
                <span className="font-bold text-sf-text">تكلفة البضاعة المباعة (COGS)</span>
                <span className="font-mono font-bold text-sf-danger">
                  ({formatMoney(incomeStatement.cogs_sdg, 'SDG')})
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-sf-border font-bold bg-sf-raised px-3 rounded-lg">
                <span className="text-sf-text">= مجمل الربح</span>
                <span className="font-mono text-sky-400 text-sm">
                  {formatMoney(incomeStatement.gross_profit_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-sf-border">
                <span className="font-bold text-sf-text">المصروفات التشغيلية والعمومية</span>
                <span className="font-mono font-bold text-sf-danger">
                  ({formatMoney(incomeStatement.total_operating_expenses_sdg, 'SDG')})
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-sf-border">
                <span className="font-bold text-sf-text">فروقات أسعار الصرف (أرباح / خسائر العملة)</span>
                <span
                  className={`font-mono font-bold ${
                    incomeStatement.fx_gain_loss_sdg >= 0 ? 'text-sf-action' : 'text-sf-danger'
                  }`}
                >
                  {formatMoney(incomeStatement.fx_gain_loss_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-3 font-black bg-sf-selected/40 border border-sf-action/40 px-3.5 rounded-xl mt-4">
                <span className="text-sf-action text-sm">صافي الأرباح القابلة للتوزيع</span>
                <span className="font-mono text-sf-action text-base">
                  {formatMoney(incomeStatement.net_profit_sdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>
        </div>

);
