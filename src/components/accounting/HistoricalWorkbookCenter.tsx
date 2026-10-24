import React, { useEffect, useRef, useState } from 'react';
import { operationId } from '../../services/businessApi';
import { BusinessError } from '../../domain/validation';
import type { Document } from '../../domain/store';
import { useApp } from '../../context/AppContext';
import { createHistoricalImportTemplate, parseHistoricalImportWorkbook } from '../../services/historicalImportWorkbook';

type ServerPreview = Awaited<ReturnType<ReturnType<typeof useApp>['previewHistoricalImport']>>;

type Review = Awaited<ReturnType<typeof parseHistoricalImportWorkbook>>;

/** Workbook review, protected staging and read-only server dry run. Explicit financial approval binds the reviewed evidence and retains uncertain retries. */
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
  const [confirmed,setConfirmed] = useState(false), [pendingApproval,setPendingApproval] = useState<ServerPreview|null>(null), [receipt,setReceipt] = useState<Document|null>(null);
  const committing = useRef(false), approvalIdentity = useRef('');
  const [session, setSession] = useState<Document | null>(null);
  const [recoveryId, setRecoveryId] = useState('');
  const recoveryLock = useRef(false);
  const identity = `${app.currentOrg?.id}:${app.currentUser?.uid}:${allowed}`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  useEffect(() => { setSession(null); setPendingApproval(null); setReceipt(null); setRecoveryId(''); pendingStage.current = null; }, [identity]);
  const [reviewScope, setReviewScope] = useState('');
  useEffect(() => { generation.current++; setConfirmed(false); setPreview(null); setReview(null); setError(''); setBusy(false); }, [scope]);
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
    setConfirmed(false); setReceipt(null); setPreview(null); setReview(null); setSession(null); pendingStage.current = null;
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
  const approve = async (proposal:ServerPreview) => {
    if (committing.current) return;
    committing.current=true; const captured=identity, orgId=app.currentOrg!.id;
    approvalIdentity.current=captured;setPendingApproval(proposal);setBusy(true);setError('');
    try {
      const result=await app.commitHistoricalImport({...proposal.approval_input,expected_review_sha256:proposal.review_sha256},orgId,proposal.operation_id);
      if(result.id!==proposal.session_id || result.org_id!==orgId || result.rows_sha256!==proposal.approval_input.expected_rows_sha256) throw new BusinessError('تعذر تأكيد نتيجة الاعتماد؛ أعد المحاولة بنفس الطلب.',502);
      if(mounted.current && currentIdentity.current===captured){setReceipt(result);setPendingApproval(null);setPreview(null);setConfirmed(false);}
    } catch(e) {
      if(mounted.current && currentIdentity.current===captured){
        setError(e instanceof Error?e.message:'تعذر تأكيد الاعتماد؛ أعد المحاولة بنفس الطلب.');
        if(e instanceof BusinessError && e.status<500 && e.status!==429 && e.code!=='session_changed'){setPendingApproval(null);setPreview(null);setConfirmed(false);}
      }
    } finally {committing.current=false;if(mounted.current && currentIdentity.current===captured)setBusy(false);}
  };
  const recover = async () => {
    if (!recoveryId || recoveryLock.current || busy || pendingApproval) return;
    recoveryLock.current = true;
    const captured = identity, orgId = app.currentOrg!.id, id = recoveryId, token = ++generation.current;
    try {
      await run(async () => {
        const recovered = await app.recoverHistoricalImport(id, orgId);
        if (!mounted.current || currentIdentity.current !== captured || generation.current !== token) return;
        setReview(null); setPreview(null); setConfirmed(false); pendingStage.current = null;
        setSession(recovered.session); setReceipt(recovered.receipt); setPendingApproval(null);
        approvalIdentity.current = captured;
      });
    } finally { recoveryLock.current = false; }
  };
  if (!allowed) return null;
  const visible = reviewScope === scope ? review : null;
  const livePreview = preview?.scope === scope ? preview.value : null;
  return <section className="sf-card space-y-4" aria-label="مراجعة المصنف التاريخي" data-testid="historical-workbook-center">
    <h2 className="text-xl font-bold">استيراد المستندات التاريخية — مراجعة الملف</h2>
    <p>نزّل القالب وأدخل أدلة الفواتير أو المشتريات الأصلية وبنودها ودفعاتها. القراءة والتحقق هنا لا يحفظان جلسة أو بيانات مالية.</p>
    <div className="space-y-2" data-testid="historical-cloud-recovery">
      <label className="block">جلسة سابقة محفوظة في السحابة<select aria-label="جلسة الاستيراد المحفوظة" value={recoveryId} disabled={busy || Boolean(pendingApproval)} onChange={e => setRecoveryId(e.target.value)} className="sf-field w-full">
        <option value="">اختر جلسة لاستكمال مراجعتها أو عرض نتيجة اعتمادها</option>
        {app.historicalImportSessions.map(row => <option key={row.id} value={row.id}>{String(row.file_name)} — {String(row.created_at).slice(0,10)} — {String(row.status).startsWith('completed') ? 'معتمدة' : 'بانتظار المراجعة'}</option>)}
      </select></label>
      <button type="button" className="sf-secondary" data-testid="recover-historical-session" disabled={!recoveryId || busy || Boolean(pendingApproval)} onClick={() => void recover()}>استرداد الجلسة من الخادم</button>
      <p className="text-sm">الاسترداد لا يرحّل أي مستند. الجلسة غير المعتمدة تحتاج معاينة جديدة وموافقة صريحة؛ نتيجة الاعتماد السابقة تُعرض دون تكرارها.</p>
    </div>
    <button className="sf-secondary" disabled={busy} onClick={() => void run(async () => {
      const captured = scope, template = await createHistoricalImportTemplate();
      if (!mounted.current || current.current !== captured) return;
      const url = URL.createObjectURL(new Blob([template.bytes], { type: template.mime_type }));
      try { const link = document.createElement('a'); link.href = url; link.download = template.filename; link.click(); }
      finally { URL.revokeObjectURL(url); }
    })}>تنزيل قالب المستندات التاريخية</button>
    <label className="block">المصنف التاريخي XLSX<input type="file" accept=".xlsx" disabled={busy || Boolean(pendingApproval)} data-testid="historical-workbook-file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void choose(file); }} /></label>
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
    {session && !receipt && <div role="status" data-testid="historical-server-session"><p>حُفظت جلسة المراجعة الخادمية فقط؛ لم تُعتمد مستندات أو قيود.</p><p>الملف: {String(session.file_name)} — المستندات: {Number(session.rows_total)}</p>{session.file_duplicate_warning && <p>{String(session.file_duplicate_warning)}</p>}<button className="sf-secondary" data-testid="preview-historical-workbook" disabled={busy || Boolean(pendingApproval) || Boolean(receipt)} onClick={() => void run(async () => {
      setPreview(null);setConfirmed(false);
      const captured = scope, token = generation.current;
      const input = {id:String(session.id),expected_rows_sha256:String(session.rows_sha256),expected_validation_context_sha256:String(session.validation_context_sha256),...(session.document_evidence_sha256?{expected_document_evidence_sha256:String(session.document_evidence_sha256)}:{}),reason:'معاينة المستندات التاريخية قبل الاعتماد'};
      const request = {input,operationId:operationId()};
      const result = await app.previewHistoricalImport(request, app.currentOrg!.id);
      if (result.dry_run !== true || result.session_id !== session.id || result.operation_id !== request.operationId || JSON.stringify(result.approval_input) !== JSON.stringify(input)) throw new Error('نتيجة المعاينة لا تطابق الجلسة أو أدلة الملف؛ أعد المعاينة.');
      if (mounted.current && current.current === captured && generation.current === token) setPreview({scope:captured,value:result});
    })}>معاينة الأثر المحاسبي دون حفظ</button><p>راجع الأثر المحاسبي قبل الموافقة الصريحة؛ الاعتماد ينشئ مستندات وقيوداً فعلية.</p></div>}
    {livePreview && <div className="space-y-2" data-testid="historical-server-preview">
      <h3 className="font-bold">معاينة خادمية — لم يُحفظ الأثر المالي</h3>
      <p>المستندات المقترحة: {Number(livePreview.proposed_result.invoices_created||0)+Number(livePreview.proposed_result.purchase_bills_created||0)} — القيود المقترحة: {Number(livePreview.proposed_result.journals_created||0)}</p>
      <p>نتائج المطابقة: {Number(livePreview.proposed_result.reconciliation?.findings_count||0)} — {livePreview.proposed_result.accounting_block?'توجد فروقات حاجبة؛ لا تعتمد الترحيل.':'اجتازت الخطة التحقق الحالي؛ يلزم اعتماد منفصل بعد المراجعة.'}</p>
      {!livePreview.proposed_result.accounting_block && <div>
        <label><input type="checkbox" data-testid="confirm-historical-approval" checked={confirmed} disabled={busy || Boolean(pendingApproval)} onChange={e=>setConfirmed(e.target.checked)} />راجعت المستندات والقيود والمطابقة وأوافق على ترحيلها مالياً.</label>
        <button className="sf-primary" data-testid="commit-historical-workbook" disabled={busy || !confirmed || Boolean(pendingApproval) || !/^[a-f0-9]{64}$/.test(livePreview.review_sha256)} onClick={()=>void approve(livePreview)}>اعتماد المستندات والقيود المراجعة</button>
      </div>}
      <details><summary>القيود والمطابقة المقترحة</summary><pre className="whitespace-pre-wrap">{JSON.stringify({reconciliation:livePreview.proposed_result.reconciliation,journals:livePreview.proposed_changes.filter((change:Document)=>change.path.includes('/journal_entries/')).map((change:Document)=>change.value)},null,2)}</pre></details>
    </div>}
    {pendingApproval && approvalIdentity.current===identity && <div data-testid="historical-pending-approval"><p>لم يُؤكد الرد بعد. أعد نفس طلب الاعتماد للتحقق من نتيجته دون تكراره.</p><button className="sf-secondary" disabled={busy} data-testid="retry-historical-approval" onClick={()=>void approve(pendingApproval)}>إعادة نفس طلب الاعتماد</button></div>}
    {receipt && approvalIdentity.current===identity && <div role="status" data-testid="historical-approval-receipt"><p>{receipt.review_status==='legacy_without_review_evidence'?'هذه نتيجة اعتماد سابقة؛ لم يُحفظ معها دليل المعاينة الخادمية بالإصدار الحالي.':'اكتمل الاعتماد الخادمي للمستندات والقيود المراجعة.'}</p><p>الجلسة: {String(receipt.id)} — المستندات المستوردة: {Number(receipt.rows_imported)}</p><p>{receipt.accounting_block?'توجد فروقات محاسبية حاجبة؛ راجع التقرير قبل إغلاق الفترة.':'المطابقة دون فروقات مسجلة في نتيجة الاعتماد.'}</p></div>}
  </section>;
}
