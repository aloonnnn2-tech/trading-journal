// Proves requirement 6: zero V2 CSS rules exist outside the
// `html[data-design="v2"]` scope.
//
// This is the guard on the whole redesign. V2 is only reversible because a
// single missing ancestor selector is the difference between an experiment and
// a global style leak into V1 -- and such a leak is invisible until someone
// loads the app with the flag off and notices the app looks subtly wrong.
// Checking it by eye across a growing stylesheet does not scale, so it is
// checked here instead.
//
// Run: npm run check:design-v2

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = fileURLToPath(new URL("../src/styles/design-v2.css", import.meta.url));
const SCOPE = 'html[data-design="v2"]';

const css = readFileSync(FILE, "utf8");

// Strip comments first: they contain both prose about selectors and example
// selectors, neither of which is a rule.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

const offenders: { line: number; selector: string }[] = [];

// Walk the file rather than parsing it. Every selector list is the text
// between a `}` (or start of file, or an at-rule's `{`) and the next `{`.
// Nested at-rules (@media, @supports) are transparent: their contents are
// still selector lists and are checked the same way. `@keyframes` bodies are
// skipped, since `0%`/`from`/`to` are keyframe selectors, not element ones.
let index = 0;
let insideKeyframes = 0;
let depth = 0;

const tokens = stripped.split(/([{}])/);
let cursor = 0;

for (const token of tokens) {
  const startOffset = cursor;
  cursor += token.length;

  if (token === "{") {
    depth += 1;
    continue;
  }
  if (token === "}") {
    depth -= 1;
    if (insideKeyframes > 0 && depth < insideKeyframes) insideKeyframes = 0;
    continue;
  }

  const selector = token.trim();
  if (!selector) continue;

  // A declaration block's contents, not a selector list.
  if (selector.includes(":") && !selector.includes("{") && /^[a-z-]+\s*:/i.test(selector)) {
    // Could still be a selector list following declarations, so fall through
    // to the per-selector check below rather than skipping outright.
  }

  if (/@keyframes/i.test(selector)) {
    insideKeyframes = depth + 1;
    continue;
  }
  if (insideKeyframes > 0) continue;

  // Take only the trailing selector list -- anything before the last `}` or
  // `;` belongs to the previous rule's declarations.
  const tail = selector.split(";").pop() ?? "";
  if (!tail.trim()) continue;

  // At-rule preludes (@media, @supports, @import) introduce a block whose
  // children get checked individually.
  if (tail.trim().startsWith("@")) continue;

  for (const one of tail.split(",")) {
    const sel = one.trim();
    if (!sel) continue;
    if (sel.includes(SCOPE)) continue;

    const line = stripped.slice(0, startOffset).split("\n").length;
    offenders.push({ line, selector: sel });
  }
  index += 1;
}

if (offenders.length > 0) {
  console.error(
    `design-v2.css: ${offenders.length} selector(s) outside the ${SCOPE} scope.\n` +
      "Every V2 rule must be scoped, or it leaks into V1:\n",
  );
  for (const o of offenders) console.error(`  line ~${o.line}: ${o.selector}`);
  process.exit(1);
}

console.log(`design-v2.css: all ${index} rule(s) scoped under ${SCOPE}.`);
