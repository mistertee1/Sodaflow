import type { Account, JournalEntry } from "../types";
import { journal, journalLine } from "./financial";
import {
  fixedAssetRegistrationQuote,
  type FixedAssetRegistrationInput,
} from "./fixedAssets";
import { clean, type Document } from "./store";
import {
  dateOnly,
  ensure,
  identifier,
  text,
  validateJournal,
} from "./validation";

export const fixedAssetCollections = [
  "fixed_assets",
  "fixed_asset_depreciations",
] as const;
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.entries(v)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
          .join(",")}}`
      : (JSON.stringify(v) ?? "null");
const registrationKeys = [
  "id",
  "name",
  "category",
  "purchase_date",
  "in_service_date",
  "source_journal_id",
  "source_line_index",
  "useful_life_months",
  "residual_value_sdg",
  "residual_value_usd",
  "asset_account_code",
  "accumulated_depreciation_account_code",
  "depreciation_expense_account_code",
  "reason",
  "reference_number",
];

export function fixedAssetRegistrationEvidence(
  input: FixedAssetRegistrationInput,
  snapshot: {
    org_id: string;
    accounts: Account[];
    journal_entries: JournalEntry[];
    fixed_assets: Document[];
  },
  identity: { operation_id: string; created_by: string; created_at: string },
) {
  identifier(identity.operation_id);
  identifier(identity.created_by);
  dateOnly(identity.created_at);
  const quote = fixedAssetRegistrationQuote(input, snapshot),
    source = snapshot.journal_entries.find(
      (row) => row.id === quote.source_journal_id,
    )!,
    codes = new Set([
      quote.asset_account_code,
      quote.accumulated_depreciation_account_code,
      quote.depreciation_expense_account_code,
    ]);
  const asset = {
    ...quote,
    input: clean(input as unknown as Document),
    operation_id: identity.operation_id,
    created_by: identity.created_by,
    created_at: identity.created_at,
    source_journal_basis: clean(source as unknown as Document),
    account_basis: snapshot.accounts
      .filter((row) => codes.has(row.code))
      .map((row) => clean(row as unknown as Document)),
    revision: 1,
    next_depreciation_sequence: 1,
    accumulated_depreciation_sdg: 0,
    accumulated_depreciation_usd: 0,
    book_value_sdg: quote.purchase_cost_sdg,
    book_value_usd: quote.purchase_cost_usd,
    status: "active",
  };
  ensure(
    new TextEncoder().encode(JSON.stringify(asset)).length <= 250000,
    "دليل الأصل يتجاوز حد السجل.",
    413,
  );
  return asset;
}

export function fixedAssetDepreciationEvidence(
  asset: Document,
  input: Document,
  identity: { operation_id: string; created_by: string; created_at: string },
) {
  ensure(
    input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).every((key) =>
        [
          "asset_id",
          "expected_revision",
          "sequence",
          "date",
          "reason",
        ].includes(key),
      ),
    "حقول ترحيل الإهلاك غير صالحة.",
  );
  ensure(
    identifier(input.asset_id) === asset.id &&
      Number.isSafeInteger(input.expected_revision) &&
      input.expected_revision === asset.revision,
    "الأصل تغير؛ حدّث السجل قبل الإهلاك.",
    409,
  );
  ensure(
    Number.isSafeInteger(input.sequence) &&
      input.sequence === asset.next_depreciation_sequence,
    "تسلسل الإهلاك غير مطابق.",
    409,
  );
  const row = asset.schedule[input.sequence - 1];
  ensure(
    row && dateOnly(input.date) === input.date && input.date === row.date,
    "تاريخ قسط الإهلاك غير مطابق للجدول.",
    409,
  );
  text(input.reason, 1000, true);
  const id = `fad-${identity.operation_id}`,
    journalId = `jv-fad-${identity.operation_id}`,
    lines = [
      journalLine(
        asset.depreciation_expense_account_code,
        "مصروف إهلاك",
        row.depreciation_sdg,
        0,
        row.depreciation_usd,
        0,
      ),
      journalLine(
        asset.accumulated_depreciation_account_code,
        "مجمع الإهلاك",
        0,
        row.depreciation_sdg,
        0,
        row.depreciation_usd,
      ),
    ];
  const event = {
    id,
    org_id: asset.org_id,
    schema_version: 1,
    asset_id: asset.id,
    sequence: input.sequence,
    date: input.date,
    amount_sdg: row.depreciation_sdg,
    amount_usd: row.depreciation_usd,
    journal_id: row.depreciation_sdg > 0 || row.depreciation_usd > 0 ? journalId : null,
    operation_id: identity.operation_id,
    created_by: identity.created_by,
    created_at: identity.created_at,
    reason: input.reason,
    asset_revision_before: asset.revision,
  };
  const entry = event.journal_id ? {
    ...journal(
      journalId,
      asset.org_id,
      identity.created_by,
      input.date,
      "fixed_asset_depreciation",
      id,
      input.reason,
      lines,
      0,
    ),
    created_at: identity.created_at,
  } : null;
  const accumulatedSdg = row.accumulated_sdg,
    accumulatedUsd = row.accumulated_usd,
    complete = input.sequence === asset.schedule.length,
    updated = {
      ...asset,
      revision: asset.revision + 1,
      next_depreciation_sequence: input.sequence + 1,
      accumulated_depreciation_sdg: accumulatedSdg,
      accumulated_depreciation_usd: accumulatedUsd,
      book_value_sdg: asset.purchase_cost_sdg - accumulatedSdg,
      book_value_usd: Number(
        (asset.purchase_cost_usd - accumulatedUsd).toFixed(2),
      ),
      status: complete ? "fully_depreciated" : "active",
      last_depreciation_id: id,
      updated_at: identity.created_at,
    };
  return { event, entry, updated };
}

export function verifyFixedAssetSources(
  data: Record<string, Document[]>,
  orgId?: string,
) {
  const assets = data.fixed_assets || [],
    events = data.fixed_asset_depreciations || [],
    entries = data.journal_entries || [],
    tenant = orgId || assets[0]?.org_id || events[0]?.org_id;
  if (
    !assets.length &&
    !events.length &&
    !entries.some((row) => row.reference_type === "fixed_asset_depreciation")
  )
    return;
  identifier(tenant);
  ensure(
    assets.length <= 1200 && events.length <= 1200,
    "سجل الأصول يتجاوز حد التحقق.",
    413,
  );
  const ids = new Set<string>(),
    sourceLines = new Set<string>(),
    eventIds = new Set<string>(),
    operations = new Set<string>();
  for (const asset of assets) {
    identifier(asset.id);
    ensure(
      asset.org_id === tenant &&
        asset.schema_version === 1 &&
        !ids.has(asset.id),
      "هوية أصل مكررة أو أجنبية.",
    );
    ids.add(asset.id);
    const key = `${asset.source_journal_id}:${asset.source_line_index}`;
    ensure(!sourceLines.has(key), "مصدر شراء الأصل مستخدم أكثر من مرة.");
    sourceLines.add(key);
    const liveSource = entries.filter(row => row.id === asset.source_journal_id);
    ensure(liveSource.length === 1 && stable(liveSource[0]) === stable(asset.source_journal_basis), 'قيد شراء الأصل مفقود أو مختلف عن إثبات التسجيل.');
    const quote = fixedAssetRegistrationQuote(
      Object.fromEntries(
        registrationKeys.map((key) => [key, asset.input[key]]),
      ) as unknown as FixedAssetRegistrationInput,
      {
        org_id: tenant,
        accounts: asset.account_basis as Account[],
        journal_entries: [asset.source_journal_basis as JournalEntry],
        fixed_assets: [],
      },
    );
    for (const key of Object.keys(quote))
      ensure(
        stable(asset[key]) === stable((quote as unknown as Document)[key]),
        "إثبات تسجيل الأصل مختلف عن المصدر.",
      );
    const related = events
      .filter((row) => row.asset_id === asset.id)
      .sort((a, b) => a.sequence - b.sequence);
    ensure(
      related.every((row, index) => row.sequence === index + 1),
      "تسلسل إهلاك الأصل ناقص.",
    );
    let current: Document = {
      ...asset,
      revision: 1,
      next_depreciation_sequence: 1,
      accumulated_depreciation_sdg: 0,
      accumulated_depreciation_usd: 0,
      book_value_sdg: asset.purchase_cost_sdg,
      book_value_usd: asset.purchase_cost_usd,
      status: "active",
    };
    for (const event of related) {
      identifier(event.id);
      identifier(event.operation_id);
      identifier(event.created_by);
      dateOnly(event.created_at);
      ensure(
        event.org_id === tenant &&
          !eventIds.has(event.id) &&
          !operations.has(event.operation_id) &&
          event.id === `fad-${event.operation_id}`,
        "مصدر إهلاك مكرر أو مختلف.",
      );
      eventIds.add(event.id);
      operations.add(event.operation_id);
      const derived = fixedAssetDepreciationEvidence(
        current,
        {
          asset_id: asset.id,
          expected_revision: current.revision,
          sequence: event.sequence,
          date: event.date,
          reason: event.reason,
        },
        {
          operation_id: event.operation_id,
          created_by: event.created_by,
          created_at: event.created_at,
        },
      );
      ensure(
        stable(derived.event) === stable(event),
        "مصدر الإهلاك مختلف عن الجدول.",
      );
      const linked = entries.filter(
        (row) =>
          row.reference_type === "fixed_asset_depreciation" &&
          row.reference_id === event.id,
      );
      ensure(
        derived.entry ? linked.length === 1 && stable(linked[0]) === stable(derived.entry) : linked.length === 0,
        "قيد الإهلاك مفقود أو مختلف.",
      );
      current = derived.updated;
    }
    for (const key of [
      "revision",
      "next_depreciation_sequence",
      "accumulated_depreciation_sdg",
      "accumulated_depreciation_usd",
      "book_value_sdg",
      "book_value_usd",
      "status",
      "last_depreciation_id",
    ])
      ensure(
        stable(asset[key]) === stable(current[key]),
        "الرصيد الحالي للأصل لا يطابق أحداث الإهلاك.",
      );
  }
  for (const event of events) ensure(ids.has(event.asset_id), "إهلاك بلا أصل.");
  for (const entry of entries.filter(
    (row) => row.reference_type === "fixed_asset_depreciation",
  )) {
    validateJournal(entry.lines);
    ensure(eventIds.has(entry.reference_id), "قيد إهلاك بلا مصدر.");
  }
}
export function reconcileFixedAssets(data: Record<string, Document[]>) {
  try {
    verifyFixedAssetSources(data);
    return [];
  } catch (e) {
    return [
      {
        code: "invalid_fixed_asset_source",
        collection: "fixed_assets",
        id: "sources",
        message: e instanceof Error ? e.message : "مصدر أصل غير صالح",
      },
    ];
  }
}
export function fixedAssetBackupCounts(data: Record<string, Document[]>) {
  return {
    fixed_asset_count: (data.fixed_assets || []).length,
    fixed_asset_depreciation_count: (data.fixed_asset_depreciations || [])
      .length,
  };
}
export function validateFixedAssetBackup(backup: Document) {
  const data = backup.collections;
  ensure(data && typeof data === "object", "مصادر النسخة غير صالحة.");
  const declared =
    backup.fixed_asset_schema_version !== undefined ||
    backup.counters?.fixed_asset_count !== undefined ||
    (data.fixed_assets || []).length ||
    (data.fixed_asset_depreciations || []).length;
  if (declared) {
    ensure(
      backup.fixed_asset_schema_version === 1 &&
        Array.isArray(data.fixed_assets) &&
        Array.isArray(data.fixed_asset_depreciations),
      "مصادر الأصول في النسخة ناقصة.",
      409,
    );
    for (const [k, v] of Object.entries(fixedAssetBackupCounts(data)))
      ensure(
        backup.counters?.[k] === v,
        "عدد مصادر الأصول في النسخة مختلف.",
        409,
      );
    verifyFixedAssetSources(data, identifier(backup.org?.id));
  }
  return {
    fixed_assets: data.fixed_assets || [],
    fixed_asset_depreciations: data.fixed_asset_depreciations || [],
  };
}
export function remapFixedAssets(
  data: Record<string, Document[]>,
  destination: string,
) {
  identifier(destination);
  return {
    fixed_assets: (data.fixed_assets || []).map((row) => ({
      ...row,
      org_id: destination,
      account_basis: row.account_basis.map((a: Document) => ({
        ...a,
        org_id: destination,
      })),
      source_journal_basis: {
        ...row.source_journal_basis,
        org_id: destination,
      },
    })),
    fixed_asset_depreciations: (data.fixed_asset_depreciations || []).map(
      (row) => ({ ...row, org_id: destination }),
    ),
  };
}
