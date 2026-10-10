import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Boxes,
  Cloud,
  CloudOff,
  CreditCard,
  Eye,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Invoice } from '../types';
import { formatMoney, safeAdd } from '../lib/currency';

interface OperationsAttentionPanelProps {
  onNavigate: (tab: string) => void;
  onViewInvoice: (invoice: Invoice) => void;
}

export const OperationsAttentionPanel: React.FC<OperationsAttentionPanelProps> = ({ onNavigate, onViewInvoice }) => {
  const { invoices, products, settings, syncStatus, syncError } = useApp();
  const today = new Date().toISOString().slice(0, 10);

  const overdue = useMemo(
    () => invoices
      .filter(invoice => !['paid', 'cancelled', 'void', 'draft'].includes(invoice.status) && !!invoice.due_date && invoice.due_date < today)
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')),
    [invoices, today],
  );

  const openInvoices = useMemo(
    () => invoices.filter(invoice => !['paid', 'cancelled', 'void', 'draft'].includes(invoice.status) && (invoice.remaining_sdg > 0 || invoice.remaining_usd > 0)),
    [invoices],
  );

  const lowStock = useMemo(
    () => products.filter(product => product.track_inventory !== false
      && typeof product.stock_quantity === 'number'
      && typeof product.min_stock_alert === 'number'
      && product.stock_quantity <= product.min_stock_alert),
    [products],
  );

  const overdueAmount = overdue.reduce((sum, invoice) => safeAdd(sum, invoice.remaining_sdg || 0, settings.sdg_decimals, settings.rounding_rule), 0);
  const syncHealthy = syncStatus === 'synced' || syncStatus === 'idle';

  return (
    <section className="space-y-3" aria-labelledby="attention-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="attention-title" className="sf-heading-2">يحتاج انتباهك</h2>
          <p className="text-sm text-sf-muted mt-1">مختصر تشغيلي للأشياء التي تحتاج إجراء، مستوحى من أسلوب Operations Console في الوايرفريم.</p>
        </div>
        <button type="button" onClick={() => onNavigate('invoices')} className="sf-action-link text-sm">عرض كل الفواتير</button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="sf-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-sf-muted">فواتير متأخرة</p>
              <p className="text-2xl font-semibold mt-1">{overdue.length}</p>
            </div>
            <AlertTriangle className={overdue.length ? 'text-sf-danger' : 'text-sf-muted'} aria-hidden="true" />
          </div>
          <p className="text-sm text-sf-muted mt-3">متبقي <bdi dir="ltr" className="sf-number">{formatMoney(overdueAmount, 'SDG', settings)}</bdi></p>
          {overdue[0] ? (
            <button type="button" onClick={() => onViewInvoice(overdue[0])} className="sf-secondary w-full mt-4 inline-flex items-center justify-center gap-2">
              <Eye aria-hidden="true" />
              <span>فتح الأقدم</span>
            </button>
          ) : <p className="text-xs text-sf-success mt-4">لا توجد متأخرات حالياً.</p>}
        </article>

        <article className="sf-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-sf-muted">بانتظار التحصيل</p>
              <p className="text-2xl font-semibold mt-1">{openInvoices.length}</p>
            </div>
            <CreditCard className={openInvoices.length ? 'text-sf-warning' : 'text-sf-muted'} aria-hidden="true" />
          </div>
          <p className="text-sm text-sf-muted mt-3">فواتير صادرة ما زال عليها رصيد.</p>
          <button type="button" onClick={() => onNavigate('invoices')} className="sf-secondary w-full mt-4">إدارة التحصيل</button>
        </article>

        <article className="sf-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-sf-muted">مخزون منخفض</p>
              <p className="text-2xl font-semibold mt-1">{lowStock.length}</p>
            </div>
            <Boxes className={lowStock.length ? 'text-sf-warning' : 'text-sf-muted'} aria-hidden="true" />
          </div>
          <p className="text-sm text-sf-muted mt-3">{lowStock[0]?.name || 'لا توجد أصناف تحت حد التنبيه.'}</p>
          <button type="button" onClick={() => onNavigate('products')} className="sf-secondary w-full mt-4">فتح المخزون</button>
        </article>

        <article className="sf-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-sf-muted">حالة المزامنة</p>
              <p className="text-lg font-semibold mt-1">{syncHealthy ? 'مستقرة' : 'تحتاج مراجعة'}</p>
            </div>
            {syncHealthy ? <Cloud className="text-sf-success" aria-hidden="true" /> : <CloudOff className="text-sf-danger" aria-hidden="true" />}
          </div>
          <p className="text-sm text-sf-muted mt-3 line-clamp-2">{syncError || (syncStatus === 'syncing' ? 'جاري تحديث البيانات السحابية.' : 'لا توجد أخطاء مزامنة معلنة.')}</p>
        </article>
      </div>
    </section>
  );
};
