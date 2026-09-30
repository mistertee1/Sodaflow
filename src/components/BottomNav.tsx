import React from 'react';
import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  Receipt,
  BookOpen,
  Settings,
} from 'lucide-react';

export type TabType = 'dashboard' | 'invoices' | 'customers' | 'products' | 'expenses' | 'accounting' | 'settings';

interface BottomNavProps {
  activeTab: TabType | string;
  onSelectTab?: (tab: TabType) => void;
  onChangeTab?: (tab: any) => void;
  onOpenNewInvoice?: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab, onChangeTab }) => {
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
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0c0c0f]/95 border-t border-[#1e1e24] py-2 px-2 sm:px-6 shadow-2xl backdrop-blur-md">
      <div className="max-w-6xl mx-auto flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => handleSelect(tab.id)}
              className={`flex flex-col items-center gap-1 px-2.5 sm:px-4 py-1.5 rounded-xl transition-all text-xs ${
                isActive
                  ? 'text-emerald-400 bg-emerald-950/70 border border-emerald-700/50 font-black shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-[#16161f] border border-transparent font-medium'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span className="text-[11px] whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
