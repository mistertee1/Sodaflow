import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// 718 CSS px across 190 mm keeps 14px operational text at >= 10.5pt.
const pageWidthPx = 718;
const pageHeightPx = Math.floor(277 * pageWidthPx / 190);

/** Lay out complete blocks and table rows before rendering; never slice a row image. */
function paginateDocument(source: HTMLElement, host: HTMLElement): HTMLElement[] {
  const pages: HTMLElement[] = [];
  const blocks = Array.from(source.children) as HTMLElement[];
  const header = blocks.find(block => block.dataset.pdfRepeat === 'header');
  const footer = blocks.find(block => block.dataset.pdfRepeat === 'footer');
  const watermark = blocks.find(block => block.dataset.pdfRepeat === 'watermark');
  let page: HTMLElement, pageFooter: HTMLElement;
  const newPage = () => {
    page = source.cloneNode(false) as HTMLElement;
    page.style.width = `${pageWidthPx}px`;
    page.style.maxWidth = 'none';
    if (header) page.appendChild(header.cloneNode(true));
    if (watermark) page.appendChild(watermark.cloneNode(true));
    pageFooter = footer ? footer.cloneNode(true) as HTMLElement : document.createElement('div');
    const number = document.createElement('span');
    number.dataset.pdfPageNumber = '';
    number.style.cssText = "font:400 14px/22px 'IBM Plex Sans Arabic',sans-serif;white-space:nowrap;color:#52656B;";
    number.textContent = 'صفحة 000 من 000';
    pageFooter.appendChild(number);
    if (!footer) pageFooter.style.cssText = 'margin-top:16px;display:flex;justify-content:flex-end;';
    page.appendChild(pageFooter);
    host.appendChild(page);
    pages.push(page);
  };
  const fits = () => page.getBoundingClientRect().height <= pageHeightPx;
  const add = (block: HTMLElement) => page.insertBefore(block, pageFooter);
  newPage();
  for (const block of blocks.filter(block => block !== header && block !== footer && block !== watermark)) {
    const table = block.matches('table') ? block as HTMLTableElement : block.querySelector<HTMLTableElement>('table');
    if (!table?.tBodies.length) {
      const copy = block.cloneNode(true) as HTMLElement;
      add(copy);
      if (!fits()) { copy.remove(); newPage(); add(copy); }
      if (!fits()) throw new Error('محتوى المستند أطول من مساحة الصفحة. استخدم الطباعة أو اختصر النص المطوّل.');
      continue;
    }
    const emptyTableBlock = () => {
      const copy = block.cloneNode(true) as HTMLElement;
      const targetTable = copy.matches('table') ? copy as HTMLTableElement : copy.querySelector<HTMLTableElement>('table')!;
      for (const body of Array.from(targetTable.tBodies)) body.replaceChildren();
      return { copy, body: targetTable.tBodies[0] };
    };
    let { copy, body } = emptyTableBlock();
    add(copy);
    for (const row of Array.from(table.tBodies).flatMap(body => Array.from(body.rows))) {
      const rowCopy = row.cloneNode(true) as HTMLTableRowElement;
      body.appendChild(rowCopy);
      if (fits()) continue;
      rowCopy.remove();
      if (!body.rows.length) copy.remove();
      newPage();
      ({ copy, body } = emptyTableBlock());
      add(copy);
      body.appendChild(rowCopy);
      if (!fits()) throw new Error('أحد بنود المستند أطول من صفحة كاملة. استخدم الطباعة أو اختصر وصف البند.');
    }
  }
  pages.forEach((page, index) => {
    page.querySelector<HTMLElement>('[data-pdf-page-number]')!.textContent = `صفحة ${index + 1} من ${pages.length}`;
  });
  return pages;
}

async function renderDocumentPdf(container: HTMLElement): Promise<jsPDF> {
  const source = container.querySelector<HTMLElement>('.sf-print-document');
  if (!source) throw new Error('تعذر تجهيز قالب المستند.');
  await Promise.all([400, 500, 600].map(weight => document.fonts.load(`${weight} 14px "IBM Plex Sans Arabic"`)));
  await document.fonts.ready;
  await Promise.all(Array.from(source.querySelectorAll('img')).map(image => image.complete ? Promise.resolve() : new Promise<void>(resolve => {
    image.onload = () => resolve(); image.onerror = () => resolve();
  })));
  const host = document.createElement('div');
  host.style.width = `${pageWidthPx}px`;
  container.appendChild(host);
  try {
    const pages = paginateDocument(source, host);
    const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4', compress:true });
    for (let index = 0; index < pages.length; index++) {
      const canvas = await html2canvas(pages[index], { scale:2, useCORS:true, logging:false, backgroundColor:'#FFFFFF', windowWidth:pageWidthPx });
      if (index) pdf.addPage();
      const heightMm = canvas.height * 190 / canvas.width;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, 190, heightMm);
      canvas.width = 0; canvas.height = 0;
    }
    return pdf;
  } finally { host.remove(); }
}

export async function createDocumentPdfBlob(container: HTMLElement): Promise<Blob> {
  return (await renderDocumentPdf(container)).output('blob');
}

export async function downloadDocumentPdf(container: HTMLElement, filename: string): Promise<void> {
  (await renderDocumentPdf(container)).save(filename);
}
