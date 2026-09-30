import React, { useState } from 'react';

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showText?: boolean;
  subtitle?: string;
  className?: string;
  variant?: 'image' | 'vector';
  onClick?: () => void;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showText = false,
  subtitle,
  className = '',
  variant = 'image',
  onClick,
}) => {
  const [hasError, setHasError] = useState(false);

  const sizeMap = {
    xs: { box: 'w-6 h-6', text: 'text-sm', sub: 'text-[9px]' },
    sm: { box: 'w-8 h-8', text: 'text-base', sub: 'text-[10px]' },
    md: { box: 'w-10 h-10', text: 'text-lg', sub: 'text-xs' },
    lg: { box: 'w-14 h-14', text: 'text-xl', sub: 'text-xs' },
    xl: { box: 'w-20 h-20', text: 'text-2xl', sub: 'text-sm' },
    '2xl': { box: 'w-28 h-28', text: 'text-3xl', sub: 'text-base' },
  };

  const currentSize = sizeMap[size];

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 select-none ${onClick ? 'cursor-pointer hover:opacity-90' : ''} ${className}`}
    >
      {/* Logo Icon Mark */}
      <div
        className={`${currentSize.box} relative shrink-0 rounded-2xl overflow-hidden border border-[#c59b48]/30 bg-gradient-to-br from-[#1c2430] to-[#0f141d] p-1 shadow-md shadow-black/20 flex items-center justify-center transition-transform hover:scale-105`}
      >
        {variant === 'image' && !hasError ? (
          <img
            src="/hisabuk_logo.jpg"
            alt="شعار حسابك"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain rounded-xl"
            onError={() => setHasError(true)}
          />
        ) : (
          <svg viewBox="0 0 100 100" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="16" width="56" height="68" rx="8" stroke="#38495f" strokeWidth="6" fill="#111722" />
            <path d="M42 32L49 39L64 24" stroke="#c59b48" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18 64L38 48L52 56L76 32" stroke="#c59b48" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M76 32L62 32M76 32L76 46" stroke="#c59b48" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="30" y1="72" x2="46" y2="72" stroke="#64748b" strokeWidth="4" strokeLinecap="round"/>
            <line x1="54" y1="72" x2="68" y2="72" stroke="#64748b" strokeWidth="4" strokeLinecap="round"/>
          </svg>
        )}
      </div>

      {/* Brand Typography (Wordmark) */}
      {showText && (
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1.5">
            <span className={`font-black tracking-tight text-white ${currentSize.text} font-sans`}>
              حِسَابُك
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#c59b48]/15 border border-[#c59b48]/40 text-[#d4a34b] font-bold">
              Hisabuk
            </span>
          </div>
          {subtitle && (
            <span className={`text-slate-400 font-normal ${currentSize.sub} truncate max-w-[200px]`}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
