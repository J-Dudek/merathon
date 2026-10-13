import { describe, expect, it } from "vitest";
import { aboutReport, osLabel, releaseUrl, REPO_URL } from "./about";

describe("releaseUrl", () => {
  it("pointe sur le tag de la version", () => {
    expect(releaseUrl("1.8.0")).toBe(`${REPO_URL}/releases/tag/v1.8.0`);
  });

  it("retombe sur la liste des releases sans version", () => {
    expect(releaseUrl("")).toBe(`${REPO_URL}/releases`);
  });
});

describe("osLabel", () => {
  it("nomme les systèmes connus et laisse les autres tels quels", () => {
    expect(osLabel("macos")).toBe("macOS");
    expect(osLabel("freebsd")).toBe("freebsd");
  });
});

describe("aboutReport", () => {
  it("résume version, système et bibliothèques", () => {
    const info = { os: "linux", arch: "x86_64", libgit2: "1.9.1", debug: false };
    expect(aboutReport("1.8.0", "2.9.5", info)).toBe("Merathon 1.8.0\nSystème : Linux x86_64\nTauri : 2.9.5\nlibgit2 : 1.9.1");
  });

  it("signale un build de développement et omet ce qui est inconnu", () => {
    expect(aboutReport("1.8.0", "", null)).toBe("Merathon 1.8.0");
    expect(aboutReport("1.8.0", "", { os: "windows", arch: "x86_64", libgit2: "1.9.1", debug: true }).split("\n")[0])
      .toBe("Merathon 1.8.0 (développement)");
  });
});
