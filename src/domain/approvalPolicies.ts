import type { OrgRole } from '../types';
import type { Document, Transaction } from './store';
import { ensure, identifier, money, text } from './validation';

export const approvalCollections = ['approval_policies', 'approval_policy_versions', 'approval_requests'] as const;
export type ApprovalKind = 'discount' | 'expense' | 'refund' | 'credit_limit';
export type ApprovalRequiredRole = 'Sales' | 'Accountant' | 'Admin' | 'Owner';
export type ApprovableAction = 'invoice.create' | 'expense.create' | 'customerRefund.create';

export interface ApprovalRequirement {
  kind: ApprovalKind;
  discount_percent: number;
  amount_sdg: number;
  amount_usd: number;
  overage_sdg: number;
  overage_usd: number;
}

export interface ApprovalMoneyThresholds {
  accountant_max_sdg: number;
  accountant_max_usd: number;
  admin_max_sdg: number;
  admin_max_usd: number;
}

export interface ApprovalPolicy {
  id: string;
  org_id: string;
  name: string;
  active: boolean;
  revision: number;
  discount: { sales_max_percent: number; admin_max_percent: number };
  expense: ApprovalMoneyThresholds;
  refund: ApprovalMoneyThresholds;
  credit_limit: { required_role: 'Admin' | 'Owner' };
  previous_version_hash: string | null;
  version_hash: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  operation_id: string;
}

export interface ApprovalPolicyVersion extends ApprovalPolicy {
  configuration_id: string;
}

export interface ApprovalRequest {
  id: string;
  org_id: string;
  policy_id: string;
  policy_revision: number;
  policy_version_id: string;
  policy_version_hash: string;
  kind: ApprovalKind;
  subject_type: string;
  subject_id: string;
  reason: string;
  discount_percent: number;
  amount_sdg: number;
  amount_usd: number;
  overage_sdg: number;
  overage_usd: number;
  payload: Document;
  required_role: ApprovalRequiredRole;
  status: 'pending' | 'approved' | 'rejected';
  revision: number;
  requested_by: string;
  requested_role: OrgRole;
  requested_at: string;
  operation_id: string;
  request_hash: string;
  reviewed_by?: string;
  reviewer_role?: OrgRole;
  reviewed_at?: string;
  review_reason?: string;
  review_operation_id?: string;
  review_hash?: string;
  consumed_by?: string;
  consumed_at?: string;
  consumed_action?: ApprovableAction;
  consumed_operation_id?: string;
  consumption_hash?: string;
}

