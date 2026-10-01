import React from 'react';
import { formatMoney } from '../../lib/currency';
import type { MerchantSettings } from '../../types';
import { calculateTrialBalance, calculateIncomeStatement, calculateBalanceSheet, calculateCashFlowStatement } from '../../services/accountingService';
import { BookOpen, Plus, RotateCcw, CheckCircle2, AlertCircle, Search, Filter, ArrowDownLeft, ArrowUpRight, TrendingUp, FileSpreadsheet, Coins, DollarSign, Layers, Scale, Calendar, Tag, ShieldCheck, Lock, Unlock, Landmark, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
interface Props { trialBalance: ReturnType<typeof calculateTrialBalance>; incomeStatement: ReturnType<typeof calculateIncomeStatement>; balanceSheet: ReturnType<typeof calculateBalanceSheet>; cashFlow: ReturnType<typeof calculateCashFlowStatement>; settings: MerchantSettings; theme: 'light'|'dark'; }
export const BalanceSheetReport: React.FC<Props> = ({ trialBalance, incomeStatement, balanceSheet, cashFlow, settings, theme }) => (
        <div className="space-y-6">
          {/* Top Equation and Balance Badge */}
          <div className="bg-sf-surface border border-sf-border rounded-xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-sf-text">قائمة المركز المالي (الميزانية العمومية)</h3>
                {balanceSheet.is_balanced ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sf-selected/80 text-sf-action border border-sf-action/50 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    الميزانية متزنة تماماً (الأصول = الخصوم + حقوق الملكية)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sf-danger-bg/80 text-sf-danger border border-sf-danger/50 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    فارق عدم توازن: {formatMoney(balanceSheet.difference_sdg, 'SDG')}
                  </span>
                )}
              </div>
              <p className="text-xs text-sf-muted mt-1">
                توضح المركز المالي للمنشأة في تاريخ محدد، وتشمل أرباح الفترة الحالية المنقولة تلقائياً من قائمة الدخل.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-sf-muted">العملة المرجعية:</span>
              <span className="text-xs font-mono font-semibold px-2 py-1 rounded bg-sf-raised text-sf-action border border-sf-border">
                SDG / USD
              </span>
            </div>
          </div>

          {/* Three Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Assets */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-5 shadow-sm space-y-1">
              <span className="text-xs text-sf-text font-semibold block">إجمالي الأصول (Assets)</span>
              <div className="text-xl font-semibold font-mono text-sf-text">
                {formatMoney(balanceSheet.total_assets_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted">
                {formatMoney(balanceSheet.total_assets_usd, 'USD')}
              </div>
            </div>

            {/* Liabilities */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-5 shadow-sm space-y-1">
              <span className="text-xs text-sf-warning font-semibold block">إجمالي الخصوم والالتزامات (Liabilities)</span>
              <div className="text-xl font-semibold font-mono text-sf-text">
                {formatMoney(balanceSheet.total_liabilities_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted">
                {formatMoney(balanceSheet.total_liabilities_usd, 'USD')}
              </div>
            </div>

            {/* Equity */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-5 shadow-sm space-y-1">
              <span className="text-xs text-sf-text font-semibold block">إجمالي حقوق الملكية (Equity)</span>
              <div className="text-xl font-semibold font-mono text-sf-text">
                {formatMoney(balanceSheet.total_equity_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-sf-muted">
                {formatMoney(balanceSheet.total_equity_usd, 'USD')}
              </div>
            </div>
          </div>

          {/* Detailed Side-by-Side Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Assets Table */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-sf-border pb-3">
                <h4 className="font-semibold text-sm text-sf-text flex items-center gap-2">
                  <span>الأصول المتداولة والثابتة</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-sf-raised border border-sf-border text-sf-text">
                    {balanceSheet.assets.length} حساب
                  </span>
                </h4>
                <span className="text-xs font-mono font-semibold text-sf-text">
                  {formatMoney(balanceSheet.total_assets_sdg, 'SDG')}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-sf-raised text-sf-muted font-semibold border-b border-sf-border">
                    <tr>
                      <th className="py-2 px-3">الرمز</th>
                      <th className="py-2 px-3">الحساب</th>
                      <th className="py-2 px-3">الرصيد (ج.س)</th>
                      <th className="py-2 px-3">الرصيد ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {balanceSheet.assets.map((item) => (
                      <tr key={item.account_code} className="hover:bg-sf-raised">
                        <td className="py-2 px-3 font-mono text-sf-text font-semibold">{item.account_code}</td>
                        <td className="py-2 px-3 text-sf-text font-medium">{item.account_name}</td>
                        <td className="py-2 px-3 font-mono font-semibold text-sf-text">
                          {formatMoney(item.balance_sdg, 'SDG')}
                        </td>
                        <td className="py-2 px-3 font-mono text-sf-muted">
                          {formatMoney(item.balance_usd, 'USD')}
                        </td>
                      </tr>
                    ))}
                    {balanceSheet.assets.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-sf-muted">
                          لا توجد أصول مسجلة
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-sf-border bg-sf-raised font-semibold">
                    <tr>
                      <td colSpan={2} className="py-2.5 px-3 text-sf-text">إجمالي الأصول</td>
                      <td className="py-2.5 px-3 font-mono text-sf-text">
                        {formatMoney(balanceSheet.total_assets_sdg, 'SDG')}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-sf-text">
                        {formatMoney(balanceSheet.total_assets_usd, 'USD')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Right: Liabilities & Equity Table */}
            <div className="bg-sf-surface border border-sf-border rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-sf-border pb-3">
                <h4 className="font-semibold text-sm text-sf-warning flex items-center gap-2">
                  <span>الخصوم وحقوق الملكية</span>
                </h4>
                <span className="text-xs font-mono font-semibold text-sf-text">
                  {formatMoney(balanceSheet.total_liabilities_and_equity_sdg, 'SDG')}
                </span>
              </div>

              {/* Liabilities Sub-table */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-sf-warning">الخصوم والالتزامات:</div>
                <table className="w-full text-right text-xs">
                  <tbody className="divide-y divide-sf-border">
                    {balanceSheet.liabilities.map((item) => (
                      <tr key={item.account_code} className="hover:bg-sf-raised">
                        <td className="py-1.5 px-3 font-mono text-sf-warning font-semibold">{item.account_code}</td>
                        <td className="py-1.5 px-3 text-sf-text">{item.account_name}</td>
                        <td className="py-1.5 px-3 font-mono font-semibold text-sf-text">
                          {formatMoney(item.balance_sdg, 'SDG')}
                        </td>
                        <td className="py-1.5 px-3 font-mono text-sf-muted">
                          {formatMoney(item.balance_usd, 'USD')}
                        </td>
                      </tr>
                    ))}
                    {balanceSheet.liabilities.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-2 text-center text-sf-muted text-xs">
                          لا توجد خصوم مسجلة
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Equity Sub-table */}
              <div className="space-y-2 pt-3 border-t border-sf-border">
                <div className="text-xs font-semibold text-sf-text">حقوق الملكية ورأس المال:</div>
                <table className="w-full text-right text-xs">
                  <tbody className="divide-y divide-sf-border">
                    {balanceSheet.equity.map((item) => (
                      <tr key={item.account_code} className="hover:bg-sf-raised">
                        <td className="py-1.5 px-3 font-mono text-sf-text font-semibold">{item.account_code}</td>
                        <td className="py-1.5 px-3 text-sf-text">{item.account_name}</td>
                        <td className="py-1.5 px-3 font-mono font-semibold text-sf-text">
                          {formatMoney(item.balance_sdg, 'SDG')}
                        </td>
                        <td className="py-1.5 px-3 font-mono text-sf-muted">
                          {formatMoney(item.balance_usd, 'USD')}
                        </td>
                      </tr>
                    ))}

                    {/* Current Period Profit line */}
                    <tr className="bg-sf-selected/30 border border-sf-action/40">
                      <td className="py-2 px-3 font-mono text-sf-action font-semibold">PL-NET</td>
                      <td className="py-2 px-3 text-sf-action font-semibold">أرباح الفترة الحالية (من قائمة الدخل)</td>
                      <td className="py-2 px-3 font-mono font-semibold text-sf-action">
                        {formatMoney(balanceSheet.current_period_profit_sdg, 'SDG')}
                      </td>
                      <td className="py-2 px-3 font-mono text-sf-action">
                        {formatMoney(balanceSheet.current_period_profit_usd, 'USD')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Total Liabilities + Equity Summary */}
              <div className="p-3 bg-sf-raised border border-sf-border rounded-xl flex items-center justify-between text-xs font-semibold">
                <span className="text-sf-text">مجموع الخصوم وحقوق الملكية:</span>
                <span className="font-mono text-sf-action text-sm">
                  {formatMoney(balanceSheet.total_liabilities_and_equity_sdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>
        </div>

);
