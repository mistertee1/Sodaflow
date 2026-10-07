import { AccountingPeriodsCenter } from './accounting/AccountingPeriodsCenter';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { api } from '../services/businessApi';
import type { Operations } from '../domain/operations';
import { useApp } from '../context/AppContext';
import {
  BookOpen,
  Plus,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  FileSpreadsheet,
  Coins,
  DollarSign,
  Layers,
  Scale,
  Calendar,
  Tag,
  ShieldCheck,
  Lock,
  Unlock,
  Landmark,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { formatMoney } from '../lib/currency';
import { Account, AccountCategory, AccountNature, JournalEntry, JournalEntryLine } from '../types';
import {
  calculateTrialBalance,
  calculateIncomeStatement,
  calculateBalanceSheet,
  calculateCashFlowStatement,
  validateJournalEntryBalance,
} from '../services/accountingService';

import { TrialBalanceReport } from './accounting/TrialBalanceReport';
import { IncomeReport } from './accounting/IncomeReport';
import { BalanceSheetReport } from './accounting/BalanceSheetReport';
import { CashFlowReport } from './accounting/CashFlowReport';
import { classifyAccount, reportingGroupsFor, reportingGroupLabels, type ReportingGroup } from '../domain/accountClassification';
import { hasIncompleteInvoiceCosts } from '../domain/inventoryCost';
import { OperationalCenter } from './accounting/OperationalCenter';
import { PayablesCenter } from './accounting/PayablesCenter';
import { Dialog } from './Dialog';
export const AccountingView: React.FC = () => {
  const {
    invoices,
    products,
    accounts,
    journalEntries,
    addAccount,
    updateAccount,
    addJournalEntry,
    resetChartOfAccounts,
    isActionAllowed,
    settings,
    updateSettings,
    theme,
    currentUser, currentOrg, counters,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<
    'ledger' | 'receivables' | 'cash' | 'payables' | 'coa' | 'journal' | 'trial' | 'income' | 'balance_sheet' | 'cash_flow' | 'period_lock'
  >('coa');
  const [reportStart, setReportStart] = useState('');
  const [reportEnd, setReportEnd] = useState('');
  const [remoteReports, setRemoteReports] = useState<Awaited<ReturnType<Operations['advancedReports']>> | null>(null);
  const [reportError, setReportError] = useState('');
  const advancedAllowed = isActionAllowed('reports:advanced');
  const advancedTab = ['income', 'balance_sheet', 'cash_flow'].includes(activeSubTab);
  const reportsReady = !currentUser || remoteReports?.organizationId === currentOrg?.id && (remoteReports.period.start || '') === reportStart && (remoteReports.period.end || '') === reportEnd;
  useEffect(() => {
    let active = true; setRemoteReports(null); setReportError('');
    if (currentUser && currentOrg && advancedAllowed && advancedTab) void api<Awaited<ReturnType<Operations['advancedReports']>>>(`/organizations/${encodeURIComponent(currentOrg.id)}/reports/advanced?start=${encodeURIComponent(reportStart)}&end=${encodeURIComponent(reportEnd)}`).then(value => { if (active) setRemoteReports(value); }).catch(error => { if (active) setReportError(error instanceof Error ? error.message : 'تعذر تحميل التقارير.'); });
    return () => { active = false; };
  }, [currentUser?.uid, currentOrg?.id, counters.revision, advancedAllowed, advancedTab, reportStart, reportEnd]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Journal date & type filter + pagination
  const [journalStartDate, setJournalStartDate] = useState('');
  const [journalEndDate, setJournalEndDate] = useState('');
  const [journalTypeFilter, setJournalTypeFilter] = useState<string>('ALL');
  const [journalPage, setJournalPage] = useState(1);
  const [journalPageSize, setJournalPageSize] = useState(10);

  // Modal States
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [newAccCode, setNewAccCode] = useState('');
  const [newAccNameAr, setNewAccNameAr] = useState('');
  const [newAccNameEn, setNewAccNameEn] = useState('');
  const [newAccType, setNewAccType] = useState<AccountCategory>('EXPENSE');
  const [newAccNature, setNewAccNature] = useState<AccountNature>('DEBIT');
  const [newAccGroup, setNewAccGroup] = useState<ReportingGroup>('operating_expense');
  const [newAccDesc, setNewAccDesc] = useState('');
  const [accFormError, setAccFormError] = useState<string | null>(null);

  // Manual Journal Entry Modal State
  const [isNewEntryOpen, setIsNewEntryOpen] = useState(false);
  const [entryDescription, setEntryDescription] = useState('');
  const [entryAdjusting, setEntryAdjusting] = useState(false), [entryReason, setEntryReason] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [entryLines, setEntryLines] = useState<
    Array<{
      account_code: string;
      debit_sdg: number;
      credit_sdg: number;
      debit_usd: number;
      credit_usd: number;
      description?: string;
    }>
  >([
    { account_code: '', debit_sdg: 0, credit_sdg: 0, debit_usd: 0, credit_usd: 0 },
    { account_code: '', debit_sdg: 0, credit_sdg: 0, debit_usd: 0, credit_usd: 0 },
  ]);
  const [entryError, setEntryError] = useState<string | null>(null);
  const entrySubmitting = useRef(false);
  const [isSavingEntry, setIsSavingEntry] = useState(false);

  const reportBundle = useMemo(() => {
    const period = { start: reportStart, end: reportEnd };
    try { return { error: '', trial: calculateTrialBalance(accounts, journalEntries, period), income: calculateIncomeStatement(journalEntries, accounts, period), balance: calculateBalanceSheet(accounts, journalEntries, period), cash: calculateCashFlowStatement(accounts, journalEntries, period) }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'تعذر حساب التقارير.', trial: calculateTrialBalance([], []), income: calculateIncomeStatement([], []), balance: calculateBalanceSheet([], []), cash: calculateCashFlowStatement([], []) }; }
  }, [accounts, journalEntries, reportStart, reportEnd]);
  const bundle = currentUser && remoteReports ? { trial: remoteReports.trialBalance, income: remoteReports.incomeStatement, balance: remoteReports.balanceSheet, cash: remoteReports.cashFlow } : reportBundle;
  const { trial: trialBalance, income: ledgerIncome, balance: balanceSheet, cash: cashFlow } = bundle;
  const incompleteCosts = currentUser ? remoteReports?.incomeStatement.costs_complete === false : hasIncompleteInvoiceCosts(invoices, products, journalEntries, { start: reportStart, end: reportEnd });
  const incomeStatement = { ...ledgerIncome, costs_complete: !incompleteCosts };

  // Filtered Accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchesSearch =
        acc.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        acc.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (acc.name_en && acc.name_en.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = categoryFilter === 'ALL' || acc.type === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [accounts, searchQuery, categoryFilter]);

  // Filtered Journal Entries
  const filteredEntries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return journalEntries.filter((e) => {
      const matchesQuery =
        !q ||
        e.entry_number.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.reference_id?.toLowerCase().includes(q) ||
        e.lines.some((l) => l.account_code.includes(q) || l.account_name.toLowerCase().includes(q));

      const entryDateOnly = e.date ? e.date.split('T')[0] : '';
      const matchesStartDate = !journalStartDate || entryDateOnly >= journalStartDate;
      const matchesEndDate = !journalEndDate || entryDateOnly <= journalEndDate;

      const matchesType =
        journalTypeFilter === 'ALL' || e.reference_type === journalTypeFilter;

      return matchesQuery && matchesStartDate && matchesEndDate && matchesType;
    });
  }, [journalEntries, searchQuery, journalStartDate, journalEndDate, journalTypeFilter]);

  const totalJournalPages = Math.max(1, Math.ceil(filteredEntries.length / journalPageSize));
  const paginatedEntries = useMemo(() => {
    const start = (journalPage - 1) * journalPageSize;
    return filteredEntries.slice(start, start + journalPageSize);
  }, [filteredEntries, journalPage, journalPageSize]);

  // Account Categories Map
  const categoryLabels: Record<AccountCategory, { label: string; color: string }> = {
    ASSET: { label: 'أصول (Assets)', color: 'text-sf-text bg-sf-raised border-sf-border' },
    LIABILITY: { label: 'خصوم والتزامات (Liabilities)', color: 'text-sf-warning bg-sf-warning-bg/40 border-sf-warning/40' },
    EQUITY: { label: 'حقوق الملكية (Equity)', color: 'text-sf-text bg-sf-raised border-sf-border' },
    REVENUE: { label: 'إيرادات (Revenue)', color: 'text-sf-action bg-sf-selected/40 border-sf-action/40' },
    EXPENSE: { label: 'مصروفات (Expenses)', color: 'text-sf-danger bg-sf-danger-bg/40 border-sf-danger/40' },
  };

  // Handle Add Account Submit
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccFormError(null);
    if (!newAccCode.trim() || !newAccNameAr.trim()) {
      setAccFormError('يرجى ملء رمز الحساب واسم الحساب باللغة العربية');
      return;
    }
    if (accounts.some((a) => a.code === newAccCode.trim())) {
      setAccFormError('رمز الحساب هذا مستخدم مسبقاً، يرجى اختيار رمز مختلف');
      return;
    }

    try {
      await addAccount({
        code: newAccCode.trim(),
        name_ar: newAccNameAr.trim(),
        name_en: newAccNameEn.trim() || '',
        type: newAccType,
        nature: newAccNature,
        ...classifyAccount({ code: newAccCode.trim(), type: newAccType, nature: newAccNature, reporting_group: newAccGroup }),
        is_system: false,
        is_active: true,
        balance_sdg: 0,
        balance_usd: 0,
        description: newAccDesc.trim() || '',
      });

      setIsAddAccountOpen(false);
      setNewAccCode('');
      setNewAccNameAr('');
      setNewAccNameEn('');
      setNewAccDesc('');
    } catch (err: any) {
      setAccFormError(err.message || 'حدث خطأ أثناء إضافة الحساب');
    }
  };

  // Add line to manual journal entry
  const handleAddEntryLine = () => {
    setEntryLines([
      ...entryLines,
      { account_code: '', debit_sdg: 0, credit_sdg: 0, debit_usd: 0, credit_usd: 0 },
    ]);
  };

  const handleRemoveEntryLine = (index: number) => {
    if (entryLines.length <= 2) return;
    setEntryLines(entryLines.filter((_, i) => i !== index));
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    const updated = [...entryLines];
    updated[index] = { ...updated[index], [field]: value };
    setEntryLines(updated);
  };

  // Compute total debit and credit in modal
  const modalDebitSdg = entryLines.reduce((s, l) => s + (Number(l.debit_sdg) || 0), 0);
  const modalCreditSdg = entryLines.reduce((s, l) => s + (Number(l.credit_sdg) || 0), 0);
  const modalIsBalanced = validateJournalEntryBalance(entryLines.map(line => ({ ...line, account_name: line.account_code }))).isValid;

  // Submit manual journal entry
  const handleCreateJournalEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (entrySubmitting.current) return;
    setEntryError(null);

    if (entryAdjusting && (!isActionAllowed('periods:adjust') || !entryReason.trim())) { setEntryError('قيد التسوية يتطلب صلاحية وسبباً واضحاً.'); return; }
    if (!entryDescription.trim()) {
      setEntryError('يرجى كتابة شرح أو بيان للقيد المحاسبي');
      return;
    }

    if (entryLines.some((l) => !l.account_code)) {
      setEntryError('يرجى اختيار حساب لكل طرف في القيد');
      return;
    }

    if (modalDebitSdg <= 0 && entryLines.every(line => line.debit_usd <= 0)) {
      setEntryError('يجب أن يحتوي القيد على مبالغ صحيحة أكبر من الصفر');
      return;
    }

    if (!modalIsBalanced) {
      setEntryError(`القيد غير متزن: مجموع المدين (${modalDebitSdg}) لا يساوي مجموع الدائن (${modalCreditSdg})`);
      return;
    }

    entrySubmitting.current = true;
    setIsSavingEntry(true);
    try {
      const lines: JournalEntryLine[] = entryLines.map((l, idx) => {
        const acc = accounts.find((a) => a.code === l.account_code);
        return {
          id: `line-${Date.now()}-${idx}`,
          account_code: l.account_code,
          account_name: acc?.name_ar || l.account_code,
          debit_sdg: Number(l.debit_sdg) || 0,
          credit_sdg: Number(l.credit_sdg) || 0,
          debit_usd: Number(l.debit_usd) || 0,
          credit_usd: Number(l.credit_usd) || 0,
          description: l.description || entryDescription,
          notes: l.description || entryDescription,
        };
      });

      const entryNumber = `JV-${new Date().getFullYear()}-${(journalEntries.length + 1).toString().padStart(4, '0')}`;

      await addJournalEntry({
        ...(entryAdjusting ? { adjusting: true, reason: entryReason.trim() } : {}),
        entry_number: entryNumber,
        date: entryDate,
        description: entryDescription,
        reference_type: 'manual',
        reference_id: entryNumber,
        lines,
        total_debit_sdg: modalDebitSdg,
        total_credit_sdg: modalCreditSdg,
        total_debit_usd: 0,
        total_credit_usd: 0,
        is_balanced: true,
        exchange_rate_used: settings.default_exchange_rate,
      });

      setIsNewEntryOpen(false);
      setEntryDescription(''); setEntryAdjusting(false); setEntryReason('');
      setEntryLines([
        { account_code: '', debit_sdg: 0, credit_sdg: 0, debit_usd: 0, credit_usd: 0 },
        { account_code: '', debit_sdg: 0, credit_sdg: 0, debit_usd: 0, credit_usd: 0 },
      ]);
    } catch (err: any) {
      setEntryError(err.message || 'حدث خطأ أثناء حفظ القيد المحاسبي');
    } finally {
      entrySubmitting.current = false;
      setIsSavingEntry(false);
    }
  };

  const reportDates = <div className="flex flex-wrap gap-3 items-end bg-sf-surface border border-sf-border p-4 rounded-xl">
    <label className="text-xs space-y-1">من تاريخ<input aria-label="بداية فترة التقرير" type="date" value={reportStart} onChange={e => setReportStart(e.target.value)} className="block bg-sf-raised border border-sf-border rounded-lg p-2" /></label>
    <label className="text-xs space-y-1">إلى تاريخ<input aria-label="نهاية فترة التقرير" type="date" value={reportEnd} onChange={e => setReportEnd(e.target.value)} className="block bg-sf-raised border border-sf-border rounded-lg p-2" /></label>
    <button className="text-xs text-sf-action p-2" onClick={() => { setReportStart(''); setReportEnd(''); }}>كل الفترات</button>
    <p className="text-xs text-sf-muted w-full">الدخل والتدفقات وحركة ميزان المراجعة للفترة المختارة. المركز المالي تراكمي حتى نهاية الفترة؛ الافتتاحي من القيود السابقة.</p>
  </div>;

  return (
    <div className="space-y-6">
      {reportDates}
      {incompleteCosts && <p role="status" className="bg-sf-warning-bg text-sf-warning border border-sf-border p-4 rounded-xl">تكلفة بعض فواتير هذه الفترة غير موثقة. الإيرادات والقيود محفوظة، لكن الربح الكامل غير متاح حتى مراجعة التكلفة التاريخية.</p>}
      {advancedTab && !advancedAllowed && <p role="status" className="text-sf-muted p-4">التقارير المتقدمة غير متاحة في الباقة أو صلاحيات الحساب الحالية.</p>}
      {advancedTab && advancedAllowed && currentUser && !reportsReady && !reportError && <p role="status" className="text-sf-muted p-4">جاري تحميل التقارير من الخادم…</p>}
      {advancedTab && reportError && <p role="alert" className="text-sf-danger p-4">{reportError}</p>}
      {reportBundle.error && <p role="alert" className="bg-sf-danger-bg text-sf-danger border border-sf-danger p-4 rounded-xl">{reportBundle.error}</p>}
      {/* Top Header Card */}
      <div className="bg-sf-surface border border-sf-border rounded-xl p-6 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-sf-action/10 border border-sf-action/30 flex items-center justify-center text-sf-action">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-semibold text-sf-text">دفتر الأستاذ والمحاسبة العامة</h2>
                <span className="text-xs px-3 py-1 rounded-full bg-sf-selected/70 text-sf-action border border-sf-action/40 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  قيد مزدوج آلي
                </span>
              </div>
              <p className="text-xs text-sf-muted mt-1">
                دليل الحسابات المتوافق مع الأنشطة التجارية السودانية، اليومية العامة، ميزان المراجعة، وقائمة الدخل.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isActionAllowed('journal:create') && (
              <button
                onClick={() => setIsNewEntryOpen(true)}
                className="px-4 py-2 rounded-xl bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs flex items-center gap-2 shadow-lg shadow-sf-action/20 transition-all "
              >
                <Plus className="w-4 h-4" />
                <span>قيد يومية يدوي</span>
              </button>
            )}

            {isActionAllowed('accounts:create') && (
              <button
                onClick={() => setIsAddAccountOpen(true)}
                className="px-4 py-2 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border font-semibold text-xs flex items-center gap-2 transition-all"
              >
                <Plus className="w-4 h-4 text-sf-action" />
                <span>إضافة حساب</span>
              </button>
            )}

            {isActionAllowed('accounts:update') && (
              <button
                onClick={() => {
                  if (window.confirm('هل تريد إعادة تعيين دليل الحسابات إلى التوزيع القياسي الافتراضي؟')) {
                    resetChartOfAccounts();
                  }
                }}
                title="إعادة ضبط شجرة الحسابات الافتراضية"
                className="p-2 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-muted hover:text-sf-text border border-sf-border transition-all"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-2 border-t border-sf-border mt-6 pt-4 overflow-x-auto pb-1 [&>button]:shrink-0">
          {(['ledger', 'receivables', 'cash'] as const).map(view => <button key={view} onClick={() => setActiveSubTab(view)} aria-pressed={activeSubTab === view} className="sf-secondary shrink-0 whitespace-nowrap">{{ ledger: 'دفتر الأستاذ', receivables: 'كشوف العملاء', cash: 'النقدية والبنوك' }[view]}</button>)}
          {isActionAllowed('payables:read') && <button onClick={() => setActiveSubTab('payables')} aria-pressed={activeSubTab === 'payables'} className="sf-secondary shrink-0 whitespace-nowrap">الموردون والمشتريات</button>}
          <button
            onClick={() => setActiveSubTab('coa')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'coa'
                ? 'bg-sf-action/10 text-sf-action border border-sf-action/30'
                : 'text-sf-muted hover:text-sf-text hover:bg-sf-raised'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>دليل الحسابات ({accounts.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('journal')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'journal'
                ? 'bg-sf-action/10 text-sf-action border border-sf-action/30'
                : 'text-sf-muted hover:text-sf-text hover:bg-sf-raised'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>دفتر القيود واليومية ({journalEntries.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('trial')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'trial'
                ? 'bg-sf-action/10 text-sf-action border border-sf-action/30'
                : 'text-sf-muted hover:text-sf-text hover:bg-sf-raised'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>ميزان المراجعة</span>
            {!reportBundle.error && trialBalance.isBalanced ? (
              <span className="w-2 h-2 rounded-full bg-sf-action"></span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-sf-danger"></span>
            )}
          </button>

          <button
            disabled={!advancedAllowed}
            onClick={() => setActiveSubTab('income')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'income'
                ? 'bg-sf-action/10 text-sf-action border border-sf-action/30'
                : 'text-sf-muted hover:text-sf-text hover:bg-sf-raised'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>قائمة الدخل</span>
          </button>

          <button
            disabled={!advancedAllowed}
            onClick={() => setActiveSubTab('balance_sheet')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'balance_sheet'
                ? 'bg-sf-action/10 text-sf-action border border-sf-action/30'
                : 'text-sf-muted hover:text-sf-text hover:bg-sf-raised'
            }`}
          >
            <Landmark className="w-4 h-4" />
            <span>الميزانية العمومية</span>
            {balanceSheet.is_balanced ? (
              <span className="w-2 h-2 rounded-full bg-sf-action"></span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-sf-danger"></span>
            )}
          </button>

          <button
            disabled={!advancedAllowed}
            onClick={() => setActiveSubTab('cash_flow')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'cash_flow'
                ? 'bg-sf-action/10 text-sf-action border border-sf-action/30'
                : 'text-sf-muted hover:text-sf-text hover:bg-sf-raised'
            }`}
          >
            <Coins className="w-4 h-4" />
            <span>التدفقات النقدية</span>
          </button>

          <button
            onClick={() => setActiveSubTab('period_lock')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'period_lock'
                ? 'bg-sf-warning-bg/15 text-sf-warning border border-sf-warning/40'
                : 'text-sf-muted hover:text-sf-text hover:bg-sf-raised'
            }`}
          >
            {settings.period_lock_date ? (
              <Lock className="w-4 h-4 text-sf-warning" />
            ) : (
              <Unlock className="w-4 h-4 text-sf-muted" />
            )}
            <span>إقفال الفترات</span>
            {settings.period_lock_date && (
              <span className="text-xs px-2 py-1 rounded bg-sf-warning-bg/80 text-sf-warning font-mono border border-sf-warning/50">
                مقفلة
              </span>
            )}
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: CHART OF ACCOUNTS (دليل الحسابات) */}
      {activeSubTab === 'coa' && (
        <div className="space-y-4">
          {/* Filter and Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-sf-surface border border-sf-border p-3 rounded-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-sf-muted absolute right-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث برمز الحساب أو الاسم..."
                className="w-full bg-sf-raised border border-sf-border rounded-lg pr-12 pl-3 py-2 text-xs text-sf-text placeholder:text-sf-muted focus:outline-none focus:border-sf-action"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <button
                onClick={() => setCategoryFilter('ALL')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  categoryFilter === 'ALL'
                    ? 'bg-sf-action/20 text-sf-action border border-sf-action/40'
                    : 'text-sf-muted hover:text-sf-text bg-sf-raised'
                }`}
              >
                الكل
              </button>
              {(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as AccountCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    categoryFilter === cat
                      ? 'bg-sf-action/20 text-sf-action border border-sf-action/40'
                      : 'text-sf-muted hover:text-sf-text bg-sf-raised'
                  }`}
                >
                  {categoryLabels[cat].label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Accounts Grid / Table */}
          <div className="bg-sf-surface border border-sf-border rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-sf-raised text-sf-muted font-semibold border-b border-sf-border">
                  <tr>
                    <th className="py-3 px-4">رمز الحساب</th>
                    <th className="py-3 px-4">اسم الحساب</th>
                    <th className="py-3 px-4">النوع / التبويب</th>
                    <th className="py-3 px-4">الطبيعة المحاسبية</th>
                    <th className="py-3 px-4">الرصيد بالجنيه</th>
                    <th className="py-3 px-4">الرصيد بالدولار</th>
                    <th className="py-3 px-4">حالة الحساب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sf-border">
                  {filteredAccounts.map((acc) => {
                    const trialItem = trialBalance.items.find((ti) => ti.account_code === acc.code);
                    const balSdg = trialItem ? trialItem.net_balance_sdg : acc.balance_sdg;
                    const balUsd = trialItem ? trialItem.net_balance_usd : acc.balance_usd;

                    return (
                      <tr key={acc.code} className="hover:bg-sf-raised/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-sf-text">
                          {acc.code}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-sf-text">{acc.name_ar}</div>
                          {acc.name_en && (
                            <div className="text-xs text-sf-muted font-mono">{acc.name_en}</div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-semibold border ${categoryLabels[acc.type]?.color}`}
                          >
                            {categoryLabels[acc.type]?.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-1 rounded-md text-xs font-semibold ${
                              acc.nature === 'DEBIT'
                                ? 'bg-sf-raised text-sf-text border border-sf-border'
                                : 'bg-sf-warning-bg/50 text-sf-warning border border-sf-warning/40'
                            }`}
                          >
                            {acc.nature === 'DEBIT' ? 'مدين (Debit)' : 'دائن (Credit)'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-sf-text">
                          {reportBundle.error ? '—' : formatMoney(balSdg, 'SDG')}
                        </td>
                        <td className="py-3 px-4 font-mono text-sf-muted">
                          {reportBundle.error ? '—' : formatMoney(balUsd, 'USD')}
                        </td>
                        <td className="py-3 px-4">
                          {acc.is_system ? (
                            <span className="text-xs px-2 py-1 rounded bg-sf-raised text-sf-muted font-medium">
                              نظامي أساسي
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded bg-sf-selected text-sf-action font-medium">
                              مخصص
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAccounts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sf-muted">
                        لا توجد حسابات مطابقة لمعايير البحث
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: GENERAL JOURNAL (دفتر اليومية العامة والقيود) */}
      {activeSubTab === 'journal' && (
        <div className="space-y-4">
          <div className="bg-sf-surface border border-sf-border p-4 rounded-xl space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-sf-muted absolute right-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setJournalPage(1);
                  }}
                  placeholder="ابحث برقم القيد أو البيان..."
                  className="w-full bg-sf-raised border border-sf-border rounded-xl pr-12 pl-3 py-2 text-xs text-sf-text placeholder:text-sf-muted focus:outline-none focus:border-sf-action"
                />
              </div>

              <div>
                <select
                  value={journalTypeFilter}
                  onChange={(e) => {
                    setJournalTypeFilter(e.target.value);
                    setJournalPage(1);
                  }}
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                >
                  <option value="ALL">كافة أنواع القيود</option>
                  <option value="invoice">فواتير مبيعات</option>
                  <option value="payment">سندات قبض (تحصيل)</option>
                  <option value="expense">مصروفات تشغيلية</option>
                  <option value="void">إلغاء وإبطال فواتير</option>
                  <option value="manual">قيود تسوية يدوية</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-sf-muted whitespace-nowrap">من:</span>
                <input
                  type="date"
                  value={journalStartDate}
                  onChange={(e) => {
                    setJournalStartDate(e.target.value);
                    setJournalPage(1);
                  }}
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-2 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-sf-muted whitespace-nowrap">إلى:</span>
                <input
                  type="date"
                  value={journalEndDate}
                  onChange={(e) => {
                    setJournalEndDate(e.target.value);
                    setJournalPage(1);
                  }}
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-2 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-sf-muted pt-2 border-t border-sf-border flex-wrap gap-2">
              <div>
                إجمالي القيود المطابقة: <span className="font-mono text-sf-text font-semibold">{filteredEntries.length}</span> من أصل {journalEntries.length}
              </div>

              {(searchQuery || journalStartDate || journalEndDate || journalTypeFilter !== 'ALL') && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setJournalStartDate('');
                    setJournalEndDate('');
                    setJournalTypeFilter('ALL');
                    setJournalPage(1);
                  }}
                  className="text-sf-warning hover:underline text-xs"
                >
                  إعادة تعيين الفلاتر
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {paginatedEntries.map((entry) => (
              <div
                key={entry.id}
                className="bg-sf-surface border border-sf-border rounded-xl p-4 sm:p-6 shadow-sm space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-sf-border pb-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono font-semibold text-sm text-sf-text">
                      {entry.entry_number}
                    </span>
                    <span className="text-xs text-sf-muted font-medium">| {entry.date}</span>
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-semibold border ${
                        entry.reference_type === 'invoice'
                          ? 'bg-sf-selected/60 text-sf-action border-sf-action/40'
                          : entry.reference_type === 'payment'
                          ? 'bg-sf-raised text-sf-text border-sf-border'
                          : entry.reference_type === 'expense'
                          ? 'bg-sf-danger-bg/60 text-sf-danger border-sf-danger/40'
                          : entry.reference_type === 'void'
                          ? 'bg-sf-raised text-sf-text border-sf-border'
                          : 'bg-sf-raised text-sf-text border-sf-border'
                      }`}
                    >
                      {entry.reference_type === 'invoice'
                        ? 'فاتورة مبيعات'
                        : entry.reference_type === 'payment'
                        ? 'سند قبض'
                        : entry.reference_type === 'expense'
                        ? 'مصروفات'
                        : entry.reference_type === 'void'
                        ? 'إلغاء فاتورة'
                        : 'قيد يدوي'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-xs font-mono font-semibold text-sf-text">
                      الإجمالي: {formatMoney(entry.total_debit_sdg, 'SDG')}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-sf-selected/80 text-sf-action border border-sf-action/40 font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      متزن
                    </span>
                  </div>
                </div>

                <p className="text-xs text-sf-text font-semibold">{entry.description}</p>

                {/* Journal Entry Lines Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-sf-raised text-sf-muted font-semibold border-b border-sf-border">
                      <tr>
                        <th className="py-2 px-3">رقم الحساب</th>
                        <th className="py-2 px-3">اسم الحساب</th>
                        <th className="py-2 px-3">البيان الفرعي</th>
                        <th className="py-2 px-3">مدين (ج.س)</th>
                        <th className="py-2 px-3">دائن (ج.س)</th>
                        <th className="py-2 px-3">مدين ($)</th>
                        <th className="py-2 px-3">دائن ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sf-border">
                      {entry.lines.map((line, idx) => (
                        <tr key={idx} className="hover:bg-sf-raised">
                          <td className="py-2 px-3 font-mono font-semibold text-sf-text">
                            {line.account_code}
                          </td>
                          <td className="py-2 px-3 font-medium text-sf-text">{line.account_name}</td>
                          <td className="py-2 px-3 text-sf-muted text-xs">{line.description || '-'}</td>
                          <td className="py-2 px-3 font-mono font-semibold text-sf-text">
                            {line.debit_sdg > 0 ? formatMoney(line.debit_sdg, 'SDG') : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-sf-warning">
                            {line.credit_sdg > 0 ? formatMoney(line.credit_sdg, 'SDG') : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono text-sf-muted">
                            {line.debit_usd > 0 ? formatMoney(line.debit_usd, 'USD') : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono text-sf-muted">
                            {line.credit_usd > 0 ? formatMoney(line.credit_usd, 'USD') : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {filteredEntries.length === 0 && (
              <div className="bg-sf-surface border border-sf-border rounded-xl p-8 text-center text-sf-muted">
                لا توجد قيود يومية مطابقة لمعايير البحث المحددة
              </div>
            )}

            {/* Pagination Controls */}
            {filteredEntries.length > 0 && (
              <div className="bg-sf-surface border border-sf-border rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-sf-muted">عدد القيود في الصفحة:</span>
                  <select
                    value={journalPageSize}
                    onChange={(e) => {
                      setJournalPageSize(Number(e.target.value));
                      setJournalPage(1);
                    }}
                    className="bg-sf-raised border border-sf-border rounded-lg px-2 py-1 text-sf-text"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-sf-muted">
                    الصفحة <span className="font-mono text-sf-text font-semibold">{journalPage}</span> من{' '}
                    <span className="font-mono text-sf-text">{totalJournalPages}</span>
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setJournalPage((p) => Math.max(1, p - 1))}
                      disabled={journalPage === 1}
                      className="p-2 rounded-lg bg-sf-raised border border-sf-border text-sf-text disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sf-raised"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setJournalPage((p) => Math.min(totalJournalPages, p + 1))}
                      disabled={journalPage === totalJournalPages}
                      className="p-2 rounded-lg bg-sf-raised border border-sf-border text-sf-text disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sf-raised"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: TRIAL BALANCE (ميزان المراجعة) */}
      {!reportBundle.error && activeSubTab === 'trial' && <TrialBalanceReport trialBalance={trialBalance} incomeStatement={incomeStatement} balanceSheet={balanceSheet} cashFlow={cashFlow} settings={settings} theme={theme} />}

      {/* SUB-TAB 4: INCOME STATEMENT (قائمة الدخل والأرباح) */}
      {!reportBundle.error && !reportError && advancedAllowed && reportsReady && activeSubTab === 'income' && <IncomeReport trialBalance={trialBalance} incomeStatement={incomeStatement} balanceSheet={balanceSheet} cashFlow={cashFlow} settings={settings} theme={theme} />}

      {/* SUB-TAB 5: BALANCE SHEET (الميزانية العمومية والمركز المالي) */}
      {!reportBundle.error && !reportError && advancedAllowed && reportsReady && activeSubTab === 'balance_sheet' && <BalanceSheetReport trialBalance={trialBalance} incomeStatement={incomeStatement} balanceSheet={balanceSheet} cashFlow={cashFlow} settings={settings} theme={theme} />}

      {/* SUB-TAB 6: CASH FLOW STATEMENT (قائمة التدفقات النقدية) */}
      {!reportBundle.error && !reportError && advancedAllowed && reportsReady && activeSubTab === 'cash_flow' && <CashFlowReport trialBalance={trialBalance} incomeStatement={incomeStatement} balanceSheet={balanceSheet} cashFlow={cashFlow} settings={settings} theme={theme} />}

      {/* SUB-TAB 7: ACCOUNTING PERIOD LOCK (إقفال الفترات المحاسبية) */}
      {(['ledger', 'receivables', 'cash'] as const).map(view => activeSubTab === view && <OperationalCenter key={view} view={view} />)}
      {activeSubTab === 'payables' && <PayablesCenter />}

      {activeSubTab === 'period_lock' && <AccountingPeriodsCenter key={`${currentOrg?.id}:${currentUser?.uid || 'local'}`} />}
      {isAddAccountOpen && (
        <Dialog label="إضافة حساب جديد" onClose={() => setIsAddAccountOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sf-ink/60 backdrop-blur-sm">
          <div className="bg-sf-surface border border-sf-border rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="font-semibold text-base text-sf-text border-b border-sf-border pb-3">
              إضافة حساب جديد إلى دليل الحسابات
            </h3>

            {accFormError && (
              <div role="alert" className="p-3 rounded-xl bg-sf-danger-bg/70 border border-sf-danger text-sf-danger text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{accFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-4 text-xs">
              <div>
                <label className="block text-sf-text font-semibold mb-1">رمز الحساب (رقم فريد)</label>
                <input
                  type="text"
                  value={newAccCode}
                  onChange={(e) => setNewAccCode(e.target.value)}
                  placeholder="مثال: 5310"
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text font-mono focus:outline-none focus:border-sf-action"
                  required
                />
              </div>

              <div>
                <label className="block text-sf-text font-semibold mb-1">اسم الحساب باللغة العربية</label>
                <input
                  type="text"
                  value={newAccNameAr}
                  onChange={(e) => setNewAccNameAr(e.target.value)}
                  placeholder="مثال: إيجار المخزن الشمالي"
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text focus:outline-none focus:border-sf-action"
                  required
                />
              </div>

              <div>
                <label className="block text-sf-text font-semibold mb-1">الاسم بالإنجليزية (اختياري)</label>
                <input
                  type="text"
                  value={newAccNameEn}
                  onChange={(e) => setNewAccNameEn(e.target.value)}
                  placeholder="مثال: North Warehouse Rent"
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text font-mono focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sf-text font-semibold mb-1">التبويب</label>
                  <select
                    value={newAccType}
                    onChange={(e) => { const type = e.target.value as AccountCategory; setNewAccType(type); setNewAccGroup(reportingGroupsFor(type)[0]); setNewAccNature(['ASSET', 'EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT'); }}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text focus:outline-none focus:border-sf-action"
                  >
                    <option value="ASSET">أصول (Assets)</option>
                    <option value="LIABILITY">خصوم (Liabilities)</option>
                    <option value="EQUITY">حقوق ملكية (Equity)</option>
                    <option value="REVENUE">إيرادات (Revenue)</option>
                    <option value="EXPENSE">مصروفات (Expense)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sf-text font-semibold mb-1">الطبيعة المحاسبية</label>
                  <select
                    value={newAccNature}
                    onChange={(e) => setNewAccNature(e.target.value as AccountNature)}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text focus:outline-none focus:border-sf-action"
                  >
                    <option value="DEBIT">مدين (Debit)</option>
                    <option value="CREDIT">دائن (Credit)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sf-text font-semibold mb-1" htmlFor="account-reporting-group">مجموعة التقرير</label>
                <select id="account-reporting-group" value={newAccGroup} onChange={e => setNewAccGroup(e.target.value as ReportingGroup)} className="w-full bg-sf-raised border border-sf-border rounded-xl p-2">
                  {reportingGroupsFor(newAccType).map(group => <option key={group} value={group}>{reportingGroupLabels[group]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sf-text font-semibold mb-1">وصف أو ملاحظات</label>
                <textarea
                  value={newAccDesc}
                  onChange={(e) => setNewAccDesc(e.target.value)}
                  placeholder="ملاحظات حول طبيعة استخدام هذا الحساب..."
                  rows={2}
                  className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text focus:outline-none focus:border-sf-action"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-sf-border">
                <button
                  type="button"
                  onClick={() => setIsAddAccountOpen(false)}
                  className="px-4 py-2 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 rounded-xl bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold shadow-lg shadow-sf-action/20"
                >
                  حفظ الحساب
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {/* MODAL 2: MANUAL JOURNAL ENTRY */}
      {isNewEntryOpen && (
        <Dialog label="إنشاء قيد يومية" onClose={() => setIsNewEntryOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sf-ink/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-sf-surface border border-sf-border rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-sf-border pb-3">
              <div>
                <h3 className="font-semibold text-base text-sf-text">إنشاء قيد يومية عامة يدوي</h3>
                <p className="text-xs text-sf-muted mt-1">
                  قيد مزدوج يتطلب توازن كامل بين أطراف المدين والدائن.
                </p>
              </div>
              <div className="text-xs font-mono">
                {modalIsBalanced ? (
                  <span className="px-3 py-1 rounded-full bg-sf-selected text-sf-action border border-sf-action font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    القيد متزن
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-sf-danger-bg text-sf-danger border border-sf-danger font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    فرق: {Math.abs(modalDebitSdg - modalCreditSdg).toLocaleString()} ج.س
                  </span>
                )}
              </div>
            </div>

            {entryError && (
              <div role="alert" className="p-3 rounded-xl bg-sf-danger-bg/70 border border-sf-danger text-sf-danger text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{entryError}</span>
              </div>
            )}

            <form onSubmit={handleCreateJournalEntry} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sf-text font-semibold mb-1">تاريخ القيد</label>
                  <input
                    type="date"
                    aria-label="تاريخ القيد" value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text font-mono focus:outline-none focus:border-sf-action"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sf-text font-semibold mb-1">البيان العام للقيد</label>
                  <input
                    type="text"
                    aria-label="البيان العام للقيد" value={entryDescription}
                    onChange={(e) => setEntryDescription(e.target.value)}
                    placeholder="مثال: سداد إيجار المحل أو تمويل رأس مال"
                    className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sf-text focus:outline-none focus:border-sf-action"
                    required
                  />
                </div>
              </div>

              {isActionAllowed('periods:adjust') && <div className="space-y-2"><label className="flex gap-2"><input type="checkbox" checked={entryAdjusting} onChange={e => setEntryAdjusting(e.target.checked)} disabled={isSavingEntry} />قيد تسوية لفترة مقفلة مبدئياً</label>{entryAdjusting && <label className="block">سبب التسوية<input aria-label="سبب التسوية" value={entryReason} onChange={e => setEntryReason(e.target.value)} required maxLength={1000} disabled={isSavingEntry} className="w-full mt-1 p-2 rounded border border-sf-border bg-sf-raised" /></label>}</div>}
              {/* Lines editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sf-text">أطراف القيد (الحسابات والعمليات)</span>
                  <button
                    type="button"
                    onClick={handleAddEntryLine}
                    className="text-xs font-semibold text-sf-action hover:text-sf-action flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة طرف آخر
                  </button>
                </div>

                <div className="space-y-3">
                  {entryLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="bg-sf-raised border border-sf-border p-3 rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                    >
                      <div className="sm:col-span-5">
                        <select
                          value={line.account_code}
                          onChange={(e) => handleLineChange(idx, 'account_code', e.target.value)}
                          className="w-full bg-sf-raised border border-sf-border rounded-lg px-3 py-2 text-xs text-sf-text focus:outline-none focus:border-sf-action"
                          required
                        >
                          <option value="">-- اختر الحساب --</option>
                          {accounts.map((acc) => (
                            <option key={acc.code} value={acc.code}>
                              {acc.code} - {acc.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-3">
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={line.debit_sdg || ''}
                            onChange={(e) => handleLineChange(idx, 'debit_sdg', parseFloat(e.target.value) || 0)}
                            placeholder="مدين ج.س"
                            className="w-full bg-sf-raised border border-sf-border rounded-lg px-2 py-2 text-xs font-mono font-semibold text-sf-text focus:outline-none focus:border-sf-action"
                          />
                        </div>
                      </div>

                      <div className="sm:col-span-3">
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={line.credit_sdg || ''}
                            onChange={(e) => handleLineChange(idx, 'credit_sdg', parseFloat(e.target.value) || 0)}
                            placeholder="دائن ج.س"
                            className="w-full bg-sf-raised border border-sf-border rounded-lg px-2 py-2 text-xs font-mono font-semibold text-sf-warning focus:outline-none focus:border-sf-warning"
                          />
                        </div>
                      </div>

                      <div className="sm:col-span-1 text-center">
                        {entryLines.length > 2 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveEntryLine(idx)}
                            className="text-sf-danger hover:text-sf-danger font-semibold text-base"
                            title="حذف هذا الطرف"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals Summary */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-sf-raised border border-sf-border font-mono text-xs font-semibold">
                  <span className="text-sf-muted font-sans">إجمالي الأطراف:</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sf-text">مدين: {modalDebitSdg.toLocaleString()} ج.س</span>
                    <span className="text-sf-warning">دائن: {modalCreditSdg.toLocaleString()} ج.س</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-sf-border">
                <button
                  type="button"
                  onClick={() => setIsNewEntryOpen(false)}
                  className="px-4 py-2 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSavingEntry || !modalIsBalanced}
                  className="px-6 py-2 rounded-xl bg-sf-action hover:bg-sf-action-hover disabled:opacity-50 text-sf-on-action font-semibold shadow-lg shadow-sf-action/20"
                >
                  {isSavingEntry ? 'جاري الترحيل...' : 'ترحيل القيد'}
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      )}
    </div>
  );
};

