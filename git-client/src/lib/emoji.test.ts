import { beforeEach, describe, expect, it } from "vitest";
import { emojiToName } from "gemoji";
import { emojiQueryAt, frenchEmojis, insertEmoji, recentEmojis, rememberEmoji, searchEmojis } from "./emoji";

const emojis = (q: string, limit?: number) => searchEmojis(q, limit).map((e) => e.emoji);

describe("emojiQueryAt", () => {
  const at = (text: string) => emojiQueryAt(text, text.length);

  it("reconnaît « :mot » en début de mot", () => {
    expect(at(":tada")).toEqual({ start: 0, query: "tada" });
    expect(at("bravo :ta")).toEqual({ start: 6, query: "ta" });
    expect(at("(:fête")).toEqual({ start: 1, query: "fête" });
    expect(at("ok\n:+1")).toEqual({ start: 3, query: "+1" });
  });

  it.each(["12:30", "fix: bug", "fix:bug", "std::vector", "https://exemple", ":", ":t", ":)", ":D", ":-D", ":tada:", ":tada "])("ignore « %s »", (text) => {
    expect(at(text)).toBeNull();
  });

  it("ne lit que ce qui précède le curseur", () => {
    expect(emojiQueryAt(":tada suite", 3)).toEqual({ start: 0, query: "ta" });
    expect(emojiQueryAt(":tada suite", 11)).toBeNull();
  });
});

describe("searchEmojis", () => {
  it("met le nom exact en tête, puis les noms qui commencent par la saisie", () => {
    expect(emojis("tada")[0]).toBe("🎉");
    expect(emojis("rocket")[0]).toBe("🚀");
    expect(emojis("+1")[0]).toBe("👍");
  });

  it("comprend le français, sans casse ni accents", () => {
    expect(emojis("fusée")[0]).toBe("🚀");
    expect(emojis("COEUR")[0]).toBe("❤️");
    expect(emojis("fet")).toContain("🎉");
  });

  it("limite les résultats et ne propose rien sans correspondance", () => {
    expect(emojis("a", 8)).toHaveLength(8);
    expect(emojis("zzzzzz")).toEqual([]);
    expect(emojis("  ")).toEqual([]);
  });

  it("n'associe les mots français qu'à des emojis existants", () => {
    expect(frenchEmojis().filter((e) => !(e in emojiToName))).toEqual([]);
  });
});

describe("insertEmoji", () => {
  it("remplace la saisie et ajoute une espace si rien ne sépare du texte suivant", () => {
    expect(insertEmoji("ok :ta", 3, 6, "🎉", true)).toEqual({ text: "ok 🎉 ", caret: 6 });
    expect(insertEmoji("ok :ta fin", 3, 6, "🎉", true)).toEqual({ text: "ok 🎉 fin", caret: 5 });
  });

  it("insère au curseur sans espace, en remplaçant la sélection", () => {
    expect(insertEmoji("abc", 1, 1, "🎉")).toEqual({ text: "a🎉bc", caret: 3 });
    expect(insertEmoji("abc", 0, 3, "🎉")).toEqual({ text: "🎉", caret: 2 });
  });
});

describe("emojis récents", () => {
  beforeEach(() => localStorage.clear());

  it("propose les plus courants tant qu'aucun n'a été choisi", () => {
    expect(recentEmojis()[0].emoji).toBe("👍");
    expect(recentEmojis().length).toBeGreaterThan(8);
  });

  it("garde les choix du plus récent au plus ancien, sans doublon ni liste par défaut", () => {
    rememberEmoji("🎉");
    expect(recentEmojis().map((e) => e.emoji)).toEqual(["🎉"]);
    rememberEmoji("🚀");
    rememberEmoji("🎉");
    expect(recentEmojis().map((e) => e.emoji)).toEqual(["🎉", "🚀"]);
  });

  it("ignore un stockage illisible", () => {
    localStorage.setItem("merathon.emoji.recent", "{pas du json");
    expect(recentEmojis()[0].emoji).toBe("👍");
    localStorage.setItem("merathon.emoji.recent", JSON.stringify(["pas un emoji", 3]));
    expect(recentEmojis()[0].emoji).toBe("👍");
  });
});
