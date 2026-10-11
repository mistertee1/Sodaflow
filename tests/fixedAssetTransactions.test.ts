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

test('C4.3 protected previews are read-only, bind both commands, and reject a stale/forged reviewed quote', async () => {
  const f = await fixture(), before = f.store.dump();
  const p = await f.ops.fixedAssetPreview(f.org.id, owner, {action: 'fixedAsset.register', input: f.input});
  assert.deepEqual(f.store.dump(), before); assert.equal(p.organizationId, f.org.id); assert.equal(p.quote.purchase_cost_sdg, 1200); assert.match(p.quote_hash, /^[a-f0-9]{64}$/);
  await assert.rejects(f.run('fixedAsset.register', {...f.input, expected_quote_hash: 'f'.repeat(64)})); assert.deepEqual(f.store.dump(), before);
  await f.run('fixedAsset.register', {...f.input, expected_quote_hash: p.quote_hash}, 'ui-register');
  const input = {asset_id: 'asset-1', expected_revision: 1, sequence: 1, date: '2026-10-31', reason: 'إهلاك مراجع'};
  const registered = f.store.dump(), dep = await f.ops.fixedAssetPreview(f.org.id, owner, {action: 'fixedAsset.depreciate', input});
  assert.deepEqual(f.store.dump(), registered); assert.equal(dep.quote.amount_sdg, 100); assert.equal(dep.quote.book_after_sdg, 1100);
  await assert.rejects(f.run('fixedAsset.depreciate', {...input, reason: 'تغير السبب', expected_quote_hash: dep.quote_hash})); assert.deepEqual(f.store.dump(), registered);
  const command = {...input, expected_quote_hash: dep.quote_hash};
  const saved = await f.run('fixedAsset.depreciate', command, 'ui-dep'); assert.deepEqual(await f.run('fixedAsset.depreciate', command, 'ui-dep'), saved);
  const posted = f.store.dump(); await assert.rejects(f.run('fixedAsset.depreciate', command, 'other-dep')); assert.deepEqual(f.store.dump(), posted);
});

test('C4.3 preview enforces live role, tenant, entitlement, server authority and rules attestation', async () => {
  for (const mode of ['Admin', 'Viewer', 'foreign', 'expired', 'feature', 'browser', 'rules']) {
    const f = await fixture(); let actor = owner, ops = f.ops;
    await f.store.transaction(async tx => {
      if (['Admin', 'Viewer'].includes(mode)) {actor = {...owner, uid: mode}; tx.set(`${f.root}/members/${mode}`, {uid: mode, org_id: f.org.id, role: mode, status: 'active'});}
      if (mode === 'foreign') actor = {...owner, uid: 'stranger'};
      if (mode === 'expired') tx.set(f.root, {...await tx.get(f.root), subscriptionStatus: 'expired'});
      if (mode === 'feature') {const plan = await tx.get('plans/Enterprise'); tx.set('plans/Enterprise', {...plan, features: {...plan!.features, accounting: false}});}
    });
    if (['browser', 'rules'].includes(mode)) ops = new Operations({authority: mode === 'browser' ? 'browser' : 'server', transaction: f.store.transaction.bind(f.store)}, () => now);
    const before = f.store.dump(); await assert.rejects(ops.fixedAssetPreview(f.org.id, actor, {action: 'fixedAsset.register', input: f.input})); assert.deepEqual(f.store.dump(), before);
  }
  const f = await fixture();
  await f.store.transaction(async tx => tx.set(`${f.root}/members/accountant`, {uid: 'accountant', org_id: f.org.id, role: 'Accountant', status: 'active'}));
  assert.equal((await f.ops.fixedAssetPreview(f.org.id, {...owner, uid: 'accountant'}, {action: 'fixedAsset.register', input: f.input})).quote.id, 'asset-1');
});

test('C4.3 depreciation rechecks open periods after review and refuses future dates', async () => {
  const f = await fixture(); await f.run('fixedAsset.register', f.input, 'register');
  const input = {asset_id: 'asset-1', expected_revision: 1, sequence: 1, date: '2026-10-31', reason: 'مراجعة'};
  const preview = await f.ops.fixedAssetPreview(f.org.id, owner, {action: 'fixedAsset.depreciate', input});
  await f.run('period.softClose', {id: 'oct', expected_revision: 1, reason: 'قفل بعد المعاينة'}, 'close');
  const before = f.store.dump();
  await assert.rejects(f.ops.fixedAssetPreview(f.org.id, owner, {action: 'fixedAsset.depreciate', input}));
  await assert.rejects(f.run('fixedAsset.depreciate', {...input, expected_quote_hash: preview.quote_hash})); assert.deepEqual(f.store.dump(), before);
  await assert.rejects(f.ops.fixedAssetPreview(f.org.id, owner, {action: 'fixedAsset.depreciate', input: {...input, date: '2026-12-31'}}));
});

