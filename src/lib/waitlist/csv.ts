// The waitlist as a CSV file, for the admin panel's download button.
//
// Two things a naive join(",") gets wrong, both tested in csv.test.ts:
//
//  - Quoting. A field containing a comma, a double quote or a line break has
//    to be wrapped in quotes, with inner quotes doubled (RFC 4180).
//  - Spreadsheet formula injection. Excel, Numbers and Sheets treat a cell
//    starting with = + - or @ as a formula. These addresses were typed by
//    anonymous visitors, so a crafted one could run as a formula on the admin's
//    machine the moment the file is opened. Such fields get a leading
//    apostrophe, which spreadsheets read as "this is text" and don't display.
//    Tab and carriage return are on the list too, per OWASP.

export interface WaitlistRow {
  email: string;
  source: string | null;
  created_at: string;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: string | null): string {
  let text = value ?? "";
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Header row plus one line per signup, CRLF-separated as RFC 4180 asks. */
export function waitlistToCsv(rows: readonly WaitlistRow[]): string {
  const lines = ["email,source,joined_at"];
  for (const row of rows) {
    lines.push([row.email, row.source, row.created_at].map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
