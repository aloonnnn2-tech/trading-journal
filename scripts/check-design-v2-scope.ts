// Proves requirement 6, and guards the route-readiness gate alongside it.
//
// Every rule in design-v2.css must carry BOTH ancestors:
//
//   html[data-design="v2"]      -- the flag. Without it V2 leaks into V1.
//   :has([data-v2-ready])       -- route readiness. Without it V2 turns on for
//                                  routes that have not been redesigned yet,
//                                  which renders them as V1 with the surface
//                                  stripped off: square corners and no
//                                  shadows, but none of the compensating
//                                  density work. That reads as broken, not as
//                                  redesigned.
//
// Both failures are invisible until someone loads a page and notices it looks
// subtly wrong, and neither is catchable by eye across a growing stylesheet.
// Hence this check.
//
// Run: npm run check:design-v2

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = fileURLToPath(new URL("../src/styles/design-v2.css", import.meta.url));
const GATES = ['html[data-design="v2"]', ":has([data-v2-ready])"] as const;

const css = readFileSync(FILE, "utf8");

// Strip comments first: they contain both prose about selectors and example
// selectors, neither of which is a rule.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

const offenders: { line: number; selector: string; missing: string }[] = [];

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
    const missing = GATES.filter((g) => !sel.includes(g));
    if (missing.length === 0) continue;

    const line = stripped.slice(0, startOffset).split("\n").length;
    offenders.push({ line, selector: sel, missing: missing.join(" + ") });
  }
  index += 1;
}

if (offenders.length > 0) {
  console.error(
    `design-v2.css: ${offenders.length} selector(s) missing a required gate.\n` +
      `Every V2 rule needs ${GATES.join(" and ")}:\n`,
  );
  for (const o of offenders) {
    console.error(`  line ~${o.line}: [missing ${o.missing}]  ${o.selector}`);
  }
  process.exit(1);
}

console.log(`design-v2.css: all ${index} rule(s) carry ${GATES.join(" + ")}.`);
