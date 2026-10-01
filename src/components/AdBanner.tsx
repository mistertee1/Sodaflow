import type { FC } from 'react';

interface AdBannerProps {
  slot?: string;
  format?: 'horizontal' | 'rectangle' | 'in-feed';
  className?: string;
  label?: string;
}

// No advertising account has been configured or verified for SudaFlow.
// Keep call sites compatible without invented approvals or publisher IDs.
export const AdBanner: FC<AdBannerProps> = () => null;
