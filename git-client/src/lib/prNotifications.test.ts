import { describe, expect, it } from "vitest";
import { filterEvents, notificationText, pullRequestEvents, readNotifications, type PrEvent } from "./prNotifications";
import { defaultNotifications } from "../store/useDisplayStore";
import type { MyPullRequests, PrSummary } from "../types/forge";

const pr = (number: number, patch: Partial<PrSummary> = {}): PrSummary =>
  ({
    number, title: `MR ${number}`, projectPath: "group/app", headSha: "h1", updatedAt: "2026-01-01T00:00:00Z",
    review: "pending", ci: "pending", ...patch,
  }) as PrSummary;

const lists = (assigned: PrSummary[], authored: PrSummary[] = []): MyPullRequests => ({ assigned, authored });

describe("pullRequestEvents", () => {
  it("signale une PR à traiter apparue, pas une PR que je viens d'ouvrir", () => {
    expect(pullRequestEvents(lists([]), lists([pr(1)], [pr(2)]))).toEqual([{ pr: pr(1), kinds: ["opened"] }]);
  });

  it("détecte commits, commentaires, CI et relecture", () => {
    const before = lists([pr(1, { commentCount: 2 })]);
    const after = lists([pr(1, { commentCount: 3, headSha: "h2", ci: "failure", review: "approved", updatedAt: "2026-01-02T00:00:00Z" })]);
    expect(pullRequestEvents(before, after)[0].kinds).toEqual(["commits", "comments", "ci_failure", "approved"]);
  });

  it("ne signale pas mes propres commits", () => {
    const after = lists([], [pr(1, { headSha: "h2", ci: "success" })]);
    expect(pullRequestEvents(lists([], [pr(1)]), after)[0].kinds).toEqual(["ci_success"]);
  });

  it("ne signale pas un push de ma part sur une PR à traiter", () => {
    const after = lists([pr(1, { headSha: "h2", pushedByMe: true })]);
    expect(pullRequestEvents(lists([pr(1)]), after)).toEqual([]);
  });

  it("signale une activité quand le nombre de commentaires est inconnu et que rien d'autre n'explique le changement", () => {
    const after = lists([pr(1, { updatedAt: "2026-01-02T00:00:00Z" })]);
    expect(pullRequestEvents(lists([pr(1)]), after)[0].kinds).toEqual(["activity"]);
  });

  it("ne compte qu'une fois une PR présente dans les deux listes, et rien sans changement", () => {
    const both = lists([pr(1)], [pr(1)]);
    expect(pullRequestEvents(both, both)).toEqual([]);
  });
});

describe("filterEvents", () => {
  const events: PrEvent[] = [{ pr: pr(1), kinds: ["ci_failure", "activity"] }];

  it("applique les préférences", () => {
    expect(filterEvents(events, { ...defaultNotifications, ci: false })).toEqual([{ pr: pr(1), kinds: ["activity"] }]);
    expect(filterEvents(events, { ...defaultNotifications, ci: false, comments: false })).toEqual([]);
    expect(filterEvents(events, { ...defaultNotifications, enabled: false })).toEqual([]);
  });
});

describe("notificationText", () => {
  it("détaille une seule MR", () => {
    expect(notificationText([{ pr: pr(4), kinds: ["ci_failure", "comments"] }], "gitlab")).toEqual({
      title: "MR !4 · MR 4",
      body: "CI en échec, nouveaux commentaires — group/app",
    });
  });

  it("résume plusieurs PR, une ligne chacune", () => {
    const events = [1, 2, 3, 4, 5, 6].map((n) => ({ pr: pr(n), kinds: ["approved" as const] }));
    const { title, body } = notificationText(events, "github");
    expect(title).toBe("6 PR mises à jour");
    expect(body.split("\n")).toEqual(["#1 MR 1 : approuvée", "#2 MR 2 : approuvée", "#3 MR 3 : approuvée", "#4 MR 4 : approuvée", "… et 2 autres"]);
  });
});

describe("readNotifications", () => {
  const seenAt = (updatedAt: string) => ({ head: "h1", updatedAt, at: 0 });
  const later = "2026-01-02T00:00:00Z";
  const notified = [
    { id: 1, prs: [{ key: "a", pr: pr(1, { updatedAt: later }) }] },
    { id: 2, prs: [{ key: "a", pr: pr(1, { updatedAt: later }) }, { key: "b", pr: pr(2) }] },
  ];

  it("retire une notification quand toutes ses PR ont été consultées dans l'état notifié", () => {
    expect(readNotifications(notified, {})).toEqual([]);
    expect(readNotifications(notified, { a: seenAt("2026-01-01T00:00:00Z") })).toEqual([]);
    expect(readNotifications(notified, { a: seenAt(later) })).toEqual([1]);
    expect(readNotifications(notified, { a: seenAt(later), b: seenAt("2026-01-01T00:00:00Z") })).toEqual([1, 2]);
  });
});
