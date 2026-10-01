import React from 'react';

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showText?: boolean;
  subtitle?: string;
  className?: string;
  variant?: 'image' | 'vector';
  onClick?: () => void;
}

// The supplied SVG includes its clear space. Keep its aspect ratio and never mirror it.
// Manual p. 3: symbol >= 24px; bilingual lockup >= 200px.
export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 'md', showText = false, subtitle, className = '', onClick }) => {
  const symbolSizes = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80, '2xl': 112 };
  const lockupSizes = { xs: 200, sm: 200, md: 200, lg: 220, xl: 264, '2xl': 330 };
  const width = showText ? lockupSizes[size] : symbolSizes[size];
  const height = showText ? width * 150 / 330 : width;
  const name = showText ? 'logo-bilingual' : 'symbol';
  const content = <>
    <img src={`/brand/logos/sudaflow-${name}-primary.svg`} width={width} height={height} alt="سودافلو | SudaFlow" className="sf-logo-light sf-brand-asset" />
    <img src={`/brand/logos/sudaflow-${name}-dark.svg`} width={width} height={height} alt="سودافلو | SudaFlow" className="sf-logo-dark sf-brand-asset" />
    {subtitle && <span className="text-xs text-sf-muted">{subtitle}</span>}
  </>;
  const classes = `inline-flex items-center gap-3 shrink-0 ${className}`;
  return onClick ? <button type="button" onClick={onClick} className={classes}>{content}</button> : <span className={classes}>{content}</span>;
};
