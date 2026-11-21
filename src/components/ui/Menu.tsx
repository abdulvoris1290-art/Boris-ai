import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushLayer } from './layers';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  checked?: boolean;
  separatorBefore?: boolean;
  keepOpen?: boolean;
}

interface MenuProps {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement | null> }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  header?: ReactNode;
  width?: number;
}

export function Menu({ trigger, items, align = 'end', side = 'bottom', header, width = 220 }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 0;
      let top = side === 'bottom' ? r.bottom + 6 : r.top - menuH - 6;
      if (side === 'bottom' && top + menuH > window.innerHeight - 8) top = r.top - menuH - 6;
      if (top < 8) top = 8;
      let left = align === 'end' ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, side, width]);

  useEffect(() => {
    if (!open) return;
    const layer = pushLayer();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!layer.isTop()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])];
        const idx = els.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (idx + 1) % els.length : (idx - 1 + els.length) % els.length;
        els[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus());
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      layer.pop();
    };
  }, [open]);

  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: triggerRef })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
          >
            {header}
            {items.map((item, i) => (
              <div key={i}>
                {item.separatorBefore && <div className="menu-sep" />}
                <button
                  className={`menu-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`}
                  role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  onClick={() => {
                    // Return focus to the trigger first, so a dialog opened by this item restores focus there.
                    if (!item.keepOpen) {
                      triggerRef.current?.focus();
                      setOpen(false);
                    }
                    item.onSelect?.();
                  }}
                >
                  {item.icon && <span className="menu-icon">{item.icon}</span>}
                  <span className="menu-label">{item.label}</span>
                  {item.hint && <span className="menu-hint">{item.hint}</span>}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
