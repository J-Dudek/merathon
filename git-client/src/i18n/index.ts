import { en } from "./en";

/**
 * Traduction de l'interface. Le français du code source sert de clé : `tr("Fermer")` renvoie ce texte tel quel
 * en français, et sa traduction de `en.ts` en anglais. La langue est lue une fois au chargement : changer de langue
 * recharge la fenêtre (voir useDisplayStore), ce qui permet d'utiliser `tr` aussi dans les constantes de module.
 */

export type Language = "fr" | "en";
export const LANGUAGES: Language[] = ["fr", "en"];
/** Chaque langue est nommée dans sa propre langue, pour rester reconnaissable quelle que soit celle de l'interface. */
export const LANGUAGE_NAMES: Record<Language, string> = { fr: "Français", en: "English" };

type Params = Record<string, string | number | null | undefined>;

/** Langue de l'interface : celle choisie, le français par défaut. */
export function resolveLanguage(stored: unknown): Language {
  return stored === "en" ? "en" : "fr";
}

function storedLanguage(): unknown {
  try {
    return JSON.parse(localStorage.getItem("merathon.display") ?? "{}")?.language;
  } catch {
    return undefined; // stockage indisponible ou illisible : langue par défaut
  }
}

const systemLanguage = typeof navigator === "undefined" ? "fr" : navigator.language;

export const language: Language = resolveLanguage(storedLanguage());

/** Paramètre régional des dates et des nombres. */
export const locale: string = localeOf(language);

function localeOf(lang: Language): string {
  if (lang === "fr") return "fr-FR";
  return systemLanguage.startsWith("en") ? systemLanguage : "en-GB";
}

if (typeof document !== "undefined") document.documentElement.lang = language;

/** Typographie propre à chaque langue : espaces avant la ponctuation double, guillemets, pourcentages. */
export const COLON = language === "fr" ? " : " : ": ";
export const LIST_SEPARATOR = language === "fr" ? " ; " : "; ";
export const quoted = (text: string): string => (language === "fr" ? `« ${text} »` : `"${text}"`);
export const percent = (value: number | string): string => (language === "fr" ? `${value} %` : `${value}%`);

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function translate(lang: Language, source: string, params?: Params): string {
  return interpolate(lang === "en" ? (en[source] ?? source) : source, params);
}

export function translatePlural(lang: Language, count: number, one: string, many: string, params?: Params): string {
  const singular = lang === "en" ? count === 1 : count <= 1;
  return translate(lang, singular ? one : many, { n: count, ...params });
}

/** Texte traduit ; `{nom}` est remplacé par le paramètre du même nom. */
export function tr(source: string, params?: Params): string {
  return translate(language, source, params);
}

/** Forme singulière ou plurielle selon `count` (règle de la langue), disponible dans le texte sous `{n}`. */
export function trn(count: number, one: string, many: string, params?: Params): string {
  return translatePlural(language, count, one, many, params);
}
