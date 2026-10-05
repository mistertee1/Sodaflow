import { createHash } from 'node:crypto';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { BusinessError } from '../src/domain/validation';
import { adminServices, selectedFirestoreDatabaseId } from './admin';
import { ACCOUNTING_RULES_SHA256 } from './accountingRulesHash';

export function verifyAccountingRulesSource(source: ReadonlyArray<{ content: string }>) {
  const hash = source.length === 1 ? createHash('sha256').update(source[0].content.replace(/\r\n/g, '\n').trim()).digest('hex') : '';
  if (hash !== ACCOUNTING_RULES_SHA256) throw new BusinessError('قواعد حماية المحاسبة V2 المنشورة لا تطابق الإصدار المراجع. انشر قواعد هذا الإصدار قبل إثبات التكلفة أو التفعيل.', 503, 'accounting_rules_not_deployed');
}
/** Read the currently deployed rules before trusting V2 writes. Does not publish or modify rules. */
export async function verifyDeployedAccountingRules() {
  if (selectedFirestoreDatabaseId() !== '(default)') throw new BusinessError('التحقق من قواعد V2 للقاعدة المسماة يحتاج إعداداً تقنياً مستقلاً؛ لن يتم التفعيل دون تحقق.', 503, 'accounting_named_database_unsupported');
  try {
    const ruleset = await getSecurityRules(adminServices().app).getFirestoreRuleset();
    verifyAccountingRulesSource(ruleset.source);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('تعذر قراءة قواعد Firebase المنشورة للتحقق من حماية V2. راجع صلاحية قراءة القواعد في حساب خدمة الخادم.', 503, 'accounting_rules_not_verified');
  }
}
