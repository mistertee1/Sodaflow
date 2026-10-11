import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/domain/store";
import { Operations, type Actor } from "../src/domain/operations";
import { Organizations } from "../server/organizations";
import { INITIAL_SETTINGS } from "../src/data/initialData";
import { defaultPlatformPlans } from "../src/lib/plans";
import { getDefaultChartOfAccounts } from "../src/services/accountingService";
import { journal, journalLine } from "../src/domain/financial";
import { verifyFixedAssetSources } from "../src/domain/fixedAssetSources";
import {
  reconcileFinancialData,
  type FinancialData,
} from "../src/domain/reconciliation";
const now = new Date("2026-11-30T12:00:00Z"),
  owner: Actor = {
    uid: "asset-owner",
    email: "asset@example.com",
    emailVerified: true,
  };
async function fixture() {
  const store = new MemoryStore(),
    org = await new Organizations(store).create(
      owner,
      "أصول",
      INITIAL_SETTINGS,
      "asset-org",
      true,
    ),
    root = `organizations/${org.id}`;
  await store.transaction(async (tx) => {
    tx.set(root, {
      ...(await tx.get(root)),
      accounting_version: 2,
      planId: "Enterprise",
      subscriptionStatus: "active",
      subscriptionEnd: "2027-01-01",
    });
    tx.set(
      "plans/Enterprise",
      defaultPlatformPlans(now.toISOString()).find(
        (x) => x.id === "Enterprise",
      )!,
    );
    for (const account of getDefaultChartOfAccounts(org.id))
      tx.set(`${root}/accounts/${account.code}`, account);
    for (const account of [
      {
        code: "1500",
        name_ar: "معدات",
        name_en: "Equipment",
        org_id: org.id,
        type: "ASSET",
        nature: "DEBIT",
        is_active: true,
        reporting_group: "fixed_assets",
      },
      {
        code: "1590",
        name_ar: "مجمع إهلاك",
        name_en: "Accumulated depreciation",
        org_id: org.id,
        type: "ASSET",
        nature: "CREDIT",
        is_active: true,
        reporting_group: "fixed_assets",
      },
      {
        code: "5600",
        name_ar: "مصروف إهلاك",
        name_en: "Depreciation expense",
        org_id: org.id,
        type: "EXPENSE",
        nature: "DEBIT",
        is_active: true,
        reporting_group: "operating_expense",
      },
    ])
      tx.set(`${root}/accounts/${account.code}`, account);
    tx.set(
      `${root}/journal_entries/purchase-asset`,
      journal(
        "purchase-asset",
        org.id,
        owner.uid,
        "2026-10-01",
        "manual",
        "asset-source",
        "شراء معدات",
        [
          journalLine("1500", "معدات", 1200, 0, 12, 0),
          journalLine("1130", "البنك", 0, 1200, 0, 12),
        ],
        100,
      ),
    );
  });
  const ops = new Operations(store, () => now),
    run = (
      action: string,
      data: any,
      id: string = crypto.randomUUID(),
      actor = owner,
    ) => ops.execute(org.id, actor, { action, data, operationId: id });
  await run(
    "period.create",
    {
      id: "oct",
      start_date: "2026-10-01",
      end_date: "2026-10-31",
      reason: "أكتوبر",
    },
    "period-oct",
  );
  await run(
    "period.create",
    {
      id: "nov",
      start_date: "2026-11-01",
      end_date: "2026-11-30",
      reason: "نوفمبر",
    },
    "period-nov",
  );
  const input = {
    id: "asset-1",
    name: "معدات مكتب",
    category: "معدات",
    purchase_date: "2026-10-01",
    in_service_date: "2026-10-01",
    source_journal_id: "purchase-asset",
    source_line_index: 0,
    useful_life_months: 12,
    residual_value_sdg: 0,
    residual_value_usd: 0,
    asset_account_code: "1500",
    accumulated_depreciation_account_code: "1590",
    depreciation_expense_account_code: "5600",
    reason: "تسجيل الأصل",
    reference_number: "FA-1",
  };
  return { store, org, root, ops, run, input };
}
test("C4.2 registers immutable source once and posts scheduled depreciation atomically", async () => {
  const f = await fixture(),
    registered = await f.run("fixedAsset.register", f.input, "register");
  assert.deepEqual(
    await f.run("fixedAsset.register", f.input, "register"),
    registered,
  );
  const event = await f.run(
    "fixedAsset.depreciate",
    {
      asset_id: "asset-1",
      expected_revision: 1,
      sequence: 1,
      date: "2026-10-31",
      reason: "إهلاك أكتوبر",
    },
    "dep-1",
  );
  assert.deepEqual(
    await f.run(
      "fixedAsset.depreciate",
      {
        asset_id: "asset-1",
        expected_revision: 1,
        sequence: 1,
        date: "2026-10-31",
        reason: "إهلاك أكتوبر",
      },
      "dep-1",
    ),
    event,
  );
  const s = await f.ops.snapshot(f.org.id, owner, true),
    asset = s.collections.fixed_assets[0];
  assert.equal(asset.accumulated_depreciation_sdg, 100);
  assert.equal(asset.book_value_sdg, 1100);
  assert.equal(s.collections.fixed_asset_depreciations.length, 1);
  assert.equal(
    s.collections.journal_entries.filter(
      (x: any) => x.reference_type === "fixed_asset_depreciation",
    ).length,
    1,
  );
  verifyFixedAssetSources(s.collections, f.org.id);
  assert.deepEqual(
    reconcileFinancialData(s.collections as FinancialData, s.settings, {
      requireCosting: true,
    }),
    [],
  );
});
test("C4.2 Owner and Accountant only; protected dates, revisions and request fields roll back", async () => {
  for (const role of ["Accountant", "Admin", "Viewer"]) {
    const f = await fixture(),
      actor = { ...owner, uid: role };
    await f.store.transaction(async (tx) =>
      tx.set(`${f.root}/members/${role}`, {
        uid: role,
        org_id: f.org.id,
        role,
        status: "active",
      }),
    );
    const before = f.store.dump();
    if (role === "Accountant")
      assert.equal(
        (await f.run("fixedAsset.register", f.input, "role", actor)).result
          .created_by,
        role,
      );
    else {
      await assert.rejects(
        f.run("fixedAsset.register", f.input, "role", actor),
      );
      assert.deepEqual(f.store.dump(), before);
    }
  }
  const f = await fixture();
  await f.run("fixedAsset.register", f.input, "register");
  for (const data of [
    {
      asset_id: "asset-1",
      expected_revision: 9,
      sequence: 1,
      date: "2026-10-31",
      reason: "x",
    },
    {
      asset_id: "asset-1",
      expected_revision: 1,
      sequence: 1,
      date: "2026-10-30",
      reason: "x",
    },
    {
      asset_id: "asset-1",
      expected_revision: 1,
      sequence: 1,
      date: "2026-10-31",
      reason: "x",
      amount: 99,
    },
  ]) {
    const before = f.store.dump();
    await assert.rejects(f.run("fixedAsset.depreciate", data));
    assert.deepEqual(f.store.dump(), before);
  }
});
test("C4.2 source, asset and depreciation tampering are detected read-only", async () => {
  const f = await fixture();
  await f.run("fixedAsset.register", f.input, "register");
  await f.run(
    "fixedAsset.depreciate",
    {
      asset_id: "asset-1",
      expected_revision: 1,
      sequence: 1,
      date: "2026-10-31",
      reason: "إهلاك",
    },
    "dep",
  );
  const backup = await f.ops.snapshot(f.org.id, owner, true);
  for (const mutate of [
    (s: any) => s.collections.fixed_assets[0].purchase_cost_sdg++,
    (s: any) => s.collections.fixed_asset_depreciations[0].amount_sdg++,
    (s: any) =>
      s.collections.journal_entries.find(
        (x: any) => x.reference_type === "fixed_asset_depreciation",
      ).lines[0].debit_sdg++,
  ]) {
    const bad = structuredClone(backup);
    mutate(bad);
    assert.throws(() => verifyFixedAssetSources(bad.collections, f.org.id));
    assert.ok(
      reconcileFinancialData(bad.collections as FinancialData, bad.settings, {
        requireCosting: true,
      }).length,
    );
  }
});
test("C4.2 backup restores tenant-remapped asset lifecycle and rejects incomplete proof", async () => {
  const f = await fixture();
  await f.run("fixedAsset.register", f.input, "register");
  await f.run(
    "fixedAsset.depreciate",
    {
      asset_id: "asset-1",
      expected_revision: 1,
      sequence: 1,
      date: "2026-10-31",
      reason: "إهلاك",
    },
    "dep",
  );
  const backup = await f.ops.snapshot(f.org.id, owner, true),
    actor = { ...owner, uid: "asset-restore" },
    org = await new Organizations(f.store).create(
      actor,
      "استعادة أصول",
      INITIAL_SETTINGS,
      "asset-restore",
      true,
    ),
    root = `organizations/${org.id}`;
  await f.store.transaction(async (tx) =>
    tx.set(root, {
      ...(await tx.get(root)),
      planId: "Enterprise",
      subscriptionStatus: "active",
      subscriptionEnd: "2027-01-01",
    }),
  );
  const bad = structuredClone(backup);
  delete bad.collections.fixed_asset_depreciations;
  const before = f.store.dump();
  await assert.rejects(
    f.ops.execute(org.id, actor, {
      action: "backup.restore",
      data: { backup: bad },
      operationId: "bad",
    }),
  );
  assert.deepEqual(f.store.dump(), before);
  await f.ops.execute(org.id, actor, {
    action: "backup.restore",
    data: { backup },
    operationId: "restore",
  });
  const restored = await f.ops.snapshot(org.id, actor, true);
  verifyFixedAssetSources(restored.collections, org.id);
  assert.equal(restored.collections.fixed_assets[0].org_id, org.id);
  assert.equal(restored.counters.fixed_asset_count, 1);
  assert.equal(restored.counters.fixed_asset_depreciation_count, 1);
  assert.deepEqual(
    reconcileFinancialData(
      restored.collections as FinancialData,
      restored.settings,
      { requireCosting: true },
    ),
    [],
  );
});
