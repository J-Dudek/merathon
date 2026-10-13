import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

const { downloadLabel, releaseNoteSections } = await import("./updater");

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

describe("downloadLabel", () => {
  it("shows a percentage when the size is known", () => {
    expect(downloadLabel(0, 0)).toBe("Téléchargement de la mise à jour…");
    expect(downloadLabel(512, 1024)).toBe("Téléchargement de la mise à jour… 50 %");
    expect(downloadLabel(2048, 1024)).toBe("Téléchargement de la mise à jour… 100 %");
  });
});
