import type { Invoice, MerchantSettings } from '../types';
import type { Document, Transaction } from './store';
import { ensure, identifier } from './validation';
import { loadSalesSource } from './salesCorrections';
import { loadPurchaseSource } from './purchaseCorrections';

export const correctionDocumentKinds = ['credit_note', 'customer_refund', 'purchase_return', 'supplier_refund'] as const;
export type CorrectionDocumentKind = typeof correctionDocumentKinds[number];
export interface CorrectionDocument {
  schema_version: 1;
  organization_id: string;
  document_type: CorrectionDocumentKind;
  document: Document;
  source: { id: string; number: string; partner_name: string; date: string; currency: string };
  business: { name: string; phone: string; address: string };
  lines: Document[];
  stock: Document[];
  financial_account?: { id: string; name: string; account_code: string; currency: string };
  generated_at: string;
}
export function correctionDocumentKind(input: unknown): CorrectionDocumentKind {
  ensure(typeof input === 'string' && correctionDocumentKinds.includes(input as CorrectionDocumentKind), 'نوع مستند التصحيح غير صالح.');
  return input as CorrectionDocumentKind;
}
/** Read immutable financial evidence afresh; callers must enforce export/read authorization. */
export async function readCorrectionDocument(tx: Transaction, root: string, input: Document, settings: MerchantSettings, iso: string): Promise<CorrectionDocument> {
  ensure(Object.keys(input).every(key => ['kind', 'id'].includes(key)), 'أرسل نوع المستند ومعرفه فقط.');
  const kind = correctionDocumentKind(input.kind), id = identifier(input.id);
  const collection = { credit_note: 'credit_notes', customer_refund: 'customer_refunds', purchase_return: 'purchase_returns', supplier_refund: 'supplier_refunds' }[kind];
  const row = await tx.get(`${root}/${collection}/${id}`);
  ensure(row, 'مستند التصحيح غير موجود.', 404);
  ensure(row.org_id === root.split('/')[1] && row.id === id, 'مستند التصحيح يتبع مؤسسة أخرى.', 403);
  const sales = kind === 'credit_note' || kind === 'customer_refund';
  const source = await tx.get(`${root}/${sales ? 'invoices' : 'purchase_bills'}/${identifier(sales ? row.invoice_id : row.bill_id)}`);
  ensure(source, 'مصدر مستند التصحيح غير موجود.', 409);
  if (sales) await loadSalesSource(tx, root, source as Invoice);
  else await loadPurchaseSource(tx, root, source);
  const lines = (row.lines || []).map((line: Document) => {
    const item = source.items.find((item: Document) => item.id === line.line_id);
    ensure(item, 'بند المصدر مفقود.', 409);
    return { ...line, description: sales ? item.description : item.product_name, product_id: item.product_id || '', unit: item.unit || '' };
  });
  const account = row.financial_account_id ? await tx.get(`${root}/financial_accounts/${identifier(row.financial_account_id)}`) : undefined;
  return {
    ...(account ? { financial_account: { id: account.id, name: account.name, account_code: account.account_code, currency: account.currency } } : {}),
    schema_version: 1, organization_id: root.split('/')[1], document_type: kind, document: row,
    source: { id: source.id, number: sales ? source.invoice_number : source.supplier_reference, partner_name: sales ? source.customer_name : source.supplier_name, date: source.issue_date, currency: row.native_currency },
    business: { name: settings.business_name || '', phone: settings.phone || '', address: settings.address || '' },
    lines, stock: row.stock || [], generated_at: iso,
  };
}