const stable = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value).filter(([, nested]) => nested !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';

const sha256 = async (value: unknown) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const timestamp = (value: unknown, label: string) => ensure(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, `${label} غير صالح.`);

const allowed = (value: Document, keys: string[], label: string) => ensure(
  Object.keys(value).every(key => keys.includes(key)),
  `${label} تحتوي حقولاً غير صالحة أو محمية.`,
);

const percentage = (value: unknown, label: string) => {
  ensure(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100, `${label} غير صالحة.`);
  ensure(Number.isInteger(value * 10000), `${label} تتجاوز دقة أربع خانات عشرية.`);
  return value;
};

function moneyThresholds(value: unknown, label: string): ApprovalMoneyThresholds {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} غير صالحة.`);
  const row = value as Document;
  allowed(row, ['accountant_max_sdg', 'accountant_max_usd', 'admin_max_sdg', 'admin_max_usd'], label);
  const parsed = {
    accountant_max_sdg: money(row.accountant_max_sdg, 0),
    accountant_max_usd: money(row.accountant_max_usd, 2),
    admin_max_sdg: money(row.admin_max_sdg, 0),
    admin_max_usd: money(row.admin_max_usd, 2),
  };
  ensure(parsed.accountant_max_sdg <= parsed.admin_max_sdg && parsed.accountant_max_usd <= parsed.admin_max_usd, `${label}: حد المحاسب يجب ألا يتجاوز حد المدير.`);
  return parsed;
}

export function validateApprovalPolicyInput(data: Document) {
  allowed(data, ['id', 'name', 'active', 'discount', 'expense', 'refund', 'credit_limit', 'expected_revision', 'reason'], 'سياسة الموافقات');
  ensure(data.discount && typeof data.discount === 'object' && !Array.isArray(data.discount), 'حدود خصم السياسة مطلوبة.');
  allowed(data.discount, ['sales_max_percent', 'admin_max_percent'], 'حدود الخصم');
  const sales_max_percent = percentage(data.discount.sales_max_percent, 'حد خصم المبيعات');
  const admin_max_percent = percentage(data.discount.admin_max_percent, 'حد خصم المدير');
  ensure(sales_max_percent <= admin_max_percent, 'حد خصم المبيعات يجب ألا يتجاوز حد المدير.');
  ensure(data.credit_limit && typeof data.credit_limit === 'object' && !Array.isArray(data.credit_limit), 'سياسة تجاوز الائتمان مطلوبة.');
  allowed(data.credit_limit, ['required_role'], 'سياسة تجاوز الائتمان');
  ensure(['Admin', 'Owner'].includes(data.credit_limit.required_role), 'تجاوز الائتمان يتطلب المدير أو المالك.');
  return {
    id: identifier(data.id),
    name: text(data.name, 120, true),
    active: data.active !== false,
    discount: { sales_max_percent, admin_max_percent },
    expense: moneyThresholds(data.expense, 'حدود اعتماد المصروف'),
    refund: moneyThresholds(data.refund, 'حدود اعتماد المبلغ المسترد'),
    credit_limit: { required_role: data.credit_limit.required_role as 'Admin' | 'Owner' },
  };
}

const policyHashPayload = (policy: Omit<ApprovalPolicy, 'version_hash'> | ApprovalPolicyVersion) => ({
  id: 'configuration_id' in policy ? policy.configuration_id : policy.id,
  name: policy.name,
  active: policy.active,
  revision: policy.revision,
  discount: policy.discount,
  expense: policy.expense,
  refund: policy.refund,
  credit_limit: policy.credit_limit,
  previous_version_hash: policy.previous_version_hash,
});

export const approvalPolicyHash = (policy: Omit<ApprovalPolicy, 'version_hash'> | ApprovalPolicyVersion) => sha256(policyHashPayload(policy));

export async function saveApprovalPolicy(
  tx: Transaction,
  root: string,
  orgId: string,
  actor: string,
  now: string,
  operationId: string,
  action: 'approvalPolicy.create' | 'approvalPolicy.update',
  data: Document,
) {
  const parsed = validateApprovalPolicyInput(data), path = `${root}/approval_policies/${parsed.id}`;
  const existing = await tx.get(path) as ApprovalPolicy | undefined;
  ensure(action === 'approvalPolicy.create' ? !existing : !!existing, action.endsWith('create') ? 'معرّف سياسة الموافقات مستخدم مسبقاً.' : 'سياسة الموافقات غير موجودة.', action.endsWith('create') ? 409 : 404);
  if (existing) {
    ensure(Number(data.expected_revision) === existing.revision, 'تم تعديل سياسة الموافقات من جلسة أخرى؛ حدّث البيانات وأعد المحاولة.', 409);
    const versions=(await tx.list(`${root}/approval_policy_versions`)).filter(row=>row.configuration_id===existing.id);
    await validateApprovalData({approval_policies:[existing],approval_policy_versions:versions,approval_requests:[]},orgId);
    ensure(stable({id:existing.id,name:existing.name,active:existing.active,discount:existing.discount,expense:existing.expense,refund:existing.refund,credit_limit:existing.credit_limit})!==stable(parsed),'سياسة الموافقات لم تتغير.',409);
  }
  if (parsed.active) {
    const active = (await tx.list(`${root}/approval_policies`)).filter(row => row.id !== parsed.id && row.active === true);
    ensure(active.length === 0, 'توجد سياسة موافقات نشطة أخرى؛ عطّلها قبل تفعيل هذه السياسة.', 409);
  }
  const base = {
    ...parsed,
    org_id: orgId,
    revision: (existing?.revision || 0) + 1,
    previous_version_hash: existing?.version_hash || null,
    created_by: existing?.created_by || actor,
    created_at: existing?.created_at || now,
    updated_by: actor,
    updated_at: now,
    operation_id: operationId,
  };
  const result: ApprovalPolicy = { ...base, version_hash: await approvalPolicyHash(base) };
  const versionPath = `${root}/approval_policy_versions/${result.id}-r${result.revision}`;
  const version: ApprovalPolicyVersion = { ...result, id: `${result.id}-r${result.revision}`, configuration_id: result.id };
  ensure(!(await tx.get(versionPath)), 'إصدار سياسة الموافقات موجود مسبقاً.', 409);
  return { result, version, paths: { current: path, version: versionPath }, before: existing };
}

const requestImmutablePayload = (request: Omit<ApprovalRequest, 'request_hash'> | ApprovalRequest) => ({
  id: request.id,
  policy_id: request.policy_id,
  policy_revision: request.policy_revision,
  policy_version_id: request.policy_version_id,
  policy_version_hash: request.policy_version_hash,
  kind: request.kind,
  subject_type: request.subject_type,
  subject_id: request.subject_id,
  reason: request.reason,
  discount_percent: request.discount_percent,
  amount_sdg: request.amount_sdg,
  amount_usd: request.amount_usd,
  overage_sdg: request.overage_sdg,
  overage_usd: request.overage_usd,
  payload: request.payload,
  required_role: request.required_role,
  requested_by: request.requested_by,
  requested_role: request.requested_role,
  requested_at: request.requested_at,
  operation_id: request.operation_id,
});

export const approvalRequestHash = (request: Omit<ApprovalRequest, 'request_hash'> | ApprovalRequest) => sha256(requestImmutablePayload(request));

const reviewHash = (request: ApprovalRequest) => sha256({
  request_hash: request.request_hash,
  status: request.status,
  revision: request.revision,
  reviewed_by: request.reviewed_by,
  reviewer_role: request.reviewer_role,
  reviewed_at: request.reviewed_at,
  review_reason: request.review_reason,
  review_operation_id: request.review_operation_id,
});

const payloadValue = (value: unknown, depth = 0): void => {
  ensure(depth <= 6, 'تفاصيل طلب الموافقة متداخلة أكثر من المسموح.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { text(value, 2000); return; }
  if (typeof value === 'number') { ensure(Number.isFinite(value), 'تفاصيل طلب الموافقة تحتوي رقماً غير صالح.'); return; }
  if (Array.isArray(value)) { ensure(value.length <= 100, 'تفاصيل طلب الموافقة تتجاوز 100 بند.'); for (const nested of value) payloadValue(nested, depth + 1); return; }
  ensure(value && typeof value === 'object', 'تفاصيل طلب الموافقة غير صالحة.');
  const row = value as Document;
  ensure(Object.keys(row).length <= 100 && !Object.keys(row).some(key => ['__proto__', 'prototype', 'constructor'].includes(key)), 'تفاصيل طلب الموافقة تحتوي حقولاً محظورة.');
  for (const nested of Object.values(row)) payloadValue(nested, depth + 1);
};

function parseRequestInput(data: Document) {
  allowed(data, ['id', 'policy_id', 'kind', 'subject_type', 'subject_id', 'reason', 'discount_percent', 'amount_sdg', 'amount_usd', 'overage_sdg', 'overage_usd', 'payload'], 'طلب الموافقة');
  ensure(['discount', 'expense', 'refund', 'credit_limit'].includes(data.kind), 'نوع طلب الموافقة غير صالح.');
  const kind = data.kind as ApprovalKind;
  const result = {
    id: identifier(data.id),
    policy_id: identifier(data.policy_id),
    kind,
    subject_type: identifier(data.subject_type),
    subject_id: identifier(data.subject_id),
    reason: text(data.reason, 1000, true),
    discount_percent: percentage(data.discount_percent ?? 0, 'نسبة الخصم'),
    amount_sdg: money(data.amount_sdg ?? 0, 0),
    amount_usd: money(data.amount_usd ?? 0, 2),
    overage_sdg: money(data.overage_sdg ?? 0, 0),
    overage_usd: money(data.overage_usd ?? 0, 2),
    payload: data.payload ?? {},
  };
  ensure(result.payload && typeof result.payload === 'object' && !Array.isArray(result.payload), 'تفاصيل طلب الموافقة يجب أن تكون كائناً.');
  payloadValue(result.payload);
  ensure(new TextEncoder().encode(stable(result.payload)).length <= 25000, 'تفاصيل طلب الموافقة تتجاوز 25KB.');
  if (kind === 'discount') ensure(result.discount_percent > 0 && result.amount_sdg === 0 && result.amount_usd === 0 && result.overage_sdg === 0 && result.overage_usd === 0, 'طلب الخصم يقبل نسبة فقط.');
  if (kind === 'expense' || kind === 'refund') ensure(result.discount_percent === 0 && (result.amount_sdg > 0 || result.amount_usd > 0) && result.overage_sdg === 0 && result.overage_usd === 0, 'طلب المبلغ يجب أن يحتوي قيمة موجبة بلا حقول تجاوز أو خصم.');
  if (kind === 'credit_limit') ensure(result.discount_percent === 0 && result.amount_sdg === 0 && result.amount_usd === 0 && (result.overage_sdg > 0 || result.overage_usd > 0), 'طلب تجاوز الائتمان يجب أن يحتوي قيمة تجاوز موجبة فقط.');
  return result;
}

export function requiredApprovalRole(policy: ApprovalPolicy | ApprovalPolicyVersion, input: Pick<ApprovalRequest, 'kind' | 'discount_percent' | 'amount_sdg' | 'amount_usd' | 'overage_sdg' | 'overage_usd'>): ApprovalRequiredRole {
  if (input.kind === 'discount') return input.discount_percent <= policy.discount.sales_max_percent ? 'Sales' : input.discount_percent <= policy.discount.admin_max_percent ? 'Admin' : 'Owner';
  if (input.kind === 'credit_limit') return policy.credit_limit.required_role;
  const thresholds = input.kind === 'expense' ? policy.expense : policy.refund;
  if (input.amount_sdg <= thresholds.accountant_max_sdg && input.amount_usd <= thresholds.accountant_max_usd) return 'Accountant';
  if (input.amount_sdg <= thresholds.admin_max_sdg && input.amount_usd <= thresholds.admin_max_usd) return 'Admin';
  return 'Owner';
}

export function canApprove(role: OrgRole, required: ApprovalRequiredRole) {
  return role === 'Owner' || role === 'Admin' && required !== 'Owner' || role === 'Accountant' && required === 'Accountant' || role === 'Sales' && required === 'Sales';
}

const approvableAction = (value: unknown): ApprovableAction => {
  ensure(['invoice.create', 'expense.create', 'customerRefund.create'].includes(String(value)), 'العملية المطلوبة لا تدعم مسار الموافقات.');
  return value as ApprovableAction;
};

const commandDataWithoutApproval = (data: Document) => Object.fromEntries(
  Object.entries(data).filter(([key]) => key !== 'approval_request_ids'),
);

export const approvalCommandHash = (action: ApprovableAction, operationId: string, data: Document) => sha256({
  action: approvableAction(action),
  operation_id: identifier(operationId),
  data: commandDataWithoutApproval(data),
});

const requirementInput = (requirement: ApprovalRequirement) => ({
  kind: requirement.kind,
  discount_percent: requirement.discount_percent,
  amount_sdg: requirement.amount_sdg,
  amount_usd: requirement.amount_usd,
  overage_sdg: requirement.overage_sdg,
  overage_usd: requirement.overage_usd,
});

const validateRequirement = (value: ApprovalRequirement) => {
  ensure(['discount', 'expense', 'refund', 'credit_limit'].includes(value.kind), 'متطلب الموافقة غير صالح.');
  const parsed = parseRequestInput({
    id: 'requirement', policy_id: 'policy', subject_type: 'operation', subject_id: 'operation', reason: 'requirement', payload: {}, ...value,
  });
  return requirementInput(parsed);
};

export async function createOperationApprovalRequests(
  tx: Transaction,
  root: string,
  orgId: string,
  actor: string,
  role: OrgRole,
  now: string,
  operationId: string,
  data: Document,
  requirements: ApprovalRequirement[],
) {
  allowed(data, ['policy_id', 'target_action', 'target_operation_id', 'reason', 'command_data'], 'طلب موافقة العملية');
  const policyId = identifier(data.policy_id), targetAction = approvableAction(data.target_action), targetOperationId = identifier(data.target_operation_id);
  ensure(data.command_data && typeof data.command_data === 'object' && !Array.isArray(data.command_data), 'بيانات العملية المطلوب اعتمادها غير صالحة.');
  const reason = text(data.reason, 1000, true), commandHash = await approvalCommandHash(targetAction, targetOperationId, data.command_data);
  const unique = new Map<ApprovalKind, ApprovalRequirement>();
  for (const requirement of requirements.map(validateRequirement)) {
    ensure(!unique.has(requirement.kind), 'تكرر نوع متطلب الموافقة للعملية نفسها.'); unique.set(requirement.kind, requirement);
  }
  ensure(unique.size > 0, 'العملية لا تتطلب موافقة وفق القيم الحالية.', 409);
  const requests: ApprovalRequest[] = [];
  for (const requirement of unique.values()) {
    const proposed = await createApprovalRequest(tx, root, orgId, actor, role, now, operationId, {
      id: `approval-${targetOperationId}-${requirement.kind}`,
      policy_id: policyId,
      subject_type: targetAction.replace('.', '_'),
      subject_id: targetOperationId,
      reason,
      ...requirement,
      payload: { target_action: targetAction, target_operation_id: targetOperationId, command_hash: commandHash },
    });
    requests.push(proposed.result);
  }
  return { requests, paths: requests.map(request => `${root}/approval_requests/${request.id}`), target_action: targetAction, target_operation_id: targetOperationId, command_hash: commandHash };
}

const consumptionHash = (request: ApprovalRequest) => sha256({
  request_hash: request.request_hash,
  review_hash: request.review_hash,
  consumed_by: request.consumed_by,
  consumed_at: request.consumed_at,
  consumed_action: request.consumed_action,
  consumed_operation_id: request.consumed_operation_id,
});

export async function authorizeOperationApprovals(
  tx: Transaction,
  root: string,
  orgId: string,
  actor: string,
  role: OrgRole,
  now: string,
  action: ApprovableAction,
  operationId: string,
  data: Document,
  requirements: ApprovalRequirement[],
) {
  const parsed = requirements.map(validateRequirement), ids = data.approval_request_ids ?? [];
  ensure(Array.isArray(ids) && ids.length <= 4 && ids.every(id => typeof id === 'string'), 'معرّفات الموافقات غير صالحة.');
  ensure(new Set(ids).size === ids.length, 'معرّفات الموافقات مكررة.');
  const commandHash = await approvalCommandHash(action, operationId, data);
  const supplied = new Map<string, ApprovalRequest>();
  for (const raw of ids) {
    const id = identifier(raw), request = await tx.get(`${root}/approval_requests/${id}`) as ApprovalRequest | undefined;
    ensure(request && request.org_id === orgId, 'طلب الموافقة المرفق غير موجود.', 404); supplied.set(id, request);
  }
  const activePolicies = (await tx.list(`${root}/approval_policies`) as ApprovalPolicy[]).filter(policy => policy.active);
  ensure(activePolicies.length <= 1, 'توجد أكثر من سياسة موافقات نشطة.', 409);
  const activePolicy = activePolicies[0];
  let activeVersion: ApprovalPolicyVersion | undefined;
  if (activePolicy) {
    ensure(activePolicy.org_id === orgId && activePolicy.version_hash === await approvalPolicyHash(activePolicy), 'بصمة سياسة الموافقات النشطة غير مطابقة.', 409);
    activeVersion = await tx.get(`${root}/approval_policy_versions/${activePolicy.id}-r${activePolicy.revision}`) as ApprovalPolicyVersion | undefined;
    ensure(activeVersion && activeVersion.org_id === orgId && activeVersion.configuration_id === activePolicy.id && activeVersion.version_hash === activePolicy.version_hash && await approvalPolicyHash(activeVersion) === activeVersion.version_hash, 'الإصدار النشط لسياسة الموافقات غير مطابق.', 409);
  }
  const used = new Set<string>(), updates: { path: string; before: ApprovalRequest; result: ApprovalRequest }[] = [], evidence: Document[] = [];
  for (const requirement of parsed) {
    let matched: ApprovalRequest | undefined;
    for (const [id, request] of supplied) {
      if (used.has(id) || request.kind !== requirement.kind) continue;
      const payload = request.payload || {};
      if (request.requested_by === actor && request.subject_id === operationId && payload.target_action === action && payload.target_operation_id === operationId && payload.command_hash === commandHash && stable(requirementInput(request)) === stable(requirement)) { matched = request; used.add(id); break; }
    }
    if (!matched) {
      if (!activeVersion || canApprove(role, requiredApprovalRole(activeVersion, requirement))) continue;
      ensure(false, `العملية تتطلب موافقة ${requirement.kind} معتمدة ومطابقة.`, 409);
    }
    ensure(matched.status === 'approved' && !matched.consumed_at && matched.revision === 2, 'طلب الموافقة غير معتمد أو استُهلك مسبقاً.', 409);
    ensure(matched.request_hash === await approvalRequestHash(matched), 'بصمة طلب الموافقة المرفق غير مطابقة.', 409);
    const version = await tx.get(`${root}/approval_policy_versions/${matched.policy_version_id}`) as ApprovalPolicyVersion | undefined;
    ensure(version && version.org_id === orgId && version.version_hash === matched.policy_version_hash && await approvalPolicyHash(version) === version.version_hash, 'إصدار سياسة الموافقة المرفقة غير مطابق.', 409);
    ensure(matched.required_role === requiredApprovalRole(version, requirement), 'دور الموافقة المرفقة لا يطابق العملية الحالية.', 409);
    ensure(matched.review_hash === await reviewHash(matched) && matched.reviewed_by && matched.reviewed_by !== actor, 'قرار الموافقة المرفق غير صالح أو يخرق فصل المهام.', 409);
    const result: ApprovalRequest = { ...matched, consumed_by: actor, consumed_at: now, consumed_action: action, consumed_operation_id: operationId };
    result.consumption_hash = await consumptionHash(result);
    updates.push({ path: `${root}/approval_requests/${matched.id}`, before: matched, result });
    evidence.push({ request_id: matched.id, request_hash: matched.request_hash, review_hash: matched.review_hash, consumption_hash: result.consumption_hash, policy_version_hash: matched.policy_version_hash, required_role: matched.required_role, reviewed_by: matched.reviewed_by });
  }
  ensure(used.size === supplied.size, 'أُرفق طلب موافقة لا يطابق أي متطلب للعملية.', 409);
  return { evidence, updates };
}

export async function createApprovalRequest(tx: Transaction, root: string, orgId: string, actor: string, role: OrgRole, now: string, operationId: string, data: Document) {
  const parsed = parseRequestInput(data), policy = await tx.get(`${root}/approval_policies/${parsed.policy_id}`) as ApprovalPolicy | undefined;
  ensure(policy && policy.org_id === orgId && policy.active, 'سياسة الموافقات المطلوبة غير موجودة أو غير نشطة.', 409);
  const versionId = `${policy.id}-r${policy.revision}`, version = await tx.get(`${root}/approval_policy_versions/${versionId}`) as ApprovalPolicyVersion | undefined;
  ensure(version && version.org_id === orgId && version.version_hash === policy.version_hash && await approvalPolicyHash(version) === version.version_hash, 'دليل إصدار سياسة الموافقات غير مطابق.', 409);
  const required_role = requiredApprovalRole(policy, parsed);
  ensure(!canApprove(role, required_role), 'صلاحيتك الحالية تكفي لهذا الحد؛ لا تنشئ طلب موافقة ذاتية.', 409);
  const path = `${root}/approval_requests/${parsed.id}`;
  ensure(!(await tx.get(path)), 'معرّف طلب الموافقة مستخدم مسبقاً.', 409);
  const base = {
    ...parsed,
    org_id: orgId,
    policy_revision: policy.revision,
    policy_version_id: versionId,
    policy_version_hash: version.version_hash,
    required_role,
    status: 'pending' as const,
    revision: 1,
    requested_by: actor,
    requested_role: role,
    requested_at: now,
    operation_id: operationId,
  };
  const result: ApprovalRequest = { ...base, request_hash: await approvalRequestHash(base) };
  return { result, path };
}

export async function reviewApprovalRequest(tx: Transaction, root: string, orgId: string, actor: string, role: OrgRole, now: string, operationId: string, data: Document) {
  allowed(data, ['id', 'expected_revision', 'decision', 'reason'], 'مراجعة الموافقة');
  const id = identifier(data.id), decision = data.decision as 'approved' | 'rejected';
  ensure(['approved', 'rejected'].includes(decision), 'قرار الموافقة غير صالح.');
  const path = `${root}/approval_requests/${id}`, existing = await tx.get(path) as ApprovalRequest | undefined;
  ensure(existing && existing.org_id === orgId, 'طلب الموافقة غير موجود.', 404);
  ensure(existing.status === 'pending', 'طلب الموافقة لم يعد معلقاً.', 409);
  ensure(Number(data.expected_revision) === existing.revision, 'تمت مراجعة الطلب من جلسة أخرى؛ حدّث البيانات.', 409);
  ensure(existing.request_hash === await approvalRequestHash(existing), 'بصمة طلب الموافقة غير مطابقة.', 409);
  const version = await tx.get(`${root}/approval_policy_versions/${existing.policy_version_id}`) as ApprovalPolicyVersion | undefined;
  ensure(version && version.org_id === orgId && version.version_hash === existing.policy_version_hash && await approvalPolicyHash(version) === version.version_hash, 'دليل سياسة الطلب غير مطابق.', 409);
  ensure(existing.required_role === requiredApprovalRole(version, existing), 'دور اعتماد الطلب لا يطابق السياسة المحفوظة.', 409);
  ensure(existing.requested_by !== actor, 'لا يجوز لمقدم الطلب اعتماد أو رفض طلبه.', 403);
  ensure(canApprove(role, existing.required_role), `هذا الطلب يتطلب دور ${existing.required_role}.`, 403);
  const reason = text(data.reason ?? '', 1000, decision === 'rejected');
  const result: ApprovalRequest = {
    ...existing,
    status: decision,
    revision: existing.revision + 1,
    reviewed_by: actor,
    reviewer_role: role,
    reviewed_at: now,
    review_reason: reason,
    review_operation_id: operationId,
  };
  result.review_hash = await reviewHash(result);
  return { result, path, before: existing };
}

export async function validateApprovalData(data: Record<string, Document[]>, orgId: string) {
  const policies = (data.approval_policies || []) as ApprovalPolicy[], versions = (data.approval_policy_versions || []) as ApprovalPolicyVersion[], requests = (data.approval_requests || []) as ApprovalRequest[];
  ensure(policies.filter(policy => policy.active).length <= 1, 'النسخة تحتوي أكثر من سياسة موافقات نشطة.');
  const versionMap = new Map(versions.map(version => [version.id, version]));
  for (const policy of policies) {
    identifier(policy.id); ensure(policy.org_id === orgId && Number.isSafeInteger(policy.revision) && policy.revision > 0, 'سياسة موافقات تتبع مؤسسة أخرى أو إصدارها غير صالح.');
    identifier(policy.created_by);identifier(policy.updated_by);identifier(policy.operation_id);timestamp(policy.created_at,'تاريخ إنشاء سياسة الموافقات');timestamp(policy.updated_at,'تاريخ تحديث سياسة الموافقات');
    validateApprovalPolicyInput({id:policy.id,name:policy.name,active:policy.active,discount:policy.discount,expense:policy.expense,refund:policy.refund,credit_limit:policy.credit_limit});
    ensure(policy.version_hash === await approvalPolicyHash(policy), 'بصمة سياسة الموافقات غير مطابقة.');
    let previous: string | null = null;
    for (let revision = 1; revision <= policy.revision; revision++) {
      const version = versionMap.get(`${policy.id}-r${revision}`);
      ensure(version && version.id===`${policy.id}-r${revision}`&&version.org_id === orgId && version.configuration_id === policy.id && version.revision === revision && version.previous_version_hash === previous, 'سلسلة إصدارات سياسة الموافقات ناقصة أو غير مرتبة.');
      identifier(version.created_by);identifier(version.updated_by);identifier(version.operation_id);timestamp(version.created_at,'تاريخ إنشاء إصدار الموافقات');timestamp(version.updated_at,'تاريخ تحديث إصدار الموافقات');
      validateApprovalPolicyInput({id:version.configuration_id,name:version.name,active:version.active,discount:version.discount,expense:version.expense,refund:version.refund,credit_limit:version.credit_limit});
      ensure(version.version_hash === await approvalPolicyHash(version), 'بصمة إصدار سياسة الموافقات غير مطابقة.');
      if(revision===policy.revision)ensure(version.updated_by===policy.updated_by&&version.updated_at===policy.updated_at&&version.operation_id===policy.operation_id,'السياسة الحالية لا تطابق بيانات آخر إصدار.');
      previous = version.version_hash;
    }
    ensure(previous === policy.version_hash, 'السياسة الحالية لا تطابق آخر إصدار محفوظ.');
  }
  ensure(versions.length === [...versionMap.values()].length && versions.every(version => policies.some(policy => policy.id === version.configuration_id && version.revision <= policy.revision)), 'النسخة تحتوي إصدار سياسة يتيم أو مكرر.');
  for (const request of requests) {
    identifier(request.id); ensure(request.org_id === orgId && ['pending', 'approved', 'rejected'].includes(request.status) && Number.isSafeInteger(request.revision) && request.revision >= 1, 'طلب موافقة غير صالح أو يتبع مؤسسة أخرى.');
    const parsed=parseRequestInput({id:request.id,policy_id:request.policy_id,kind:request.kind,subject_type:request.subject_type,subject_id:request.subject_id,reason:request.reason,discount_percent:request.discount_percent,amount_sdg:request.amount_sdg,amount_usd:request.amount_usd,overage_sdg:request.overage_sdg,overage_usd:request.overage_usd,payload:request.payload});
    ensure(stable(parsed)===stable({id:request.id,policy_id:request.policy_id,kind:request.kind,subject_type:request.subject_type,subject_id:request.subject_id,reason:request.reason,discount_percent:request.discount_percent,amount_sdg:request.amount_sdg,amount_usd:request.amount_usd,overage_sdg:request.overage_sdg,overage_usd:request.overage_usd,payload:request.payload}),'طلب الموافقة يحتوي قيماً غير مطبعة.');
    identifier(request.requested_by);identifier(request.operation_id);timestamp(request.requested_at,'تاريخ طلب الموافقة');ensure(['Admin','Accountant','Sales','Cashier'].includes(request.requested_role)&&!canApprove(request.requested_role,request.required_role),'دور مقدم طلب الموافقة غير صالح.');
    const version = versionMap.get(request.policy_version_id);
    ensure(version && version.version_hash === request.policy_version_hash && request.required_role === requiredApprovalRole(version, request), 'طلب الموافقة لا يطابق إصدار السياسة.');
    ensure(request.request_hash === await approvalRequestHash(request), 'بصمة طلب الموافقة غير مطابقة.');
    if (request.status === 'pending') ensure(request.revision === 1 && !request.review_hash && !request.reviewed_by, 'طلب معلق يحتوي قرار مراجعة غير صالح.');
    else {
      ensure(request.revision === 2 && !!request.reviewed_by && request.reviewed_by !== request.requested_by && !!request.reviewed_at && !!request.reviewer_role && canApprove(request.reviewer_role, request.required_role), 'مراجع طلب الموافقة غير صالح.');
      identifier(request.reviewed_by!);identifier(request.review_operation_id);timestamp(request.reviewed_at,'تاريخ مراجعة الموافقة');text(request.review_reason||'',1000,request.status==='rejected');
      ensure(request.review_hash === await reviewHash(request), 'بصمة قرار الموافقة غير مطابقة.');
    }
    if (request.consumed_at) {
      ensure(request.status === 'approved' && !!request.consumed_by && !!request.consumed_action && !!request.consumed_operation_id, 'استهلاك طلب الموافقة غير مكتمل.');
      identifier(request.consumed_by);identifier(request.consumed_operation_id);timestamp(request.consumed_at,'تاريخ استهلاك الموافقة');approvableAction(request.consumed_action);
      ensure(request.consumed_by === request.requested_by, 'لا يجوز استهلاك الموافقة بواسطة مستخدم آخر.');
      ensure(request.consumption_hash === await consumptionHash(request), 'بصمة استهلاك الموافقة غير مطابقة.');
    } else ensure(!request.consumed_by && !request.consumed_action && !request.consumed_operation_id && !request.consumption_hash, 'طلب الموافقة يحتوي دليلاً جزئياً للاستهلاك.');
  }
  const sourceFor = (request: ApprovalRequest) => request.consumed_action === 'invoice.create'
    ? (data.invoices || []).find(row => row.id === `inv-${request.consumed_operation_id}`)
    : request.consumed_action === 'expense.create'
      ? (data.expenses || []).find(row => row.id === `exp-${request.consumed_operation_id}`)
      : (data.customer_refunds || []).find(row => row.id === `refund-${request.consumed_operation_id}`);
  const matchesEvidence = (evidence: Document, request: ApprovalRequest) => evidence.request_id===request.id&&evidence.request_hash===request.request_hash&&evidence.review_hash===request.review_hash&&evidence.consumption_hash===request.consumption_hash&&evidence.policy_version_hash===request.policy_version_hash&&evidence.required_role===request.required_role&&evidence.reviewed_by===request.reviewed_by;
  for(const request of requests.filter(row=>row.consumed_at)){
    const source=sourceFor(request);ensure(source&&Array.isArray(source.approval_evidence)&&source.approval_evidence.filter((evidence:Document)=>matchesEvidence(evidence,request)).length===1,'مصدر استهلاك الموافقة مفقود أو لا يطابق دليل العملية.');
  }
  for(const [action,rows] of [['invoice.create',data.invoices||[]],['expense.create',data.expenses||[]],['customerRefund.create',data.customer_refunds||[]]] as const)for(const row of rows)for(const evidence of row.approval_evidence||[]){
    const request=requests.find(saved=>saved.id===evidence.request_id);ensure(request&&request.consumed_action===action&&request.consumed_operation_id===row.operation_id&&matchesEvidence(evidence,request),'دليل موافقة العملية يتيم أو غير مطابق.');
  }
}

export const remapApprovalData = (data: Record<string, Document[]>, orgId: string) => Object.fromEntries(
  approvalCollections.map(collection => [collection, (data[collection] || []).map(row => ({ ...row, org_id: orgId }))]),
);
