// Google Analytics 4 (gtag.js) client helper
declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

/**
 * Tracks virtual page views for Single-Page Application (SPA) tab transitions
 */
export const trackPageView = (pagePath: string, pageTitle?: string) => {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'page_view', {
      page_path: pagePath,
      page_title: pageTitle || document.title,
      page_location: window.location.href,
    });
  }
};

/**
 * Tracks custom user interactions and business events
 */
export const trackEvent = (
  eventName: string,
  eventParams?: Record<string, string | number | boolean | undefined>
) => {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, eventParams);
  }
};
