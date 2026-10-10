import type { Account, Invoice, JournalEntry, Payment } from '../types';
import type { FinancialAccount } from './cashManagement';
import type { PurchaseBill, SupplierPayment } from './payables';
import type { Document } from './store';
import { classifyAccount } from './accountClassification';
import type { NativeSourceAllocation } from './fxExposure';
import { openingLineAllocations } from './openingIntegration';
import { dateOnly, ensure, identifier } from './validation';

export interface FxSourceSnapshot {
  org_id:string; accounts:Account[]; journal_entries:JournalEntry[]; financial_accounts:FinancialAccount[];
  invoices:Invoice[]; payments:Payment[]; purchase_bills:PurchaseBill[]; supplier_payments:SupplierPayment[];
  credit_notes:Document[]; customer_refunds:Document[]; purchase_returns:Document[]; supplier_refunds:Document[];
  opening_batches:Document[]; opening_lots:Document[]; opening_settlements:Document[]; inventory_movements:Document[];
}

function strictIndex<T extends object>(rows:T[],org:string,label:string){
  ensure(Array.isArray(rows),`${label} غير مكتملة في لقطة المصدر.`); const index=new Map<string,T>();
  for(const row of rows){const record=row as Record<string,unknown>,id=identifier(record.id);ensure(record.org_id===org&&!index.has(id),`${label} أجنبية أو مكررة.`);index.set(id,row);} return index;
}

/** Build line-level native-currency proof exclusively from verified server records. */
export function deriveNativeSourceAllocations(snapshot:FxSourceSnapshot,accountCodes:string[],asOf:string):NativeSourceAllocation[]{
  const org=identifier(snapshot.org_id),day=dateOnly(asOf),selected=new Set(accountCodes.map(identifier));
  ensure(selected.size===accountCodes.length,'حسابات إثبات المصدر مكررة.');
  const chart=new Map<string,Account>(); for(const account of snapshot.accounts){identifier(account.code);ensure(account.org_id===org&&!chart.has(account.code),'دليل الحسابات أجنبي أو مكرر.');chart.set(account.code,account);}
  const financial=new Map<string,FinancialAccount>(); for(const row of snapshot.financial_accounts){identifier(row.id);identifier(row.account_code);ensure(row.org_id===org&&!financial.has(row.account_code),'ربط الحساب المالي أجنبي أو مكرر.');financial.set(row.account_code,row);}
  const invoices=strictIndex(snapshot.invoices,org,'الفواتير'),payments=strictIndex(snapshot.payments,org,'التحصيلات');
  const bills=strictIndex(snapshot.purchase_bills,org,'فواتير الشراء'),supplierPayments=strictIndex(snapshot.supplier_payments,org,'مدفوعات الموردين');
  const creditNotes=strictIndex(snapshot.credit_notes,org,'إشعارات الائتمان'),customerRefunds=strictIndex(snapshot.customer_refunds,org,'رديات العملاء');
  const purchaseReturns=strictIndex(snapshot.purchase_returns,org,'مردودات الشراء'),supplierRefunds=strictIndex(snapshot.supplier_refunds,org,'استردادات الموردين');
  const openingData={accounts:snapshot.accounts as unknown as Document[],financial_accounts:snapshot.financial_accounts as unknown as Document[],opening_batches:snapshot.opening_batches,opening_lots:snapshot.opening_lots,opening_settlements:snapshot.opening_settlements,journal_entries:snapshot.journal_entries as unknown as Document[],inventory_movements:snapshot.inventory_movements};
  const openingReceivables=openingLineAllocations(openingData,'receivable'),openingPayables=openingLineAllocations(openingData,'payable');
  const invoiceCurrency=(id:string)=>{const invoice=invoices.get(identifier(id));ensure(invoice,'مصدر الفاتورة مفقود.');ensure(['SDG','USD'].includes(invoice.receivable_currency||''),'عملة ذمة الفاتورة غير مثبتة.');return invoice.receivable_currency!;};
  const billCurrency=(id:string)=>{const bill=bills.get(identifier(id));ensure(bill,'مصدر فاتورة الشراء مفقود.');ensure(['SDG','USD'].includes(bill.currency),'عملة فاتورة الشراء غير صالحة.');return bill.currency;};
  const related=(entry:JournalEntry,lineIndex:number,side:'receivable'|'payable'):'SDG'|'USD'=>{
    const ref=identifier(entry.reference_id);
    if(entry.reference_type==='invoice')return invoiceCurrency(ref);
    if(entry.reference_type==='payment'){const row=payments.get(ref);ensure(row,'مصدر التحصيل مفقود.');return invoiceCurrency(row.invoice_id);}
    if(entry.reference_type==='credit_note'||entry.reference_type==='customer_refund'){const row=(entry.reference_type==='credit_note'?creditNotes:customerRefunds).get(ref);ensure(row,'مصدر تصحيح العميل مفقود.');return invoiceCurrency(row.invoice_id);}
    if(entry.reference_type==='purchase_bill')return billCurrency(ref);
    if(entry.reference_type==='supplier_payment'){const row=supplierPayments.get(ref);ensure(row,'مصدر سداد المورد مفقود.');return billCurrency(row.bill_id);}
    if(entry.reference_type==='purchase_return'||entry.reference_type==='supplier_refund'){const row=(entry.reference_type==='purchase_return'?purchaseReturns:supplierRefunds).get(ref);ensure(row,'مصدر تصحيح المورد مفقود.');return billCurrency(row.bill_id);}
    ensure(['opening_batch','opening_settlement'].includes(entry.reference_type),'نوع قيد لا يملك موصل عملة مصدر موثوقاً.');
    const lot=(side==='receivable'?openingReceivables:openingPayables).get(`${entry.id}:${lineIndex}`);ensure(lot,'مصدر سطر الافتتاح مفقود.');return lot.currency;
  };
  const allocations:NativeSourceAllocation[]=[];
  for(const entry of snapshot.journal_entries){identifier(entry.id);ensure(entry.org_id===org,'قيد أجنبي في لقطة المصدر.');if(dateOnly(entry.date)>day)continue;
    for(const [lineIndex,line] of entry.lines.entries()){if(!selected.has(line.account_code))continue;const account=chart.get(line.account_code);ensure(account?.is_active,'حساب إثبات المصدر مفقود أو غير نشط.');const group=classifyAccount(account).reporting_group;let currency:'SDG'|'USD',sourceId:string;
      if(group==='cash_bank'){const mapped=financial.get(line.account_code);ensure(mapped&&['SDG','USD'].includes(mapped.currency),'الحساب النقدي بلا ربط عملة موثوق.');currency=mapped.currency;sourceId=mapped.id;}
      else if(group==='receivables'||group==='payables'){currency=related(entry,lineIndex,group==='receivables'?'receivable':'payable');sourceId=entry.reference_id;}
      else ensure(false,'إثبات عملة المصدر يقتصر على البنود النقدية.');
      allocations.push({journal_id:entry.id,line_index:lineIndex,source_id:sourceId,native_currency:currency});
    }
  }
  return allocations;
}
