'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Plain / technical view.
 *
 * The single change that makes this usable by someone who does not read code.
 * Rather than dumbing the product down, both readings are kept: plain language
 * for deciding what to do, and the exact technical detail for fixing it.
 *
 * The preference is per-browser and per-person, which is what localStorage is
 * for. It is read after mount to avoid a hydration mismatch, and every read is
 * guarded — a private window can throw on access.
 */
type Mode = 'plain' | 'technical';

const ViewModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({
  mode: 'plain',
  setMode: () => undefined,
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>('plain');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('cecc:view-mode');
      if (stored === 'plain' || stored === 'technical') setModeState(stored);
    } catch {
      // Blocked storage is not a reason to fail; the default stands.
    }
  }, []);

  const setMode = (next: Mode): void => {
    setModeState(next);
    try {
      localStorage.setItem('cecc:view-mode', next);
    } catch {
      // Preference simply will not persist. The page still works.
    }
  };

  return <ViewModeContext.Provider value={{ mode, setMode }}>{children}</ViewModeContext.Provider>;
}

export const useViewMode = () => useContext(ViewModeContext);

export function ViewModeToggle() {
  const { mode, setMode } = useViewMode();

  return (
    <div className="inline-flex items-center rounded-md border border-surface-border bg-surface p-0.5" role="group" aria-label="View detail level">
      {(['plain', 'technical'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setMode(option)}
          aria-pressed={mode === option}
          title={option === 'plain' ? 'Explain everything in ordinary language' : 'Show rule ids, evidence and exact locations'}
          className={`press rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${
            mode === option ? 'bg-cecc/15 text-cecc' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {option === 'plain' ? 'Plain English' : 'Technical'}
        </button>
      ))}
    </div>
  );
}
