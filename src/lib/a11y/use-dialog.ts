"use client";

import { useEffect, useRef, type RefObject } from "react";

// The four behaviours a modal owes a keyboard user, in one hook.
//
// `PaidPlanModal` already implemented all of this by hand and correctly; every
// other modal in the app (quick trade, screenshot import, the welcome modal,
// the image lightbox) implemented none of it. The result was that tabbing
// inside any of those walked focus straight out of the dialog and into the
// page behind it -- which is still scrollable, still clickable, and visually
// covered by a backdrop, so a keyboard user ends up somewhere they cannot see
// with no way back short of reloading.
//
// Extracted here rather than copied a fourth time. `PaidPlanModal` is
// deliberately left on its own copy: it is working, it also binds arrow keys
// for step navigation, and rewriting a correct implementation to prove a point
// about duplication is how working things break.
//
// The selector below matters more than it looks. The version in PaidPlanModal
// covers `a[href]`, `button` and `[tabindex]`, which is complete for a modal
// made of prose and buttons -- and misses every field in a modal made of a
// form, which is what the quick-trade dialog is. Inputs, selects and
// textareas are what get tabbed between there.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

interface UseDialogOptions {
  open: boolean;
  onClose: () => void;
  /**
   * Escape is ignored while this is false. Used by dialogs with a request in
   * flight, so a submit already running can't be abandoned out from under
   * itself -- the same guard those dialogs already apply to backdrop clicks.
   */
  closeOnEscape?: boolean;
  /**
   * Focused when the dialog opens. Without one, focus is placed on the dialog
   * container itself, which is what makes a screen reader read the dialog's
   * label rather than leaving the user's focus back on the page behind.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * @returns a ref to attach to the dialog's own element (the panel, not the
 *          backdrop) -- it bounds the focus trap.
 */
export function useDialog({
  open,
  onClose,
  closeOnEscape = true,
  initialFocusRef,
}: UseDialogOptions): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Read through refs inside the effect so changing handlers don't tear down
  // and rebuild the trap mid-interaction -- which would re-run the focus and
  // scroll-lock setup, yanking focus back to the top every render.
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  useEffect(() => {
    onCloseRef.current = onClose;
    closeOnEscapeRef.current = closeOnEscape;
  });

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (closeOnEscapeRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
        // A focusable element inside a collapsed or hidden branch still
        // matches the selector but cannot actually be focused; tabbing to it
        // silently drops focus to the body, which defeats the trap.
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

      if (focusable.length === 0) {
        // Nothing to move to, so keep focus on the dialog rather than letting
        // Tab escape to the page behind.
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Where focus was before the dialog took it, so it can be handed back on
    // close -- otherwise closing drops a keyboard user at the top of the
    // document rather than on the control they opened it with.
    const restoreTo = document.activeElement as HTMLElement | null;

    // Deferred a frame: the dialog's children mount with it, and framer-motion
    // animates them in, so the target may not be focusable on this tick.
    const focusTimer = window.setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else {
        dialogRef.current?.focus();
      }
    }, 60);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      restoreTo?.focus?.();
    };
  }, [open, initialFocusRef]);

  return dialogRef;
}
