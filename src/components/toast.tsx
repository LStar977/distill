"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Kind = "ok" | "info";
interface Toast {
  message: string;
  kind: Kind;
}

const ToastContext = createContext<(message: string, kind?: Kind) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: Kind = "ok") => {
    setToast({ message, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          role="status"
          className="anim-toast fixed left-1/2 bottom-7 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-[11px] text-[13px]"
          style={{ background: "var(--toast-bg)", color: "var(--toast-text)", boxShadow: "0 12px 32px rgba(21,21,23,.25)" }}
        >
          <svg width="14" height="14" className="block">
            <circle cx="7" cy="7" r="7" fill={toast.kind === "ok" ? "var(--positive)" : "var(--signal)"} />
            {toast.kind === "ok" && (
              <polyline points="4,7 6.3,9.3 10.2,5" fill="none" stroke="#161B22" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