test('C4.3 registration source must still exist and depreciation controls must remain active', async () => {
  for (const mode of ['source', 'missing', 'account']) {
    const f = await fixture(); await f.run('fixedAsset.register', f.input, 'register');
    await f.store.transaction(async tx => {
      if (mode === 'source') {const entry = (await tx.get(`${f.root}/journal_entries/purchase-asset`))!; entry.lines[0].debit_sdg++; entry.lines[1].credit_sdg++; tx.set(`${f.root}/journal_entries/purchase-asset`, entry);}
      if (mode === 'missing') tx.delete(`${f.root}/journal_entries/purchase-asset`);
      if (mode === 'account') tx.set(`${f.root}/accounts/1590`, {...await tx.get(`${f.root}/accounts/1590`), is_active: false});
    });
    const before = f.store.dump(), input = {asset_id: 'asset-1', expected_revision: 1, sequence: 1, date: '2026-10-31', reason: 'إهلاك'};
    await assert.rejects(f.ops.fixedAssetPreview(f.org.id, owner, {action: 'fixedAsset.depreciate', input}));
    await assert.rejects(f.run('fixedAsset.depreciate', input)); assert.deepEqual(f.store.dump(), before);
  }
});

test('C4.3 zero rounded installment advances source sequence without an invalid zero journal and restores', async () => {
  const f = await fixture();
  await f.store.transaction(async tx => {const entry = (await tx.get(`${f.root}/journal_entries/purchase-asset`))!; entry.lines[0].debit_sdg = 1; entry.lines[0].debit_usd = 0; entry.lines[1].credit_sdg = 1; entry.lines[1].credit_usd = 0; tx.set(`${f.root}/journal_entries/purchase-asset`, entry);});
  await f.run('fixedAsset.register', f.input, 'register');
  const input = {asset_id: 'asset-1', expected_revision: 1, sequence: 1, date: '2026-10-31', reason: 'قسط صفر بعد التقريب'};
  const preview = await f.ops.fixedAssetPreview(f.org.id, owner, {action: 'fixedAsset.depreciate', input}); assert.equal(preview.quote.amount_sdg, 0); assert.deepEqual(preview.quote.lines, []);
  const event = await f.run('fixedAsset.depreciate', {...input, expected_quote_hash: preview.quote_hash}, 'zero-dep'); assert.equal(event.result.journal_id, null);
  const backup = await f.ops.snapshot(f.org.id, owner, true); assert.equal(backup.collections.journal_entries.length, 1); assert.equal(backup.collections.fixed_assets[0].revision, 2);
  verifyFixedAssetSources(backup.collections, f.org.id); assert.deepEqual(reconcileFinancialData(backup.collections as FinancialData, backup.settings, {requireCosting: true}), []);
  const {validateFixedAssetBackup, remapFixedAssets} = await import('../src/domain/fixedAssetSources'); assert.equal(validateFixedAssetBackup(backup).fixed_asset_depreciations.length, 1);
  const remapped = {...backup.collections, ...remapFixedAssets(backup.collections, 'restored'), journal_entries: backup.collections.journal_entries.map((row: any) => ({...row, org_id: 'restored'}))}; verifyFixedAssetSources(remapped, 'restored');
});

test('C4.3 HTTP preview rejects forged payload/query/auth and sets no-store without writing', async () => {
  const {default: express} = await import('express'), {createApi} = await import('../server/api'), f = await fixture();
  const app = express(); app.use(express.json()); app.use('/api', createApi({operations: f.ops, verify: async token => {if (token !== 'valid') throw Error('invalid'); return owner;}}));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/fixed-assets/preview`, before = f.store.dump();
  const send = (body: any, suffix = '', token = 'valid') => fetch(url + suffix, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify(body)});
  try {
    const response = await send({action: 'fixedAsset.register', input: f.input}); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.json()).quote.purchase_cost_sdg, 1200);
    assert.equal((await send({action: 'fixedAsset.register', input: f.input}, '', 'invalid')).status, 401);
    assert.equal((await send({action: 'fixedAsset.register', input: f.input}, '?orgId=foreign')).status, 400);
    assert.equal((await send({action: 'fixedAsset.register', input: {...f.input, purchase_cost_sdg: 1}})).status, 400);
    assert.equal((await send({action: 'fixedAsset.register', input: f.input, actor: 'forged'})).status, 400); assert.deepEqual(f.store.dump(), before);
  } finally {await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}
});
