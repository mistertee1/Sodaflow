import React, { useEffect, useRef, useState } from 'react';
import { operationId } from '../../services/businessApi';
import type { Document } from '../../domain/store';
import { useApp } from '../../context/AppContext';
import { createHistoricalImportTemplate, parseHistoricalImportWorkbook } from '../../services/historicalImportWorkbook';

type ServerPreview = Awaited<ReturnType<ReturnType<typeof useApp>['previewHistoricalImport']>>;

type Review = Awaited<ReturnType<typeof parseHistoricalImportWorkbook>>;

/** Workbook review, protected staging and read-only server dry run. Financial approval remains separate. */
export function HistoricalWorkbookCenter() {
  const app = useApp();
  const allowed = app.isActionAllowed('import:accounting') && app.currentOrg?.accounting_version === 2;
  const scope = `${app.currentOrg?.id}:${app.currentUser?.uid}:${app.counters.revision}:${allowed}`;
  const current = useRef(scope); current.current = scope;
  const generation = useRef(0), mounted = useRef(true);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pendingStage = useRef<{ fileHash: string; id: string } | null>(null);
  const [preview, setPreview] = useState<{scope:string;value:ServerPreview}|null>(null);
  const [session, setSession] = useState<Document | null>(null);
  const identity = `${app.currentOrg?.id}:${app.currentUser?.uid}:${allowed}`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  useEffect(() => { setSession(null); pendingStage.current = null; }, [identity]);
  const [reviewScope, setReviewScope] = useState('');
  useEffect(() => { generation.current++; setPreview(null); setReview(null); setError(''); setBusy(false); }, [scope]);
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
    setPreview(null); setReview(null); setSession(null); pendingStage.current = null;
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
  const livePreview = preview?.scope === scope ? preview.value : null;
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
      <p role="status">{visible.validation.can_stage ? 'اجتاز التحقق المحلي؛ يمكن إرسال الملف للتحقق الخادمي؛ لم يُعتمد مالياً.' : 'توجد أخطاء حاجبة؛ صحح الملف وأعد رفعه.'}</p>
      <ul>{visible.validation.blocking_issues.map((issue, i) => <li key={i}>الصف {issue.row_number}: {issue.message}</li>)}</ul>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr>{['الصف', 'النوع', 'المرجع', 'التاريخ', 'العملة', 'الإجمالي', 'المدفوع', 'الأدلة'].map(t => <th className="p-2 text-start" key={t}>{t}</th>)}</tr></thead><tbody>
        {visible.request.rows.map(row => <tr key={row.row_number}><td>{row.row_number}</td><td>{row.kind === 'invoice' ? 'فاتورة بيع' : 'فاتورة شراء'}</td><td>{row.reference}</td><td>{row.date}</td><td>{row.currency}</td><td>{row.total}</td><td>{row.paid}</td><td><details><summary>البنود والدفعات</summary><pre className="whitespace-pre-wrap">{JSON.stringify(visible.request.document_evidence[row.row_number], null, 2)}</pre></details></td></tr>)}
      </tbody></table></div>
      <button className="sf-primary" data-testid="stage-historical-workbook" disabled={busy || !visible.validation.can_stage || Boolean(session)} onClick={() => void run(async () => {
        const captured = identity, orgId = app.currentOrg!.id;
        if (pendingStage.current?.fileHash !== visible.request.file_hash) pendingStage.current = { fileHash: visible.request.file_hash, id: operationId() };
        const result = await app.stageHistoricalImport(visible.request, pendingStage.current.id);
        if (result.org_id !== orgId || result.file_hash !== visible.request.file_hash || result.file_name !== visible.request.file_name || result.rows_total !== visible.request.rows.length) throw new Error('نتيجة جلسة المراجعة لا تطابق المؤسسة أو الملف الحالي؛ لم تُقبل النتيجة.');
        if (mounted.current && currentIdentity.current === captured) setSession(result);
      })}>تحقق خادمياً واحفظ جلسة المراجعة</button>
      <p className="text-sm">لم يُحفظ شيء. التحقق الخادمي يحفظ جلسة مراجعة فقط. الاعتماد المالي غير متاح في هذه الخطوة.</p>
    </div>}
    {session && <div role="status" data-testid="historical-server-session"><p>حُفظت جلسة المراجعة الخادمية فقط؛ لم تُعتمد مستندات أو قيود.</p><p>الملف: {String(session.file_name)} — المستندات: {Number(session.rows_total)}</p>{session.file_duplicate_warning && <p>{String(session.file_duplicate_warning)}</p>}<button className="sf-secondary" data-testid="preview-historical-workbook" disabled={busy} onClick={() => void run(async () => {
      setPreview(null);
      const captured = scope, token = generation.current;
      const input = {id:String(session.id),expected_rows_sha256:String(session.rows_sha256),expected_validation_context_sha256:String(session.validation_context_sha256),...(session.document_evidence_sha256?{expected_document_evidence_sha256:String(session.document_evidence_sha256)}:{}),reason:'معاينة المستندات التاريخية قبل الاعتماد'};
      const request = {input,operationId:operationId()};
      const result = await app.previewHistoricalImport(request, app.currentOrg!.id);
      if (result.dry_run !== true || result.session_id !== session.id || result.operation_id !== request.operationId || JSON.stringify(result.approval_input) !== JSON.stringify(input)) throw new Error('نتيجة المعاينة لا تطابق الجلسة أو أدلة الملف؛ أعد المعاينة.');
      if (mounted.current && current.current === captured && generation.current === token) setPreview({scope:captured,value:result});
    })}>معاينة الأثر المحاسبي دون حفظ</button><p>الاعتماد المالي ما زال غير متاح.</p></div>}
    {livePreview && <div className="space-y-2" data-testid="historical-server-preview">
      <h3 className="font-bold">معاينة خادمية — لم يُحفظ الأثر المالي</h3>
      <p>المستندات المقترحة: {Number(livePreview.proposed_result.invoices_created||0)+Number(livePreview.proposed_result.purchase_bills_created||0)} — القيود المقترحة: {Number(livePreview.proposed_result.journals_created||0)}</p>
      <p>نتائج المطابقة: {Number(livePreview.proposed_result.reconciliation?.findings_count||0)} — {livePreview.proposed_result.accounting_block?'توجد فروقات حاجبة؛ لا تعتمد الترحيل.':'اجتازت الخطة التحقق الحالي؛ يلزم اعتماد منفصل بعد المراجعة.'}</p>
      <details><summary>القيود والمطابقة المقترحة</summary><pre className="whitespace-pre-wrap">{JSON.stringify({reconciliation:livePreview.proposed_result.reconciliation,journals:livePreview.proposed_changes.filter((change:Document)=>change.path.includes('/journal_entries/')).map((change:Document)=>change.value)},null,2)}</pre></details>
    </div>}
  </section>;
}
