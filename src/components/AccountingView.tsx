import React, { useState, useMemo } from 'react';
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
} from '../services/accountingService';

export const AccountingView: React.FC = () => {
  const {
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
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<
    'coa' | 'journal' | 'trial' | 'income' | 'balance_sheet' | 'cash_flow' | 'period_lock'
  >('coa');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Journal date & type filter + pagination
  const [journalStartDate, setJournalStartDate] = useState('');
  const [journalEndDate, setJournalEndDate] = useState('');
  const [journalTypeFilter, setJournalTypeFilter] = useState<string>('ALL');
  const [journalPage, setJournalPage] = useState(1);
  const [journalPageSize, setJournalPageSize] = useState(10);

  // Period Lock State
  const [lockDateInput, setLockDateInput] = useState(settings.period_lock_date || '');
  const [lockFeedback, setLockFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isUpdatingLock, setIsUpdatingLock] = useState(false);

  // Modal States
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [newAccCode, setNewAccCode] = useState('');
  const [newAccNameAr, setNewAccNameAr] = useState('');
  const [newAccNameEn, setNewAccNameEn] = useState('');
  const [newAccType, setNewAccType] = useState<AccountCategory>('EXPENSE');
  const [newAccNature, setNewAccNature] = useState<AccountNature>('DEBIT');
  const [newAccDesc, setNewAccDesc] = useState('');
  const [accFormError, setAccFormError] = useState<string | null>(null);

  // Manual Journal Entry Modal State
  const [isNewEntryOpen, setIsNewEntryOpen] = useState(false);
  const [entryDescription, setEntryDescription] = useState('');
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

  // Calculations
  const trialBalance = useMemo(() => {
    return calculateTrialBalance(accounts, journalEntries);
  }, [accounts, journalEntries]);

  const incomeStatement = useMemo(() => {
    return calculateIncomeStatement(journalEntries);
  }, [journalEntries]);

  const balanceSheet = useMemo(() => {
    return calculateBalanceSheet(accounts, journalEntries);
  }, [accounts, journalEntries]);

  const cashFlow = useMemo(() => {
    return calculateCashFlowStatement(accounts, journalEntries);
  }, [accounts, journalEntries]);

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
    ASSET: { label: 'أصول (Assets)', color: 'text-sky-400 bg-sky-950/40 border-sky-800/40' },
    LIABILITY: { label: 'خصوم والتزامات (Liabilities)', color: 'text-amber-400 bg-amber-950/40 border-amber-800/40' },
    EQUITY: { label: 'حقوق الملكية (Equity)', color: 'text-purple-400 bg-purple-950/40 border-purple-800/40' },
    REVENUE: { label: 'إيرادات (Revenue)', color: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40' },
    EXPENSE: { label: 'مصروفات (Expenses)', color: 'text-rose-400 bg-rose-950/40 border-rose-800/40' },
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
  const modalIsBalanced = Math.abs(modalDebitSdg - modalCreditSdg) < 1;

  // Submit manual journal entry
  const handleCreateJournalEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntryError(null);

    if (!entryDescription.trim()) {
      setEntryError('يرجى كتابة شرح أو بيان للقيد المحاسبي');
      return;
    }

    if (entryLines.some((l) => !l.account_code)) {
      setEntryError('يرجى اختيار حساب لكل طرف في القيد');
      return;
    }

    if (modalDebitSdg <= 0 || modalCreditSdg <= 0) {
      setEntryError('يجب أن يحتوي القيد على مبالغ صحيحة أكبر من الصفر');
      return;
    }

    if (!modalIsBalanced) {
      setEntryError(`القيد غير متزن: مجموع المدين (${modalDebitSdg}) لا يساوي مجموع الدائن (${modalCreditSdg})`);
      return;
    }

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
      setEntryDescription('');
      setEntryLines([
        { account_code: '', debit_sdg: 0, credit_sdg: 0, debit_usd: 0, credit_usd: 0 },
        { account_code: '', debit_sdg: 0, credit_sdg: 0, debit_usd: 0, credit_usd: 0 },
      ]);
    } catch (err: any) {
      setEntryError(err.message || 'حدث خطأ أثناء حفظ القيد المحاسبي');
    }
  };

  // Period Lock Handlers
  const handleLockPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActionAllowed('org:update_settings')) {
      setLockFeedback({ type: 'error', text: 'ليس لديك صلاحية لتعديل إعدادات إقفال الفترات المحاسبية' });
      return;
    }
    if (!lockDateInput) {
      setLockFeedback({ type: 'error', text: 'يرجى تحديد تاريخ إقفال الفترة' });
      return;
    }
    setIsUpdatingLock(true);
    setLockFeedback(null);
    try {
      await updateSettings({ period_lock_date: lockDateInput });
      setLockFeedback({
        type: 'success',
        text: `تم إقفال الفترة المحاسبية بنجاح حتى تاريخ ${lockDateInput}. جميع العمليات حتى هذا التاريخ أصبحت محمية.`,
      });
    } catch (err: any) {
      setLockFeedback({ type: 'error', text: err.message || 'حدث خطأ أثناء إقفال الفترة' });
    } finally {
      setIsUpdatingLock(false);
    }
  };

  const handleUnlockPeriod = async () => {
    if (!isActionAllowed('org:update_settings')) {
      setLockFeedback({ type: 'error', text: 'ليس لديك صلاحية لفك إقفال الفترات المحاسبية' });
      return;
    }
    if (!window.confirm('تحذير: فك إقفال الفترة المحاسبية سيتيح التعديل والحذف في القيود التاريخية. هل أنت متأكد من الاستمرار؟')) {
      return;
    }
    setIsUpdatingLock(true);
    setLockFeedback(null);
    try {
      await updateSettings({ period_lock_date: undefined });
      setLockDateInput('');
      setLockFeedback({
        type: 'success',
        text: 'تم فك إقفال الفترة المحاسبية. أصبح بإمكانك تسجيل وتعديل القيود بحرية.',
      });
    } catch (err: any) {
      setLockFeedback({ type: 'error', text: err.message || 'حدث خطأ أثناء فك الإقفال' });
    } finally {
      setIsUpdatingLock(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-black text-white">دفتر الأستاذ والمحاسبة العامة</h2>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-950/70 text-emerald-400 border border-emerald-800/40 font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  قيد مزدوج آلي
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                دليل الحسابات المتوافق مع الأنشطة التجارية السودانية، اليومية العامة، ميزان المراجعة، وقائمة الدخل.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isActionAllowed('journal:create') && (
              <button
                onClick={() => setIsNewEntryOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>قيد يومية يدوي</span>
              </button>
            )}

            {isActionAllowed('accounts:create') && (
              <button
                onClick={() => setIsAddAccountOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#181820] hover:bg-[#22222d] text-slate-200 border border-[#2a2a38] font-bold text-xs flex items-center gap-1.5 transition-all"
              >
                <Plus className="w-4 h-4 text-emerald-400" />
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
                className="p-2 rounded-xl bg-[#14141c] hover:bg-[#1f1f2a] text-slate-400 hover:text-white border border-[#22222f] transition-all"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-2 border-t border-[#1e1e24] mt-5 pt-4 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveSubTab('coa')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'coa'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#14141c]'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>دليل الحسابات ({accounts.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('journal')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'journal'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#14141c]'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>دفتر القيود واليومية ({journalEntries.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('trial')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'trial'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#14141c]'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>ميزان المراجعة</span>
            {trialBalance.isBalanced ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('income')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'income'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#14141c]'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>قائمة الدخل</span>
          </button>

          <button
            onClick={() => setActiveSubTab('balance_sheet')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'balance_sheet'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#14141c]'
            }`}
          >
            <Landmark className="w-4 h-4" />
            <span>الميزانية العمومية</span>
            {balanceSheet.is_balanced ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('cash_flow')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'cash_flow'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#14141c]'
            }`}
          >
            <Coins className="w-4 h-4" />
            <span>التدفقات النقدية</span>
          </button>

          <button
            onClick={() => setActiveSubTab('period_lock')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
              activeSubTab === 'period_lock'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#14141c]'
            }`}
          >
            {settings.period_lock_date ? (
              <Lock className="w-4 h-4 text-amber-400" />
            ) : (
              <Unlock className="w-4 h-4 text-slate-500" />
            )}
            <span>إقفال الفترات</span>
            {settings.period_lock_date && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 font-mono border border-amber-700/50">
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
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#0c0c0f] border border-[#1e1e24] p-3 rounded-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث برمز الحساب أو الاسم..."
                className="w-full bg-[#121217] border border-[#22222d] rounded-lg pr-9 pl-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <button
                onClick={() => setCategoryFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  categoryFilter === 'ALL'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200 bg-[#121217]'
                }`}
              >
                الكل
              </button>
              {(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as AccountCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                    categoryFilter === cat
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200 bg-[#121217]'
                  }`}
                >
                  {categoryLabels[cat].label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Accounts Grid / Table */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-[#121217] text-slate-400 font-bold border-b border-[#1e1e24]">
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
                <tbody className="divide-y divide-[#181820]">
                  {filteredAccounts.map((acc) => {
                    const trialItem = trialBalance.items.find((ti) => ti.account_code === acc.code);
                    const balSdg = trialItem ? trialItem.net_balance_sdg : acc.balance_sdg;
                    const balUsd = trialItem ? trialItem.net_balance_usd : acc.balance_usd;

                    return (
                      <tr key={acc.code} className="hover:bg-[#12121a]/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                          {acc.code}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-white">{acc.name_ar}</div>
                          {acc.name_en && (
                            <div className="text-[10px] text-slate-500 font-mono">{acc.name_en}</div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${categoryLabels[acc.type]?.color}`}
                          >
                            {categoryLabels[acc.type]?.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              acc.nature === 'DEBIT'
                                ? 'bg-sky-950/50 text-sky-400 border border-sky-800/40'
                                : 'bg-amber-950/50 text-amber-400 border border-amber-800/40'
                            }`}
                          >
                            {acc.nature === 'DEBIT' ? 'مدين (Debit)' : 'دائن (Credit)'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-200">
                          {formatMoney(balSdg, 'SDG')}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">
                          {formatMoney(balUsd, 'USD')}
                        </td>
                        <td className="py-3 px-4">
                          {acc.is_system ? (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                              نظامي أساسي
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 font-medium">
                              مخصص
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAccounts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
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
          <div className="bg-[#0c0c0f] border border-[#1e1e24] p-4 rounded-2xl space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setJournalPage(1);
                  }}
                  placeholder="ابحث برقم القيد أو البيان..."
                  className="w-full bg-[#121217] border border-[#22222d] rounded-xl pr-9 pl-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <select
                  value={journalTypeFilter}
                  onChange={(e) => {
                    setJournalTypeFilter(e.target.value);
                    setJournalPage(1);
                  }}
                  className="w-full bg-[#121217] border border-[#22222d] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
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
                <span className="text-[11px] text-slate-400 whitespace-nowrap">من:</span>
                <input
                  type="date"
                  value={journalStartDate}
                  onChange={(e) => {
                    setJournalStartDate(e.target.value);
                    setJournalPage(1);
                  }}
                  className="w-full bg-[#121217] border border-[#22222d] rounded-xl px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 whitespace-nowrap">إلى:</span>
                <input
                  type="date"
                  value={journalEndDate}
                  onChange={(e) => {
                    setJournalEndDate(e.target.value);
                    setJournalPage(1);
                  }}
                  className="w-full bg-[#121217] border border-[#22222d] rounded-xl px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-[#181820] flex-wrap gap-2">
              <div>
                إجمالي القيود المطابقة: <span className="font-mono text-emerald-400 font-bold">{filteredEntries.length}</span> من أصل {journalEntries.length}
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
                  className="text-amber-400 hover:underline text-xs"
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
                className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-4 sm:p-5 shadow-sm space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#181820] pb-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono font-black text-sm text-emerald-400">
                      {entry.entry_number}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">| {entry.date}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                        entry.reference_type === 'invoice'
                          ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                          : entry.reference_type === 'payment'
                          ? 'bg-sky-950/60 text-sky-400 border-sky-800/40'
                          : entry.reference_type === 'expense'
                          ? 'bg-rose-950/60 text-rose-400 border-rose-800/40'
                          : entry.reference_type === 'void'
                          ? 'bg-purple-950/60 text-purple-400 border-purple-800/40'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
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
                    <div className="text-xs font-mono font-bold text-slate-200">
                      الإجمالي: {formatMoney(entry.total_debit_sdg, 'SDG')}
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      متزن
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 font-semibold">{entry.description}</p>

                {/* Journal Entry Lines Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-[#121217] text-slate-400 font-bold border-b border-[#1e1e24]">
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
                    <tbody className="divide-y divide-[#181820]">
                      {entry.lines.map((line, idx) => (
                        <tr key={idx} className="hover:bg-[#14141c]">
                          <td className="py-2 px-3 font-mono font-bold text-emerald-400">
                            {line.account_code}
                          </td>
                          <td className="py-2 px-3 font-medium text-white">{line.account_name}</td>
                          <td className="py-2 px-3 text-slate-400 text-[11px]">{line.description || '-'}</td>
                          <td className="py-2 px-3 font-mono font-bold text-sky-400">
                            {line.debit_sdg > 0 ? formatMoney(line.debit_sdg, 'SDG') : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-amber-400">
                            {line.credit_sdg > 0 ? formatMoney(line.credit_sdg, 'SDG') : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-400">
                            {line.debit_usd > 0 ? formatMoney(line.debit_usd, 'USD') : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-400">
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
              <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-8 text-center text-slate-500">
                لا توجد قيود يومية مطابقة لمعايير البحث المحددة
              </div>
            )}

            {/* Pagination Controls */}
            {filteredEntries.length > 0 && (
              <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">عدد القيود في الصفحة:</span>
                  <select
                    value={journalPageSize}
                    onChange={(e) => {
                      setJournalPageSize(Number(e.target.value));
                      setJournalPage(1);
                    }}
                    className="bg-[#14141c] border border-[#22222d] rounded-lg px-2 py-1 text-slate-200"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-slate-400">
                    الصفحة <span className="font-mono text-emerald-400 font-bold">{journalPage}</span> من{' '}
                    <span className="font-mono text-slate-200">{totalJournalPages}</span>
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setJournalPage((p) => Math.max(1, p - 1))}
                      disabled={journalPage === 1}
                      className="p-1.5 rounded-lg bg-[#14141c] border border-[#22222d] text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#1e1e27]"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setJournalPage((p) => Math.min(totalJournalPages, p + 1))}
                      disabled={journalPage === totalJournalPages}
                      className="p-1.5 rounded-lg bg-[#14141c] border border-[#22222d] text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#1e1e27]"
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
      {activeSubTab === 'trial' && (
        <div className="space-y-4">
          {/* Status Header */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">ميزان المراجعة بالأرصدة والمجاميع</h3>
                {trialBalance.isBalanced ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    الميزان متزن 100%
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-950/80 text-rose-400 border border-rose-700/50 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    يوجد فرق في توازن الميزان
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                تجميع لكافة حركات المدين والدائن والأرصدة الصافية لجميع الحسابات النشطة.
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">مجموع المدين (ج.س)</span>
                <span className="font-bold text-sky-400 text-sm">
                  {formatMoney(trialBalance.totalDebitSdg, 'SDG')}
                </span>
              </div>
              <div className="h-8 w-px bg-[#22222f]"></div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">مجموع الدائن (ج.س)</span>
                <span className="font-bold text-amber-400 text-sm">
                  {formatMoney(trialBalance.totalCreditSdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>

          {/* Trial Balance Table */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-[#121217] text-slate-400 font-bold border-b border-[#1e1e24]">
                  <tr>
                    <th className="py-3 px-4">رمز الحساب</th>
                    <th className="py-3 px-4">اسم الحساب</th>
                    <th className="py-3 px-4">مجموع المدين (ج.س)</th>
                    <th className="py-3 px-4">مجموع الدائن (ج.س)</th>
                    <th className="py-3 px-4">الرصيد الصافي (ج.س)</th>
                    <th className="py-3 px-4">الرصيد الصافي ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181820]">
                  {trialBalance.items.map((item) => (
                    <tr key={item.account_code} className="hover:bg-[#12121a]">
                      <td className="py-2.5 px-4 font-mono font-bold text-emerald-400">
                        {item.account_code}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-white">{item.account_name}</td>
                      <td className="py-2.5 px-4 font-mono text-sky-400">
                        {item.total_debit_sdg > 0 ? formatMoney(item.total_debit_sdg, 'SDG') : '-'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-amber-400">
                        {item.total_credit_sdg > 0 ? formatMoney(item.total_credit_sdg, 'SDG') : '-'}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-200">
                        {formatMoney(item.net_balance_sdg, 'SDG')}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">
                        {formatMoney(item.net_balance_usd, 'USD')}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[#14141c] font-mono font-black border-t-2 border-emerald-500/40 text-xs">
                  <tr>
                    <td colSpan={2} className="py-3 px-4 text-white">
                      الإجمالي العام
                    </td>
                    <td className="py-3 px-4 text-sky-400">
                      {formatMoney(trialBalance.totalDebitSdg, 'SDG')}
                    </td>
                    <td className="py-3 px-4 text-amber-400">
                      {formatMoney(trialBalance.totalCreditSdg, 'SDG')}
                    </td>
                    <td colSpan={2} className="py-3 px-4 text-emerald-400 text-left">
                      {trialBalance.isBalanced ? '✓ متوازن تماماً' : '⚠ غير متوازن'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: INCOME STATEMENT (قائمة الدخل والأرباح) */}
      {activeSubTab === 'income' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Sales Revenue */}
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-4 shadow-sm">
              <span className="text-xs text-slate-400 font-bold block mb-1">إجمالي إيراد المبيعات</span>
              <div className="text-lg font-black font-mono text-emerald-400">
                {formatMoney(incomeStatement.sales_revenue_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1">
                {formatMoney(incomeStatement.sales_revenue_usd, 'USD')}
              </div>
            </div>

            {/* Gross Profit */}
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-4 shadow-sm">
              <span className="text-xs text-slate-400 font-bold block mb-1">مجمل الربح (Gross Profit)</span>
              <div className="text-lg font-black font-mono text-sky-400">
                {formatMoney(incomeStatement.gross_profit_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1">
                {formatMoney(incomeStatement.gross_profit_usd, 'USD')}
              </div>
            </div>

            {/* Operating Expenses */}
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-4 shadow-sm">
              <span className="text-xs text-slate-400 font-bold block mb-1">المصروفات التشغيلية</span>
              <div className="text-lg font-black font-mono text-rose-400">
                {formatMoney(incomeStatement.total_operating_expenses_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1">
                {formatMoney(incomeStatement.total_operating_expenses_usd, 'USD')}
              </div>
            </div>

            {/* Net Profit */}
            <div className="bg-[#0c0c0f] border border-emerald-500/30 rounded-2xl p-4 shadow-sm bg-gradient-to-br from-[#0c0c0f] to-emerald-950/20">
              <span className="text-xs text-emerald-400 font-black block mb-1">صافي الربح النهائي</span>
              <div className="text-xl font-black font-mono text-emerald-300">
                {formatMoney(incomeStatement.net_profit_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-emerald-400/70 mt-1">
                {formatMoney(incomeStatement.net_profit_usd, 'USD')}
              </div>
            </div>
          </div>

          {/* Detailed Statement Breakdown */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-sm text-white border-b border-[#1e1e24] pb-3">
              تفاصيل قائمة الدخل المحاسبية
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-[#181820]">
                <span className="font-bold text-slate-300">إيرادات النشاط التجاري (المبيعات)</span>
                <span className="font-mono font-bold text-emerald-400">
                  {formatMoney(incomeStatement.sales_revenue_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-[#181820]">
                <span className="font-bold text-slate-300">تكلفة البضاعة المباعة (COGS)</span>
                <span className="font-mono font-bold text-rose-400">
                  ({formatMoney(incomeStatement.cogs_sdg, 'SDG')})
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-[#1e1e24] font-bold bg-[#14141c] px-3 rounded-lg">
                <span className="text-white">= مجمل الربح</span>
                <span className="font-mono text-sky-400 text-sm">
                  {formatMoney(incomeStatement.gross_profit_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-[#181820]">
                <span className="font-bold text-slate-300">المصروفات التشغيلية والعمومية</span>
                <span className="font-mono font-bold text-rose-400">
                  ({formatMoney(incomeStatement.total_operating_expenses_sdg, 'SDG')})
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-[#181820]">
                <span className="font-bold text-slate-300">فروقات أسعار الصرف (أرباح / خسائر العملة)</span>
                <span
                  className={`font-mono font-bold ${
                    incomeStatement.fx_gain_loss_sdg >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatMoney(incomeStatement.fx_gain_loss_sdg, 'SDG')}
                </span>
              </div>

              <div className="flex items-center justify-between py-3 font-black bg-emerald-950/40 border border-emerald-600/40 px-3.5 rounded-xl mt-4">
                <span className="text-emerald-300 text-sm">صافي الأرباح القابلة للتوزيع</span>
                <span className="font-mono text-emerald-300 text-base">
                  {formatMoney(incomeStatement.net_profit_sdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: BALANCE SHEET (الميزانية العمومية والمركز المالي) */}
      {activeSubTab === 'balance_sheet' && (
        <div className="space-y-6">
          {/* Top Equation and Balance Badge */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">قائمة المركز المالي (الميزانية العمومية)</h3>
                {balanceSheet.is_balanced ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    الميزانية متزنة تماماً (الأصول = الخصوم + حقوق الملكية)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-950/80 text-rose-400 border border-rose-700/50 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    فارق عدم توازن: {formatMoney(balanceSheet.difference_sdg, 'SDG')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                توضح المركز المالي للمنشأة في تاريخ محدد، وتشمل أرباح الفترة الحالية المنقولة تلقائياً من قائمة الدخل.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">العملة المرجعية:</span>
              <span className="text-xs font-mono font-bold px-2 py-1 rounded bg-[#181820] text-emerald-400 border border-[#262635]">
                SDG / USD
              </span>
            </div>
          </div>

          {/* Three Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Assets */}
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 shadow-sm space-y-1">
              <span className="text-xs text-sky-400 font-bold block">إجمالي الأصول (Assets)</span>
              <div className="text-xl font-black font-mono text-white">
                {formatMoney(balanceSheet.total_assets_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-400">
                {formatMoney(balanceSheet.total_assets_usd, 'USD')}
              </div>
            </div>

            {/* Liabilities */}
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 shadow-sm space-y-1">
              <span className="text-xs text-amber-400 font-bold block">إجمالي الخصوم والالتزامات (Liabilities)</span>
              <div className="text-xl font-black font-mono text-white">
                {formatMoney(balanceSheet.total_liabilities_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-400">
                {formatMoney(balanceSheet.total_liabilities_usd, 'USD')}
              </div>
            </div>

            {/* Equity */}
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 shadow-sm space-y-1">
              <span className="text-xs text-purple-400 font-bold block">إجمالي حقوق الملكية (Equity)</span>
              <div className="text-xl font-black font-mono text-white">
                {formatMoney(balanceSheet.total_equity_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-400">
                {formatMoney(balanceSheet.total_equity_usd, 'USD')}
              </div>
            </div>
          </div>

          {/* Detailed Side-by-Side Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Assets Table */}
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[#181820] pb-3">
                <h4 className="font-bold text-sm text-sky-400 flex items-center gap-2">
                  <span>الأصول المتداولة والثابتة</span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-sky-950/60 border border-sky-800/40 text-sky-300">
                    {balanceSheet.assets.length} حساب
                  </span>
                </h4>
                <span className="text-xs font-mono font-bold text-slate-200">
                  {formatMoney(balanceSheet.total_assets_sdg, 'SDG')}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-[#121217] text-slate-400 font-bold border-b border-[#1e1e24]">
                    <tr>
                      <th className="py-2 px-3">الرمز</th>
                      <th className="py-2 px-3">الحساب</th>
                      <th className="py-2 px-3">الرصيد (ج.س)</th>
                      <th className="py-2 px-3">الرصيد ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181820]">
                    {balanceSheet.assets.map((item) => (
                      <tr key={item.account_code} className="hover:bg-[#14141c]">
                        <td className="py-2 px-3 font-mono text-sky-400 font-bold">{item.account_code}</td>
                        <td className="py-2 px-3 text-slate-200 font-medium">{item.account_name}</td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-100">
                          {formatMoney(item.balance_sdg, 'SDG')}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-400">
                          {formatMoney(item.balance_usd, 'USD')}
                        </td>
                      </tr>
                    ))}
                    {balanceSheet.assets.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-slate-500">
                          لا توجد أصول مسجلة
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-[#242433] bg-[#121217] font-bold">
                    <tr>
                      <td colSpan={2} className="py-2.5 px-3 text-sky-300">إجمالي الأصول</td>
                      <td className="py-2.5 px-3 font-mono text-sky-400">
                        {formatMoney(balanceSheet.total_assets_sdg, 'SDG')}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">
                        {formatMoney(balanceSheet.total_assets_usd, 'USD')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Right: Liabilities & Equity Table */}
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[#181820] pb-3">
                <h4 className="font-bold text-sm text-amber-400 flex items-center gap-2">
                  <span>الخصوم وحقوق الملكية</span>
                </h4>
                <span className="text-xs font-mono font-bold text-slate-200">
                  {formatMoney(balanceSheet.total_liabilities_and_equity_sdg, 'SDG')}
                </span>
              </div>

              {/* Liabilities Sub-table */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-amber-400">الخصوم والالتزامات:</div>
                <table className="w-full text-right text-xs">
                  <tbody className="divide-y divide-[#181820]">
                    {balanceSheet.liabilities.map((item) => (
                      <tr key={item.account_code} className="hover:bg-[#14141c]">
                        <td className="py-1.5 px-3 font-mono text-amber-400 font-bold">{item.account_code}</td>
                        <td className="py-1.5 px-3 text-slate-200">{item.account_name}</td>
                        <td className="py-1.5 px-3 font-mono font-bold text-slate-100">
                          {formatMoney(item.balance_sdg, 'SDG')}
                        </td>
                        <td className="py-1.5 px-3 font-mono text-slate-400">
                          {formatMoney(item.balance_usd, 'USD')}
                        </td>
                      </tr>
                    ))}
                    {balanceSheet.liabilities.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-2 text-center text-slate-500 text-[11px]">
                          لا توجد خصوم مسجلة
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Equity Sub-table */}
              <div className="space-y-2 pt-3 border-t border-[#181820]">
                <div className="text-[11px] font-bold text-purple-400">حقوق الملكية ورأس المال:</div>
                <table className="w-full text-right text-xs">
                  <tbody className="divide-y divide-[#181820]">
                    {balanceSheet.equity.map((item) => (
                      <tr key={item.account_code} className="hover:bg-[#14141c]">
                        <td className="py-1.5 px-3 font-mono text-purple-400 font-bold">{item.account_code}</td>
                        <td className="py-1.5 px-3 text-slate-200">{item.account_name}</td>
                        <td className="py-1.5 px-3 font-mono font-bold text-slate-100">
                          {formatMoney(item.balance_sdg, 'SDG')}
                        </td>
                        <td className="py-1.5 px-3 font-mono text-slate-400">
                          {formatMoney(item.balance_usd, 'USD')}
                        </td>
                      </tr>
                    ))}

                    {/* Current Period Profit line */}
                    <tr className="bg-emerald-950/30 border border-emerald-800/40">
                      <td className="py-2 px-3 font-mono text-emerald-400 font-bold">PL-NET</td>
                      <td className="py-2 px-3 text-emerald-300 font-bold">أرباح الفترة الحالية (من قائمة الدخل)</td>
                      <td className="py-2 px-3 font-mono font-bold text-emerald-400">
                        {formatMoney(balanceSheet.current_period_profit_sdg, 'SDG')}
                      </td>
                      <td className="py-2 px-3 font-mono text-emerald-400">
                        {formatMoney(balanceSheet.current_period_profit_usd, 'USD')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Total Liabilities + Equity Summary */}
              <div className="p-3 bg-[#14141c] border border-[#22222f] rounded-xl flex items-center justify-between text-xs font-black">
                <span className="text-slate-200">مجموع الخصوم وحقوق الملكية:</span>
                <span className="font-mono text-emerald-400 text-sm">
                  {formatMoney(balanceSheet.total_liabilities_and_equity_sdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 6: CASH FLOW STATEMENT (قائمة التدفقات النقدية) */}
      {activeSubTab === 'cash_flow' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white">قائمة التدفقات النقدية (Cash Flow Statement)</h3>
                <p className="text-xs text-slate-400 mt-1">
                  تحليل حركة النقدية الداخلة والخارجة مقسمة وفقاً للمعايير المحاسبية (أنشطة تشغيلية، استثمارية، وتمويلية).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">صافي السيولة النقدية الختامية:</span>
                <span className="text-sm font-mono font-black text-emerald-400 px-3 py-1 bg-emerald-950/70 border border-emerald-800/40 rounded-xl">
                  {formatMoney(cashFlow.ending_cash_sdg, 'SDG')}
                </span>
              </div>
            </div>
          </div>

          {/* 4 Cards Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-xs text-slate-400 font-bold block">التدفقات التشغيلية (Operating)</span>
              <div
                className={`text-lg font-black font-mono ${
                  cashFlow.net_operating_sdg >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatMoney(cashFlow.net_operating_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-500">
                {formatMoney(cashFlow.net_operating_usd, 'USD')}
              </div>
            </div>

            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-xs text-slate-400 font-bold block">التدفقات الاستثمارية (Investing)</span>
              <div
                className={`text-lg font-black font-mono ${
                  cashFlow.net_investing_sdg >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatMoney(cashFlow.net_investing_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-500">
                {formatMoney(cashFlow.net_investing_usd, 'USD')}
              </div>
            </div>

            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-xs text-slate-400 font-bold block">التدفقات التمويلية (Financing)</span>
              <div
                className={`text-lg font-black font-mono ${
                  cashFlow.net_financing_sdg >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatMoney(cashFlow.net_financing_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-500">
                {formatMoney(cashFlow.net_financing_usd, 'USD')}
              </div>
            </div>

            <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-xs text-sky-400 font-black block">صافي التغير في النقدية</span>
              <div
                className={`text-lg font-black font-mono ${
                  cashFlow.net_change_in_cash_sdg >= 0 ? 'text-sky-400' : 'text-rose-400'
                }`}
              >
                {formatMoney(cashFlow.net_change_in_cash_sdg, 'SDG')}
              </div>
              <div className="text-xs font-mono text-slate-500">
                {formatMoney(cashFlow.net_change_in_cash_usd, 'USD')}
              </div>
            </div>
          </div>

          {/* Statement Detailed Walkthrough */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <h4 className="font-bold text-sm text-white border-b border-[#1e1e24] pb-3">
              تفاصيل قائمة التدفقات النقدية
            </h4>

            <div className="space-y-3 text-xs">
              {/* Section 1: Operating */}
              <div className="p-3.5 bg-[#121217] rounded-xl border border-[#1e1e27] space-y-2">
                <div className="font-bold text-emerald-400 flex items-center justify-between">
                  <span>1. التدفقات النقدية من الأنشطة التشغيلية (Operating Activities)</span>
                  <span className="font-mono">{formatMoney(cashFlow.net_operating_sdg, 'SDG')}</span>
                </div>
                <div className="space-y-1.5 pr-3 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>+ النقدية المحصلة من العميل والمبيعات (Cash from Customers)</span>
                    <span className="font-mono text-emerald-400">
                      {formatMoney(cashFlow.operating_inflows_sdg, 'SDG')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>- النقدية المدفوعة للمصروفات التشغيلية (Cash to Expenses)</span>
                    <span className="font-mono text-rose-400">
                      ({formatMoney(cashFlow.operating_outflows_sdg, 'SDG')})
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 2: Investing */}
              <div className="p-3.5 bg-[#121217] rounded-xl border border-[#1e1e27] space-y-2">
                <div className="font-bold text-sky-400 flex items-center justify-between">
                  <span>2. التدفقات النقدية من الأنشطة الاستثمارية (Investing Activities)</span>
                  <span className="font-mono">{formatMoney(cashFlow.net_investing_sdg, 'SDG')}</span>
                </div>
                <div className="space-y-1.5 pr-3 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>صافي حركة شراء وبيع الأصول الثابتة</span>
                    <span className="font-mono text-slate-400">
                      {formatMoney(cashFlow.net_investing_sdg, 'SDG')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 3: Financing */}
              <div className="p-3.5 bg-[#121217] rounded-xl border border-[#1e1e27] space-y-2">
                <div className="font-bold text-purple-400 flex items-center justify-between">
                  <span>3. التدفقات النقدية من الأنشطة التمويلية (Financing Activities)</span>
                  <span className="font-mono">{formatMoney(cashFlow.net_financing_sdg, 'SDG')}</span>
                </div>
                <div className="space-y-1.5 pr-3 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>صافي مساهمات رأس المال والمسحوبات</span>
                    <span className="font-mono text-slate-400">
                      {formatMoney(cashFlow.net_financing_sdg, 'SDG')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Reconciliation Table */}
              <div className="pt-3 border-t border-[#1e1e24] space-y-2">
                <div className="flex items-center justify-between py-1.5 text-slate-300 font-bold">
                  <span>صافي الزيادة / (النقص) في النقدية خلال الفترة</span>
                  <span className="font-mono text-sky-400">
                    {formatMoney(cashFlow.net_change_in_cash_sdg, 'SDG')}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-slate-400">
                  <span>رصيد النقدية وما في حكمها في بداية الفترة</span>
                  <span className="font-mono">{formatMoney(cashFlow.beginning_cash_sdg, 'SDG')}</span>
                </div>
                <div className="flex items-center justify-between py-2.5 px-3 bg-emerald-950/50 border border-emerald-700/40 rounded-xl text-emerald-300 font-black">
                  <span>رصيد النقدية وما في حكمها في نهاية الفترة (الخزينة والبنوك)</span>
                  <span className="font-mono text-sm">{formatMoney(cashFlow.ending_cash_sdg, 'SDG')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 7: ACCOUNTING PERIOD LOCK (إقفال الفترات المحاسبية) */}
      {activeSubTab === 'period_lock' && (
        <div className="space-y-6">
          {/* Status Card */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                    settings.period_lock_date
                      ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                      : 'bg-slate-800/40 border border-slate-700/40 text-slate-400'
                  }`}
                >
                  {settings.period_lock_date ? (
                    <Lock className="w-6 h-6" />
                  ) : (
                    <Unlock className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white">إقفال الفترات المحاسبية</h3>
                    {settings.period_lock_date ? (
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800/40 font-bold flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" />
                        الفترة مقفلة حتى: {settings.period_lock_date}
                      </span>
                    ) : (
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 font-bold flex items-center gap-1">
                        <Unlock className="w-3.5 h-3.5" />
                        كافة الفترات المحاسبية مفتوحة
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    حماية العمليات والقيود التاريخية من التعديل أو الحذف بعد اعتماد الميزانيات أو الإقرارات الضريبية.
                  </p>
                </div>
              </div>

              {settings.period_lock_date && isActionAllowed('org:update_settings') && (
                <button
                  type="button"
                  onClick={handleUnlockPeriod}
                  disabled={isUpdatingLock}
                  className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold text-xs flex items-center gap-1.5 transition-all"
                >
                  <Unlock className="w-4 h-4" />
                  <span>فك إقفال الفترة المحاسبية</span>
                </button>
              )}
            </div>
          </div>

          {/* Feedback message */}
          {lockFeedback && (
            <div
              className={`p-4 rounded-xl border text-xs flex items-center gap-2.5 ${
                lockFeedback.type === 'success'
                  ? 'bg-emerald-950/70 border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/70 border-rose-800 text-rose-300'
              }`}
            >
              {lockFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{lockFeedback.text}</span>
            </div>
          )}

          {/* Lock Action Form Card */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <h4 className="font-bold text-sm text-white border-b border-[#1e1e24] pb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>تحديد تاريخ إقفال الفترة المحاسبية</span>
            </h4>

            <form onSubmit={handleLockPeriod} className="space-y-4 max-w-lg">
              <div>
                <label className="block text-xs text-slate-300 font-bold mb-1.5">
                  إقفال كافة العمليات والقيود حتى تاريخ (شاملاً هذا التاريخ):
                </label>
                <input
                  type="date"
                  value={lockDateInput}
                  onChange={(e) => setLockDateInput(e.target.value)}
                  className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  required
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  لن يُسمح بإنشاء أو تعديل أو إبطال أو حذف أي فواتير أو سندات أو مصروفات أو قيود بتاريخ يسبق أو يطابق هذا التاريخ.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isUpdatingLock || !lockDateInput}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Lock className="w-4 h-4" />
                  <span>{settings.period_lock_date ? 'تحديث تاريخ إقفال الفترة' : 'تفعيل إقفال الفترة المحاسبية'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Guidelines & Controls Info Card */}
          <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-5 sm:p-6 shadow-sm space-y-3">
            <h4 className="font-bold text-xs text-slate-300">قواعد الضبط المحاسبي عند إقفال الفترة:</h4>
            <ul className="text-xs text-slate-400 space-y-2 list-disc list-inside">
              <li>
                <strong className="text-slate-200">الفواتير:</strong> يُمنع إصدار أو تعديل أو إبطال الفواتير المؤرخة في تاريخ مقفل.
              </li>
              <li>
                <strong className="text-slate-200">سندات القبض:</strong> يُمنع تحصيل أو تسجيل سندات في تاريخ واقع ضمن الفترة المقفلة.
              </li>
              <li>
                <strong className="text-slate-200">المصروفات:</strong> تجميد حركة المصروفات التاريخية ومنع حذفها لضمان مطابقة قائمة الدخل المعتمدة.
              </li>
              <li>
                <strong className="text-slate-200">القيود المحاسبية اليدوية:</strong> يُرفض تسجيل أي قيد تسوية بتاريخ يسبق تاريخ الإقفال.
              </li>
            </ul>
          </div>
        </div>
      )}
      {isAddAccountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0e0e14] border border-[#22222d] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-base text-white border-b border-[#1e1e24] pb-3">
              إضافة حساب جديد إلى دليل الحسابات
            </h3>

            {accFormError && (
              <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{accFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">رمز الحساب (رقم فريد)</label>
                <input
                  type="text"
                  value={newAccCode}
                  onChange={(e) => setNewAccCode(e.target.value)}
                  placeholder="مثال: 5310"
                  className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">اسم الحساب باللغة العربية</label>
                <input
                  type="text"
                  value={newAccNameAr}
                  onChange={(e) => setNewAccNameAr(e.target.value)}
                  placeholder="مثال: إيجار المخزن الشمالي"
                  className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">الاسم بالإنجليزية (اختياري)</label>
                <input
                  type="text"
                  value={newAccNameEn}
                  onChange={(e) => setNewAccNameEn(e.target.value)}
                  placeholder="مثال: North Warehouse Rent"
                  className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">التبويب</label>
                  <select
                    value={newAccType}
                    onChange={(e) => setNewAccType(e.target.value as AccountCategory)}
                    className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="ASSET">أصول (Assets)</option>
                    <option value="LIABILITY">خصوم (Liabilities)</option>
                    <option value="EQUITY">حقوق ملكية (Equity)</option>
                    <option value="REVENUE">إيرادات (Revenue)</option>
                    <option value="EXPENSE">مصروفات (Expense)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">الطبيعة المحاسبية</label>
                  <select
                    value={newAccNature}
                    onChange={(e) => setNewAccNature(e.target.value as AccountNature)}
                    className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="DEBIT">مدين (Debit)</option>
                    <option value="CREDIT">دائن (Credit)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">وصف أو ملاحظات</label>
                <textarea
                  value={newAccDesc}
                  onChange={(e) => setNewAccDesc(e.target.value)}
                  placeholder="ملاحظات حول طبيعة استخدام هذا الحساب..."
                  rows={2}
                  className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1e1e24]">
                <button
                  type="button"
                  onClick={() => setIsAddAccountOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#181820] hover:bg-[#22222c] text-slate-300 font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black shadow-lg shadow-emerald-500/20"
                >
                  حفظ الحساب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: MANUAL JOURNAL ENTRY */}
      {isNewEntryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm overflow-y-auto">
          <div className="bg-[#0e0e14] border border-[#22222d] rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-[#1e1e24] pb-3">
              <div>
                <h3 className="font-bold text-base text-white">إنشاء قيد يومية عامة يدوي</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  قيد مزدوج يتطلب توازن كامل بين أطراف المدين والدائن.
                </p>
              </div>
              <div className="text-xs font-mono">
                {modalIsBalanced ? (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    القيد متزن
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full bg-rose-950 text-rose-400 border border-rose-800 font-bold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    فرق: {Math.abs(modalDebitSdg - modalCreditSdg).toLocaleString()} ج.س
                  </span>
                )}
              </div>
            </div>

            {entryError && (
              <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{entryError}</span>
              </div>
            )}

            <form onSubmit={handleCreateJournalEntry} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">تاريخ القيد</label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">البيان العام للقيد</label>
                  <input
                    type="text"
                    value={entryDescription}
                    onChange={(e) => setEntryDescription(e.target.value)}
                    placeholder="مثال: سداد إيجار المحل أو تمويل رأس مال"
                    className="w-full bg-[#14141c] border border-[#22222d] rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              </div>

              {/* Lines editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-300">أطراف القيد (الحسابات والعمليات)</span>
                  <button
                    type="button"
                    onClick={handleAddEntryLine}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة طرف آخر
                  </button>
                </div>

                <div className="space-y-2.5">
                  {entryLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="bg-[#121218] border border-[#1e1e24] p-3 rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                    >
                      <div className="sm:col-span-5">
                        <select
                          value={line.account_code}
                          onChange={(e) => handleLineChange(idx, 'account_code', e.target.value)}
                          className="w-full bg-[#181822] border border-[#262635] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
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
                            className="w-full bg-[#181822] border border-[#262635] rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-sky-400 focus:outline-none focus:border-sky-500"
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
                            className="w-full bg-[#181822] border border-[#262635] rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-amber-400 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      <div className="sm:col-span-1 text-center">
                        {entryLines.length > 2 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveEntryLine(idx)}
                            className="text-rose-400 hover:text-rose-300 font-bold text-base"
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
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#14141c] border border-[#1e1e24] font-mono text-xs font-bold">
                  <span className="text-slate-400 font-sans">إجمالي الأطراف:</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sky-400">مدين: {modalDebitSdg.toLocaleString()} ج.س</span>
                    <span className="text-amber-400">دائن: {modalCreditSdg.toLocaleString()} ج.س</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1e1e24]">
                <button
                  type="button"
                  onClick={() => setIsNewEntryOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#181820] hover:bg-[#22222c] text-slate-300 font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={!modalIsBalanced || modalDebitSdg <= 0}
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black shadow-lg shadow-emerald-500/20"
                >
                  ترحيل القيد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
