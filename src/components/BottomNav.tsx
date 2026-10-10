import React from 'react';
import { useApp } from '../context/AppContext';
import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  Receipt,
  BookOpen,
  Plus,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export type TabType = 'dashboard' | 'invoices' | 'customers' | 'products' | 'expenses' | 'accounting' | 'settings';

interface BottomNavProps {
  activeTab: TabType | string;
  onSelectTab?: (tab: TabType) => void;
  onChangeTab?: (tab: any) => void;
  onOpenNewInvoice?: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab, onChangeTab, onOpenNewInvoice }) => {
  const { isActionAllowed } = useApp();
  const handleSelect = (tabId: TabType) => {
    if (onSelectTab) onSelectTab(tabId);
    if (onChangeTab) onChangeTab(tabId);
  };

  const groups = [
    {
      label: 'نظرة عامة',
      tabs: [
        { id: 'dashboard' as TabType, label: 'لوحة التحكم', mobileLabel: 'الرئيسية', icon: LayoutDashboard },
      ],
    },
    {
      label: 'المبيعات',
      tabs: [
        { id: 'invoices' as TabType, label: 'الفواتير', mobileLabel: 'الفواتير', icon: FileText },
        { id: 'customers' as TabType, label: 'العملاء', mobileLabel: 'العملاء', icon: Users },
      ],
    },
    {
      label: 'التشغيل',
      tabs: [
        { id: 'products' as TabType, label: 'المنتجات والمخزون', mobileLabel: 'المخزون', icon: Package },
        { id: 'expenses' as TabType, label: 'المصروفات', mobileLabel: 'المصروفات', icon: Receipt },
      ],
    },
    {
      label: 'المالية',
      tabs: [
        { id: 'accounting' as TabType, label: 'المحاسبة والتقارير', mobileLabel: 'المحاسبة', icon: BookOpen },
      ],
    },
  ];

  const allowed = (tab: TabType) =>
    tab !== 'expenses' && tab !== 'accounting'
      ? true
      : isActionAllowed(tab === 'expenses' ? 'expenses:read' : 'journal:read');

  return (
    <nav className="sf-nav no-print" aria-label="التنقل الرئيسي">
      <div className="sf-nav-brand"><BrandLogo showText size="md" /></div>

      {onOpenNewInvoice && isActionAllowed('invoices:create') && (
        <button type="button" onClick={onOpenNewInvoice} className="sf-nav-primary-action">
          <Plus aria-hidden="true" />
          <span>فاتورة جديدة</span>
        </button>
      )}

      <div className="sf-nav-items">
        {groups.map(group => {
          const visibleTabs = group.tabs.filter(tab => allowed(tab.id));
          if (!visibleTabs.length) return null;
          return (
            <div className="sf-nav-group" key={group.label}>
              <p className="sf-nav-group-label">{group.label}</p>
              {visibleTabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`tab-${tab.id}`}
                    onClick={() => handleSelect(tab.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className="sf-nav-item"
                  >
                    <Icon aria-hidden="true" />
                    <span className="sf-nav-desktop-label whitespace-nowrap">{tab.label}</span>
                    <span className="sf-nav-mobile-label whitespace-nowrap">{tab.mobileLabel}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="sf-nav-caption">شغلك أوضح.<br />فواتير · تحصيل · مخزون · محاسبة</p>
    </nav>
  );
};
