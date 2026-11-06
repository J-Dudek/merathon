import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

function setUserAgent(value: string) {
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });
}

describe("Modal resize controls", () => {
  const original = navigator.userAgent;
  afterEach(() => setUserAgent(original));

  it("keeps them on desktop", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    render(<Modal title="T" onClose={() => {}} resizeKey="t">x</Modal>);
    expect(screen.getByRole("button", { name: "Agrandir" })).toBeTruthy();
  });

  it("removes them on Android", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 16)");
    render(<Modal title="T" onClose={() => {}} resizeKey="t">x</Modal>);
    expect(screen.queryByRole("button", { name: "Agrandir" })).toBeNull();
  });
});
