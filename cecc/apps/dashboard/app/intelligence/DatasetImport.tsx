'use client';

import { useRef, useState, useTransition } from 'react';
import { importDatasetAction } from '../actions';

/**
 * Dataset import.
 *
 * Reads the file in the browser and sends its text to a server action, rather
 * than accepting an arbitrary path from the page. A page that could name any
 * file on disk for the server to open would be a file-disclosure hole, and this
 * interface is not worth that.
 */
export function DatasetImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = (file: File): void => {
    setFileName(file.name);
    // Bounded before reading, so an oversized file never reaches memory.
    if (file.size > 8 * 1024 * 1024) {
      setResult({ ok: false, message: 'That file is larger than 8MB.' });
      return;
    }
    startTransition(async () => {
      const text = await file.text();
      setResult(await importDatasetAction(text));
    });
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        className="lift flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-surface-border bg-surface px-6 py-8 text-center"
      >
        <p className="text-[13px] text-ink-muted">Drop a dataset file here</p>
        <p className="text-[11px] text-ink-faint">One JSON object per line, each with a check id and whether it was fixed</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="press lift mt-1 rounded border border-cecc/50 bg-cecc/15 px-3 py-1.5 text-[12px] font-medium text-cecc disabled:opacity-60"
        >
          {pending ? 'Reading…' : 'Choose a file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".jsonl,.json,.txt"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {fileName && <p className="text-[11px] text-ink-faint">{fileName}</p>}
      </div>

      {result && (
        <p
          role="status"
          className={`animate-rise rounded border px-3 py-2 text-[12px] leading-relaxed ${
            result.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-sev-critical/40 bg-sev-critical/10 text-sev-critical'
          }`}
        >
          <span className="font-medium">{result.message}</span>
          {result.detail && <span className="mt-0.5 block opacity-80">{result.detail}</span>}
        </p>
      )}
    </div>
  );
}
