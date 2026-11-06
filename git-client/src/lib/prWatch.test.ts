import { describe, expect, it } from "vitest";
import { watchSettings } from "./prWatch";
import { defaultNotifications } from "../store/useDisplayStore";

describe("watchSettings", () => {
  it("ne programme rien tant que l'option n'est pas cochée, ni si les notifications sont coupées", () => {
    expect(watchSettings(defaultNotifications, 30, false)).toBeNull();
    expect(watchSettings({ ...defaultNotifications, background: true, enabled: false }, 30, false)).toBeNull();
  });

  it("transmet l'intervalle, la langue et les types d'événements choisis", () => {
    expect(watchSettings({ ...defaultNotifications, background: true, ci: false }, 60, true)).toEqual({
      minutes: 60, opened: true, commits: true, comments: true, ci: false, review: true, english: true,
    });
  });
});
