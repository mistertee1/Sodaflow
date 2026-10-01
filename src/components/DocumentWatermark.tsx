import { documentWatermarkSource } from '../lib/documentBrand';

export function DocumentWatermark() {
  return <div className="sf-document-watermark" aria-hidden="true"><img src={documentWatermarkSource} alt="" /></div>;
}
