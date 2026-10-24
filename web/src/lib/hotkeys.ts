import { useEffect, useState } from "react";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

/** Cmd/Ctrl + `key` anywhere in the app. */
export function useModHotkey(key: string, onPress: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key) {
        e.preventDefault();
        onPress();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, onPress]);
}

const COLLAPSED_KEY = "sentinell.sidebar.collapsed";

// Per-viewer preference only; storage may be unavailable (private mode), so it is best effort.
export function useCollapsedSidebar(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const update = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };
  return [collapsed, update];
}

export function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches;
}
