import { serverEnv } from './env';

// Never initialize Firebase or create work just because this file is deployed.
// Operator activation and private-storage acceptance remain independent steps.
if (serverEnv('SCHEDULED_EXPORTS_ENABLED') !== 'true') {
  console.info(JSON.stringify({ status: 'disabled', execution_enabled: false }));
} else {
  const [{ firebaseScheduledExportDispatcher }, { firebaseLargeExportWorker }] = await Promise.all([import('./scheduledExportDispatch'), import('./largeExportWorker')]);
  const dispatcher = firebaseScheduledExportDispatcher(), worker = firebaseLargeExportWorker();
  const cleanup = await worker.cleanupNext(), expired = await worker.expireNext(), dispatched = await dispatcher.dispatchNext(), job = await worker.runNext();
  console.info(JSON.stringify({ status: 'processed', cleanup: cleanup?.status || null, expired: expired?.id || null, dispatched: dispatched?.status || null, job: job ? { id: job.id, status: job.status } : null }));
}
