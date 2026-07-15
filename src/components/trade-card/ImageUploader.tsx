"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ALLOWED_IMAGE_TYPES } from "@/lib/images/queries";
import type { ApplyCoreFields, OcrCoreField, ParseResult } from "@/lib/ocr/types";
import { FIELD_LABELS, OCR_CORE_FIELDS, AUTOFILL_CONFIDENCE } from "@/lib/ocr/types";
import { ConfidenceBadge } from "@/components/ocr/ConfidenceBadge";

interface ImageItem {
  id: string;
  signedUrl: string;
  storagePath: string;
}

function formatValue(v: unknown): string {
  return typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 8 }) : String(v);
}

export function ImageUploader({
  tradeId,
  initialImages,
  onApplyFields,
  onCountChange,
}: {
  tradeId: string;
  initialImages: ImageItem[];
  onApplyFields?: (fields: ApplyCoreFields) => void;
  onCountChange?: (count: number) => void;
}) {
  const [images, setImagesState] = useState<ImageItem[]>(initialImages);
  const setImages = (updater: (prev: ImageItem[]) => ImageItem[]) => {
    setImagesState((prev) => {
      const next = updater(prev);
      onCountChange?.(next.length);
      return next;
    });
  };
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [selected, setSelected] = useState<Set<OcrCoreField>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detectedCoreKeys = (): OcrCoreField[] =>
    result ? (OCR_CORE_FIELDS.filter((k) => result.core[k]) as OcrCoreField[]) : [];

  async function runOcr(file: File) {
    // Clear any previous scan's panel immediately — otherwise a stale result
    // (or stale checkbox selections) from an earlier image stays on screen,
    // unlabeled, while this scan is in flight or if it finds nothing.
    setResult(null);
    setSelected(new Set());
    try {
      setScanning(true);
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/ocr/parse", { method: "POST", body: formData });
      if (!res.ok) return;
      const parsed = (await res.json()) as ParseResult;
      const keys = OCR_CORE_FIELDS.filter((k) => parsed.core[k]) as OcrCoreField[];
      if (keys.length > 0 || parsed.extra.length > 0) {
        setResult(parsed);
        // Pre-select the fields confident enough to auto-fill.
        setSelected(new Set(keys.filter((k) => (parsed.core[k]?.confidence ?? 0) >= AUTOFILL_CONFIDENCE)));
      }
    } catch {
      // OCR failure is non-fatal — just don't show the panel
    } finally {
      setScanning(false);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    setError(null);

    // Detected-fields review only makes sense for one image at a time — with
    // several images in one batch there's no single sensible "apply these
    // fields" target, and running OCR per file would have each file's result
    // silently overwrite the previous one's still-unreviewed panel. Only
    // auto-scan a lone upload; a batch just uploads normally.
    const shouldScan = fileArray.length === 1;

    try {
      for (const file of fileArray) {
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
          setError("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          setError("File exceeds 5 MB limit.");
          continue;
        }

        const formData = new FormData();
        formData.append("file", file);

        // Run upload and OCR (if applicable) in parallel
        const [res] = await Promise.all([
          fetch(`/api/trades/${tradeId}/images`, { method: "POST", body: formData }),
          shouldScan ? runOcr(file) : Promise.resolve(),
        ]);

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError((body as { error?: string }).error ?? "Upload failed.");
          continue;
        }

        const newImage = (await res.json()) as { id: string; url: string; storage_path: string };
        setImages((prev) => [
          ...prev,
          { id: newImage.id, signedUrl: newImage.url, storagePath: newImage.storage_path },
        ]);
      }
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(image: ImageItem) {
    if (!confirm("Remove this image? This cannot be undone.")) return;
    setError(null);
    setDeletingId(image.id);
    try {
      const res = await fetch(`/api/trades/${tradeId}/images/${image.id}`, { method: "DELETE" });
      if (res.ok) {
        setImages((prev) => prev.filter((i) => i.id !== image.id));
      } else {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Delete failed.");
      }
    } catch {
      setError("Delete failed — check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  // Listen on window rather than a React onPaste on the drop zone: that div
  // only receives paste events while it holds DOM focus, but clicking it to
  // focus it also opens the native file picker (see onClick below), so
  // Ctrl+V would silently do nothing unless the user tabbed to it manually.
  useEffect(() => {
    function onWindowPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (items.length > 0) uploadFiles(items);
    }
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeId]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      uploadFiles(e.dataTransfer.files);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tradeId],
  );

  function toggle(key: OcrCoreField) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyFields() {
    if (!result) return;
    const payload: ApplyCoreFields = {};
    for (const key of selected) {
      const f = result.core[key];
      if (f) payload[key] = f.value;
    }
    onApplyFields?.(payload);
    setResult(null);
    setSelected(new Set());
  }

  const coreKeys = detectedCoreKeys();

  return (
    <div>
      {images.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div key={img.id} className="group relative aspect-video">
              <img
                src={img.signedUrl}
                alt="Trade chart"
                className={`h-full w-full cursor-pointer rounded-xl object-cover transition-opacity ${
                  deletingId === img.id ? "opacity-40" : ""
                }`}
                onClick={() => setLightboxUrl(img.signedUrl)}
              />
              <button
                onClick={() => handleDelete(img)}
                disabled={deletingId === img.id}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed"
                title="Remove image"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-6 text-sm text-zinc-500 outline-none transition-colors hover:border-primary hover:text-primary ${
          uploading ? "cursor-not-allowed opacity-60" : ""
        }`}
      >
        {uploading ? "Uploading..." : "Click, paste, or drag an image here"}
      </div>

      {scanning && <p className="mt-2 text-xs text-zinc-400">Reading image for trade data...</p>}

      {result && (coreKeys.length > 0 || result.extra.length > 0) && (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="mb-2 text-xs font-semibold text-primary">
            Detected from image
            {result.broker ? ` · ${result.broker}` : ""}
          </p>

          {coreKeys.length > 0 && (
            <div className="mb-3 flex flex-col gap-1">
              {coreKeys.map((key) => {
                const f = result.core[key]!;
                return (
                  <label key={key} className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="accent-primary" />
                    <span className="text-zinc-500">{FIELD_LABELS[key]}:</span>
                    <span className="font-medium">{formatValue(f.value)}</span>
                    <ConfidenceBadge confidence={f.confidence} source={f.source} />
                  </label>
                );
              })}
            </div>
          )}

          {result.extra.length > 0 && (
            <div className="mb-3 border-t border-primary/20 pt-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Also read (no field to save)</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {result.extra.map((e) => (
                  <span key={e.key} className="text-[11px] text-zinc-400">
                    {e.label}: <span className="text-zinc-300">{formatValue(e.value)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={applyFields}
              disabled={selected.size === 0}
              className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50"
            >
              Apply {selected.size > 0 ? `${selected.size} field${selected.size > 1 ? "s" : ""}` : ""} to trade
            </button>
            <button
              onClick={() => {
                setResult(null);
                setSelected(new Set());
              }}
              className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-400 hover:border-zinc-400"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-loss">{error}</p>}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && uploadFiles(e.target.files)}
      />

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Full-size chart"
            className="max-h-full max-w-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
