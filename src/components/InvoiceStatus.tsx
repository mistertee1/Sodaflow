import React from 'react';
import { Check, CircleDashed, Clock, FileText, Send, Undo2, X } from 'lucide-react';
import { getInvoiceStatusInfo } from '../lib/currency';

const statusIcons = { draft: FileText, sent: Send, partially_paid: CircleDashed, paid: Check, overdue: Clock, cancelled: X, void: Undo2 };

export const InvoiceStatus: React.FC<{ status: string }> = ({ status }) => {
  const info = getInvoiceStatusInfo(status);
  const Icon = statusIcons[status as keyof typeof statusIcons] || FileText;
  return <span className={`sf-status ${info.color} ${info.bg}`}>
    <Icon aria-hidden="true" />
    <span>{info.label}</span>
  </span>;
};
