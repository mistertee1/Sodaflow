import type { Account, JournalEntry, MerchantSettings, OrgRole } from '../types';
import type { Document, Transaction } from './store';
import { dateOnly, ensure, identifier, text } from './validation';
import { periodLedgerHash, validatePeriods } from './periodContracts';
import { financialCollections, reconcileFinancialData, type FinancialData } from './reconciliation';
import { cashReconciliationReports } from './cashReconciliation';
import { classifyAccount } from './accountClassification';
import { merchantDay } from './operationalReports';
import BigNumber from 'bignumber.js';

interface Context { tx:Transaction;root:string;orgId:string;actor:string;role:OrgRole;iso:string;operationId:string;settings:MerchantSettings;set:(path:string,row:Document)=>void;required:(collection:string,id:string)=>Promise<Document>; }
export async function closeChecklist(tx:Transaction,root:string,period:Document,settings:MerchantSettings,iso:string) {
  const collections=Object.fromEntries(await Promise.all(financialCollections.map(async name=>[name,await tx.list(`${root}/${name}`)]))) as FinancialData;
  const findings=reconcileFinancialData(collections,settings,{requireCosting:true});
  const sessions=await cashReconciliationReports(tx,root,period.end_date);
  const entries=collections.journal_entries as JournalEntry[], accounts=collections.accounts as Account[];
  const requiredAccounts=accounts.filter(account=>classifyAccount(account).reporting_group==='cash_bank').filter(account=>entries.some(entry=>dateOnly(entry.date)<=period.end_date && entry.lines.some(line=>line.account_code===account.code && (line.debit_sdg||line.credit_sdg||line.debit_usd||line.credit_usd))));
  const missing:string[]=[],proof:Document[]=[];
  for(const account of requiredAccounts) {
    const maps=collections.financial_accounts.filter(row=>row.account_code===account.code);
    const row=sessions.records.find(row=>maps.some(map=>row.financial_account_id===map.id));
    if(maps.length!==1 || !row || row.effective_status!=='matched' || row.ledger_snapshot.period.end!==period.end_date || row.kind!=='cash' && row.ledger_snapshot.period.start>period.start_date) missing.push(account.code);
    else {proof.push({account_code:account.code,financial_account_id:row.financial_account_id,id:row.id,kind:row.kind,ledger_hash:row.ledger_snapshot.ledger_hash});}
  }
  let debit=new BigNumber(0),credit=new BigNumber(0),debitUsd=new BigNumber(0),creditUsd=new BigNumber(0);
  for(const entry of entries.filter(row=>dateOnly(row.date)<=period.end_date)) for(const line of entry.lines){debit=debit.plus(line.debit_sdg);credit=credit.plus(line.credit_sdg);debitUsd=debitUsd.plus(line.debit_usd);creditUsd=creditUsd.plus(line.credit_usd);}
  const balanced=debit.eq(credit)&&debitUsd.eq(creditUsd);
  // Summaries use ALL findings, never the 100-row display slice. Unknown cash mappings block both checks.
  const clean = (...names:string[]) => !findings.some(row=>names.includes(row.collection));
  const journalClean = clean('journal_entries');
  const missingKind = (kind:string) => missing.some(code=>{const map=collections.financial_accounts.find(row=>row.account_code===code);return !map || (kind==='cash' ? map.kind==='cash' : map.kind!=='cash');});
  const checks = {
    sales_posted: journalClean && clean('invoices','payments','credit_notes','customer_refunds'),
    expenses_posted: journalClean && clean('expenses'),
    bank_reconciled: !missingKind('bank') && clean('financial_accounts','bank_reconciliations','internal_transfers'),
    cash_reconciled: !missingKind('cash') && clean('financial_accounts','cash_reconciliations','internal_transfers'),
    inventory_reconciled: journalClean && clean('products','inventory_movements'),
    ar_reconciled: journalClean && clean('customers','invoices','payments','credit_notes','customer_refunds'),
    ap_reconciled: journalClean && clean('suppliers','purchase_bills','supplier_payments','purchase_returns','supplier_refunds'),
    journals_balanced: balanced && journalClean,
    journals_complete: !findings.some(row=>/journal|reversal/.test(row.code)),
  };

  return {checks,period_id:period.id,end_date:period.end_date,checked_at:iso,findings_count:findings.length,findings:findings.slice(0,100),missing_reconciliations:missing,reconciliations:proof,balanced,ledger_hash:await periodLedgerHash(entries,period.end_date),can_close:!findings.length&&!missing.length&&balanced};
}
export async function periodCommand(action:string,data:Document,c:Context):Promise<Document> {
  const reason=text(data.reason,1000,true), rows=validatePeriods(await c.tx.list(`${c.root}/accounting_periods`),c.orgId);
  if(action==='period.create') {
    ensure(Object.keys(data).every(k=>['id','start_date','end_date','reason'].includes(k)),'مدخلات إنشاء الفترة غير مسموحة.');
    const id=identifier(data.id);ensure(!rows.some(row=>row.id===id),'الفترة موجودة.',409);
    const row={id,org_id:c.orgId,schema_version:1,start_date:dateOnly(data.start_date),end_date:dateOnly(data.end_date),status:'OPEN',revision:1,created_by:c.actor,created_at:c.iso,operation_id:c.operationId,reason};
    validatePeriods([...rows,row],c.orgId);c.set(`${c.root}/accounting_periods/${id}`,row);return row;
  }
  ensure(Object.keys(data).every(k=>['id','expected_revision','reason','fx_review_completed'].includes(k)),'مدخلات انتقال الفترة غير مسموحة.');
  const old=await c.required('accounting_periods',data.id);ensure(old.org_id===c.orgId,'الفترة تنتمي لمؤسسة أخرى.');
  ensure(Number.isSafeInteger(data.expected_revision)&&data.expected_revision===old.revision,'الفترة تغيرت؛ حدث البيانات وراجع الحالة.',409);
  ensure(old.revision<Number.MAX_SAFE_INTEGER,'إصدار الفترة تجاوز الحد.',409);
  const row:Document={...old,revision:old.revision+1,changed_by:c.actor,changed_at:c.iso,reason,operation_id:c.operationId};
  if(action==='period.softClose') {ensure(['OPEN','REOPENED'].includes(old.status),'الإغلاق المبدئي يتطلب فترة مفتوحة.',409);row.status='SOFT_CLOSED';}
  else if(action==='period.close') {
    ensure(old.status==='SOFT_CLOSED','الإغلاق النهائي يتطلب الإغلاق المبدئي أولاً.',409);
    ensure(old.end_date<=merchantDay(new Date(c.iso),c.settings.timezone||'Africa/Khartoum'),'لا يمكن إغلاق فترة مستقبلية.',409);
    ensure(data.fx_review_completed===true,'أكد مراجعة فروق الصرف قبل الإغلاق النهائي.');
    const checks=await closeChecklist(c.tx,c.root,old,c.settings,c.iso);ensure(checks.can_close,'فشل فحص الإغلاق: أصلح الفروقات وطابق كل صندوق وبنك حتى نهاية الفترة.',409);
    row.status='CLOSED';row.close_evidence={schema_version:1,...checks,fx_review_completed:true,reviewed_by:c.actor,review_reason:reason};
  } else {
    ensure(action==='period.reopen' && ['SOFT_CLOSED','CLOSED'].includes(old.status),'إعادة الفتح تتطلب فترة مقفلة.',409);
    row.status='REOPENED';row.previous_status=old.status;row.reopened_by=c.actor;row.reopened_at=c.iso;row.reopen_reason=reason;
  }
  ensure(new TextEncoder().encode(JSON.stringify(row)).length<=200000,'إثبات الفترة كبير؛ يلزم إغلاق مضبوط في إجراء خادمي.',413);
  validatePeriods(rows.map(saved=>saved.id===row.id?row:saved),c.orgId);c.set(`${c.root}/accounting_periods/${row.id}`,row);return row;
}
