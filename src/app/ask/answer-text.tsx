import type { ReactNode } from "react";

// Renders the formatted text these models produce -- headings, bold, italic,
// inline code, bullet and numbered lists, and tables -- which previously
// displayed as literal asterisks and pipe characters.
//
// **Everything here builds React elements from plain strings.** Nothing is
// ever passed to dangerouslySetInnerHTML, so provider output -- which is
// untrusted text that has just been round-tripped through a third party -- has
// no path to injecting markup or script into the page. A markdown library
// would work too; this covers what these models actually emit, adds no
// dependency, and keeps the safety property obvious by construction.
//
// Anything unrecognized falls through as plain text rather than being dropped.
// Losing a line of an answer is worse than showing one with stray syntax in it.

/** Splits a line into bold / italic / code runs. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Order matters: ** before *, or bold would match as two italics.
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;

    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key} className="font-semibold text-zinc-900 dark:text-zinc-50">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

/** A `|---|---|` separator carries no content and must not render as a row. */
function isTableDivider(line: string): boolean {
  return isTableRow(line) && /^[\s|:-]+$/.test(line);
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function AnswerText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const content = paragraph.join(" ");
    blocks.push(
      <p key={`p${key++}`} className="text-sm leading-relaxed">
        {renderInline(content, `p${key}`)}
      </p>,
    );
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    const { ordered, items } = list;
    const className = `ml-5 flex flex-col gap-1 text-sm leading-relaxed ${
      ordered ? "list-decimal" : "list-disc"
    }`;
    blocks.push(
      ordered ? (
        <ol key={`l${key++}`} className={className}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, `l${key}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`l${key++}`} className={className}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, `l${key}-${i}`)}</li>
          ))}
        </ul>
      ),
    );
    list = null;
  }

  function flushAll() {
    flushParagraph();
    flushList();
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushAll();
      continue;
    }

    // Tables: gather the contiguous run of rows and render as a real table.
    if (isTableRow(trimmed)) {
      flushAll();
      const rows: string[][] = [];
      let j = i;
      while (j < lines.length && isTableRow(lines[j].trim())) {
        if (!isTableDivider(lines[j].trim())) rows.push(splitRow(lines[j]));
        j++;
      }
      i = j - 1;

      if (rows.length > 0) {
        const [header, ...body] = rows;
        blocks.push(
          // Wide tables scroll inside their own container so the page itself
          // never scrolls sideways on a phone.
          <div key={`t${key++}`} className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {header.map((cell, c) => (
                    <th
                      key={c}
                      className="border-b border-zinc-300 px-2 py-1.5 text-left font-semibold text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                    >
                      {renderInline(cell, `th${key}-${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className="border-b border-zinc-200 px-2 py-1.5 align-top dark:border-subtle"
                      >
                        {renderInline(cell, `td${key}-${r}-${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      blocks.push(
        <h3
          key={`h${key++}`}
          className="text-[13px] font-semibold uppercase tracking-[0.04em] text-zinc-900 dark:text-zinc-50"
        >
          {renderInline(heading[2], `h${key}`)}
        </h3>,
      );
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    // A plain line while a list is open continues that list item rather than
    // silently starting a paragraph inside the list.
    if (list) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }

    paragraph.push(trimmed);
  }

  flushAll();

  return <div className="flex flex-col gap-3 text-zinc-700 dark:text-zinc-300">{blocks}</div>;
}
