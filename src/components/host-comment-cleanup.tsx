// Removes what the hosting platform writes into <head>, before React hydrates.
//
// Netlify inserts a comment into every HTML response, right after
// <meta charset>, preceded by a line break:
//
//   <meta charSet="utf-8"/>\n<!-- This site is hosted on Netlify ... -->
//
// Inside <head> the browser keeps that line break as a text node. React
// renders no text (and no comments) in <head>, so when it hydrates it reports
// a mismatch (minified error #418) and re-renders the document from the root.
// That re-render resets <html>'s attributes to the ones React rendered, which
// wipes the `dark` / `light` class next-themes applied before first paint:
// the page flashes the other theme for a few frames on every load.
//
// Found 2026-10-07. A local production build is clean; the same build with
// Netlify's bytes injected reproduces the error; removing only the comment
// does NOT fix it -- the whitespace text node is the trigger.
//
// So both are removed: comment nodes and whitespace-only text nodes directly
// inside <head>. The app renders neither there (checked on /, /sign-in and
// /dashboard); React's own markers live in <body>.
const SCRIPT = `(function(){try{
var h=document.head,n=h&&h.firstChild,x;
while(n){x=n.nextSibling;if(n.nodeType===8||(n.nodeType===3&&!/\\S/.test(n.nodeValue)))h.removeChild(n);n=x}
}catch(e){}})()`;

/** Inline and synchronous, with the CSP nonce for the same reason as DesignFlagScript. */
export function HostCommentCleanupScript({ nonce }: { nonce: string | undefined }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
