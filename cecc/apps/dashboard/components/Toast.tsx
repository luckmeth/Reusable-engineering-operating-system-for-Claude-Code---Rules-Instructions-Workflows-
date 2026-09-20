'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Confirmations that outlive the component that triggered them.
 *
 * Resolving a finding removes it from the list, which unmounts the button and
 * takes its inline confirmation with it. The item disappearing is feedback of a
 * sort, but it leaves no record of what happened or whether it worked — so the
 * message is raised here instead, outside the tree that re-renders.
 */
export interface ToastMessage {
  id: number;
  ok: boolean;
  message: string;
  detail?: string;
}

const ToastContext = createContext<{ push: (t: Omit<ToastMessage, 'id'>) => void }>({ push: () => undefined });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const push = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    setToasts((current) => [...current, { ...toast, id: Date.now() + Math.random() }].slice(-4));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  useEffect(() => {
    // Failures stay until dismissed. A message explaining why something did not
    // work is exactly the one that must not disappear while being read.
    if (!toast.ok) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [toast.ok, onDismiss]);

  return (
    <div
      className={`animate-rise pointer-events-auto rounded-lg border px-3.5 py-2.5 shadow-lg backdrop-blur ${
        toast.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-sev-critical/40 bg-sev-critical/10 text-sev-critical'
      }`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 text-sm">{toast.ok ? '✓' : '✕'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug">{toast.message}</p>
          {toast.detail && <p className="mt-0.5 text-[11px] leading-relaxed opacity-80">{toast.detail}</p>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="press -mr-1 -mt-1 rounded px-1 text-sm opacity-60 hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
