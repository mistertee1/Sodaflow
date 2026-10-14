import { OrgRole } from '../types';

export type ActionType =
  | 'approvals:read'
  | 'approvals:request'
  | 'approvals:review'
  | 'approvals:manage'
  | 'budget:read'
  | 'budget:manage'
  | 'dimensions:read'
  | 'dimensions:manage'
  | 'tax:read'
  | 'tax:manage'
  | 'equity:write'
  | 'opening:write'
  | 'opening:settle'
  | 'opening:preview'
  | 'periods:read'
  | 'periods:manage'
  | 'periods:adjust'
  | 'periods:reopen'
  | 'payables:read'
  | 'payables:write'
  | 'org:read'
  | 'org:update_settings'
  | 'org:archive'
  | 'members:view'
  | 'members:invite'
  | 'members:update_role'
  | 'members:remove'
  | 'customers:read'
  | 'customers:create'
  | 'customers:update'
  | 'customers:delete'
  | 'products:read'
  | 'products:create'
  | 'products:update'
  | 'products:stock_adjustment'
  | 'products:delete'
  | 'invoices:read'
  | 'invoices:create'
  | 'invoices:update'
  | 'invoices:void'
  | 'invoices:delete'
  | 'payments:read'
  | 'payments:create'
  | 'expenses:read'
  | 'expenses:create'
  | 'expenses:delete'
  | 'reports:view'
  | 'reports:advanced'
  | 'accounts:read'
  | 'accounts:create'
  | 'accounts:update'
  | 'journal:read'
  | 'journal:create'
  | 'audit_logs:view'
  | 'backup:export'
  | 'backup:restore';

const ROLE_PERMISSIONS: Record<OrgRole, Set<ActionType>> = {
  Owner: new Set<ActionType>([
    'approvals:read', 'approvals:request', 'approvals:review', 'approvals:manage',
    'budget:read', 'budget:manage',
    'dimensions:read', 'dimensions:manage',
    'tax:read', 'tax:manage',
    'equity:write',
    'opening:preview', 'opening:write', 'opening:settle',
    'periods:read', 'periods:manage', 'periods:adjust', 'periods:reopen',
    'payables:read', 'payables:write',
    'org:read',
    'org:update_settings',
    'org:archive',
    'members:view',
    'members:invite',
    'members:update_role',
    'members:remove',
    'customers:read',
    'customers:create',
    'customers:update',
    'customers:delete',
    'products:read',
    'products:create',
    'products:update',
    'products:stock_adjustment',
    'products:delete',
    'invoices:read',
    'invoices:create',
    'invoices:update',
    'invoices:void',
    'invoices:delete',
    'payments:read',
    'payments:create',
    'expenses:read',
    'expenses:create',
    'expenses:delete',
    'reports:view',
    'reports:advanced',
    'accounts:read',
    'accounts:create',
    'accounts:update',
    'journal:read',
    'journal:create',
    'audit_logs:view',
    'backup:export',
    'backup:restore',
  ]),
  Admin: new Set<ActionType>([
    'approvals:read', 'approvals:request', 'approvals:review',
    'budget:read', 'budget:manage',
    'dimensions:read', 'dimensions:manage',
    'periods:read',
    'payables:read', 'payables:write',
    'org:read',
    'org:update_settings',
    'members:view',
    'members:invite',
    'members:update_role',
    'members:remove',
    'customers:read',
    'customers:create',
    'customers:update',
    'customers:delete',
    'products:read',
    'products:create',
    'products:update',
    'products:stock_adjustment',
    'products:delete',
    'invoices:read',
    'invoices:create',
    'invoices:update',
    'invoices:void',
    'payments:read',
    'payments:create',
    'expenses:read',
    'expenses:create',
    'expenses:delete',
    'reports:view',
    'reports:advanced',
    'accounts:read',
    'accounts:create',
    'accounts:update',
    'journal:read',
    'journal:create',
    'audit_logs:view',
    'backup:export',
    'backup:restore',
  ]),
  Accountant: new Set<ActionType>([
    'approvals:read', 'approvals:request', 'approvals:review',
    'budget:read',
    'dimensions:read',
    'tax:read',
    'opening:preview', 'opening:settle',
    'periods:read', 'periods:manage', 'periods:adjust',
    'payables:read', 'payables:write',
    'org:read',
    'members:view',
    'customers:read',
    'customers:create',
    'customers:update',
    'products:read',
    'products:update',
    'products:stock_adjustment',
    'invoices:read',
    'invoices:create',
    'invoices:update',
    'invoices:void',
    'payments:read',
    'payments:create',
    'expenses:read',
    'expenses:create',
    'expenses:delete',
    'reports:view',
    'reports:advanced',
    'accounts:read',
    'accounts:create',
    'accounts:update',
    'journal:read',
    'journal:create',
    'audit_logs:view',
    'backup:export',
  ]),
  Sales: new Set<ActionType>([
    'approvals:request',
    'dimensions:read',
    'org:read',
    'members:view',
    'customers:read',
    'customers:create',
    'customers:update',
    'products:read',
    'invoices:read',
    'invoices:create',
    'payments:read',
    'payments:create',
    'reports:view',
    'accounts:read',
  ]),
  Cashier: new Set<ActionType>([
    'approvals:request',
    'dimensions:read',
    'org:read',
    'products:read',
    'customers:read',
    'invoices:read',
    'invoices:create',
    'payments:read',
    'payments:create',
    'accounts:read',
  ]),
  Viewer: new Set<ActionType>([
    'budget:read',
    'dimensions:read',
    'periods:read',
    'payables:read',
    'org:read',
    'members:view',
    'customers:read',
    'products:read',
    'invoices:read',
    'payments:read',
    'expenses:read',
    'reports:view',
    'accounts:read',
    'journal:read',
  ]),
};

export const hasPermission = (role: OrgRole | undefined | null, action: ActionType): boolean => {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.has(action) : false;
};

export const getRoleArabicLabel = (role: OrgRole): string => {
  switch (role) {
    case 'Owner':
      return 'المالك (Owner)';
    case 'Admin':
      return 'مدير النظام (Admin)';
    case 'Accountant':
      return 'محاسب (Accountant)';
    case 'Sales':
      return 'مبيعات (Sales)';
    case 'Cashier':
      return 'كاشير (Cashier)';
    case 'Viewer':
      return 'مشاهد فقط (Viewer)';
    default:
      return role;
  }
};

