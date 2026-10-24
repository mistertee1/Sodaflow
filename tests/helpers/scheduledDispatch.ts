import { MemoryStore, type Store, type Document } from '../../src/domain/store';
import { liveExportFixture } from './liveExports';
import { ScheduledExportDispatcher } from '../../server/scheduledExportDispatch';
import { scheduleInput } from './scheduledExports';
import { scheduledExportDueKey } from '../../src/domain/scheduledExportManagement';

export async function scheduledDispatchFixture(store: Store = new MemoryStore(), suffix = 'dispatch') {
  const f = await liveExportFixture(store, suffix), dispatcher = new ScheduledExportDispatcher(f.server, f.options);
  const schedule = async (operationId = 'policy', uid = 'Accountant', overrides: Document = {}) => (await f.create(operationId, uid, scheduleInput(overrides))).schedule;
  const dispatch = (id: string) => dispatcher.dispatch(f.org.id, id);
  const duePath = (id: string) => `scheduled_export_due/${scheduledExportDueKey(f.org.id, id)}`;
  return { ...f, dispatcher, schedule, dispatch, duePath };
}
