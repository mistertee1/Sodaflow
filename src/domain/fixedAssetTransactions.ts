import type { Account, JournalEntry, MerchantSettings } from "../types";
import type { Document, Transaction } from "./store";
import { clean } from "./store";
import {
  fixedAssetDepreciationEvidence,
  fixedAssetRegistrationEvidence,
  verifyFixedAssetSources,
} from "./fixedAssetSources";
import type { FixedAssetRegistrationInput } from "./fixedAssets";
import {
  readOpeningFinancialData,
  assertOpeningFinancialData,
} from "./openingTransactions";
import { ensure } from "./validation";
import { quoteFixedAsset, type FixedAssetPreviewRequest } from './fixedAssetPreview';

export async function fixedAssetTransaction(
  action: string,
  data: Document,
  c: {
    tx: Transaction;
    root: string;
    orgId: string;
    settings: MerchantSettings;
    actor: string;
    operationId: string;
    now: Date;
  },
) {
  const original = await readOpeningFinancialData(c.tx, c.root, c.orgId);
  await assertOpeningFinancialData(original, c.settings);
  verifyFixedAssetSources(original, c.orgId);
  // Preserve the existing server command contract, while binding UI submissions to their reviewed quote.
  const {expected_quote_hash, ...input} = data;
  const preview = await quoteFixedAsset({action, input} as FixedAssetPreviewRequest, original, c.orgId);
  if (expected_quote_hash !== undefined) {
    ensure(typeof expected_quote_hash === 'string' && /^[a-f0-9]{64}$/.test(expected_quote_hash), 'بصمة معاينة الأصل غير صالحة.');
    ensure(preview.quote_hash === expected_quote_hash, 'معاينة الأصل تغيرت؛ أعد المعاينة والتأكيد.', 409);
  }
  const iso = c.now.toISOString();
  if (action === "fixedAsset.register") {
    const asset = fixedAssetRegistrationEvidence(
      input as unknown as FixedAssetRegistrationInput,
      {
        org_id: c.orgId,
        accounts: original.accounts as Account[],
        journal_entries: original.journal_entries as JournalEntry[],
        fixed_assets: original.fixed_assets,
      },
      { operation_id: c.operationId, created_by: c.actor, created_at: iso },
    );
    ensure(
      !(await c.tx.get(`${c.root}/fixed_assets/${asset.id}`)),
      "معرف الأصل موجود مسبقاً.",
      409,
    );
    const staged = clean(original);
    staged.fixed_assets.push(asset);
    await assertOpeningFinancialData(staged, c.settings);
    return {
      result: asset,
      changes: [{ path: `${c.root}/fixed_assets/${asset.id}`, value: asset }],
    };
  }
  ensure(action === "fixedAsset.depreciate", "عملية أصل ثابت غير معروفة.");
  const asset = original.fixed_assets.find((row) => row.id === input.asset_id);
  ensure(asset, "الأصل غير موجود.", 404);
  const proposed = fixedAssetDepreciationEvidence(asset, input, {
    operation_id: c.operationId,
    created_by: c.actor,
    created_at: iso,
  });
  for (const [name, id] of [
    ["fixed_asset_depreciations", proposed.event.id],
    ...(proposed.entry ? [["journal_entries", proposed.entry.id]] : []),
  ])
    ensure(
      !(await c.tx.get(`${c.root}/${name}/${id}`)),
      "معرف الإهلاك أو القيد موجود مسبقاً.",
      409,
    );
  const staged = clean(original);
  staged.fixed_assets = staged.fixed_assets.map((row) =>
    row.id === asset.id ? proposed.updated : row,
  );
  staged.fixed_asset_depreciations.push(proposed.event);
  if (proposed.entry) staged.journal_entries.push(proposed.entry);
  await assertOpeningFinancialData(staged, c.settings);
  return {
    result: proposed.event,
    changes: [
      { path: `${c.root}/fixed_assets/${asset.id}`, value: proposed.updated },
      {
        path: `${c.root}/fixed_asset_depreciations/${proposed.event.id}`,
        value: proposed.event,
      },
      ...(proposed.entry ? [{
        path: `${c.root}/journal_entries/${proposed.entry.id}`,
        value: proposed.entry,
      }] : []),
    ],
    entry: proposed.entry,
  };
}
