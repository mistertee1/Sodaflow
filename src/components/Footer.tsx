import React from 'react';
import { Mail } from 'lucide-react';
import { LegalTab } from './LegalModal';
import { BrandLogo } from './BrandLogo';

interface FooterProps {
  onOpenLegal: (tab: LegalTab) => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenLegal }) => {
  return (
    <footer className="mt-auto border-t border-sf-border bg-sf-canvas text-sf-muted py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Main Footer Row */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-6 border-b border-sf-border text-center md:text-right">

          {/* Brand Info */}
          <div className="space-y-1.5 max-w-sm">
            <div className="flex items-center justify-center md:justify-start gap-2.5">
              <BrandLogo size="sm" />
              <span className="font-black text-sf-text text-base tracking-tight">
                سودافلو <span className="text-sf-action font-sans text-xs">/ SudaFlow</span>
              </span>
            </div>
            <p className="text-xs text-sf-muted leading-relaxed">
              المنظومة المحاسبية المتكاملة لإصدار الفواتير المزدوجة بالجنيه والدولار وإدارة المخزون والتحصيل للشركات والمتاجر.
            </p>
          </div>

          {/* Legal & Utility Links */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium">
            <button
              type="button"
              onClick={() => onOpenLegal('privacy')}
              className="text-sf-muted hover:text-sf-action transition-colors py-1"
            >
              سياسة الخصوصية (Privacy Policy)
            </button>
            <span className="text-slate-700 hidden sm:inline">•</span>
            <button
              type="button"
              onClick={() => onOpenLegal('terms')}
              className="text-sf-muted hover:text-sf-action transition-colors py-1"
            >
              شروط الاستخدام (Terms of Service)
            </button>
            <span className="text-slate-700 hidden sm:inline">•</span>
            <button
              type="button"
              onClick={() => onOpenLegal('about')}
              className="text-sf-muted hover:text-sf-action transition-colors py-1"
            >
              من نحن (About Us)
            </button>
            <span className="text-slate-700 hidden sm:inline">•</span>
            <button
              type="button"
              onClick={() => onOpenLegal('contact')}
              className="text-sf-action hover:text-sf-action font-semibold transition-colors py-1 flex items-center gap-1"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>اتصل بنا والدعم</span>
            </button>
          </div>

        </div>

        {/* Bottom Sub-row: AdSense and Copyright note */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-sf-muted">
          <div className="flex items-center gap-2">

            <span>جميع الحقوق محفوظة © {new Date().getFullYear()} — سودافلو | SudaFlow</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-sf-muted">v3.0</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
