import type { Account, JournalEntry } from '../types';
import type { Document } from './store';
import { fixedAssetRegistrationQuote, type FixedAssetRegistrationInput } from './fixedAssets';
import { fixedAssetDepreciationEvidence } from './fixedAssetSources';
import { fxQuoteHash } from './fxRevaluationTransactions';
import { ensure, identifier } from './validation';

export type FixedAssetAction = 'fixedAsset.register' | 'fixedAsset.depreciate';
export interface FixedAssetDepreciationInput extends Document {
  asset_id: string; expected_revision: number; sequence: number; date: string; reason: string;
}
export type FixedAssetPreviewRequest =
  | {action: 'fixedAsset.register'; input: FixedAssetRegistrationInput}
  | {action: 'fixedAsset.depreciate'; input: FixedAssetDepreciationInput};
export interface FixedAssetPreview {
  organizationId: string; action: FixedAssetAction; quote: Document; quote_hash: string;
}
/** Used by protected preview and again inside the atomic command. No browser balance is accepted. */
export async function quoteFixedAsset(request: FixedAssetPreviewRequest, data: Record<string, Document[]>, orgId: string): Promise<FixedAssetPreview> {
  ensure(request && typeof request === 'object' && !Array.isArray(request) && Object.keys(request).every(key => ['action', 'input'].includes(key)), 'حقول معاينة الأصل غير صالحة.');
  ensure(['fixedAsset.register', 'fixedAsset.depreciate'].includes(request.action), 'عملية الأصل غير صالحة.');
  ensure(request.input && typeof request.input === 'object' && !Array.isArray(request.input), 'بيانات معاينة الأصل مطلوبة.');
  const snapshot = {org_id: orgId, accounts: data.accounts as Account[], journal_entries: data.journal_entries as JournalEntry[], fixed_assets: data.fixed_assets};
  let quote: Document;
  if (request.action === 'fixedAsset.register') quote = fixedAssetRegistrationQuote(request.input as FixedAssetRegistrationInput, snapshot);
  else {
    const input = request.input as FixedAssetDepreciationInput;
    const asset = data.fixed_assets.find(row => row.id === identifier(input.asset_id));
    ensure(asset, 'الأصل غير موجود.', 404);
    // Current source and control accounts must remain valid, even after a register was created.
    fixedAssetRegistrationQuote(asset.input, {...snapshot, fixed_assets: data.fixed_assets.filter(row => row.id !== asset.id)});
    const proposed = fixedAssetDepreciationEvidence(asset, input, {operation_id: 'preview', created_by: 'preview', created_at: `${input.date}T00:00:00Z`});
    quote = {asset_id: asset.id, name: asset.name, expected_revision: asset.revision, sequence: input.sequence, date: input.date, reason: input.reason,
      amount_sdg: proposed.event.amount_sdg, amount_usd: proposed.event.amount_usd,
      book_before_sdg: asset.book_value_sdg, book_before_usd: asset.book_value_usd,
      book_after_sdg: proposed.updated.book_value_sdg, book_after_usd: proposed.updated.book_value_usd,
      lines: proposed.entry?.lines || [], status_after: proposed.updated.status};
  }
  return {organizationId: orgId, action: request.action, quote, quote_hash: await fxQuoteHash(quote)};
}
