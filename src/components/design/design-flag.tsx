// The Design V2 runtime flag.
//
// V2 is an experiment that must be reversible at any moment and must never
// reach a production user. It is gated two ways: this branch is never merged,
// and inside the running app the whole redesign hangs off one attribute on
// <html>. With the flag off, the attribute is absent and every V2 rule --
// all of which are scoped under `html[data-design="v2"]` -- fails to match, so
// the app renders exactly as V1 does.
//
// Nothing here reads or writes application state. It only sets an attribute.

/** localStorage key an older build saved the mode under; now only ever deleted. */
export const DESIGN_KEY = "tl-design";

export type DesignMode = "v1" | "v2";

// Runs before first paint, so a V2 preview never flashes V1 chrome first.
//
// Three things matter here and each one is load-bearing:
//
//  - It is synchronous and inline. An external or deferred script would run
//    after the first paint, which is the flash this exists to prevent.
//  - Everything is wrapped in try/catch. `localStorage` throws outright in
//    some privacy modes, and a redesign flag is not worth breaking the app
//    over -- any failure falls through to V1.
//  - For V1 it *removes* the attribute rather than writing "v1". That keeps
//    the V1 DOM byte-identical to the default branch, so the flag mechanism
//    itself cannot show up as a diff when comparing the two.
//
// The choice is NOT remembered. It used to be saved to localStorage, and once
// the dev-only toggle button was deleted (71f3972) a browser that had ever
// opened V2 stayed warm-brown with no way back -- the same dev server looked
// different in Chrome and in VS Code's browser. So `?design=v2` now previews
// V2 for that page load only, and any value an older build saved is deleted.
const SCRIPT = `(function(){try{
var d=document.documentElement;
try{localStorage.removeItem(${JSON.stringify(DESIGN_KEY)})}catch(e){}
if(/[?&]design=v2(&|$)/.test(location.search)){d.dataset.design="v2"}else{d.removeAttribute("data-design")}
}catch(e){}})()`;

/**
 * Inline pre-paint script that applies the design flag.
 *
 * `nonce` is required, not optional: src/proxy.ts sends a CSP whose
 * `script-src` is `'self' 'nonce-...' 'strict-dynamic'` with no
 * `'unsafe-inline'`. Without the nonce this script is a violation today (the
 * policy is Report-Only, so it would still run and merely file a report) and
 * would be blocked outright the moment the policy is enforced -- taking the
 * whole redesign silently offline. Typing it as required means that cannot be
 * forgotten.
 */
export function DesignFlagScript({ nonce }: { nonce: string | undefined }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
