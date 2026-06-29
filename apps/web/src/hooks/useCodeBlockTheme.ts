import { useActiveEnvironmentId } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useEnvironmentQuery } from "../state/query";
import { ensureCustomThemeRegistered } from "../lib/shikiThemeRegistry";
import { resolveDiffThemeName } from "../lib/diffRendering";
import { useClientSettings } from "./useSettings";

export interface CodeBlockThemeState {
  /** The selected VSCode theme id, or `null` when using the default pierre themes. */
  readonly activeThemeId: string | null;
  /** `editor.background` of the resolved theme, for the code-area background. */
  readonly background: string | null;
  /** `editor.foreground` of the resolved theme. */
  readonly foreground: string | null;
  /**
   * Whether the resolved theme is a light or dark theme, so consumers can drive
   * a viewer's `themeType` correctly even when the selected code theme's mode
   * differs from the app's (e.g. a dark code theme while the app is in light).
   * `null` until resolved / when no custom theme is selected.
   */
  readonly type: "light" | "dark" | null;
  /**
   * `true` once the selected theme's JSON has been fetched and registered with
   * the highlighter. Callers should keep using the default theme until this is
   * `true` to avoid referencing a theme name that isn't loaded yet.
   */
  readonly isReady: boolean;
}

const INACTIVE: CodeBlockThemeState = {
  activeThemeId: null,
  background: null,
  foreground: null,
  type: null,
  isReady: false,
};

/**
 * Resolves the user-selected VSCode theme for code blocks. The selected id is a
 * client-only setting; the resolved theme JSON is fetched from the server in
 * real time, registered with the shared Shiki highlighter, and surfaced here so
 * `ChatMarkdown` can apply both syntax colors and the code-area background.
 */
export function useCodeBlockTheme(): CodeBlockThemeState {
  const codeBlockThemeId = useClientSettings((settings) => settings.codeBlockThemeId);
  const environmentId = useActiveEnvironmentId();

  const { data } = useEnvironmentQuery(
    codeBlockThemeId && environmentId
      ? serverEnvironment.themesGetJson({ environmentId, input: { id: codeBlockThemeId } })
      : null,
  );

  if (!codeBlockThemeId) {
    return INACTIVE;
  }

  const resolved = data && data.id === codeBlockThemeId ? data : null;
  if (!resolved) {
    // Selected but not yet fetched (or failed) — caller falls back to default.
    return {
      activeThemeId: codeBlockThemeId,
      background: null,
      foreground: null,
      type: null,
      isReady: false,
    };
  }

  // Idempotent: registers the theme with the highlighter the first time its JSON
  // arrives so the synchronous `codeToHtml({ theme: id })` call can resolve it.
  ensureCustomThemeRegistered(resolved.id, resolved.theme);

  return {
    activeThemeId: codeBlockThemeId,
    background: resolved.background ?? null,
    foreground: resolved.foreground ?? null,
    type: resolved.type,
    isReady: true,
  };
}

/** Resolved `theme`/`themeType` options for an `@pierre/diffs` viewer surface. */
export interface CodeViewerTheme {
  /** Theme name to pass to `@pierre/diffs` (a registered custom theme id or a pierre theme). */
  readonly theme: string;
  /** Light/dark mode for the viewer chrome and diff overlays. */
  readonly themeType: "light" | "dark";
}

/**
 * Resolves the `theme`/`themeType` for file and diff viewers (`@pierre/diffs`)
 * from the user's selected code theme. When a custom theme is selected and ready
 * (registered with the shared highlighter), use it — including its own light/dark
 * type so a dark theme renders correctly even when the app is in light mode.
 * Otherwise fall back to the built-in pierre theme for the app's current mode.
 *
 * Mirrors how `ChatMarkdown` picks the code-block theme so file viewers, diffs,
 * and chat code blocks all honour the same setting.
 */
export function resolveCodeViewerTheme(
  codeTheme: CodeBlockThemeState,
  resolvedTheme: "light" | "dark",
): CodeViewerTheme {
  if (codeTheme.isReady && codeTheme.activeThemeId) {
    return { theme: codeTheme.activeThemeId, themeType: codeTheme.type ?? resolvedTheme };
  }
  return { theme: resolveDiffThemeName(resolvedTheme), themeType: resolvedTheme };
}
