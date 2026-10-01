import React from 'react';
import { useApp } from '../context/AppContext';
import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  Receipt,
  BookOpen,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export type TabType = 'dashboard' | 'invoices' | 'customers' | 'products' | 'expenses' | 'accounting' | 'settings';

interface BottomNavProps {
  activeTab: TabType | string;
  onSelectTab?: (tab: TabType) => void;
  onChangeTab?: (tab: any) => void;
  onOpenNewInvoice?: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab, onChangeTab }) => {
  const { isActionAllowed } = useApp();
  const handleSelect = (tabId: TabType) => {
    if (onSelectTab) onSelectTab(tabId);
    if (onChangeTab) onChangeTab(tabId);
  };

  const tabs = [
    { id: 'dashboard' as TabType, label: 'الرئيسية', icon: LayoutDashboard },
    { id: 'invoices' as TabType, label: 'الفواتير', icon: FileText },
    { id: 'customers' as TabType, label: 'العملاء', icon: Users },
    { id: 'products' as TabType, label: 'المخزون', icon: Package },
    { id: 'expenses' as TabType, label: 'المصروفات', icon: Receipt },
    { id: 'accounting' as TabType, label: 'المحاسبة', icon: BookOpen },
  ];

  return (
    <nav className="sf-nav no-print" aria-label="التنقل الرئيسي">
      <div className="sf-nav-brand"><BrandLogo showText size="md" /></div>
      <div className="sf-nav-items">
        {tabs.filter(tab => tab.id !== 'expenses' && tab.id !== 'accounting' || isActionAllowed(tab.id === 'expenses' ? 'expenses:read' : 'journal:read')).map((tab) => {
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
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>
      <p className="sf-nav-caption">شغلك أوضح.<br />فواتير ومخزون وتحصيل</p>
    </nav>
  );
};
