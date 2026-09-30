import { NAV_GROUPS, PRIMARY_LINKS, navGroupTourId, navLinkTourId } from "@/lib/nav/links";

// Where the tour points when its next stop is on another page (Alon,
// 2026-09-29: the tour used to move the user there itself, so fast they
// couldn't follow; now they click the menu, and the tour shows them where).
//
// Pure: the tour asks `isShown` for each candidate, so this can be tested
// without a DOM.

export interface NavDirections {
  /** What the spotlight goes on, or null when neither is on screen. */
  targetId: string | null;
  /** "link": the page's own menu item. "group": the dropdown holding it,
   *  which has to be opened first. "none": nothing to point at (e.g. the
   *  menu is folded away) -- the card offers "Take me there" instead. */
  kind: "link" | "group" | "none";
  /** The menu item's label, e.g. "Insights". */
  label: string;
  /** The dropdown's label when the item lives in one, e.g. "Analysis". */
  groupLabel: string | null;
}

/** The phone tab bar's More button (data-tour-id in mobile-tab-bar.tsx). */
export const MOBILE_MORE_ID = "nav-more";

export function navDirections(path: string, isShown: (targetId: string) => boolean): NavDirections {
  const primary = PRIMARY_LINKS.find((l) => l.href === path);
  const group = NAV_GROUPS.find((g) => g.links.some((l) => l.href === path));
  const label = primary?.label ?? group?.links.find((l) => l.href === path)?.label ?? path.slice(1);
  const groupLabel = group?.label ?? null;

  // The item itself first: a primary link, or a dropdown item once its menu
  // is open.
  const linkId = navLinkTourId(path);
  if (isShown(linkId)) return { targetId: linkId, kind: "link", label, groupLabel };

  if (group) {
    const groupId = navGroupTourId(group.label);
    if (isShown(groupId)) return { targetId: groupId, kind: "group", label, groupLabel };
  }

  // Phones: no top menu at all. Pages that aren't on the bottom tab bar live
  // in its More sheet (mobile-tab-bar.tsx), which opens like a dropdown.
  if (isShown(MOBILE_MORE_ID)) return { targetId: MOBILE_MORE_ID, kind: "group", label, groupLabel: "More" };
  return { targetId: null, kind: "none", label, groupLabel };
}
