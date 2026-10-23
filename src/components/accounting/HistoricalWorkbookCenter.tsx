import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { createHistoricalImportTemplate, parseHistoricalImportWorkbook } from '../../services/historicalImportWorkbook';

type Review = Awaited<ReturnType<typeof parseHistoricalImportWorkbook>>;

/** Read-only workbook review. Server staging and financial approval are separate steps. */
export function HistoricalWorkbookCenter() {
  const app = useApp();
  const allowed = app.isActionAllowed('import:accounting') && app.currentOrg?.accounting_version === 2;
  const scope = `${app.currentOrg?.id}:${app.currentUser?.uid}:${app.counters.revision}:${allowed}`;
  const current = useRef(scope); current.current = scope;
  const generation = useRef(0), mounted = useRef(true);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reviewScope, setReviewScope] = useState('');
  useEffect(() => { generation.current++; setReview(null); setError(''); setBusy(false); }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    const captured = scope;
    setBusy(true); setError('');
    try { await work(); }
    catch (e) { if (mounted.current && current.current === captured) setError(e instanceof Error ? e.message : 'تعذرت قراءة المصنف.'); }
    finally { if (mounted.current && current.current === captured) setBusy(false); }
  };
  const choose = async (file?: File) => {
    setReview(null);
    const token = ++generation.current, captured = scope;
    if (!file) return;
    await run(async () => {
      const accounts = app.accounts.filter(a => a.is_active !== false).map(a => a.code);
      const result = await parseHistoricalImportWorkbook(file, {
        validation: {
          orgId: app.currentOrg!.id, periodLockDate: app.settings.period_lock_date || undefined,
          periods: app.accountingPeriods.map(({ start_date, end_date, status }) => ({ start_date, end_date, status })),
          accounts, branches: ['main', ...app.branches.filter(b => b.status !== 'inactive').map(b => b.id)],
          currencies: [app.settings.primary_currency, app.settings.secondary_currency].filter((v): v is NonNullable<typeof v> => Boolean(v)),
        },
        documents: { accounts, customers: app.customers.map(v => v.id), suppliers: app.suppliers.map(v => v.id), products: app.products.map(v => v.id) },
      });
      if (mounted.current && current.current === captured && token === generation.current) { setReview(result); setReviewScope(captured); }
    });
  };
  if (!allowed) return null;
  const visible = reviewScope === scope ? review : null;
  return <section className="sf-card space-y-4" aria-label="مراجعة المصنف التاريخي" data-testid="historical-workbook-center">
    <h2 className="text-xl font-bold">استيراد المستندات التاريخية — مراجعة الملف</h2>
    <p>نزّل القالب وأدخل أدلة الفواتير أو المشتريات الأصلية وبنودها ودفعاتها. القراءة والتحقق هنا لا يحفظان جلسة أو بيانات مالية.</p>
    <button className="sf-secondary" disabled={busy} onClick={() => void run(async () => {
      const captured = scope, template = await createHistoricalImportTemplate();
      if (!mounted.current || current.current !== captured) return;
      const url = URL.createObjectURL(new Blob([template.bytes], { type: template.mime_type }));
      try { const link = document.createElement('a'); link.href = url; link.download = template.filename; link.click(); }
      finally { URL.revokeObjectURL(url); }
    })}>تنزيل قالب المستندات التاريخية</button>
    <label className="block">المصنف التاريخي XLSX<input type="file" accept=".xlsx" disabled={busy} data-testid="historical-workbook-file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void choose(file); }} /></label>
    {busy && <p role="status">جارٍ التحقق من الملف…</p>}
    {error && <p role="alert">{error}</p>}
    {visible && <div className="space-y-3" data-testid="historical-workbook-review">
      <p>{visible.request.file_name} — {visible.request.rows.length} مستند</p>
      <p role="status">{visible.validation.can_stage ? 'اجتاز التحقق المحلي؛ التحقق الخادمي والاعتماد غير منفذين في هذه الشاشة بعد.' : 'توجد أخطاء حاجبة؛ صحح الملف وأعد رفعه.'}</p>
      <ul>{visible.validation.blocking_issues.map((issue, i) => <li key={i}>الصف {issue.row_number}: {issue.message}</li>)}</ul>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr>{['الصف', 'النوع', 'المرجع', 'التاريخ', 'العملة', 'الإجمالي', 'المدفوع', 'الأدلة'].map(t => <th className="p-2 text-start" key={t}>{t}</th>)}</tr></thead><tbody>
        {visible.request.rows.map(row => <tr key={row.row_number}><td>{row.row_number}</td><td>{row.kind === 'invoice' ? 'فاتورة بيع' : 'فاتورة شراء'}</td><td>{row.reference}</td><td>{row.date}</td><td>{row.currency}</td><td>{row.total}</td><td>{row.paid}</td><td><details><summary>البنود والدفعات</summary><pre className="whitespace-pre-wrap">{JSON.stringify(visible.request.document_evidence[row.row_number], null, 2)}</pre></details></td></tr>)}
      </tbody></table></div>
      <p className="text-sm">لم يُحفظ شيء. يظل النقل إلى جلسة خادمية والمعاينة النهائية والاعتماد غير متاح حتى اكتمال الخطوة التالية.</p>
    </div>}
  </section>;
}
