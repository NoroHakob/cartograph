"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { isTheme, THEME_STORAGE_KEY, THEMES, type Theme } from "./theme";

const CHANGE_EVENT = "cartograph-theme-change";

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode): the choice still applies for this page.
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  // "storage" keeps other open tabs in sync.
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) {
      applyTheme(readTheme());
      onChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as const);

  // React's dev-mode remount resets <html> attributes the inline script set.
  // Re-apply before paint; a no-op in production.
  useLayoutEffect(() => {
    applyTheme(readTheme());
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center rounded-md border border-border bg-surface-muted p-0.5 text-xs"
    >
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          onClick={() => setTheme(option)}
          className="rounded px-2 py-1 text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-checked:bg-surface aria-checked:text-fg aria-checked:shadow-sm"
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
