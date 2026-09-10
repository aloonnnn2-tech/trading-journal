// Proves that no Design V2 stylesheet can leak outside the scope it is meant
// for. Each sheet declares the ancestors every one of its selectors must
// carry, and a rule missing any of them fails the build.
//
//   html[data-design="v2"]   the flag. Without it, V2 leaks into V1 -- the
//                            app looks subtly wrong for everyone, with the
//                            flag off, and nothing says why.
//
//   the route marker         which routes the sheet applies to. Without it a
//                            direction turns on for every route the moment
//                            the flag flips, including pages that have had no
//                            design pass. Those render as V1 with the surface
//                            stripped off -- square corners and no shadows,
//                            but none of the compensating work -- which reads
//                            as broken rather than as redesigned. That
//                            happened once; this check is why it cannot again.
//
// The two sheets use *different* markers on purpose. That is what lets the
// retired Terminal Pro direction and the current Editorial one coexist on one
// branch without either reaching the other's routes.
//
// Neither failure is visible until someone loads a page and notices, and
// neither is catchable by eye across a growing stylesheet. Hence this check.
//
// Run: npm run check:design-v2

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Sheet {
  /** Path relative to this script. */
  file: string;
  /** Substrings every selector in the sheet must contain. */
  gates: string[];
}

const SHEETS: Sheet[] = [
  {
    // Terminal Pro. Retired, but still live on /trades so the two directions
    // can be compared side by side.
    file: "../src/styles/design-v2.css",
    gates: ['html[data-design="v2"]', ":has([data-v2-ready])"],
  },
  {
    // The refined direction: the original design with the tells removed.
    // Applies only to routes carrying the refined marker.
    file: "../src/styles/design-v2-refined.css",
    gates: ['html[data-design="v2"]', "data-v2-refined"],
  },
];

interface Offender {
  line: number;
  selector: string;
  missing: string;
}

function check(sheet: Sheet): { name: string; rules: number; offenders: Offender[] } {
  const path = fileURLToPath(new URL(sheet.file, import.meta.url));
  const name = sheet.file.split("/").pop() ?? sheet.file;
  const css = readFileSync(path, "utf8");

  // Strip comments first: they contain both prose about selectors and example
  // selectors, neither of which is a rule.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const offenders: Offender[] = [];

  // Walk the file rather than parsing it. Every selector list is the text
  // between a `}` (or start of file, or an at-rule's `{`) and the next `{`.
  // Nested at-rules (@media, @supports) are transparent: their contents are
  // still selector lists and are checked the same way. `@keyframes` bodies are
  // skipped, since `0%`/`from`/`to` are keyframe selectors, not element ones.
  let rules = 0;
  let insideKeyframes = 0;
  let depth = 0;
  let cursor = 0;

  for (const token of stripped.split(/([{}])/)) {
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

    if (/@keyframes/i.test(selector)) {
      insideKeyframes = depth + 1;
      continue;
    }
    if (insideKeyframes > 0) continue;

    // Take only the trailing selector list -- anything before the last `;`
    // belongs to the previous rule's declarations.
    const tail = selector.split(";").pop() ?? "";
    if (!tail.trim()) continue;

    // At-rule preludes (@media, @supports, @import) introduce a block whose
    // children get checked individually.
    if (tail.trim().startsWith("@")) continue;

    for (const one of tail.split(",")) {
      const sel = one.trim();
      if (!sel) continue;
      const missing = sheet.gates.filter((g) => !sel.includes(g));
      if (missing.length === 0) continue;

      offenders.push({
        line: stripped.slice(0, startOffset).split("\n").length,
        selector: sel,
        missing: missing.join(" + "),
      });
    }
    rules += 1;
  }

  return { name, rules, offenders };
}

let failed = false;

for (const sheet of SHEETS) {
  const { name, rules, offenders } = check(sheet);

  if (offenders.length > 0) {
    failed = true;
    console.error(
      `${name}: ${offenders.length} selector(s) missing a required gate.\n` +
        `Every rule in this sheet needs ${sheet.gates.join(" and ")}:\n`,
    );
    for (const o of offenders) {
      console.error(`  line ~${o.line}: [missing ${o.missing}]  ${o.selector}`);
    }
    console.error("");
  } else {
    console.log(`${name}: all ${rules} rule(s) carry ${sheet.gates.join(" + ")}.`);
  }
}

if (failed) process.exit(1);
