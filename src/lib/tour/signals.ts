// What the Quick trade form tells the guided tour, so the tour never has to
// guess from timing.
//
// It used to: when the form disappeared and no page change followed within
// 1.5s, the tour assumed the form had been cancelled and went back a step.
// Creating a trade closes the form and THEN loads the trade's page, so a slow
// first load of that page sent the user back to "Log your first trade" with
// the trade already made (reproduced 2026-09-29 with a 3s page delay).

export const TRADE_CREATED_EVENT = "trading-lens:tour-trade-created";
export const QUICK_TRADE_CLOSED_EVENT = "trading-lens:tour-quick-trade-closed";

/** A trade was created; its page (`path`) is on its way, however long it takes. */
export function signalTradeCreated(path: string) {
  window.dispatchEvent(new CustomEvent(TRADE_CREATED_EVENT, { detail: { path } }));
}

/** The form was closed without creating anything. */
export function signalQuickTradeClosed() {
  window.dispatchEvent(new CustomEvent(QUICK_TRADE_CLOSED_EVENT));
}

// And one the tour sends: it is pointing somewhere new, so the phone tab
// bar's + and More sheets close. Left open, the + sheet sat over the More
// button the very next step asked the user to tap (2026-10-15).
export const TOUR_CLOSE_SHEETS_EVENT = "trading-lens:tour-close-sheets";

export function signalCloseSheets() {
  window.dispatchEvent(new CustomEvent(TOUR_CLOSE_SHEETS_EVENT));
}
