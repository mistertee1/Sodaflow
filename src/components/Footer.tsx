import React from 'react';
import { ShieldCheck, Heart, Mail, ExternalLink, Sparkles, Store } from 'lucide-react';
import { LegalTab } from './LegalModal';
import { BrandLogo } from './BrandLogo';

interface FooterProps {
  onOpenLegal: (tab: LegalTab) => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenLegal }) => {
  return (
    <footer className="mt-auto border-t border-[#181824] bg-[#07070a] text-slate-400 py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Main Footer Row */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-6 border-b border-[#14141e] text-center md:text-right">
          
          {/* Brand Info */}
          <div className="space-y-1.5 max-w-sm">
            <div className="flex items-center justify-center md:justify-start gap-2.5">
              <BrandLogo size="sm" />
              <span className="font-black text-white text-base tracking-tight">
                حِسَابُك <span className="text-[#d4a34b] font-sans text-xs">/ Hisabuk</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              المنظومة المحاسبية المتكاملة لإصدار الفواتير المزدوجة بالجنيه والدولار وإدارة المخزون والتحصيل للشركات والمتاجر.
            </p>
          </div>

          {/* Legal & Utility Links */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium">
            <button
              type="button"
              onClick={() => onOpenLegal('privacy')}
              className="text-slate-400 hover:text-emerald-400 transition-colors py-1"
            >
              سياسة الخصوصية (Privacy Policy)
            </button>
            <span className="text-slate-700 hidden sm:inline">•</span>
            <button
              type="button"
              onClick={() => onOpenLegal('terms')}
              className="text-slate-400 hover:text-emerald-400 transition-colors py-1"
            >
              شروط الاستخدام (Terms of Service)
            </button>
            <span className="text-slate-700 hidden sm:inline">•</span>
            <button
              type="button"
              onClick={() => onOpenLegal('about')}
              className="text-slate-400 hover:text-emerald-400 transition-colors py-1"
            >
              من نحن (About Us)
            </button>
            <span className="text-slate-700 hidden sm:inline">•</span>
            <button
              type="button"
              onClick={() => onOpenLegal('contact')}
              className="text-emerald-400 hover:text-emerald-300 font-semibold transition-colors py-1 flex items-center gap-1"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>اتصل بنا والدعم</span>
            </button>
          </div>

        </div>

        {/* Bottom Sub-row: AdSense and Copyright note */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>جميع الحقوق محفوظة © {new Date().getFullYear()} — نظام التاجر السوداني</span>
          </div>

          <div className="flex items-center gap-3">
            <span>مساحة إعلانية مدارة عبر Google AdSense</span>
            <span>•</span>
            <span className="font-mono text-slate-400">v2.4 Production</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
