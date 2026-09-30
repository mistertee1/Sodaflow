import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Info, ShieldCheck } from 'lucide-react';

interface AdBannerProps {
  slot?: string;
  format?: 'horizontal' | 'rectangle' | 'in-feed';
  className?: string;
  label?: string;
}

export const AdBanner: React.FC<AdBannerProps> = ({
  slot = '7340639239',
  format = 'horizontal',
  className = '',
  label = 'إعلان تجاري مدعوم',
}) => {
  const adRef = useRef<HTMLDivElement>(null);
  const [adLoaded, setAdLoaded] = useState<boolean>(false);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const adsbygoogle = (window as any).adsbygoogle;
        if (adsbygoogle) {
          adsbygoogle.push({});
          setAdLoaded(true);
        } else {
          // If script didn't execute or blocked
          setIsBlocked(true);
        }
      }
    } catch (e) {
      console.warn('AdSense unit init error (ad blocker active or test mode):', e);
      setIsBlocked(true);
    }
  }, []);

  const getDimensionsClass = () => {
    switch (format) {
      case 'rectangle':
        return 'w-full max-w-[336px] min-h-[280px]';
      case 'in-feed':
        return 'w-full min-h-[120px]';
      case 'horizontal':
      default:
        return 'w-full min-h-[90px] sm:min-h-[100px]';
    }
  };

  return (
    <div
      ref={adRef}
      className={`relative my-4 overflow-hidden rounded-2xl border border-[#1a1a24] bg-[#09090d] p-3 text-center transition-all ${getDimensionsClass()} ${className}`}
    >
      {/* Subtle Ad Disclaimer Tag */}
      <div className="mb-2 flex items-center justify-between border-b border-[#171720] pb-1.5 text-[10px] text-slate-500">
        <div className="flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-emerald-500/60" />
          <span>{label}</span>
        </div>
        <span className="font-mono text-[9px] text-slate-600">Google AdSense</span>
      </div>

      {/* Actual Google Ad Unit */}
      <div className="flex w-full items-center justify-center overflow-hidden">
        <ins
          className="adsbygoogle"
          style={{ display: 'block', width: '100%' }}
          data-ad-client="ca-pub-7340639239387461"
          data-ad-slot={slot}
          data-ad-format={format === 'rectangle' ? 'rectangle' : 'auto'}
          data-full-width-responsive="true"
        />
      </div>

      {/* Fallback Graceful Placeholder if Ads are pending approval, test mode, or blocked */}
      {(!adLoaded || isBlocked) && (
        <div className="flex flex-col items-center justify-center py-4 px-3 text-center">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>نظام التاجر السوداني — الفوترة والمخزون السحابي</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400 max-w-md mx-auto">
            مساحة إعلانية معتمدة من Google للمساهمة في استمرار تقديم خدمات النظام المحاسبي مجاناً لكافة التجار.
          </p>
          <div className="mt-2.5 flex items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" /> موثوق ومشفّر
            </span>
            <span>•</span>
            <span>سعر الصرف المجمّد</span>
            <span>•</span>
            <span>دعم تطبيق بنكك وفوري</span>
          </div>
        </div>
      )}
    </div>
  );
};
