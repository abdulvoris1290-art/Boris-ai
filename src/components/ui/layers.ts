/**
 * Stack of open overlays (modals, menus). Only the topmost layer reacts to
 * Escape / Tab, so closing a menu inside a dialog doesn't close the dialog too.
 */
const stack: symbol[] = [];

export function pushLayer(): { isTop: () => boolean; pop: () => void } {
  const id = Symbol('layer');
  stack.push(id);
  return {
    isTop: () => stack[stack.length - 1] === id,
    pop: () => {
      const i = stack.indexOf(id);
      if (i !== -1) stack.splice(i, 1);
    },
  };
}

/** True while any modal or menu is open (global shortcuts should stay quiet). */
export const hasOpenLayer = () => stack.length > 0;
