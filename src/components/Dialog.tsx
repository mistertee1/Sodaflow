import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const openDialogs: HTMLElement[] = [];
let bodyOverflowBeforeDialogs = '';
let rootWasInert = false;
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

// Manual p. 6: initial focus, contained keyboard navigation, Escape, and focus return.
export const Dialog: React.FC<{
  label: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}> = ({ label, onClose, className = '', children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    if (!openDialogs.length) {
      bodyOverflowBeforeDialogs = document.body.style.overflow;
      rootWasInert = root?.hasAttribute('inert') || false;
      root?.setAttribute('inert', '');
    }
    for (const dialog of openDialogs) { dialog.setAttribute('inert', ''); dialog.setAttribute('aria-hidden', 'true'); }
    openDialogs.push(node);
    document.body.style.overflow = 'hidden';
    const visibleControls = () => Array.from(node.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'));
    const first = node.querySelector<HTMLElement>('[autofocus], [data-autofocus]') || visibleControls().find(element => ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) || visibleControls()[0] || node;
    first.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs.at(-1) !== node) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = visibleControls(), start = controls[0], end = controls.at(-1);
      if (!start || !end) { event.preventDefault(); node.focus(); return; }
      if (event.shiftKey && (document.activeElement === start || !node.contains(document.activeElement))) {
        event.preventDefault(); end.focus();
      } else if (!event.shiftKey && (document.activeElement === end || !node.contains(document.activeElement))) {
        event.preventDefault(); start.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openDialogs.indexOf(node);
      if (index >= 0) openDialogs.splice(index, 1);
      if (!openDialogs.length) {
        document.body.style.overflow = bodyOverflowBeforeDialogs;
        if (!rootWasInert) root?.removeAttribute('inert');
      }
      const top = openDialogs.at(-1);
      if (top) { top.removeAttribute('inert'); top.removeAttribute('aria-hidden'); }
      if (previousFocus?.isConnected && (!top || top.contains(previousFocus))) previousFocus.focus({ preventScroll: true });
      else if (top) top.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`sf-dialog ${className}`}>{children}</div>, document.body);
};
