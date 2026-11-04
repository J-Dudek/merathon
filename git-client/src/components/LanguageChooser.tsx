import { Languages } from "lucide-react";
import { useState } from "react";
import { LANGUAGE_NAMES, LANGUAGES, type Language } from "../i18n";
import { useDisplayStore } from "../store/useDisplayStore";
import { Button, Modal } from "./Modal";

/** Textes en dur : la personne n'a pas encore choisi sa langue, ils s'affichent donc dans celle sélectionnée. */
const HINT: Record<Language, string> = {
  fr: "Vous pourrez la changer à tout moment dans les préférences.",
  en: "You can change it at any time in the preferences.",
};
const CONFIRM: Record<Language, string> = { fr: "Continuer", en: "Continue" };

/**
 * Demande la langue tant qu'elle n'a pas été choisie : à la première installation, et au premier lancement après une
 * mise à jour depuis une version sans ce choix. Fermer sans choisir garde le français.
 */
export function LanguageChooser() {
  const chosen = useDisplayStore((s) => s.languageChosen);
  const update = useDisplayStore((s) => s.update);
  const [selected, setSelected] = useState<Language>("fr");

  if (chosen) return null;

  return (
    <Modal title="Langue / Language" onClose={() => update({ language: "fr", languageChosen: true })}>
      <form
        className="p-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          update({ language: selected, languageChosen: true });
        }}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {LANGUAGES.map((value) => (
            <button
              key={value}
              type="button"
              lang={value}
              aria-pressed={selected === value}
              onClick={() => setSelected(value)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                selected === value
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]/40"
                  : "border-overlay/10 hover:border-overlay/25 hover:bg-overlay/5"
              }`}
            >
              <Languages size={15} strokeWidth={1.75} className={selected === value ? "text-[var(--color-accent-text)]" : "text-[var(--color-muted)]"} />
              <span className="text-xs font-medium">{LANGUAGE_NAMES[value]}</span>
            </button>
          ))}
        </div>
        <p lang={selected} className="text-xs text-[var(--color-muted)]">{HINT[selected]}</p>
        <div className="flex justify-end">
          <Button type="submit" variant="primary"><span lang={selected}>{CONFIRM[selected]}</span></Button>
        </div>
      </form>
    </Modal>
  );
}
