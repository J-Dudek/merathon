import { it, expect } from "vitest";

// tauri.conf.json active `freezePrototype` : Object.prototype est gelé dans le webview.
// xterm 6 plante alors à l'import (KeyCodeUtils.toString = … sur un prototype gelé) et l'appli ne s'affiche plus.
it("xterm loads and starts with a frozen Object.prototype", async () => {
  Object.freeze(Object.prototype);
  const { Terminal } = await import("@xterm/xterm");
  const { FitAddon } = await import("@xterm/addon-fit");
  const term = new Terminal();
  term.loadAddon(new FitAddon());
  expect(term.cols).toBeGreaterThan(0);
});
