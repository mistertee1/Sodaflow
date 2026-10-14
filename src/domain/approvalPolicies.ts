import type { OrgRole } from '../types';
import type { Document, Transaction } from './store';
import { clean } from './store';
import { ensure, identifier, money, text } from './validation';

export type ApprovalSubject = 'discount' | 'expense' | 'customer_refund' | 'supplier_refund';
export type ApprovalCurrency = 'PERCENT' | 'SDG' | 'USD';
export interface ApprovalTier { max_value: number | null; required_role: OrgRole; }
export interface ApprovalPolicy {
  schema_version: 1;
  id: string;
  org_id: string;
  revision: number;
  subject: ApprovalSubject;
  currency: ApprovalCurrency;
  tiers: ApprovalTier[];
  active: boolean;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  operation_id: string;
}

const roles: OrgRole[] = ['Owner', 'Admin', 'Accountant', 'Sales', 'Cashier'];
const allowedKeys = ['id', 'expected_revision', 'subject', 'currency', 'tiers', 'active', 'reason'];

export function validateApprovalPolicy(input: Document, orgId: string): ApprovalPolicy {
  const id = identifier(input.id), subject = input.subject as ApprovalSubject, currency = input.currency as ApprovalCurrency;
  ensure(['discount', 'expense', 'customer_refund', 'supplier_refund'].includes(subject), 'نوع سياسة الاعتماد غير صالح.');
  ensure(['PERCENT', 'SDG', 'USD'].includes(currency), 'عملة سياسة الاعتماد غير صالحة.');
  ensure(subject === 'discount' ? currency === 'PERCENT' : currency !== 'PERCENT', 'سياسة الخصم تستخدم النسبة، وسياسات المبالغ تستخدم عملة مالية.');
  ensure(Array.isArray(input.tiers) && input.tiers.length > 0 && input.tiers.length <= 10, 'يجب تحديد مستويات اعتماد من 1 إلى 10.');
  let previous = -1;
  const tiers = input.tiers.map((row: Document, index: number): ApprovalTier => {
    ensure(row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).every(key => ['max_value', 'required_role'].includes(key)), 'حقول مستوى الاعتماد غير صالحة.');
    ensure(roles.includes(row.required_role as OrgRole), 'دور الاعتماد غير صالح.');
    const last = index === input.tiers.length - 1;
    ensure(last === (row.max_value === null), 'يجب أن يكون المستوى الأخير فقط بلا حد أعلى.');
    const max = row.max_value === null ? null : money(row.max_value, currency === 'USD' ? 2 : 4, true);
    if (max !== null) { ensure(max > previous, 'حدود الاعتماد يجب أن تكون متزايدة بلا تداخل.'); ensure(currency !== 'PERCENT' || max <= 100, 'نسبة الخصم لا تتجاوز 100%.'); previous = max; }
    return { max_value: max, required_role: row.required_role as OrgRole };
  });
  ensure(typeof input.active === 'boolean', 'حالة سياسة الاعتماد مطلوبة.');
  return clean({ ...input, schema_version: 1, id, org_id: orgId, subject, currency, tiers }) as unknown as ApprovalPolicy;
}

export async function saveApprovalPolicy(tx: Transaction, root: string, orgId: string, actor: string, iso: string, operationId: string, action: string, data: Document) {
  ensure(data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).every(key => allowedKeys.includes(key)), 'حقول حفظ سياسة الاعتماد غير صالحة.');
  const id = identifier(data.id), path = `${root}/approval_policies/${id}`, current = await tx.get(path);
  ensure(action === 'approvalPolicy.create' || action === 'approvalPolicy.update', 'عملية سياسة الاعتماد غير معروفة.');
  ensure(action.endsWith('create') ? !current : !!current, action.endsWith('create') ? 'معرف سياسة الاعتماد موجود مسبقاً.' : 'سياسة الاعتماد غير موجودة.', action.endsWith('create') ? 409 : 404);
  if (current) ensure(Number.isSafeInteger(data.expected_revision) && data.expected_revision === current.revision, 'سياسة الاعتماد تغيرت؛ حدّث البيانات ثم أعد المحاولة.', 409);
  else ensure(data.expected_revision === undefined || data.expected_revision === 0, 'الإصدار الابتدائي غير صالح.');
  text(data.reason, 1000, true);
  const revision = (current?.revision || 0) + 1;
  const saved = validateApprovalPolicy({ ...data, revision, created_at: current?.created_at || iso, created_by: current?.created_by || actor, updated_at: iso, updated_by: actor, operation_id: operationId }, orgId);
  const duplicate = (await tx.list(`${root}/approval_policies`)).find(row => row.id !== id && row.subject === saved.subject && row.currency === saved.currency && row.active);
  ensure(!saved.active || !duplicate, 'توجد سياسة اعتماد نشطة لنفس النوع والعملة.', 409);
  tx.set(path, saved as unknown as Document);
  return { result: saved as unknown as Document, before: current };
}

const rank: Record<OrgRole, number> = { Viewer: 0, Cashier: 1, Sales: 1, Accountant: 2, Admin: 3, Owner: 4 };
export function approvalDecision(policy: ApprovalPolicy, value: number, actorRole?: OrgRole, actorUid?: string, reason?: unknown) {
  ensure(policy.active, 'سياسة الاعتماد غير نشطة.', 409);
  const amount = money(value, policy.currency === 'USD' ? 2 : 4);
  const tier = policy.tiers.find(row => row.max_value === null || amount <= row.max_value)!;
  const approved = !!actorRole && rank[actorRole] >= rank[tier.required_role];
  const evidence: Document = { policy_id: policy.id, policy_revision: policy.revision, subject: policy.subject, currency: policy.currency, value: amount, required_role: tier.required_role, approved };
  if (approved) Object.assign(evidence, { approved_by: identifier(actorUid), approved_by_role: actorRole, approval_reason: text(reason, 500, true) });
  return evidence;
}

export async function approvalGate(tx: Transaction, root: string, subject: ApprovalSubject, currency: ApprovalCurrency, value: number, actorRole: OrgRole, actorUid: string, reason?: unknown) {
  const matches = (await tx.list(`${root}/approval_policies`)).filter(row => row.active === true && row.subject === subject && row.currency === currency);
  ensure(matches.length <= 1, 'توجد أكثر من سياسة اعتماد نشطة لنفس النوع والعملة.', 409);
  if (!matches.length || value <= 0) return undefined;
  const policy = validateApprovalPolicy(matches[0], matches[0].org_id);
  const evidence = approvalDecision(policy, value, actorRole, actorUid, reason);
  ensure(evidence.approved === true, `هذه العملية تتطلب اعتماد دور ${evidence.required_role}.`, 403);
  return evidence;
}
