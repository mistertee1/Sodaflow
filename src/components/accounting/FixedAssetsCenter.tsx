import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useApp} from '../../context/AppContext';
import {classifyAccount} from '../../domain/accountClassification';
import type {FixedAssetRegistrationInput} from '../../domain/fixedAssets';
import type {FixedAssetPreview, FixedAssetPreviewRequest} from '../../domain/fixedAssetPreview';
import {operationId} from '../../services/businessApi';
import {formatMoney} from '../../lib/currency';
import type {Document} from '../../domain/store';

const field = 'w-full min-w-0 mt-1 p-2 rounded border border-sf-border bg-sf-raised';
const value = (sdg: number, usd: number) => `${formatMoney(sdg, 'SDG')} / ${formatMoney(usd, 'USD')}`;
export function FixedAssetsCenter() {
  const a = useApp();
  const [assetId, setAssetId] = useState(() => `fa-${operationId()}`), [sourceKey, setSourceKey] = useState('');
  const [name, setName] = useState(''), [category, setCategory] = useState(''), [serviceDate, setServiceDate] = useState('');
  const [life, setLife] = useState('12'), [residualSdg, setResidualSdg] = useState('0'), [residualUsd, setResidualUsd] = useState('0');
  const [accumulated, setAccumulated] = useState(''), [expense, setExpense] = useState(''), [reason, setReason] = useState(''), [reference, setReference] = useState('');
  const [selectedId, setSelectedId] = useState(''), [depreciationReason, setDepreciationReason] = useState('');
  const [preview, setPreview] = useState<(FixedAssetPreview & {request: FixedAssetPreviewRequest; key: string}) | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const working = useRef(false), mounted = useRef(true), pending = useRef<{key: string; id: string} | null>(null);
  const scope = useRef({org: a.currentOrg?.id, uid: a.currentUser?.uid});
  const current = useRef(scope.current); current.current = {org: a.currentOrg?.id, uid: a.currentUser?.uid};
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const allowed = a.isActionAllowed('journal:create') && a.isActionAllowed('periods:adjust');
  const permissionNow = useRef(allowed), revisionNow = useRef(a.counters.revision);
  permissionNow.current = allowed; revisionNow.current = a.counters.revision;
  const sourceLines = useMemo(() => a.journalEntries.flatMap(entry => entry.lines.flatMap((line, index) => {
    const account = a.accounts.find(row => row.code === line.account_code);
    return account?.is_active && account.nature === 'DEBIT' && classifyAccount(account).reporting_group === 'fixed_assets'
      && line.credit_sdg === 0 && line.credit_usd === 0 && (line.debit_sdg > 0 || line.debit_usd > 0)
      && !a.fixedAssets.some(asset => asset.source_journal_id === entry.id && asset.source_line_index === index)
      ? [{key: `${entry.id}/${index}`, entry, line, index}] : [];
  })), [a.journalEntries, a.accounts, a.fixedAssets]);
  const source = sourceLines.find(row => row.key === sourceKey);
  const input: FixedAssetRegistrationInput = {id: assetId.trim(), name: name.trim(), category: category.trim(),
    purchase_date: source?.entry.date || '', in_service_date: serviceDate, source_journal_id: source?.entry.id || '', source_line_index: source?.index ?? 0,
    useful_life_months: Number(life), residual_value_sdg: Number(residualSdg), residual_value_usd: Number(residualUsd), asset_account_code: source?.line.account_code || '',
    accumulated_depreciation_account_code: accumulated, depreciation_expense_account_code: expense, reason: reason.trim(), reference_number: reference.trim()};
  const selected = a.fixedAssets.find(row => row.id === selectedId), next = selected?.schedule?.[selected.next_depreciation_sequence - 1];
  const registrationKey = JSON.stringify(input), depreciationKey = JSON.stringify({selectedId, revision: selected?.revision, depreciationReason});
  useEffect(() => {setPreview(null); setConfirmed(false);}, [registrationKey, depreciationKey, allowed, a.counters.revision]);
  const guard = () => {
    if (!mounted.current || !scope.current.org || scope.current.org !== current.current.org || scope.current.uid !== current.current.uid || !permissionNow.current)
      throw Error('تغيرت المؤسسة أو الصلاحية؛ أعد فتح العملية.');
    return scope.current.org;
  };
  const run = async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice('');
    try {await work();} catch (error) {if (mounted.current) setNotice(error instanceof Error ? error.message : 'تعذرت العملية؛ أعد المحاولة.');}
    finally {working.current = false; if (mounted.current) setBusy(false);}
  };
  const review = async (request: FixedAssetPreviewRequest) => {
    const revision = revisionNow.current;
    const result = await a.previewFixedAsset(request, guard()); guard();
    if (revision !== revisionNow.current) throw Error('بيانات المؤسسة تغيرت أثناء المعاينة؛ أعد المعاينة.');
    setPreview({...result, request, key: JSON.stringify(request)}); setConfirmed(false);
  };
  const save = async () => {
    if (!preview || !confirmed) return;
    const org = guard(), requestKey = `${preview.key}:${preview.quote_hash}`;
    if (pending.current?.key !== requestKey) pending.current = {key: requestKey, id: operationId()};
    const saved = await a.saveFixedAsset(preview.action, {...preview.request.input, expected_quote_hash: preview.quote_hash}, org, pending.current.id);
    pending.current = null; guard(); setPreview(null); setConfirmed(false);
    if (preview.action === 'fixedAsset.register') {
      setSelectedId(saved.id); setSourceKey(''); setName(''); setCategory(''); setReason(''); setReference(''); setAssetId(`fa-${operationId()}`);
      setNotice('تم تسجيل الأصل من قيد الشراء؛ لم يتكرر قيد التكلفة.');
    } else {setDepreciationReason(''); setNotice('تم ترحيل قسط الإهلاك وتحديث القيمة الدفترية.');}
  };
  const accountOptions = (kind: 'accumulated' | 'expense') => a.accounts.filter(row => row.is_active && (kind === 'accumulated'
    ? row.type === 'ASSET' && row.nature === 'CREDIT' && classifyAccount(row).reporting_group === 'fixed_assets'
    : row.type === 'EXPENSE' && row.nature === 'DEBIT' && classifyAccount(row).reporting_group === 'operating_expense'));
  const schedule = (rows: Document[], posted = 0) => <div className="overflow-auto max-h-80" tabIndex={0} aria-label="جدول الإهلاك"><table className="w-full whitespace-nowrap text-right"><thead><tr><th>القسط</th><th>التاريخ</th><th>SDG</th><th>USD</th><th>الحالة</th></tr></thead><tbody>{rows.map(row => <tr key={row.sequence}><td>{row.sequence}</td><td>{row.date}</td><td>{row.depreciation_sdg}</td><td>{row.depreciation_usd}</td><td>{row.sequence <= posted ? 'مرحّل' : 'غير مرحّل'}</td></tr>)}</tbody></table></div>;
  return <section role="region" aria-label="الأصول الثابتة والإهلاك" className="space-y-4 min-w-0 text-sm">
    <h3 className="text-lg font-semibold">الأصول الثابتة والإهلاك</h3>
    <p>التكلفة من قيد شراء موجود. الإهلاك بالقسط الثابت شهرياً من نهاية شهر التشغيل، في دفتري SDG وUSD.</p>
    {notice && <p role="status" className="sf-card p-3">{notice}</p>}
    {!allowed && <p>التسجيل وترحيل الإهلاك متاحان للمالك والمحاسب فقط. السجل للعرض.</p>}
    {allowed && <form aria-label="تسجيل أصل ثابت" className="sf-card p-4 space-y-3" onSubmit={event => {event.preventDefault(); void run(() => review({action: 'fixedAsset.register', input}));}}>
      <h4 className="font-semibold">تسجيل أصل من قيد الشراء</h4>
      {!sourceLines.length && <p>لا يوجد طرف شراء أصل متاح. أنشئ قيد شراء على حساب أصل ثابت من دفتر القيود أولاً.</p>}
      <fieldset disabled={busy} className="space-y-3 min-w-0">
        <label className="block">طرف قيد الشراء<select aria-label="طرف قيد شراء الأصل" className={field} required value={sourceKey} onChange={event => {const row = sourceLines.find(x => x.key === event.target.value); setSourceKey(event.target.value); setServiceDate(row?.entry.date || '');}}><option value="">اختر مصدر التكلفة</option>{sourceLines.map(row => <option key={row.key} value={row.key}>{row.entry.date} — {row.entry.id} — {row.line.account_code} — {value(row.line.debit_sdg, row.line.debit_usd)}</option>)}</select></label>
        {source && <p>تاريخ الشراء: {source.entry.date} · تكلفة المصدر: {value(source.line.debit_sdg, source.line.debit_usd)}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <label>رمز الأصل<input aria-label="رمز الأصل" className={field} required maxLength={100} value={assetId} onChange={e => setAssetId(e.target.value)}/></label>
          <label>اسم الأصل<input aria-label="اسم الأصل" className={field} required maxLength={200} value={name} onChange={e => setName(e.target.value)}/></label>
          <label>الفئة<input aria-label="فئة الأصل" className={field} required maxLength={100} value={category} onChange={e => setCategory(e.target.value)}/></label>
          <label>تاريخ التشغيل<input aria-label="تاريخ تشغيل الأصل" className={field} type="date" min={source?.entry.date} required value={serviceDate} onChange={e => setServiceDate(e.target.value)}/></label>
          <label>العمر الإنتاجي بالأشهر<input aria-label="العمر الإنتاجي بالأشهر" className={field} type="number" min={1} max={600} step={1} required value={life} onChange={e => setLife(e.target.value)}/></label>
          <label>القيمة التخريدية SDG<input aria-label="القيمة التخريدية SDG" className={field} type="number" min={0} step={1} required value={residualSdg} onChange={e => setResidualSdg(e.target.value)}/></label>
          <label>القيمة التخريدية USD<input aria-label="القيمة التخريدية USD" className={field} type="number" min={0} step=".01" required value={residualUsd} onChange={e => setResidualUsd(e.target.value)}/></label>
          <label>حساب مجمع الإهلاك<select aria-label="حساب مجمع الإهلاك" className={field} required value={accumulated} onChange={e => setAccumulated(e.target.value)}><option value="">اختر حساب الأصل الدائن</option>{accountOptions('accumulated').map(row => <option key={row.code} value={row.code}>{row.code} — {row.name_ar}</option>)}</select></label>
          <label>حساب مصروف الإهلاك<select aria-label="حساب مصروف الإهلاك" className={field} required value={expense} onChange={e => setExpense(e.target.value)}><option value="">اختر حساب المصروف</option>{accountOptions('expense').map(row => <option key={row.code} value={row.code}>{row.code} — {row.name_ar}</option>)}</select></label>
          <label>المرجع<input aria-label="مرجع الأصل" className={field} maxLength={200} value={reference} onChange={e => setReference(e.target.value)}/></label>
        </div>
        {!accountOptions('accumulated').length && <p>أضف حساب أصل دائن بتصنيف الأصول الثابتة لمجمع الإهلاك من دليل الحسابات.</p>}
        <label className="block">سبب التسجيل<textarea aria-label="سبب تسجيل الأصل" className={field} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label>
        <button className="sf-secondary" disabled={!source || !accumulated || !expense}>معاينة الأصل بدون حفظ</button>
      </fieldset>
    </form>}
    {preview && <section role="region" aria-label="معاينة الأصل المحمية" className="sf-card p-4 space-y-3">
      <h4 className="font-semibold">{preview.action === 'fixedAsset.register' ? 'مراجعة سجل الأصل والجدول' : 'مراجعة قسط الإهلاك'}</h4>
      {preview.action === 'fixedAsset.register' ? <><p>{preview.quote.name} · تكلفة المصدر: {value(preview.quote.purchase_cost_sdg, preview.quote.purchase_cost_usd)} · التخريدية: {value(preview.quote.residual_value_sdg, preview.quote.residual_value_usd)}</p>{schedule(preview.quote.schedule)}</> : <>
        <p>{preview.quote.name} · القسط {preview.quote.sequence} · {preview.quote.date}</p>
        <p>مبلغ الإهلاك: {value(preview.quote.amount_sdg, preview.quote.amount_usd)}</p>
        <p>القيمة الدفترية: {value(preview.quote.book_before_sdg, preview.quote.book_before_usd)} ← {value(preview.quote.book_after_sdg, preview.quote.book_after_usd)}</p>
        {preview.quote.lines.length ? <div className="overflow-auto"><table className="w-full"><thead><tr><th>الحساب</th><th>مدين SDG</th><th>دائن SDG</th><th>مدين USD</th><th>دائن USD</th></tr></thead><tbody>{preview.quote.lines.map((row: Document) => <tr key={row.account_code}><td>{row.account_code}</td><td>{row.debit_sdg}</td><td>{row.credit_sdg}</td><td>{row.debit_usd}</td><td>{row.credit_usd}</td></tr>)}</tbody></table></div> : <p>القسط صفر بعد التقريب؛ يسجل اكتمال الشهر دون قيد مالي صفري.</p>}
      </>}
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>راجعت المصدر والحسابات والجدول</label>
      <button className="sf-action" disabled={busy || !confirmed || !allowed} onClick={() => void run(save)}>{preview.action === 'fixedAsset.register' ? 'تأكيد تسجيل الأصل' : 'ترحيل قسط الإهلاك'}</button>
    </section>}
    <section role="region" aria-label="سجل الأصول المحفوظ" className="sf-card p-4 space-y-3 min-w-0">
      <h4 className="font-semibold">سجل الأصول المحفوظ</h4>
      {!a.fixedAssets.length ? <p>لا توجد أصول مسجلة.</p> : <div className="overflow-auto"><table className="w-full whitespace-nowrap text-right"><thead><tr><th>الأصل</th><th>الفئة</th><th>تاريخ الشراء</th><th>التكلفة SDG / USD</th><th>مجمع الإهلاك SDG / USD</th><th>القيمة الدفترية SDG / USD</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>{a.fixedAssets.map(asset => <tr key={asset.id}><td>{asset.name}</td><td>{asset.category}</td><td>{asset.purchase_date}</td><td>{value(asset.purchase_cost_sdg, asset.purchase_cost_usd)}</td><td>{value(asset.accumulated_depreciation_sdg, asset.accumulated_depreciation_usd)}</td><td>{value(asset.book_value_sdg, asset.book_value_usd)}</td><td>{asset.status === 'fully_depreciated' ? 'مكتمل الإهلاك' : 'نشط'}</td><td><button className="sf-secondary" disabled={busy} aria-label={`عرض الأصل ${asset.name}`} onClick={() => {setSelectedId(asset.id); setDepreciationReason('');}}>عرض الجدول والإهلاك</button></td></tr>)}</tbody></table></div>}
    </section>
    {selected && <section role="region" aria-label="تفاصيل الأصل" className="sf-card p-4 space-y-3 min-w-0">
      <h4 className="font-semibold">{selected.name} — القسط الثابت</h4>
      <p className="break-all">رمز الأصل: {selected.id} · قيد الشراء: {selected.source_journal_id} · المرجع: {selected.reference_number || '—'}</p>
      <p>التشغيل: {selected.in_service_date} · العمر الإنتاجي: {selected.useful_life_months} شهر · التخريدية: {value(selected.residual_value_sdg, selected.residual_value_usd)}</p>
      {schedule(selected.schedule, selected.next_depreciation_sequence - 1)}
      {allowed && next && <form aria-label="إعداد قسط الإهلاك" onSubmit={e => {e.preventDefault(); void run(() => review({action: 'fixedAsset.depreciate', input: {asset_id: selected.id, expected_revision: selected.revision, sequence: next.sequence, date: next.date, reason: depreciationReason.trim()}}));}} className="space-y-3">
        <p>القسط التالي {next.sequence}: {next.date} · {value(next.depreciation_sdg, next.depreciation_usd)}. يلزم تاريخ مستحق وفترة مفتوحة.</p>
        <label className="block">سبب الإهلاك<textarea aria-label="سبب قسط الإهلاك" className={field} required maxLength={1000} disabled={busy} value={depreciationReason} onChange={e => setDepreciationReason(e.target.value)}/></label>
        <button className="sf-secondary" disabled={busy}>معاينة قسط الإهلاك بدون حفظ</button>
      </form>}
      {!next && <p>اكتمل جدول الإهلاك؛ القيمة الدفترية تساوي القيمة التخريدية.</p>}
      <h5 className="font-semibold">أحداث الإهلاك والقيود المحفوظة</h5>
      {a.fixedAssetDepreciations.filter(row => row.asset_id === selected.id).sort((x, y) => x.sequence - y.sequence).map(row => <p className="break-all" key={row.id}>{row.date} · القسط {row.sequence} · {value(row.amount_sdg, row.amount_usd)} · القيد: {row.journal_id || 'قسط صفري دون قيد'} · {row.reason}</p>)}
    </section>}
  </section>;
}
