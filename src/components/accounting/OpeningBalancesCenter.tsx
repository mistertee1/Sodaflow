import { useDisplayMoney } from '../../context/useDisplayMoney';
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { operationId } from '../../services/businessApi';
import type { OpeningInput } from '../../domain/openingBalances';
import type { OpeningTerms } from '../../domain/openingSources';
import type { Operations } from '../../domain/operations';
import { OwnerReauthenticationDialog } from './OwnerReauthenticationDialog';

type Kind = 'cash' | 'receivables' | 'payables' | 'inventory';
type Row = { key: string; kind: Kind; id: string; currency: 'SDG' | 'USD'; amount: string; quantity: string; unit_cost: string; rate: string; due: string; reference: string };
type Preview = Awaited<ReturnType<Operations['openingPreview']>>;
const names: Record<Kind, string> = { cash: 'نقدية وبنوك', receivables: 'قروش ليك عند العملاء', payables: 'قروش عليك للموردين', inventory: 'مخزون' };
const inputClass = 'w-full mt-1 p-2 rounded border border-sf-border bg-sf-raised';
const button = 'p-3 rounded border border-sf-border disabled:opacity-50';
const today = () => new Date().toISOString().slice(0, 10);

export function OpeningBalancesCenter() {
  const { formatMoney, bookLabel } = useDisplayMoney();
  const app = useApp();
  const { currentOrg, currentUser, userRole, counters, isActionAllowed, financialAccounts, customers, suppliers, products, openingBatches, openingLots, openingSettlements, previewOpening, saveOpening } = app;
  const [date, setDate] = useState(today), [policy, setPolicy] = useState<OpeningInput['currency_policy']>('sdg_only');
  const [rows, setRows] = useState<Row[]>([]), [reason, setReason] = useState(''), [equityReason, setEquityReason] = useState('');
  const [capitalSdg, setCapitalSdg] = useState('0'), [capitalUsd, setCapitalUsd] = useState('0');
  const batchId = useRef(operationId());
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [reauth, setReauth] = useState(false), [lotId, setLotId] = useState(''), [cashId, setCashId] = useState(''), [settlementDate, setSettlementDate] = useState(today);
  const [amount, setAmount] = useState(''), [rate, setRate] = useState(''), [settlementReason, setSettlementReason] = useState(''), [reference, setReference] = useState('');
  const working = useRef(false), mounted = useRef(true), scope = useRef({ org: currentOrg?.id, uid: currentUser?.uid });
  const current = useRef(scope.current); current.current = { org: currentOrg?.id, uid: currentUser?.uid };
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const editable = isActionAllowed('opening:preview'), canWrite = isActionAllowed('opening:write'), canSettle = isActionAllowed('opening:settle');
  const payload: { input: OpeningInput; terms: OpeningTerms[] } = {
    input: { batch_id: batchId.current, date, reason: reason.trim(), currency_policy: policy, cash: [], receivables: [], payables: [], inventory: [], capital: { sdg: Number(capitalSdg), usd: policy === 'dual' ? Number(capitalUsd) : 0 }, equity_difference_reason: equityReason.trim() }, terms: [],
  };
  for (const row of rows) {
    const fx = policy === 'dual' ? { exchange_rate_used: Number(row.rate) } : {};
    const currency = policy === 'sdg_only' ? 'SDG' as const : row.currency;
    if (row.kind === 'inventory') payload.input.inventory.push({ id: row.id, quantity: Number(row.quantity), unit_cost: Number(row.unit_cost), currency, ...fx });
    else payload.input[row.kind].push({ id: row.id, amount: Number(row.amount), currency, ...fx });
    if (row.kind === 'receivables' || row.kind === 'payables') payload.terms.push({ kind: row.kind === 'receivables' ? 'receivable' : 'payable', source_id: row.id, due_date: row.due, reference: row.reference.trim() });
  }
  const fingerprint = JSON.stringify(payload);
  const currentFingerprint = useRef(fingerprint), currentRevision = useRef(counters.revision); currentFingerprint.current = fingerprint; currentRevision.current = counters.revision;
  useEffect(() => { setPreview(null); setReauth(false); }, [fingerprint, counters.revision, editable, canWrite]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inScope = () => mounted.current && current.current.org === scope.current.org && current.current.uid === scope.current.uid;
  const execute = async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setMessage('');
    try { if (!inScope()) throw new Error('تغيرت المؤسسة أو الجلسة؛ أعد فتح الشاشة.'); await work(); }
    catch (e) { if (inScope()) setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const mutate = async (action: 'opening.commit' | 'openingSettlement.create', data: Record<string, unknown>, orgId: string) => {
    const key = JSON.stringify({ action, data });
    if (pending.current?.fingerprint !== key) pending.current = { fingerprint: key, id: operationId() };
    await saveOpening(action, data, orgId, pending.current.id);
    pending.current = null;
  };
  const update = (key: string, fields: Partial<Row>) => setRows(old => old.map(row => row.key === key ? { ...row, ...fields } : row));
  const masters = (kind: Kind) => kind === 'cash' ? financialAccounts.filter(a => a.status === 'active' && (policy === 'dual' || a.currency === 'SDG')) : kind === 'receivables' ? customers : kind === 'payables' ? suppliers.filter(a => a.status === 'active') : products.filter(a => a.track_inventory && a.is_active);
  const lot = openingLots.find(row => row.id === lotId);
  const events = openingSettlements.filter(row => row.lot_id === lotId).sort((a, b) => b.sequence - a.sequence);
  const state = events[0]?.quote?.after || (lot ? { sdg: lot.sdg, usd: lot.usd, sequence: 0, last_date: lot.date } : null);
  const cash = financialAccounts.find(row => row.id === cashId);
  const dual = lot && openingBatches.find(row => row.id === lot.batch_id)?.input?.currency_policy === 'dual';
  return <section role="region" aria-label="الأرصدة الافتتاحية والسداد" className="space-y-4 text-sm text-sf-text">
    <h3 className="text-lg font-semibold">الأرصدة الافتتاحية والسداد</h3>
    <p>ابدأ بأرصدة المؤسسة قبل أول حركة مالية. المعاينة لا تحفظ بيانات؛ الحفظ ينشئ قيوداً ومصادر قابلة للمطابقة. البيانات التاريخية تحتاج ترحيلاً مضبوطاً.</p>
    {error && <p role="alert" className="text-sf-danger">{error}</p>}{message && <p role="status" className="text-sf-action">{message}</p>}
    {!editable && <p>صلاحية المعاينة أو الاشتراك المحاسبي غير متاحة.</p>}
    {editable && currentOrg?.accounting_version !== 2 && <p>فعّل محاسبة V2 أولاً بعد مراجعة البيانات.</p>}
    {editable && currentOrg?.accounting_version === 2 && !openingBatches.length && <form aria-label="إعداد الأرصدة الافتتاحية" className="sf-card p-4 space-y-4" onSubmit={e => { e.preventDefault(); const captured = fingerprint, revision = counters.revision; void execute(async () => { const value = await previewOpening(payload, scope.current.org!); if (inScope() && value.organizationId === scope.current.org && currentFingerprint.current === captured && currentRevision.current === revision) setPreview(value); }); }}>
      <div className="grid sm:grid-cols-2 gap-3"><label>تاريخ الأرصدة<input aria-label="تاريخ الأرصدة" type="date" value={date} onChange={e => setDate(e.target.value)} required disabled={busy} className={inputClass} /></label><label>سياسة العملات<select aria-label="سياسة العملات" value={policy} onChange={e => { setPolicy(e.target.value as typeof policy); setRows([]); }} disabled={busy} className={inputClass}><option value="sdg_only">الجنيه السوداني فقط</option><option value="dual">دفتران SDG وUSD بأسعار صريحة</option></select></label></div>
      <p>أنشئ فترة مفتوحة تغطي تاريخ الأرصدة، وجهّز العملاء والموردين والأصناف والحسابات المالية أولاً. تغيير سياسة العملات يمسح بنود المسودة.</p>
      <label className="block">سبب بدء الأرصدة<textarea aria-label="سبب بدء الأرصدة" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} required disabled={busy} className={inputClass} /></label>
      <div className="flex flex-wrap gap-2">{(Object.keys(names) as Kind[]).map(kind => <button key={kind} type="button" disabled={busy || rows.length >= 97} className={button} onClick={() => setRows(old => [...old, { key: operationId(), kind, id: '', currency: 'SDG', amount: '', quantity: '', unit_cost: '', rate: '', due: date, reference: '' }])}>إضافة {names[kind]}</button>)}</div>
      {rows.map((row, index) => <fieldset key={row.key} disabled={busy} className="border border-sf-border rounded p-3 space-y-3"><legend>{names[row.kind]} — {index + 1}</legend>
        <label className="block">المصدر<select aria-label={`المصدر ${index + 1}`} required value={row.id} onChange={e => { const item = masters(row.kind).find(item => item.id === e.target.value); update(row.key, { id: e.target.value, ...(row.kind === 'cash' && item ? { currency: (item as { currency: 'SDG' | 'USD' }).currency } : {}) }); }} className={inputClass}><option value="">اختر مصدراً</option>{masters(row.kind).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="grid sm:grid-cols-2 gap-3">{row.kind === 'inventory' ? <><label>الكمية<input aria-label={`الكمية ${index + 1}`} type="number" min="0.000001" step="0.000001" required value={row.quantity} onChange={e => update(row.key, { quantity: e.target.value })} className={inputClass} /></label><label>تكلفة الوحدة<input aria-label={`تكلفة الوحدة ${index + 1}`} type="number" min="0.000001" step="0.000001" required value={row.unit_cost} onChange={e => update(row.key, { unit_cost: e.target.value })} className={inputClass} /></label></> : <label>المبلغ<input aria-label={`المبلغ ${index + 1}`} type="number" min={row.currency === 'USD' && policy === 'dual' ? '0.01' : '1'} step={row.currency === 'USD' && policy === 'dual' ? '0.01' : '1'} required value={row.amount} onChange={e => update(row.key, { amount: e.target.value })} className={inputClass} /></label>}
        {policy === 'dual' && <><label>العملة<select aria-label={`العملة ${index + 1}`} value={row.currency} disabled={row.kind === 'cash'} onChange={e => update(row.key, { currency: e.target.value as Row['currency'] })} className={inputClass}><option>SDG</option><option>USD</option></select></label><label>جنيه لكل دولار<input aria-label={`سعر الصرف ${index + 1}`} type="number" min="0.00000001" step="0.00000001" required value={row.rate} onChange={e => update(row.key, { rate: e.target.value })} className={inputClass} /></label></>}
        {['receivables', 'payables'].includes(row.kind) && <><label>تاريخ الاستحقاق<input aria-label={`تاريخ الاستحقاق ${index + 1}`} type="date" required value={row.due} onChange={e => update(row.key, { due: e.target.value })} className={inputClass} /></label><label>مرجع الرصيد<input aria-label={`مرجع الرصيد ${index + 1}`} required maxLength={200} value={row.reference} onChange={e => update(row.key, { reference: e.target.value })} className={inputClass} /></label></>}
        </div><button type="button" className={button} onClick={() => setRows(old => old.filter(item => item.key !== row.key))}>حذف بند {index + 1}</button>
      </fieldset>)}
      <div className="grid sm:grid-cols-2 gap-3"><label>رأس المال {bookLabel('SDG')}<input aria-label="رأس المال SDG" type="number" min="0" step="1" required value={capitalSdg} onChange={e => setCapitalSdg(e.target.value)} disabled={busy} className={inputClass} /></label>{policy === 'dual' && <label>رأس المال {bookLabel('USD')}<input aria-label="رأس المال USD" type="number" min="0" step="0.01" required value={capitalUsd} onChange={e => setCapitalUsd(e.target.value)} disabled={busy} className={inputClass} /></label>}</div>
      <label className="block">تفسير فرق حقوق الملكية<textarea aria-label="تفسير فرق حقوق الملكية" value={equityReason} onChange={e => setEquityReason(e.target.value)} maxLength={1000} disabled={busy} className={inputClass} /></label><p>إذا اختلف صافي الأصول عن رأس المال، راجع الفرق واكتب تفسيراً قبل الحفظ.</p>
      <button type="submit" disabled={busy || !rows.length || !reason.trim()} className={`${button} bg-sf-action text-white`}>معاينة الأرصدة بدون حفظ</button>
    </form>}
    {preview && <section aria-label="مراجعة الأرصدة" className="sf-card p-4 space-y-3"><h4 className="font-semibold">مراجعة الأرصدة</h4><p>الفترة: {preview.period.id} · المصادر: {preview.source_count}</p><div className="overflow-auto"><table className="w-full"><thead><tr><th>البيان</th><th>{bookLabel('SDG')}</th><th>{bookLabel('USD')}</th></tr></thead><tbody>{(['assets', 'liabilities', 'capital', 'opening_equity'] as const).map(key => <tr key={key}><td>{{ assets: 'الأصول', liabilities: 'الالتزامات', capital: 'رأس المال', opening_equity: 'فرق حقوق الملكية' }[key]}</td><td>{formatMoney(preview.quote[key].sdg, 'SDG')}</td><td>{formatMoney(preview.quote[key].usd, 'USD')}</td></tr>)}</tbody></table></div><p>مدين {bookLabel('SDG')}: {formatMoney(preview.quote.total_debit_sdg, 'SDG')} · دائن {bookLabel('SDG')}: {formatMoney(preview.quote.total_credit_sdg, 'SDG')} · مدين {bookLabel('USD')}: {formatMoney(preview.quote.total_debit_usd, 'USD')} · دائن {bookLabel('USD')}: {formatMoney(preview.quote.total_credit_usd, 'USD')}</p>{!preview.quote.equity_review_complete && <p role="alert">اكتب تفسير فرق حقوق الملكية وأعد المعاينة.</p>}<button type="button" disabled={busy || !canWrite || !preview.posting_available} onClick={() => setReauth(true)} className={`${button} bg-sf-action text-white`}>تحقق المالك وحفظ الأرصدة</button>{!canWrite && <p>المحاسب يجهز المعاينة؛ الحفظ يتطلب المالك.</p>}</section>}
    {!!openingBatches.length && <p>دفعة الأرصدة محفوظة. لتصحيح أرصدة مرحّلة استخدم مسار تصحيح قابل للمراجعة.</p>}
    {canSettle && !!openingLots.length && <form aria-label="سداد رصيد افتتاحي" className="sf-card p-4 space-y-3" onSubmit={e => { e.preventDefault(); if (!lot || !state || !cash || !scope.current.org) return; const data = { lot_id: lot.id, expected_sequence: state.sequence, date: settlementDate, financial_account_id: cash.id, currency: cash.currency, amount: Number(amount), ...(dual ? { exchange_rate_used: Number(rate) } : {}), reason: settlementReason.trim(), reference_number: reference.trim() }; void execute(async () => { await mutate('openingSettlement.create', data, scope.current.org!); if (inScope()) { setAmount(''); setMessage('تم حفظ السداد وقيده؛ راجع كشف الطرف.'); } }); }}>
      <h4 className="font-semibold">سداد رصيد افتتاحي</h4><label className="block">مصدر السداد<select aria-label="مصدر السداد" required disabled={busy} value={lotId} onChange={e => { setLotId(e.target.value); setCashId(''); setAmount(''); setRate(''); }} className={inputClass}><option value="">اختر رصيداً</option>{openingLots.map(row => <option key={row.id} value={row.id}>{row.kind === 'receivable' ? 'عميل' : 'مورد'} — {(row.kind === 'receivable' ? customers : suppliers).find(party => party.id === row.party_id)?.name || row.party_id} — {row.reference}</option>)}</select></label>
      {state && <p>المتبقي المعروض: {formatMoney(state.sdg, 'SDG')} {bookLabel('SDG')} / {formatMoney(state.usd, 'USD')} {bookLabel('USD')}. الخادم يعيد فحص المصدر قبل الحفظ.</p>}
      <div className="grid sm:grid-cols-2 gap-3"><label>الحساب المالي<select aria-label="حساب السداد" required disabled={busy} value={cashId} onChange={e => setCashId(e.target.value)} className={inputClass}><option value="">اختر حساباً</option>{financialAccounts.filter(row => row.status === 'active' && (dual || row.currency === 'SDG')).map(row => <option key={row.id} value={row.id}>{row.name} — {row.currency}</option>)}</select></label><label>تاريخ السداد<input aria-label="تاريخ سداد الرصيد" type="date" min={state?.last_date} required disabled={busy} value={settlementDate} onChange={e => setSettlementDate(e.target.value)} className={inputClass} /></label><label>مبلغ السداد {cash?.currency}<input aria-label="مبلغ سداد الرصيد" type="number" min={cash?.currency === 'USD' ? '0.01' : '1'} step={cash?.currency === 'USD' ? '0.01' : '1'} required disabled={busy} value={amount} onChange={e => setAmount(e.target.value)} className={inputClass} /></label>{dual && <label>سعر صرف السداد<input aria-label="سعر صرف السداد" type="number" min="0.00000001" step="0.00000001" required disabled={busy} value={rate} onChange={e => setRate(e.target.value)} className={inputClass} /></label>}</div>
      <label className="block">سبب السداد<textarea aria-label="سبب سداد الرصيد" maxLength={1000} required disabled={busy} value={settlementReason} onChange={e => setSettlementReason(e.target.value)} className={inputClass} /></label><label className="block">مرجع السداد<input aria-label="مرجع سداد الرصيد" maxLength={200} disabled={busy} value={reference} onChange={e => setReference(e.target.value)} className={inputClass} /></label><button type="submit" disabled={busy || !lot || !cash || !state || !settlementReason.trim()} className={`${button} bg-sf-action text-white`}>{lot?.kind === 'payable' ? 'دفع رصيد المورد' : 'تحصيل رصيد العميل'}</button>
    </form>}
    {reauth && preview && <OwnerReauthenticationDialog purpose={{ title: 'تحقق المالك وحفظ الأرصدة', description: 'تأكيد الأرصدة ينشئ قيوداً افتتاحية ومخزوناً وأرصدة أطراف. راجع المعاينة قبل التأكيد.', initialReason: payload.input.reason, reasonLabel: 'سبب تأكيد الأرصدة', confirmation: 'أؤكد حفظ الأرصدة في التجربة المحلية', submit: 'التحقق وحفظ الأرصدة' }} onClose={() => setReauth(false)} onConfirm={async (confirmationReason, orgId) => { if (confirmationReason !== payload.input.reason) throw new Error('سبب التأكيد يجب أن يطابق المعاينة؛ لتغييره أغلق التحقق وأعد المعاينة.'); if (working.current || !inScope() || orgId !== scope.current.org || !canWrite) throw new Error('أعد فتح المعاينة الحالية.'); working.current = true; setBusy(true); try { await mutate('opening.commit', { ...payload, expected_preview_hash: preview.preview_hash }, orgId); if (inScope()) { setPreview(null); setRows([]); setMessage('تم حفظ الأرصدة الافتتاحية وقيودها.'); } } finally { working.current = false; if (mounted.current) setBusy(false); } }} />}
  </section>;
  // Refs are updated on every render; a late preview must not approve newer input.
}
