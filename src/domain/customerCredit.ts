import type { Customer, OrgRole } from '../types';
import { safeAdd } from '../lib/currency';
import { ensure, money, text } from './validation';

export type CreditCurrency = 'SDG' | 'USD';
export interface CreditDecision {
  currency: CreditCurrency;
  balance_before: number;
  invoice_amount: number;
  exposure_after: number;
  limit: number | null;
  exceeded: boolean;
  policy: 'warning' | 'approval_required';
  approved_by?: string;
  approval_reason?: string;
}

export function customerCreditDecision(customer: Customer, currency: CreditCurrency, invoiceAmount: number): CreditDecision {
  money(invoiceAmount, currency === 'USD' ? 2 : 0);
  const balance = currency === 'USD' ? customer.balance_usd || 0 : customer.balance_sdg || 0;
  const configured = currency === 'USD' ? customer.credit_limit_usd : customer.credit_limit_sdg;
  const limit = configured === undefined || configured === null ? null : money(configured, currency === 'USD' ? 2 : 0);
  const exposure = safeAdd(balance, invoiceAmount, currency === 'USD' ? 2 : 0);
  return { currency, balance_before: balance, invoice_amount: invoiceAmount, exposure_after: exposure, limit, exceeded: limit !== null && exposure > limit, policy: customer.credit_policy || 'warning' };
}

export function authorizeCreditDecision(decision: CreditDecision, role: OrgRole, actorUid: string, reason?: unknown): CreditDecision {
  if (!decision.exceeded || decision.policy === 'warning') return decision;
  ensure(role === 'Owner' || role === 'Admin', 'تجاوز حد ائتمان العميل يتطلب اعتماد المالك أو المدير.', 403);
  return { ...decision, approved_by: actorUid, approval_reason: text(reason, 500, true) };
}
