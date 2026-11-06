import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { pickFolder } from "./folderPicker";
import { useUiStore } from "../store/useUiStore";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

function setUserAgent(value: string) {
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });
}

describe("pickFolder", () => {
  const original = navigator.userAgent;
  beforeEach(() => vi.mocked(open).mockReset());
  afterEach(() => setUserAgent(original));

  it("uses the system dialog on desktop", async () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    vi.mocked(open).mockResolvedValue("/home/me/repo");
    await expect(pickFolder()).resolves.toBe("/home/me/repo");
    expect(useUiStore.getState().folderPicker).toBeNull();
  });

  it("returns null when the system dialog is cancelled", async () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    vi.mocked(open).mockResolvedValue(null);
    await expect(pickFolder()).resolves.toBeNull();
  });

  it("uses the in-app picker on Android, never the system dialog", async () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 16)");
    const picked = pickFolder();
    expect(open).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(useUiStore.getState().folderPicker).not.toBeNull());
    useUiStore.getState().closeFolderPicker("/data/repos/app");
    await expect(picked).resolves.toBe("/data/repos/app");
    expect(useUiStore.getState().folderPicker).toBeNull();
  });
});
