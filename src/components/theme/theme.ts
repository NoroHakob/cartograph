export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "cartograph-theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Runs inline in <head> before first paint: copies the saved choice onto
 * <html data-theme> so the colour tokens are right on the very first frame.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t!=="light"&&t!=="dark")t="system";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
