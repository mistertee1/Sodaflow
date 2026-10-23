import type { Product } from '../types';
import type { Document, Transaction } from './store';
import { BusinessError, text } from './validation';

type NamedProduct = Pick<Product, 'id' | 'name'>;

export function normalizeProductName(name: string): string {
  const value = text(name, 200, true).normalize('NFKC')
    .replace(/[\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ').trim().toLowerCase();
  if (!value) throw new BusinessError('اكتب اسماً واضحاً للمنتج.');
  return value;
}

const legacyName = (name: string) => { try { return normalizeProductName(name); } catch { return undefined; } };
export function productDuplicateGroups<T extends NamedProduct>(products: T[]) {
  const groups = new Map<string, T[]>();
  for (const product of products) {
    const key = legacyName(product.name); if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), product]);
  }
  return [...groups].filter(([, rows]) => rows.length > 1).map(([name, rows]) => ({ name, products: rows }));
}

export function duplicateProductError(name: string) {
  return new BusinessError(`المنتج «${name}» مسجل بالفعل. استخدم المنتج الموجود لاستلام كمية، أو ميّز اسم الصنف المختلف بالحجم أو النوع.`, 409, 'duplicate_product');
}

export function assertAvailableProductName(products: NamedProduct[], name: string, id?: string, previousName?: string) {
  const key = normalizeProductName(name);
  // Existing duplicate IDs and their financial history stay usable while reviewed.
  if (previousName !== undefined && legacyName(previousName) === key) return;
  const duplicate = products.find(p => p.id !== id && legacyName(p.name) === key);
  if (duplicate) throw duplicateProductError(duplicate.name);
}

export async function productNameKey(name: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeProductName(name)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

// The reservation and product/counters/audit commit together. The legacy scan is
// needed until historical names have been reviewed; no financial migration runs.
export async function reserveProductName(tx: Transaction, root: string, id: string, name: string, iso: string, previousName?: string): Promise<Document[] | undefined> {
  const normalized = normalizeProductName(name);
  if (previousName !== undefined && legacyName(previousName) === normalized) return;
  const catalog = await tx.list(`${root}/products`);
  assertAvailableProductName(catalog as Product[], name, id);
  const path = `${root}/product_names/${await productNameKey(name)}`, claim = await tx.get(path);
  if (claim && claim.product_id !== id) {
    // A restored catalog can leave obsolete technical claims. Reclaim only after
    // reading the claimed product and confirming it no longer owns this name.
    if (typeof claim.product_id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(claim.product_id)) throw new BusinessError('فهرس اسم المنتج يحتاج مراجعة تقنية.', 409);
    const owner = await tx.get(`${root}/products/${claim.product_id}`);
    if (owner && legacyName(owner.name) === normalized) throw duplicateProductError(owner.name);
  }
  if (previousName !== undefined) await releaseProductName(tx, root, id, previousName);
  tx.set(path, { product_id: id, normalized_name: normalized, schema_version: 1, updated_at: iso });
  return catalog;
}

export async function releaseProductName(tx: Transaction, root: string, id: string, name: string) {
  if (!legacyName(name)) return;
  const path = `${root}/product_names/${await productNameKey(name)}`, claim = await tx.get(path);
  if (claim?.product_id === id) tx.delete(path);
}
