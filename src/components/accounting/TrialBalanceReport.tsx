import React from 'react';
import { formatMoney } from '../../lib/currency';
import type { MerchantSettings } from '../../types';
import { calculateTrialBalance, calculateIncomeStatement, calculateBalanceSheet, calculateCashFlowStatement } from '../../services/accountingService';
import { BookOpen, Plus, RotateCcw, CheckCircle2, AlertCircle, Search, Filter, ArrowDownLeft, ArrowUpRight, TrendingUp, FileSpreadsheet, Coins, DollarSign, Layers, Scale, Calendar, Tag, ShieldCheck, Lock, Unlock, Landmark, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
interface Props { trialBalance: ReturnType<typeof calculateTrialBalance>; incomeStatement: ReturnType<typeof calculateIncomeStatement>; balanceSheet: ReturnType<typeof calculateBalanceSheet>; cashFlow: ReturnType<typeof calculateCashFlowStatement>; settings: MerchantSettings; theme: 'light'|'dark'; }
export const TrialBalanceReport: React.FC<Props> = ({ trialBalance, incomeStatement, balanceSheet, cashFlow, settings, theme }) => (
        <div className="space-y-4">
          {/* Status Header */}
          <div className="bg-sf-surface border border-sf-border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-sf-text">ميزان المراجعة بالأرصدة والمجاميع</h3>
                {trialBalance.isBalanced ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-sf-selected/80 text-sf-action border border-sf-action/50 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    الميزان متزن 100%
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-sf-danger-bg/80 text-sf-danger border border-sf-danger/50 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    يوجد فرق في توازن الميزان
                  </span>
                )}
              </div>
              <p className="text-xs text-sf-muted mt-1">
                تجميع لكافة حركات المدين والدائن والأرصدة الصافية لجميع الحسابات النشطة.
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="text-right">
                <span className="text-sf-muted block text-[10px]">مجموع المدين (ج.س)</span>
                <span className="font-bold text-sky-400 text-sm">
                  {formatMoney(trialBalance.totalDebitSdg, 'SDG')}
                </span>
              </div>
              <div className="h-8 w-px bg-sf-raised"></div>
              <div className="text-right">
                <span className="text-sf-muted block text-[10px]">مجموع الدائن (ج.س)</span>
                <span className="font-bold text-sf-warning text-sm">
                  {formatMoney(trialBalance.totalCreditSdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>

          {/* Trial Balance Table */}
          <div className="bg-sf-surface border border-sf-border rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-sf-raised text-sf-muted font-bold border-b border-sf-border">
                  <tr>
                    <th className="py-3 px-4">رمز الحساب</th>
                    <th className="py-3 px-4">اسم الحساب</th>
                    <th className="py-3 px-4">مجموع المدين (ج.س)</th>
                    <th className="py-3 px-4">مجموع الدائن (ج.س)</th>
                    <th className="py-3 px-4">الرصيد الصافي (ج.س)</th>
                    <th className="py-3 px-4">الرصيد الصافي ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sf-border">
                  {trialBalance.items.map((item) => (
                    <tr key={item.account_code} className="hover:bg-sf-raised">
                      <td className="py-2.5 px-4 font-mono font-bold text-sf-action">
                        {item.account_code}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-sf-text">{item.account_name}</td>
                      <td className="py-2.5 px-4 font-mono text-sky-400">
                        {item.total_debit_sdg > 0 ? formatMoney(item.total_debit_sdg, 'SDG') : '-'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-sf-warning">
                        {item.total_credit_sdg > 0 ? formatMoney(item.total_credit_sdg, 'SDG') : '-'}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold text-sf-text">
                        {formatMoney(item.net_balance_sdg, 'SDG')}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-sf-muted">
                        {formatMoney(item.net_balance_usd, 'USD')}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-sf-raised font-mono font-black border-t-2 border-sf-action/40 text-xs">
                  <tr>
                    <td colSpan={2} className="py-3 px-4 text-sf-text">
                      الإجمالي العام
                    </td>
                    <td className="py-3 px-4 text-sky-400">
                      {formatMoney(trialBalance.totalDebitSdg, 'SDG')}
                    </td>
                    <td className="py-3 px-4 text-sf-warning">
                      {formatMoney(trialBalance.totalCreditSdg, 'SDG')}
                    </td>
                    <td colSpan={2} className="py-3 px-4 text-sf-action text-left">
                      {trialBalance.isBalanced ? '✓ متوازن تماماً' : '⚠ غير متوازن'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

);
