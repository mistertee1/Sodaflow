import React from 'react';
import { formatMoney } from '../../lib/currency';
import type { MerchantSettings } from '../../types';
import { calculateTrialBalance, calculateIncomeStatement, calculateBalanceSheet, calculateCashFlowStatement } from '../../services/accountingService';
import { BookOpen, Plus, RotateCcw, CheckCircle2, AlertCircle, Search, Filter, ArrowDownLeft, ArrowUpRight, TrendingUp, FileSpreadsheet, Coins, DollarSign, Layers, Scale, Calendar, Tag, ShieldCheck, Lock, Unlock, Landmark, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
interface Props { trialBalance: ReturnType<typeof calculateTrialBalance>; incomeStatement: ReturnType<typeof calculateIncomeStatement>; balanceSheet: ReturnType<typeof calculateBalanceSheet>; cashFlow: ReturnType<typeof calculateCashFlowStatement>; settings: MerchantSettings; theme: 'light'|'dark'; }
export const CashFlowReport: React.FC<Props> = ({ trialBalance, incomeStatement, balanceSheet, cashFlow, settings, theme }) => (
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-sf-surface border border-sf-border rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-sf-text">قائمة التدفقات النقدية (Cash Flow Statement)</h3>
                <p className="text-xs text-sf-muted mt-1">
                  تحليل حركة النقدية الداخلة والخارجة مقسمة وفقاً للمعايير المحاسبية (أنشطة تشغيلية، استثمارية، وتمويلية).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-sf-muted">صافي السيولة النقدية الختامية:</span>
                <span className="text-sm font-mono font-black text-sf-action px-3 py-1 bg-sf-selected/70 border border-sf-action/40 rounded-xl">
                  {formatMoney(cashFlow.ending_cash_sdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>

          {/* 4 Cards Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-xs text-sf-muted font-bold block">التدفقات التشغيلية (Operating)</span>
              <div
                className={`text-lg font-black font-mono ${
                  cashFlow.net_operating_sdg >= 0 ? 'text-sf-action' : 'text-sf-danger'
                }`}
              >
                {formatMoney(cashFlow.net_operating_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted">
                {formatMoney(cashFlow.net_operating_usd, 'USD')}
              </div>
            </div>

            <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-xs text-sf-muted font-bold block">التدفقات الاستثمارية (Investing)</span>
              <div
                className={`text-lg font-black font-mono ${
                  cashFlow.net_investing_sdg >= 0 ? 'text-sf-action' : 'text-sf-danger'
                }`}
              >
                {formatMoney(cashFlow.net_investing_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted">
                {formatMoney(cashFlow.net_investing_usd, 'USD')}
              </div>
            </div>

            <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-xs text-sf-muted font-bold block">التدفقات التمويلية (Financing)</span>
              <div
                className={`text-lg font-black font-mono ${
                  cashFlow.net_financing_sdg >= 0 ? 'text-sf-action' : 'text-sf-danger'
                }`}
              >
                {formatMoney(cashFlow.net_financing_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted">
                {formatMoney(cashFlow.net_financing_usd, 'USD')}
              </div>
            </div>

            <div className="bg-sf-surface border border-sf-border rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-xs text-sky-400 font-black block">صافي التغير في النقدية</span>
              <div
                className={`text-lg font-black font-mono ${
                  cashFlow.net_change_in_cash_sdg >= 0 ? 'text-sky-400' : 'text-sf-danger'
                }`}
              >
                {formatMoney(cashFlow.net_change_in_cash_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted">
                {formatMoney(cashFlow.net_change_in_cash_usd, 'USD')}
              </div>
            </div>
          </div>

          {/* Statement Detailed Walkthrough */}
          <div className="bg-sf-surface border border-sf-border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <h4 className="font-bold text-sm text-sf-text border-b border-sf-border pb-3">
              تفاصيل قائمة التدفقات النقدية
            </h4>

            <div className="space-y-3 text-xs">
              {/* Section 1: Operating */}
              <div className="p-3.5 bg-sf-raised rounded-xl border border-sf-border space-y-2">
                <div className="font-bold text-sf-action flex items-center justify-between">
                  <span>1. التدفقات النقدية من الأنشطة التشغيلية (Operating Activities)</span>
                  <span className="font-mono">{formatMoney(cashFlow.net_operating_sdg, 'SDG')}</span>
                </div>
                <div className="space-y-1.5 pr-3 text-sf-text">
                  <div className="flex items-center justify-between">
                    <span>+ النقدية المحصلة من العميل والمبيعات (Cash from Customers)</span>
                    <span className="font-mono text-sf-action">
                      {formatMoney(cashFlow.operating_inflows_sdg, 'SDG')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>- النقدية المدفوعة للمصروفات التشغيلية (Cash to Expenses)</span>
                    <span className="font-mono text-sf-danger">
                      ({formatMoney(cashFlow.operating_outflows_sdg, 'SDG')})
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 2: Investing */}
              <div className="p-3.5 bg-sf-raised rounded-xl border border-sf-border space-y-2">
                <div className="font-bold text-sky-400 flex items-center justify-between">
                  <span>2. التدفقات النقدية من الأنشطة الاستثمارية (Investing Activities)</span>
                  <span className="font-mono">{formatMoney(cashFlow.net_investing_sdg, 'SDG')}</span>
                </div>
                <div className="space-y-1.5 pr-3 text-sf-text">
                  <div className="flex items-center justify-between">
                    <span>صافي حركة شراء وبيع الأصول الثابتة</span>
                    <span className="font-mono text-sf-muted">
                      {formatMoney(cashFlow.net_investing_sdg, 'SDG')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 3: Financing */}
              <div className="p-3.5 bg-sf-raised rounded-xl border border-sf-border space-y-2">
                <div className="font-bold text-purple-400 flex items-center justify-between">
                  <span>3. التدفقات النقدية من الأنشطة التمويلية (Financing Activities)</span>
                  <span className="font-mono">{formatMoney(cashFlow.net_financing_sdg, 'SDG')}</span>
                </div>
                <div className="space-y-1.5 pr-3 text-sf-text">
                  <div className="flex items-center justify-between">
                    <span>صافي مساهمات رأس المال والمسحوبات</span>
                    <span className="font-mono text-sf-muted">
                      {formatMoney(cashFlow.net_financing_sdg, 'SDG')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Reconciliation Table */}
              <div className="pt-3 border-t border-sf-border space-y-2">
                <div className="flex items-center justify-between py-1.5 text-sf-text font-bold">
                  <span>صافي الزيادة / (النقص) في النقدية خلال الفترة</span>
                  <span className="font-mono text-sky-400">
                    {formatMoney(cashFlow.net_change_in_cash_sdg, 'SDG')}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-sf-muted">
                  <span>رصيد النقدية وما في حكمها في بداية الفترة</span>
                  <span className="font-mono">{formatMoney(cashFlow.beginning_cash_sdg, 'SDG')}</span>
                </div>
                <div className="flex items-center justify-between py-2.5 px-3 bg-sf-selected/50 border border-sf-action/40 rounded-xl text-sf-action font-black">
                  <span>رصيد النقدية وما في حكمها في نهاية الفترة (الخزينة والبنوك)</span>
                  <span className="font-mono text-sm">{formatMoney(cashFlow.ending_cash_sdg, 'SDG')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

);
