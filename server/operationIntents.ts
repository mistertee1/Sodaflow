import { createHash, randomUUID } from 'node:crypto';
import { membership, type Actor } from '../src/domain/operations';
import type { Store, Transaction } from '../src/domain/store';
import { ensure, identifier } from '../src/domain/validation';
import { PlatformBilling } from './platformBilling';

export interface OperationIntentInput { organizationId?: string; fingerprint: string; operationId?: string; }

/** Server-only retry metadata. It confers no permission to execute a mutation. */
export class OperationIntents {
  constructor(private store: Store, private now: () => Date = () => new Date(), private controlsEnabled = true) {}
  private validate(input: OperationIntentInput) {
    ensure(input && typeof input === 'object' && !Array.isArray(input), 'بيانات الطلب غير صالحة.');
    ensure(Object.keys(input).every(key => ['organizationId', 'fingerprint', 'operationId'].includes(key)), 'حقول الطلب غير صالحة.');
    ensure(typeof input.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(input.fingerprint), 'بصمة الطلب غير صالحة.');
    if (input.organizationId !== undefined) identifier(input.organizationId);
    if (input.operationId !== undefined) { identifier(input.operationId); ensure(input.operationId.length <= 64, 'معرّف العملية طويل جداً.'); }
  }
  private async scope(tx: Transaction, actor: Actor, input: OperationIntentInput) {
    identifier(actor.uid);
    ensure(typeof input.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(input.fingerprint), 'بصمة الطلب غير صالحة.');
    let prefix: string;
    if (input.organizationId !== undefined) {
      const orgId = identifier(input.organizationId);
      const { role } = await membership(tx, orgId, actor, false, this.controlsEnabled);
      ensure(role !== 'Viewer', 'صلاحية الكتابة غير متاحة.', 403);
      prefix = `organizations/${orgId}/operationIntents`;
    } else {
      await new PlatformBilling(this.store, undefined, this.controlsEnabled).assertAdmin(actor, tx);
      prefix = 'platformOperationIntents';
    }
    const key = createHash('sha256').update(`${actor.uid}:${input.fingerprint}`).digest('hex');
    return { path: `${prefix}/${key}`, ratePath: `${prefix}/rate-${actor.uid}` };
  }
  begin(actor: Actor, input: OperationIntentInput) {
    this.validate(input);
    const proposed = input.operationId || randomUUID();
    identifier(proposed); ensure(proposed.length <= 64, 'معرّف العملية طويل جداً.');
    return this.store.transaction(async tx => {
      const { path, ratePath } = await this.scope(tx, actor, input);
      const previous = await tx.get(path);
      if (previous) {
        ensure(previous.uid === actor.uid && previous.fingerprint === input.fingerprint, 'بيانات إعادة المحاولة غير مطابقة.', 409);
        return { operationId: previous.operationId as string };
      }
      const now = this.now().toISOString(), minute = now.slice(0, 16), rate = await tx.get(ratePath);
      ensure(rate?.minute !== minute || rate.count < 120, 'طلبات كثيرة. حاول بعد دقيقة.', 429);
      tx.set(ratePath, { uid: actor.uid, minute, count: rate?.minute === minute ? rate.count + 1 : 1 });
      tx.set(path, { uid: actor.uid, fingerprint: input.fingerprint, operationId: proposed, createdAt: now });
      return { operationId: proposed };
    });
  }
  acknowledge(actor: Actor, input: OperationIntentInput) {
    this.validate(input);
    const id = identifier(input.operationId); ensure(id.length <= 64, 'معرّف العملية طويل جداً.');
    return this.store.transaction(async tx => {
      const { path } = await this.scope(tx, actor, input), pending = await tx.get(path);
      // An old response cannot remove a newer request that reused the fingerprint.
      if (pending?.uid === actor.uid && pending.operationId === id) tx.delete(path);
      return { acknowledged: !pending || pending.operationId === id };
    });
  }
}
