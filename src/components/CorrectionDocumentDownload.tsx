import React, { useRef, useState } from 'react';
import type { CorrectionDocumentKind } from '../domain/correctionDocuments';
import { useApp } from '../context/AppContext';

export function CorrectionDocumentDownload({ kind, id }: { kind: CorrectionDocumentKind; id: string }) {
  const { exportCorrectionDocument, isActionAllowed } = useApp();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  if (!isActionAllowed('backup:export')) return null;
  const download = async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const payload = await exportCorrectionDocument(kind, id);
      const { downloadCorrectionDocumentPdf } = await import('../services/correctionDocumentPdf');
      await downloadCorrectionDocumentPdf(payload);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تصدير مستند التصحيح.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <span className="inline-block"><button type="button" className="sf-secondary" aria-label={`تحميل PDF ${id}`} disabled={busy} onClick={() => void download()}>{busy ? 'جارٍ التصدير…' : 'PDF'}</button>{error && <span role="alert" className="block text-red-600">{error}</span>}</span>;
}
