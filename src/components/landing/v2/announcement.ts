// The homepage announcement bar's state, kept free of React so it can be
// tested and embedded in the pre-paint script (Phase 2C of
// docs/design-audit.md).
//
// Dismissal is stored as the announcement's ID, not as a yes/no flag, so the
// day the bar says something new it shows again for everyone -- including
// the people who closed the old one. Listed in the cookies policy.

/** localStorage key. Listed by name on /cookies. */
export const ANNOUNCEMENT_STORAGE_KEY = "tl-announcement-dismissed";

/** Change this when the bar's message changes. */
export const ANNOUNCEMENT_ID = "paid-waitlist";

/** Is the current announcement the one this visitor closed? */
export function isAnnouncementDismissed(stored: string | null | undefined, current: string = ANNOUNCEMENT_ID): boolean {
  return typeof stored === "string" && stored === current;
}

// Runs before first paint, the same pattern as DesignFlagScript
// (src/components/design/design-flag.tsx). If the visitor already closed this
// announcement it sets data-announcement-dismissed on <html>, and a rule in
// globals.css hides the bar before it is ever drawn. Without it the bar would
// render from the server HTML, then vanish after hydration: a flash, and the
// whole page jumping up by the bar's height. Everything is in try/catch --
// localStorage throws in some privacy modes, and a banner is not worth an
// error.
export const ANNOUNCEMENT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  ANNOUNCEMENT_STORAGE_KEY,
)})===${JSON.stringify(ANNOUNCEMENT_ID)}){document.documentElement.setAttribute("data-announcement-dismissed","")}}catch(e){}})()`;
