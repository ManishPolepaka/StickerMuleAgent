"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type NavPendingApi = {
  pendingHref: string | null;
  setPendingHref: (href: string | null) => void;
};

const NavPendingContext = createContext<NavPendingApi | null>(null);

export function NavPendingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // Safety: clear pending if navigation stalls
  useEffect(() => {
    if (!pendingHref) return;
    const t = window.setTimeout(() => setPendingHref(null), 8000);
    return () => window.clearTimeout(t);
  }, [pendingHref]);

  const value = useMemo(
    () => ({ pendingHref, setPendingHref }),
    [pendingHref],
  );

  return (
    <NavPendingContext.Provider value={value}>{children}</NavPendingContext.Provider>
  );
}

export function useNavPending() {
  const ctx = useContext(NavPendingContext);
  if (!ctx) {
    return {
      pendingHref: null as string | null,
      setPendingHref: (_href: string | null) => undefined,
    };
  }
  return ctx;
}

export function NavProgressBar() {
  const { pendingHref } = useNavPending();
  const [visible, setVisible] = useState(false);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    if (!pendingHref) {
      setWide(true);
      const hide = window.setTimeout(() => {
        setVisible(false);
        setWide(false);
      }, 280);
      return () => window.clearTimeout(hide);
    }
    setVisible(true);
    setWide(false);
    const expand = window.setTimeout(() => setWide(true), 40);
    return () => window.clearTimeout(expand);
  }, [pendingHref]);

  if (!visible && !pendingHref) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent"
      aria-hidden
    >
      <div
        className={`h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-400 transition-all duration-500 ease-out ${
          pendingHref ? (wide ? "w-[75%] opacity-100" : "w-[12%] opacity-100") : "w-full opacity-0"
        }`}
      />
    </div>
  );
}
