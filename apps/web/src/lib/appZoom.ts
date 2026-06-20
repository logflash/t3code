const APP_ZOOM_PROPERTY = "--app-zoom";

function readZoomFactor(): number {
  // webFrame.getZoomFactor() (via the desktop preload) is the only reliable
  // source of the true page zoom: devicePixelRatio conflates zoom with the
  // monitor's backing scale, so a guessed baseline drifts whenever Electron
  // restores a non-100% zoom at launch. When no accurate source is available
  // (web, or a preload without the method) we report 1 so titlebar chrome keeps
  // its resting layout instead of compensating against a wrong value.
  const zoom = window.desktopBridge?.getZoomFactor?.();
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * Page zoom (Cmd +/-) scales every CSS pixel, but the macOS native traffic
 * lights are drawn by the OS at a fixed screen position that does not zoom. We
 * publish the current page zoom factor as a CSS variable (`--app-zoom`) so
 * titlebar chrome can divide its offsets by it and keep a constant *screen*
 * distance from those native controls.
 */
export function syncDocumentZoomFactorProperty(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  let mediaQuery: MediaQueryList | null = null;

  const update = () => {
    document.documentElement.style.setProperty(APP_ZOOM_PROPERTY, String(readZoomFactor()));
    // Zooming changes devicePixelRatio; a `(resolution: Xdppx)` query fires once
    // when the ratio leaves X, so re-arm against the new ratio after each update.
    mediaQuery?.removeEventListener("change", update);
    mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mediaQuery.addEventListener("change", update);
  };

  update();
  // Zoom also reflows the layout viewport, so resize is a reliable secondary cue.
  window.addEventListener("resize", update);

  return () => {
    window.removeEventListener("resize", update);
    mediaQuery?.removeEventListener("change", update);
  };
}
