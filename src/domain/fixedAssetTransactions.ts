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
  const iso = c.now.toISOString();
  if (action === "fixedAsset.register") {
    const asset = fixedAssetRegistrationEvidence(
      data as unknown as FixedAssetRegistrationInput,
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
  const asset = original.fixed_assets.find((row) => row.id === data.asset_id);
  ensure(asset, "الأصل غير موجود.", 404);
  const proposed = fixedAssetDepreciationEvidence(asset, data, {
    operation_id: c.operationId,
    created_by: c.actor,
    created_at: iso,
  });
  for (const [name, id] of [
    ["fixed_asset_depreciations", proposed.event.id],
    ["journal_entries", proposed.entry.id],
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
  staged.journal_entries.push(proposed.entry);
  await assertOpeningFinancialData(staged, c.settings);
  return {
    result: proposed.event,
    changes: [
      { path: `${c.root}/fixed_assets/${asset.id}`, value: proposed.updated },
      {
        path: `${c.root}/fixed_asset_depreciations/${proposed.event.id}`,
        value: proposed.event,
      },
      {
        path: `${c.root}/journal_entries/${proposed.entry.id}`,
        value: proposed.entry,
      },
    ],
    entry: proposed.entry,
  };
}
