import { describe, expect, it } from "vitest";
import {
  AUDIT, EVALUATED_VIEWS, ORCA_PROTOCOL_URL, RGAA_GRID_URL, declaration, declarationMarkdown, formatPercent, scoreAfter, viewsAtFullScore,
  type RgaaStatus,
} from "./accessibility";
import gridCsv from "../../../docs/accessibilite/grille-rgaa.csv?raw";

describe("declaration", () => {
  it("suit les rubriques du modèle de déclaration du RGAA", () => {
    expect(declaration().map((b) => b.heading)).toEqual([
      "Engagement", "État de conformité", "Résultats des tests", "Contenus non accessibles", "Dérogations",
      "Établissement de cette déclaration", "Retour d'information et contact", "Voies de recours",
    ]);
  });

  it("ne revendique pas de conformité sans audit complet", () => {
    const status = declaration().find((b) => b.heading === "État de conformité")!;
    expect(status.paragraphs![0]).toContain("non conforme");
  });

  it("liste chaque non-conformité connue et chaque vue évaluée", () => {
    const md = declarationMarkdown();
    for (const f of AUDIT.nonCompliant) expect(md).toContain(f.title);
    for (const v of EVALUATED_VIEWS) expect(md).toContain(v.name);
  });
});

describe("non-conformités", () => {
  const block = (findings = AUDIT.nonCompliant) => declaration(findings).find((b) => b.heading === "Contenus non accessibles")!;

  it("liste les non-conformités connues avec leurs critères RGAA et WCAG", () => {
    const finding = { title: "Champ sans étiquette", detail: "Recherche sans nom.", criterion: "1.3.1", rgaa: "11.1" };
    expect(block([finding]).list).toEqual(["Champ sans étiquette : recherche sans nom. (RGAA 11.1, WCAG 1.3.1)"]);
  });

  it("indique qu'aucune n'est connue quand la liste est vide, sans revendiquer de conformité", () => {
    expect(block([]).paragraphs![0]).toContain("Aucune non-conformité n'est connue");
    expect(declaration([]).find((b) => b.heading === "État de conformité")!.paragraphs![0]).toContain("non conforme");
  });
});

/** Ligne CSV à « ; » avec champs entre guillemets (guillemets doublés à l'intérieur), comme l'écrit le module csv de Python. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') field += line[i++];
    else if (c === '"') quoted = !quoted;
    else if (c === ";" && !quoted) {
      fields.push(field);
      field = "";
    } else field += c;
  }
  return [...fields, field];
}

/** La grille n'a pas de retour à la ligne dans ses cellules : une ligne de texte par critère. */
const parseCsv = (text: string) => text.trim().split(/\r?\n/).map(parseCsvLine);

describe("grille RGAA", () => {
  // La grille publiée (docs/accessibilite) doit concorder avec la synthèse et les non-conformités affichées dans l'application.
  const rows = parseCsv(gridCsv.replace(/^\uFEFF/, "")).slice(1);

  it("compte 106 critères et la même synthèse que l'application", () => {
    expect(rows).toHaveLength(106);
    for (const row of rows) expect(row).toHaveLength(8);
    const counts = { C: 0, NC: 0, NA: 0, NT: 0 } as Record<RgaaStatus, number>;
    for (const row of rows) counts[row[3] as RgaaStatus]++;
    expect(counts).toEqual(AUDIT.rgaaGrid);
  });

  it("reprend chaque critère non conforme dans la déclaration", () => {
    const nc = rows.filter((r: string[]) => r[3] === "NC").map((r: string[]) => r[0]).sort();
    expect(AUDIT.nonCompliant.map((f) => f.rgaa).sort()).toEqual(nc);
  });

  it("lie la grille et le protocole Orca dans la déclaration", () => {
    const md = declarationMarkdown();
    expect(md).toContain(RGAA_GRID_URL);
    expect(md).toContain(ORCA_PROTOCOL_URL);
  });
});

describe("declarationMarkdown", () => {
  it("produit un titre, des rubriques de niveau 2 et des listes", () => {
    const md = declarationMarkdown();
    expect(md.startsWith("# Déclaration d'accessibilité de Merathon\n")).toBe(true);
    expect(md.match(/^## /gm)).toHaveLength(declaration().length);
    expect(md).toContain("\n- Technologies utilisées : ");
  });
});

describe("scores", () => {
  it("calcule la moyenne et le nombre de vues à 100 % à partir des scores par vue", () => {
    expect(scoreAfter()).toBe(100);
    expect(viewsAtFullScore()).toBe(EVALUATED_VIEWS.length * 2);
  });
});

describe("formatPercent", () => {
  it("écrit les pourcentages à la française", () => {
    expect(formatPercent(87.4)).toBe("87,4 %");
    expect(formatPercent(100)).toBe("100 %");
  });
});
