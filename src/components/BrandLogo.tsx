import React from 'react';
interface BrandLogoProps { size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'; showText?: boolean; subtitle?: string; className?: string; variant?: 'image' | 'vector'; onClick?: () => void; }
export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 'md', showText = false, subtitle, className = '', onClick }) => {
  const sizes = { xs: [24, 100], sm: [32, 125], md: [40, 156], lg: [56, 190], xl: [80, 245], '2xl': [112, 300] };
  const [height, width] = sizes[size], name = showText ? 'logo-bilingual' : 'symbol';
  const content = <>
    <img src={`/brand/logos/sudaflow-${name}-primary.svg`} width={showText ? width : height} height={height} alt="سودافلو | SudaFlow" className="sf-logo-light object-contain" />
    <img src={`/brand/logos/sudaflow-${name}-dark.svg`} width={showText ? width : height} height={height} alt="سودافلو | SudaFlow" className="sf-logo-dark object-contain" />
    {subtitle && <span className="text-xs text-sf-muted">{subtitle}</span>}
  </>;
  return onClick ? <button type="button" onClick={onClick} className={`inline-flex items-center gap-3 ${className}`}>{content}</button> : <span className={`inline-flex items-center gap-3 ${className}`}>{content}</span>;
};
