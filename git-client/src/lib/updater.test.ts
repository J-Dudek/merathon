import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

const { CHANGELOG_MARKER, compareVersions, downloadLabel, releaseNoteSections } = await import("./updater");

describe("releaseNoteSections", () => {
  const body = [
    "## Merathon — Git Repository Manager v1.3.0",
    "",
    "### Nouveautés",
    "",
    "- **sidebar :** dossiers de branches ([d7d80b3](https://github.com/o/r/commit/d7d80b3aaaa))",
    "- création de pull requests (3581a22)",
    "",
    "### Corrections",
    "",
    "- voir [la doc](https://example.com) ([3940418](https://github.com/o/r/commit/3940418))",
    "",
    "### Téléchargements",
    "- **Linux** : `.deb`",
    "### Windows : avertissement SmartScreen",
  ].join("\n");

  it("keeps only changelog sections, as plain text", () => {
    expect(releaseNoteSections(body)).toEqual([
      { title: "Nouveautés", items: ["sidebar : dossiers de branches", "création de pull requests"] },
      { title: "Corrections", items: ["voir la doc"] },
    ]);
  });

  it("returns nothing for releases without changelog", () => {
    expect(releaseNoteSections("## Merathon v1.2.1\n\n### Téléchargements\n- **Linux** : `.deb`")).toEqual([]);
    expect(releaseNoteSections(undefined)).toEqual([]);
  });
});

describe("releaseNoteSections with the changelog", () => {
  const body = [
    "## Merathon — Git Repository Manager v2.4.1",
    "",
    "### Corrections",
    "",
    "- remove PR notifications once viewed (2396f22)",
    "",
    "### Téléchargements",
    "- **Linux** : `.deb`",
    "",
    CHANGELOG_MARKER,
    "## [2.4.1](https://github.com/o/r/compare/v2.4.0...v2.4.1) (2026-10-14)",
    "",
    "### Corrections",
    "",
    "- remove PR notifications once viewed (2396f22)",
    "",
    "## [2.4.0](https://github.com/o/r/compare/v2.3.0...v2.4.0) (2026-10-14)",
    "",
    "### Nouveautés",
    "",
    "- add branch menu (60fa6fe)",
    "",
    "## [2.3.0](https://github.com/o/r/compare/v2.2.0...v2.3.0) (2026-10-13)",
    "",
    "### À savoir",
    "",
    "- relance Merathon à la main",
    "",
    "## 1.0.0 (2026-10-06)",
    "",
    "### Nouveautés",
    "",
    "- première version",
  ].join("\n");

  it("lists every version published since the installed one, newest first", () => {
    expect(releaseNoteSections(body, "2.2.0")).toEqual([
      { title: "2.4.1 — Corrections", items: ["remove PR notifications once viewed"] },
      { title: "2.4.0 — Nouveautés", items: ["add branch menu"] },
      { title: "2.3.0 — À savoir", items: ["relance Merathon à la main"] },
    ]);
  });

  it("keeps plain section titles when a single version was missed", () => {
    expect(releaseNoteSections(body, "2.4.0")).toEqual([{ title: "Corrections", items: ["remove PR notifications once viewed"] }]);
  });

  it("reads changelog headings without a link", () => {
    const sections = releaseNoteSections(body, "0.9.0");
    expect(sections[sections.length - 1]).toEqual({ title: "1.0.0 — Nouveautés", items: ["première version"] });
  });

  it("falls back to the release notes", () => {
    const latestOnly = [{ title: "Corrections", items: ["remove PR notifications once viewed"] }];
    expect(releaseNoteSections(body)).toEqual(latestOnly);
    expect(releaseNoteSections(body, "2.4.1")).toEqual(latestOnly);
  });
});

describe("compareVersions", () => {
  it("compares each number", () => {
    expect(compareVersions("2.10.0", "2.9.3")).toBeGreaterThan(0);
    expect(compareVersions("2.4.1", "2.4.1")).toBe(0);
    expect(compareVersions("1.9.9", "2.0.0")).toBeLessThan(0);
  });
});

describe("downloadLabel", () => {
  it("shows a percentage when the size is known", () => {
    expect(downloadLabel(0, 0)).toBe("Téléchargement de la mise à jour…");
    expect(downloadLabel(512, 1024)).toBe("Téléchargement de la mise à jour… 50 %");
    expect(downloadLabel(2048, 1024)).toBe("Téléchargement de la mise à jour… 100 %");
  });
});
