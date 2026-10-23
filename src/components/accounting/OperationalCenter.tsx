import { useDisplayMoney } from '../../context/useDisplayMoney';
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { OperationalView, Book } from '../../domain/operationalReports';
import { merchantDay, operationalPermissions } from '../../domain/operationalReports';
import { downloadOperationalCsv, downloadOperationalPdf, type OperationalResponse } from '../../services/operationalExport';
import { FinancialAccountsCenter } from './FinancialAccountsCenter';
import { ReconciliationCenter } from './ReconciliationCenter';

const titles = { ledger: 'دفتر الأستاذ العام', receivables: 'كشوف العملاء وأعمار الديون', cash: 'النقدية والبنوك' };

export function OperationalCenter({ view }: { view: OperationalView }) {
  const { formatMoney, pair, bookLabel } = useDisplayMoney();
  const amount = (sdg: number, usd: number) => <span dir="ltr" className="whitespace-nowrap">{pair(sdg, usd)}</span>;
  const { accounts, customers, currentOrg, currentUser, counters, settings, isActionAllowed, loadOperationalReport } = useApp();
  const [accountCode, setAccountCode] = useState('1110'), [customerId, setCustomerId] = useState(''), [currency, setCurrency] = useState<'both' | Book>('both');
  const [start, setStart] = useState(() => view === 'cash' ? merchantDay(new Date(), settings.timezone || 'Africa/Khartoum') : ''), [end, setEnd] = useState(() => merchantDay(new Date(), settings.timezone || 'Africa/Khartoum'));
  const [report, setReport] = useState<OperationalResponse | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [page, setPage] = useState(0);
  const exportLock = useRef(false), identity = useRef({ orgId: currentOrg?.id, view });
  identity.current = { orgId: currentOrg?.id, view };
  const allowed = operationalPermissions(view).every(isActionAllowed);
  const query = () => ({ ...(start ? { start } : {}), ...(end ? { end } : {}), ...(view === 'ledger' ? { accountCode, ...(currency === 'both' ? {} : { currency }) } : {}) });
  useEffect(() => {
    let active = true; setReport(null); setError(''); setLoading(allowed); setPage(0);
    if (allowed) void loadOperationalReport(view, query()).then(value => { if (active) setReport(value as OperationalResponse); }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'تعذر تحميل التقرير.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [view, currentOrg?.id, currentUser?.uid, counters.revision, allowed, accountCode, currency, start, end, retry]);
  useEffect(() => { setCustomerId(''); setPage(0); }, [currentOrg?.id]);
  const exportReport = async (kind: 'csv' | 'pdf') => {
    if (exportLock.current) return; exportLock.current = true; setBusy(true); setError('');
    const orgId = currentOrg?.id, selected = customerId, requested = query();
    try {
      const fresh = await loadOperationalReport(view, requested, true) as OperationalResponse;
      if (fresh.organizationId !== orgId || identity.current.orgId !== orgId || identity.current.view !== view) throw new Error('تغيّرت المؤسسة؛ أعد تحميل الكشف.');
      if (kind === 'csv') downloadOperationalCsv(fresh, selected, settings); else await downloadOperationalPdf(fresh, selected, settings.business_name, settings);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر التصدير.'); } finally { exportLock.current = false; setBusy(false); }
  };
  if (!allowed) return <p role="alert">ليس لديك صلاحية هذا التقرير.</p>;
  const statement = report?.view === 'receivables' ? report.statements.find(row => row.customer_id === customerId) : undefined;
  const rows = report?.view === 'ledger' ? report.rows : statement?.rows || [];
  const lastPage = Math.max(0, Math.ceil(rows.length / 50) - 1), currentPage = Math.min(page, lastPage);
  return <section className="sf-card p-4 space-y-4" aria-label={titles[view]}>
    <h2 className="font-bold">{titles[view]}</h2>
    {view === 'cash' && <FinancialAccountsCenter />}
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {view === 'ledger' && <><label>حساب الأستاذ<select aria-label="حساب الأستاذ" disabled={busy} className="sf-field w-full" value={accountCode} onChange={e => setAccountCode(e.target.value)}>{accounts.map(account => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}{!account.is_active ? ' (غير نشط)' : ''}</option>)}</select></label><label>عملة الأستاذ<select aria-label="عملة الأستاذ" disabled={busy} className="sf-field w-full" value={currency} onChange={e => setCurrency(e.target.value as 'both' | Book)}><option value="both">SDG / USD</option><option>SDG</option><option>USD</option></select></label></>}
      {view === 'receivables' && <label>العميل للكشف<select aria-label="العميل للكشف" disabled={busy} className="sf-field w-full" value={customerId} onChange={e => { setCustomerId(e.target.value); setPage(0); }}><option value="">كل العملاء</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}
      <label>من تاريخ<input aria-label="بداية التقرير التشغيلي" disabled={busy} type="date" className="sf-field w-full" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>حتى تاريخ<input aria-label="نهاية التقرير التشغيلي" disabled={busy} type="date" className="sf-field w-full" value={end} onChange={e => setEnd(e.target.value)} /></label>
    </div>
    {error && <p role="alert" className="text-red-600">{error} <button className="sf-secondary" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></p>}
    {loading && <p role="status">تحميل التقرير المؤكد…</p>}
    {report && <>
      <div className="flex gap-3 flex-wrap items-center"><p>حتى {report.period.end}</p>{isActionAllowed('backup:export') && (view !== 'receivables' || !!statement) && <><button className="sf-secondary" disabled={busy || loading} onClick={() => void exportReport('csv')}>تصدير الكشف CSV</button><button className="sf-secondary" disabled={busy || loading} onClick={() => void exportReport('pdf')}>تصدير الكشف PDF</button></>}</div>
      {report.view === 'ledger' && <><p>الافتتاحي: {report.currencies.map(book => <span key={book} className="mx-2" dir="ltr">{formatMoney(report.opening[book] || 0, book)}</span>)} — الختامي: {report.currencies.map(book => <span key={book} className="mx-2" dir="ltr">{formatMoney(report.closing[book] || 0, book)}</span>)}</p><p className="text-sf-muted text-sm">الرصيد موجب للمدين وسالب للدائن. طبيعة الحساب: {report.account.normal_balance === 'DEBIT' ? 'مدين' : 'دائن'}.</p></>}
      {report.view === 'cash' && <><p>رصيد النقدية والبنوك: {amount(report.closing_sdg, report.closing_usd)}</p><p>داخل الفترة: وارد {amount(report.inflow_sdg, report.inflow_usd)} — صادر {amount(report.outflow_sdg, report.outflow_usd)}</p><p className="text-sf-muted text-sm">الإجمالي يجمع صافي حركات النقدية لكل قيد؛ التحويل بين حسابين نقديين لا يضاعف الوارد والصادر.</p><div className="overflow-x-auto"><table className="sf-table w-full min-w-[640px]"><thead><tr><th>الحساب</th><th>الافتتاحي {bookLabel('SDG')} / {bookLabel('USD')}</th><th>الختامي {bookLabel('SDG')} / {bookLabel('USD')}</th><th>وارد يوم {report.period.end}</th><th>صادر يوم {report.period.end}</th></tr></thead><tbody>{report.accounts.map(row => <tr key={row.account.code}><td>{row.account.code} — {row.account.name_ar}{!row.account.is_active && ' (غير نشط)'}</td><td>{amount(row.opening.SDG || 0, row.opening.USD || 0)}</td><td>{amount(row.closing.SDG || 0, row.closing.USD || 0)}</td><td>{amount(row.daily_inflow.SDG, row.daily_inflow.USD)}</td><td>{amount(row.daily_outflow.SDG, row.daily_outflow.USD)}</td></tr>)}</tbody></table></div><p className="text-sf-muted text-sm">الوارد والصادر لكل حساب يشمل التحويلات الداخلية؛ الإجمالي أعلاه يستبعد تضخيمها.</p>{report.accounts.filter(row => row.recent_rows.length).map(row => <details key={row.account.code} className="sf-card p-3"><summary className="cursor-pointer">آخر الحركات — {row.account.code} {row.account.name_ar}</summary><div className="overflow-x-auto"><table className="sf-table w-full min-w-[640px]"><thead><tr><th>التاريخ / المرجع</th><th>البيان</th><th>وارد {bookLabel('SDG')} / {bookLabel('USD')}</th><th>صادر {bookLabel('SDG')} / {bookLabel('USD')}</th></tr></thead><tbody>{row.recent_rows.map(item => <tr key={`${item.journal_id}:${item.line_index}`}><td>{item.date} / {item.reference_type}: {item.reference_id}</td><td>{item.description}</td><td>{amount(item.debit.SDG || 0,item.debit.USD || 0)}</td><td>{amount(item.credit.SDG || 0,item.credit.USD || 0)}</td></tr>)}</tbody></table></div></details>)}<ReconciliationCenter asOf={report.period.end} /></>}
      {report.view === 'receivables' && <><p>صافي ذمم العملاء: {amount(report.total_sdg, report.total_usd)}</p>{(report.unallocated_sdg || report.unallocated_usd) !== 0 && <p role="alert">رصيد 1200 غير الموزع على العملاء: {amount(report.unallocated_sdg, report.unallocated_usd)}. راجع المراجع والقيود اليدوية والمطابقة.</p>}
        <h3 className="font-bold">أعمار الديون حتى {report.period.end}</h3><div className="overflow-x-auto"><table className="sf-table w-full min-w-[640px]"><thead><tr><th>العميل / الفاتورة</th><th>الاستحقاق</th><th>الفئة / أيام التأخير</th><th>المتبقي {bookLabel('SDG')} / {bookLabel('USD')}</th><th>رصيد دائن {bookLabel('SDG')} / {bookLabel('USD')}</th></tr></thead><tbody>{report.aging.filter(row => !customerId || row.customer_id === customerId).map(row => <tr key={row.source_key}><td>{row.customer_name} / {row.source_type==='opening_lot'?`رصيد افتتاحي: ${row.source_reference}`:row.invoice_number}</td><td>{row.due_date}</td><td>{row.bucket} / {row.overdue_days}</td><td>{amount(row.remaining_sdg, row.remaining_usd)}</td><td>{amount(row.credit_sdg, row.credit_usd)}</td></tr>)}</tbody></table></div>
        <h3 className="font-bold">العملاء الأكثر تأخراً</h3>{report.overdue_customers.slice(0, 10).map(row => <p key={row.customer_id}><button className="underline" onClick={() => { setCustomerId(row.customer_id); setPage(0); }}>{row.customer_name}</button> — {amount(row.overdue_sdg, row.overdue_usd)} — {row.oldest_overdue_days} يوم</p>)}
        {statement && <><h3 className="font-bold">كشف {statement.customer_name}</h3><p>الافتتاحي: {amount(statement.opening_sdg, statement.opening_usd)} — الختامي: {amount(statement.closing_sdg, statement.closing_usd)}</p></>}
      </>}
      {(report.view === 'ledger' || !!statement) && <><div className="overflow-x-auto"><table className="sf-table w-full min-w-[900px] text-sm"><thead><tr><th>التاريخ / رقم القيد</th><th>المرجع / البيان</th>{(report.view === 'ledger' ? report.currencies : ['SDG', 'USD'] as Book[]).map(book => <React.Fragment key={book}><th>مدين {bookLabel(book)}</th><th>دائن {bookLabel(book)}</th><th>رصيد {bookLabel(book)}</th></React.Fragment>)}</tr></thead><tbody>{rows.slice(currentPage * 50, currentPage * 50 + 50).map(row => <tr key={`${row.journal_id}:${row.line_index}`}><td>{row.date}<br />{row.entry_number}</td><td>{row.reference_type}: {row.reference_id}<br />{row.description}</td>{(report.view === 'ledger' ? report.currencies : ['SDG', 'USD'] as Book[]).map(book => <React.Fragment key={book}><td>{formatMoney(report.view === 'ledger' ? row.debit[book] : row[`debit_${book.toLowerCase()}`], book)}</td><td>{formatMoney(report.view === 'ledger' ? row.credit[book] : row[`credit_${book.toLowerCase()}`], book)}</td><td>{formatMoney(report.view === 'ledger' ? row.balance[book] : row[`balance_${book.toLowerCase()}`], book)}</td></React.Fragment>)}</tr>)}</tbody></table></div>{!rows.length && <p>لا توجد حركات في الفترة المحددة.</p>}<div className="flex gap-3 items-center"><button className="sf-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>السابق</button><span>{currentPage + 1} / {lastPage + 1}</span><button className="sf-secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>التالي</button></div></>}
    </>}
  </section>;
}
