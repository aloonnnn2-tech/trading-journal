"use client";

import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FieldDefinition } from "@/lib/fields/types";
import type { ImportTarget } from "@/lib/trades/import";
import { TOGGLEABLE_CORE_FIELDS } from "@/lib/trades/types";

const CORE_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: "ticker", label: "Ticker" },
  { key: "status", label: "Status" },
  { key: "result", label: "Result" },
  ...TOGGLEABLE_CORE_FIELDS,
];

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

function guessMapping(header: string): ImportTarget {
  const normalized = header.trim().toLowerCase().replace(/[\s_]+/g, "");
  const match = CORE_FIELD_OPTIONS.find(
    (opt) => opt.key.replace(/_/g, "") === normalized || opt.label.toLowerCase().replace(/\s+/g, "") === normalized,
  );
  return match ? (match.key as ImportTarget) : "ignore";
}

interface ImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

export function ImportWizard({ fieldDefinitions }: { fieldDefinitions: FieldDefinition[] }) {
  const router = useRouter();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, ImportTarget>>({});
  const [jsonRows, setJsonRows] = useState<Record<string, unknown>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function reset() {
    setHeaders([]);
    setRows([]);
    setMapping({});
    setJsonRows(null);
    setResult(null);
    setParseError(null);
  }

  async function handleFile(file: File) {
    reset();
    setFileName(file.name);
    setParsing(true);
    const extension = file.name.split(".").pop()?.toLowerCase();

    try {
      if (extension === "csv") {
        const text = await file.text();
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        const detectedHeaders = parsed.meta.fields ?? [];
        setHeaders(detectedHeaders);
        setRows(parsed.data);
        setMapping(Object.fromEntries(detectedHeaders.map((h) => [h, guessMapping(h)])));
      } else if (extension === "xlsx") {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/trades/import/parse-xlsx", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error("Failed to parse Excel file");
        const data = (await res.json()) as { headers: string[]; rows: Record<string, string>[] };
        setHeaders(data.headers);
        setRows(data.rows);
        setMapping(Object.fromEntries(data.headers.map((h) => [h, guessMapping(h)])));
      } else if (extension === "json") {
        const text = await file.text();
        const parsed = JSON.parse(text);
        setJsonRows(Array.isArray(parsed) ? parsed : [parsed]);
      } else {
        setParseError("Unsupported file type. Use .csv, .xlsx, or .json.");
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to read file");
    } finally {
      setParsing(false);
    }
  }

  async function handleImportMapped() {
    setImporting(true);
    const res = await fetch("/api/trades/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, mapping }),
    });
    const data = (await res.json()) as ImportResult;
    setResult(data);
    setImporting(false);
    router.refresh();
  }

  async function handleImportJson() {
    setImporting(true);
    const res = await fetch("/api/trades/import-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: jsonRows }),
    });
    const data = (await res.json()) as ImportResult;
    setResult(data);
    setImporting(false);
    router.refresh();
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4">
        <input
          type="file"
          accept=".csv,.xlsx,.json"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="text-sm text-zinc-700 dark:text-zinc-300"
        />
        {parsing && <p className="mt-2 text-sm text-zinc-500">Parsing {fileName}...</p>}
        {parseError && <p className="mt-2 text-sm text-loss">{parseError}</p>}
      </div>

      {jsonRows && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Found {jsonRows.length} trade{jsonRows.length === 1 ? "" : "s"} in {fileName}.
          </p>
          <button
            onClick={handleImportJson}
            disabled={importing}
            className="w-fit rounded-full bg-primary px-5 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
          >
            {importing ? "Importing..." : `Import ${jsonRows.length} Trades`}
          </button>
        </div>
      )}

      {headers.length > 0 && (
        <>
          <div className="rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Map columns ({rows.length} rows detected)
            </h3>
            <div className="flex flex-col gap-2">
              {headers.map((header) => (
                <div key={header} className="flex items-center gap-3">
                  <span className="w-48 truncate text-sm text-zinc-600 dark:text-zinc-400">
                    {header}
                  </span>
                  <select
                    value={mapping[header] ?? "ignore"}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, [header]: e.target.value as ImportTarget }))
                    }
                    className={inputClass}
                  >
                    <option value="ignore">Ignore</option>
                    <optgroup label="Trade Fields">
                      {CORE_FIELD_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                    {fieldDefinitions.length > 0 && (
                      <optgroup label="Custom Fields">
                        {fieldDefinitions.map((field) => (
                          <option key={field.id} value={`custom:${field.id}`}>
                            {field.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Preview (first 5 rows)
            </h3>
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="pr-4 text-zinc-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {headers.map((h) => (
                      <td key={h} className="pr-4 text-zinc-700 dark:text-zinc-300">
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleImportMapped}
            disabled={importing}
            className="w-fit rounded-full bg-primary px-5 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
          >
            {importing ? "Importing..." : `Import ${rows.length} Trades`}
          </button>
        </>
      )}

      {result && (
        <div className="rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4">
          <p className="text-sm text-profit">Imported {result.imported} trades.</p>
          {result.errors.length > 0 && (
            <div className="mt-2">
              <p className="text-sm text-amber-400">{result.errors.length} row issue(s):</p>
              <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-zinc-500">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    {e.row > 0 ? `Row ${e.row}: ` : ""}
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}