import { useEffect, useState } from "react";
import {
  Accessibility, Bell, BookOpen, Bug, Check, Copy, ExternalLink, FolderCog, FolderGit2, Info, Keyboard, Languages, Monitor, Moon, Palette, RefreshCw, RotateCcw, Scale, ScrollText,
  SquareTerminal, Sun, Trophy, type LucideIcon,
} from "lucide-react";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "./Modal";
import { GitProfilesSection } from "./GitProfilesSection";
import { Kbd } from "./Kbd";
import { Tooltip } from "./Tooltip";
import {
  ROW_HEIGHTS, SYNC_INTERVALS, TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, ZOOM_STEPS, defaultDisplay, useDisplayStore, type Density,
  type NotificationSettings, type ThemePreference,
} from "../store/useDisplayStore";
import { useUiStore, type PreferencesSection as Section } from "../store/useUiStore";
import { hasNewRewards, useCelebrationStore } from "../store/useCelebrationStore";
import {
  MILESTONE_KINDS, kindEmojis, milestoneTier, nextMilestone, rewardLabel, type MilestoneKind, type Reward, type Tier,
} from "../lib/milestones";
import { syncOpenRepos, useSyncRunning } from "../lib/autoSync";
import { sendTestNotification } from "../lib/prNotifications";
import { checkForUpdates } from "../lib/updater";
import { errorMessage } from "../lib/actions";
import { aboutReport, osLabel, REPO_URL, releaseUrl, versionLabel } from "../lib/about";
import {
  AUDIT, EVALUATED_VIEWS, ISSUES_URL, ORCA_PROTOCOL_URL, RGAA_GRID_URL, conformity, criteria, declaration, declarationMarkdown, formatPercent, scoreAfter,
  viewsAtFullScore, type Finding,
} from "../lib/accessibility";
import { appInfo, type AppInfo } from "../ipc/commands";
import logo from "../assets/logo.webp";
import { LANGUAGE_NAMES, LANGUAGES, tr, trn, locale, percent } from "../i18n";

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: tr("Apparence"), icon: Palette },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "sync", label: tr("Synchronisation"), icon: RefreshCw },
  { id: "profiles", label: tr("Profils Git"), icon: FolderCog },
  { id: "shortcuts", label: tr("Raccourcis"), icon: Keyboard },
  { id: "activity", label: tr("Mon activité"), icon: Trophy },
  { id: "accessibility", label: tr("Accessibilité"), icon: Accessibility },
  { id: "about", label: tr("À propos"), icon: Info },
];

/** Rubriques sans réglage : pas de bouton « Réinitialiser ». */
const READ_ONLY: Section[] = ["profiles", "shortcuts", "activity", "accessibility", "about"];

/** Préférences de l'application : appliquées immédiatement et partagées entre les fenêtres. */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>(() => useUiStore.getState().preferencesSection);
  const reset = useDisplayStore((s) => s.reset);
  // « Mon activité » n'apparaît qu'après la première récompense : avant, elle gâcherait la surprise.
  const hasRewards = useCelebrationStore((s) => s.milestones.rewards.length > 0);
  const newRewards = useCelebrationStore((s) => hasNewRewards(s.milestones));
  const sections = SECTIONS.filter((s) => s.id !== "activity" || hasRewards);

  return (
    <Modal title={tr("Préférences")} onClose={onClose} width="w-[720px]">
      <div className="flex h-[460px] max-h-[64vh] text-xs text-[var(--color-text)] max-[760px]:flex-col max-[760px]:h-auto max-[760px]:max-h-none">
        <nav aria-label={tr("Rubriques des préférences")} className="w-48 shrink-0 p-2 border-r border-overlay/10 bg-shade/10 flex flex-col gap-0.5 max-[760px]:w-full max-[760px]:flex-row max-[760px]:flex-wrap max-[760px]:border-r-0 max-[760px]:border-b">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                section === id
                  ? "bg-[var(--color-accent)]/15 text-[var(--color-text)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/5"
              }`}
            >
              <Icon size={15} strokeWidth={1.75} className={section === id ? "text-[var(--color-accent-text)]" : ""} />
              {label}
              {id === "activity" && newRewards && (
                <>
                  <span className="ml-auto h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden />
                  <span className="sr-only">{tr(", nouvelles récompenses")}</span>
                </>
              )}
            </button>
          ))}
          <p className="mt-auto px-2.5 pb-1 text-[10px] leading-relaxed text-[var(--color-muted)]">
            {tr("Les modifications sont appliquées immédiatement à toutes les fenêtres.")}
          </p>
        </nav>

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Zone défilante atteignable au clavier, même dans les rubriques sans champ (raccourcis, à propos). */}
          <div
            tabIndex={0}
            role="region"
            aria-label={sections.find((s) => s.id === section)?.label}
            className="flex-1 overflow-y-auto px-6 py-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]/60"
          >
            {section === "appearance" && <AppearanceSection />}
            {section === "terminal" && <TerminalSection />}
            {section === "sync" && <SyncSection />}
            {section === "profiles" && <GitProfilesSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "activity" && <ActivitySection />}
            {section === "accessibility" && <AccessibilitySection />}
            {section === "about" && <AboutSection />}
          </div>
          {!READ_ONLY.includes(section) && (
            <div className="flex justify-end px-6 py-3 border-t border-overlay/10">
              <button
                onClick={reset}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
              >
                <RotateCcw size={13} strokeWidth={1.75} />
                {tr("Réinitialiser")}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Apparence

const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: tr("Compacte") },
  { value: "normal", label: tr("Normale") },
  { value: "comfortable", label: tr("Aérée") },
];

const THEMES: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: tr("Système"), icon: Monitor },
  { value: "dark", label: tr("Sombre"), icon: Moon },
  { value: "light", label: tr("Clair"), icon: Sun },
];

function AppearanceSection() {
  const theme = useDisplayStore((s) => s.theme);
  const language = useDisplayStore((s) => s.language);
  const zoom = useDisplayStore((s) => s.zoom);
  const density = useDisplayStore((s) => s.density);
  const update = useDisplayStore((s) => s.update);
  const index = Math.max(0, ZOOM_STEPS.findIndex((z) => Math.abs(z - zoom) < 1e-6));

  return (
    <>
      <SectionTitle title={tr("Apparence")} subtitle={tr("Langue, thème, taille et densité de l'interface.")} />

      <Group title={tr("Langue")} description={tr("Changer de langue recharge la fenêtre.")}>
        <div className="grid grid-cols-2 gap-2.5">
          {LANGUAGES.map((value) => (
            <button
              key={value}
              lang={value}
              aria-pressed={language === value}
              onClick={() => update({ language: value, languageChosen: true })}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                language === value
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]/40"
                  : "border-overlay/10 hover:border-overlay/25 hover:bg-overlay/5"
              }`}
            >
              <Languages size={15} strokeWidth={1.75} className={language === value ? "text-[var(--color-accent-text)]" : "text-[var(--color-muted)]"} />
              <span className="font-medium">{LANGUAGE_NAMES[value]}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title={tr("Thème")} description={tr("« Système » suit le réglage clair / sombre du système, y compris quand il change.")}>
        <div className="grid grid-cols-3 gap-2.5">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              aria-pressed={theme === value}
              onClick={() => update({ theme: value })}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                theme === value
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]/40"
                  : "border-overlay/10 hover:border-overlay/25 hover:bg-overlay/5"
              }`}
            >
              <Icon size={15} strokeWidth={1.75} className={theme === value ? "text-[var(--color-accent-text)]" : "text-[var(--color-muted)]"} />
              <span className="font-medium">{label}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group
        title={tr("Taille de l'interface")}
        description={tr("Agrandit ou réduit tout : textes, panneaux, graphe et terminal.")}
        value={percent(Math.round(zoom * 100))}
      >
        <Slider
          label={tr("Taille de l'interface")}
          valueText={percent(Math.round(zoom * 100))}
          min={0}
          max={ZOOM_STEPS.length - 1}
          value={index}
          onChange={(i) => update({ zoom: ZOOM_STEPS[i] })}
          ticks={ZOOM_STEPS.map((z) => `${Math.round(z * 100)}`)}
          defaultIndex={ZOOM_STEPS.indexOf(defaultDisplay.zoom)}
        />
        <p className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
          <Kbd keys="Ctrl+=" />{" "}{tr("agrandir")}{" "}<span className="mx-1">·</span>
          <Kbd keys="Ctrl+-" />{" "}{tr("réduire")}{" "}<span className="mx-1">·</span>
          <Kbd keys="Ctrl+0" /> {percent(100)}
        </p>
      </Group>

      <Group title={tr("Densité du graphe")} description={tr("Hauteur des lignes de l'historique des commits.")}>
        <div className="grid grid-cols-3 gap-2.5">
          {DENSITIES.map((d) => (
            <button
              key={d.value}
              aria-pressed={density === d.value}
              onClick={() => update({ density: d.value })}
              className={`rounded-lg border p-2.5 text-left transition-colors ${
                density === d.value
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]/40"
                  : "border-overlay/10 hover:border-overlay/25 hover:bg-overlay/5"
              }`}
            >
              <DensityPreview rowHeight={ROW_HEIGHTS[d.value]} />
              <span className="mt-2 flex items-baseline justify-between">
                <span className="font-medium">{d.label}</span>
                <span className="text-[10px] text-[var(--color-muted)] font-mono">{ROW_HEIGHTS[d.value]} px</span>
              </span>
            </button>
          ))}
        </div>
      </Group>
    </>
  );
}

/** Mini graphe : trois commits espacés selon la hauteur de ligne. */
function DensityPreview({ rowHeight }: { rowHeight: number }) {
  const gap = rowHeight * 0.55;
  const ys = [10, 10 + gap, 10 + gap * 2];
  return (
    <svg viewBox="0 0 120 64" className="w-full h-14 rounded bg-shade/25" aria-hidden>
      <line x1="16" y1={ys[0]} x2="16" y2={ys[2]} stroke="var(--color-accent)" strokeWidth="2" />
      {ys.map((y, i) => (
        <g key={i}>
          <circle cx="16" cy={y} r="4" fill="var(--color-bg-primary)" stroke="var(--color-accent)" strokeWidth="2" />
          <rect x="28" y={y - 2.5} width={i === 1 ? 60 : 78} height="5" rx="2.5" fill="var(--overlay)" opacity="0.18" />
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- Terminal

function TerminalSection() {
  const fontSize = useDisplayStore((s) => s.terminalFontSize);
  const update = useDisplayStore((s) => s.update);

  return (
    <>
      <SectionTitle title="Terminal" subtitle={tr("Terminal intégré du panneau du bas.")} />
      <Group title={tr("Taille du texte")} description={tr("S'applique aussi aux terminaux déjà ouverts.")} value={`${fontSize} px`}>
        <Slider
          label={tr("Taille du texte du terminal")}
          valueText={`${fontSize} px`}
          min={TERMINAL_FONT_MIN}
          max={TERMINAL_FONT_MAX}
          value={fontSize}
          onChange={(v) => update({ terminalFontSize: v })}
          ticks={[`${TERMINAL_FONT_MIN}`, "", "", `${defaultDisplay.terminalFontSize}`, ...Array(TERMINAL_FONT_MAX - TERMINAL_FONT_MIN - 4).fill(""), `${TERMINAL_FONT_MAX}`]}
          defaultIndex={defaultDisplay.terminalFontSize - TERMINAL_FONT_MIN}
        />
      </Group>
      <Group title={tr("Aperçu")}>
        <div
          className="rounded-lg border border-overlay/10 bg-[var(--color-bg-primary)] px-3 py-2.5 overflow-hidden"
          style={{ fontFamily: "ui-monospace, 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace", fontSize, lineHeight: 1.35 }}
        >
          <div className="whitespace-nowrap">
            <span className="text-green-400">j6n@merathon</span>:<span className="text-sky-400">{tr("~/projet")}</span>$ git status
          </div>
          <div className="whitespace-nowrap text-[var(--color-text)]">{tr("Sur la branche main")}</div>
          <div className="whitespace-nowrap text-red-400">{" "}{tr("modifié :         src/App.tsx")}</div>
        </div>
      </Group>
      <p className="text-[10px] text-[var(--color-muted)] flex items-center gap-1.5">
        {tr("Dans le terminal :")}{" "}<Kbd keys="Ctrl+Maj+C" />{" "}{tr("copier")}{" "}<span className="mx-1">·</span> <Kbd keys="Ctrl+Maj+V" />{" "}{tr("coller")}
      </p>
    </>
  );
}

// ---------------------------------------------------------------- Synchronisation

function syncLabel(minutes: number): string {
  if (minutes === 0) return tr("Désactivée");
  return minutes === 60 ? "1 h" : `${minutes} min`;
}

function syncTick(minutes: number): string {
  if (minutes === 0) return "off";
  // Sans espace : les graduations sont des colonnes de largeur nulle, « 1 h » passerait sur deux lignes.
  return minutes === 60 ? "1h" : `${minutes}`;
}

function SyncSection() {
  const interval = useDisplayStore((s) => s.syncInterval);
  const update = useDisplayStore((s) => s.update);
  const syncing = useSyncRunning();
  const index = Math.max(0, SYNC_INTERVALS.indexOf(interval));

  return (
    <>
      <SectionTitle title={tr("Synchronisation")} subtitle={tr("Surveillance des dépôts ouverts dans les onglets.")} />
      <Group
        title={tr("Intervalle")}
        description={tr("Fetch de chaque dépôt ouvert et actualisation de ses PR / MR ; une notification résume les changements.")}
        value={syncLabel(interval)}
      >
        <Slider
          label={tr("Intervalle de synchronisation")}
          valueText={syncLabel(interval)}
          min={0}
          max={SYNC_INTERVALS.length - 1}
          value={index}
          onChange={(i) => update({ syncInterval: SYNC_INTERVALS[i] })}
          ticks={SYNC_INTERVALS.map(syncTick)}
          defaultIndex={SYNC_INTERVALS.indexOf(defaultDisplay.syncInterval)}
        />
      </Group>
      <button
        onClick={() => void syncOpenRepos()}
        disabled={syncing}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-overlay/10 hover:bg-overlay/10 disabled:opacity-50"
      >
        <RefreshCw size={13} strokeWidth={1.75} className={syncing ? "animate-spin" : ""} />
        {syncing ? tr("Synchronisation…") : tr("Synchroniser maintenant")}
      </button>
      <NotificationsGroup />
    </>
  );
}

const NOTIFICATION_KINDS: { key: Exclude<keyof NotificationSettings, "enabled">; label: string }[] = [
  { key: "opened", label: tr("Nouvelle PR / MR à traiter (assignée ou relecture demandée)") },
  { key: "commits", label: tr("Nouveaux commits (hors mes propres PR / MR)") },
  { key: "comments", label: tr("Nouveaux commentaires") },
  { key: "ci", label: tr("CI passée ou en échec") },
  { key: "review", label: tr("Approbation ou modifications demandées") },
  { key: "badge", label: tr("Pastille sur l'icône : nombre de PR / MR avec du nouveau, non consultées") },
];

function NotificationsGroup() {
  const settings = useDisplayStore((s) => s.notifications);
  const update = useDisplayStore((s) => s.update);
  const notify = useUiStore((s) => s.notify);
  const set = (patch: Partial<NotificationSettings>) => update({ notifications: { ...settings, ...patch } });

  async function test() {
    try {
      if (!(await sendTestNotification())) notify("error", tr("Les notifications système ne sont pas autorisées pour Merathon."));
    } catch (e) {
      notify("error", tr("Notification impossible : {error}", { error: errorMessage(e) }));
    }
  }

  return (
    <section className="mt-6">
      <Group
        title="Notifications"
        description={tr("À chaque synchronisation, l'activité de mes PR / MR (tous projets) : notification système si Merathon est en arrière-plan, simple bandeau sinon.")}
      >
        <label className="flex items-center gap-2 mb-3 font-medium">
          <input type="checkbox" className="h-4 w-4" checked={settings.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {tr("Activer les notifications")}
        </label>
        <div role="group" aria-label={tr("Notifier pour")} className={`flex flex-col gap-2.5 pl-6 ${settings.enabled ? "" : "opacity-50"}`}>
          {NOTIFICATION_KINDS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={settings[key]}
                disabled={!settings.enabled}
                onChange={(e) => set({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </Group>
      <button
        onClick={() => void test()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-overlay/10 hover:bg-overlay/10"
      >
        <Bell size={13} strokeWidth={1.75} />
        {tr("Envoyer une notification d'essai")}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------- Raccourcis

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: tr("Général"),
    items: [
      [tr("Ouvrir un dépôt"), "Ctrl+O"],
      [tr("Préférences"), "Ctrl+,"],
      [tr("Rafraîchir le dépôt"), "F5"],
      [tr("Revenir au graphe"), tr("Échap")],
    ],
  },
  {
    group: tr("Navigation au clavier"),
    items: [
      [tr("Menu contextuel de l'élément actif"), "Maj+F10"],
      [tr("Graphe : commit précédent / suivant"), "↑ / ↓"],
      [tr("Graphe : premier / dernier commit"), "Origine / Fin"],
      [tr("Barre latérale : sélectionner"), tr("Espace")],
      [tr("Barre latérale : extraire, appliquer, ouvrir"), tr("Entrée")],
      [tr("Menu : choix précédent / suivant"), "↑ / ↓"],
      [tr("Sortir du terminal intégré"), "Ctrl+Maj+J"],
    ],
  },
  {
    group: tr("Onglets et fenêtres"),
    items: [
      [tr("Nouvel onglet"), "Ctrl+T"],
      [tr("Fermer l'onglet"), "Ctrl+W"],
      [tr("Onglet suivant"), "Ctrl+Tab"],
      [tr("Onglet précédent"), "Ctrl+Maj+Tab"],
      [tr("Nouvelle fenêtre"), "Ctrl+Maj+N"],
    ],
  },
  {
    group: tr("Affichage"),
    items: [
      [tr("Agrandir l'interface"), "Ctrl+="],
      [tr("Réduire l'interface"), "Ctrl+-"],
      [tr("Taille par défaut"), "Ctrl+0"],
      [tr("Afficher / masquer le panneau du bas"), "Ctrl+J"],
    ],
  },
  {
    group: "Terminal",
    items: [
      [tr("Copier la sélection"), "Ctrl+Maj+C"],
      [tr("Coller"), "Ctrl+Maj+V"],
    ],
  },
];

function ShortcutsSection() {
  return (
    <>
      <SectionTitle title={tr("Raccourcis clavier")} subtitle={tr("Quand le terminal a le focus, les touches vont au shell, sauf Ctrl+Maj+C, Ctrl+Maj+V et Ctrl+Maj+J (sortir du terminal).")} />
      {SHORTCUTS.map(({ group, items }) => (
        <div key={group} className="mb-5">
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">{group}</h4>
          <div className="rounded-lg border border-overlay/10 divide-y divide-overlay/5">
            {items.map(([label, keys]) => (
              <div key={label} className="flex items-center justify-between px-3 py-2">
                <span>{label}</span>
                <Kbd keys={keys} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- À propos

const LINKS: { label: string; icon: LucideIcon; url: (version: string) => string }[] = [
  { label: tr("Dépôt GitHub"), icon: FolderGit2, url: () => REPO_URL },
  { label: tr("Notes de cette version"), icon: ScrollText, url: releaseUrl },
  { label: tr("Journal des modifications"), icon: BookOpen, url: () => `${REPO_URL}/blob/main/CHANGELOG.md` },
  { label: tr("Signaler un bug"), icon: Bug, url: () => `${REPO_URL}/issues/new/choose` },
  { label: tr("Licence MIT"), icon: Scale, url: () => `${REPO_URL}/blob/main/LICENSE` },
];

function AboutSection() {
  const [version, setVersion] = useState("");
  const [tauri, setTauri] = useState("");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const debugMode = useDisplayStore((s) => s.debugMode);
  const updateDisplay = useDisplayStore((s) => s.update);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Hors de Tauri (tests, aperçu navigateur) : les champs restent vides.
    getVersion().then(setVersion).catch(() => {});
    getTauriVersion().then(setTauri).catch(() => {});
    appInfo().then(setInfo).catch(() => {});
  }, []);

  async function check() {
    setChecking(true);
    try {
      await checkForUpdates(true);
    } finally {
      setChecking(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(aboutReport(version, tauri, info));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const rows: [string, string][] = [
    ["Version", version ? versionLabel(version, info) : "…"],
    [tr("Système"), info ? `${osLabel(info.os)} · ${info.arch}` : "…"],
    ["Tauri", tauri || "…"],
    ["libgit2", info?.libgit2 ?? "…"],
  ];

  return (
    <>
      <div className="mb-5 flex items-center gap-4">
        <img src={logo} alt="" className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold">
            Merathon {version && <span className="ml-1 font-mono text-xs font-normal text-[var(--color-muted)]">v{version}</span>}
          </h3>
          <p className="mt-0.5 text-[var(--color-muted)]">{tr("Git Repository Manager — client Git graphique de bureau.")}</p>
        </div>
      </div>

      <Group title={tr("Version installée")} description={tr("À joindre à un rapport de bug.")}>
        <div className="rounded-lg border border-overlay/10 divide-y divide-overlay/5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--color-muted)]">{label}</span>
              <span className="font-mono text-[11px] select-text">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={check}
            disabled={checking}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-overlay/10 hover:bg-overlay/10 disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={1.75} className={checking ? "animate-spin" : ""} />
            {checking ? tr("Vérification…") : tr("Rechercher des mises à jour")}
          </button>
          <button
            onClick={copy}
            disabled={!version}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-overlay/10 hover:bg-overlay/10 disabled:opacity-50"
          >
            {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
            {copied ? tr("Copié") : tr("Copier les informations")}
          </button>
        </div>
      </Group>

      <Group
        title={tr("Mode débug")}
        description={tr("Affiche un onglet « Logs » dans le panneau du bas d'un dépôt ouvert : commandes lancées, durées, erreurs. Les logs restent en mémoire et sont effacés à la désactivation ou à la fermeture.")}
      >
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={debugMode}
            onChange={(e) => {
              updateDisplay({ debugMode: e.target.checked });
              if (e.target.checked) useUiStore.getState().setPanel({ open: true, tab: "logs" });
            }}
          />
          {tr("Activer le mode débug")}
        </label>
      </Group>

      <Group title={tr("Liens")}>
        <div className="rounded-lg border border-overlay/10 divide-y divide-overlay/5">
          {LINKS.map(({ label, icon: Icon, url }) => (
            <button
              key={label}
              onClick={() => openUrl(url(version)).catch(() => {})}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-overlay/5"
            >
              <Icon size={14} strokeWidth={1.75} className="text-[var(--color-muted)]" />
              <span className="flex-1">{label}</span>
              <ExternalLink size={12} strokeWidth={1.75} className="text-[var(--color-muted)]" />
            </button>
          ))}
        </div>
      </Group>

      <p className="text-[10px] text-[var(--color-muted)]">{tr("© 2026 Julien Dudek — distribué sous licence MIT.")}</p>
    </>
  );
}

// ---------------------------------------------------------------- Mon activité

const KIND_LABELS: Record<MilestoneKind, string> = { commit: "Commits", branch: "Branches", pr: "PR / MR", merge: tr("Fusions") };
const KIND_UNITS: Record<MilestoneKind, string> = { commit: "commits", branch: "branches", pr: "PR / MR", merge: tr("fusions") };

/** Couleur d'un badge selon l'ampleur du palier : accent, argent, or. */
const BADGE_STYLES: Record<Tier, string> = {
  0: "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/15",
  1: "border-sky-300/70 bg-sky-300/15",
  2: "border-amber-400 bg-amber-400/20 shadow-[0_0_12px_rgb(251_191_36/0.35)]",
};

/** Anneau de focus clavier des badges (focusables pour lire leur infobulle). */
const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-elevated)]";

const rewardDate = new Intl.DateTimeFormat(locale, { dateStyle: "long" });

function ActivitySection() {
  const milestones = useCelebrationStore((s) => s.milestones);
  // Ce qui est nouveau l'est pour toute la visite : la date de dernière visite est relue à l'ouverture seulement.
  const [seenAt] = useState(() => useCelebrationStore.getState().milestones.seenAt);
  useEffect(() => () => useCelebrationStore.getState().markSeen(), []);
  const surprises = milestones.rewards.filter((r) => r.surprise);

  return (
    <>
      <SectionTitle title={tr("Mon activité")} subtitle={tr("Vos récompenses obtenues avec Merathon. Les prochaines restent une surprise.")} />

      <div className="mb-6 grid grid-cols-4 gap-2.5">
        {MILESTONE_KINDS.map((kind) => (
          <div key={kind} className="rounded-lg border border-overlay/10 bg-overlay/[0.03] px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[var(--color-muted)]">
              <span className="celebrate-emoji" aria-hidden>{kindEmojis(kind)[0]}</span>
              {KIND_LABELS[kind]}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{milestones.counts[kind]}</p>
          </div>
        ))}
      </div>

      {MILESTONE_KINDS.map((kind) => {
        const count = milestones.counts[kind];
        const next = nextMilestone(kind, count);
        const rewards = milestones.rewards.filter((r) => r.kind === kind && !r.surprise).sort((a, b) => a.count - b.count);
        return (
          <Group key={kind} title={KIND_LABELS[kind]} description={tr("Prochain palier : {next} {value}", { next, value: KIND_UNITS[kind] })} value={`${count} / ${next}`}>
            <div
              role="progressbar"
              aria-label={tr("{value} : progression vers le prochain palier", { value: KIND_LABELS[kind] })}
              aria-valuemin={0}
              aria-valuemax={next}
              aria-valuenow={count}
              aria-valuetext={tr("{count} sur {next}", { count, next })}
              className="mb-3 h-1.5 rounded-full bg-overlay/10 overflow-hidden"
            >
              <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.min(100, (count / next) * 100)}%` }} />
            </div>
            <div className="flex flex-wrap gap-2">
              {rewards.map((r) => <RewardBadge key={r.count} reward={r} isNew={r.at !== null && r.at > seenAt} />)}
              <LockedBadge />
            </div>
          </Group>
        );
      })}

      {surprises.length > 0 && (
        <Group title={tr("Surprises")} description={tr("Hors palier, un commit sur 100 en moyenne déclenche une surprise.")}>
          <div className="flex flex-wrap gap-2">
            {surprises.map((r) => <RewardBadge key={`${r.count}-${r.at}`} reward={r} isNew={r.at !== null && r.at > seenAt} />)}
          </div>
        </Group>
      )}
    </>
  );
}

/** Médaille d'une récompense obtenue ; la date et le libellé sont dans l'infobulle. */
function RewardBadge({ reward, isNew }: { reward: Reward; isNew: boolean }) {
  const tier = reward.surprise ? 0 : milestoneTier(reward.kind, reward.count);
  const date = reward.at === null ? tr("Date inconnue") : tr("Obtenu le {value}", { value: rewardDate.format(reward.at) });
  const label = `${rewardLabel(reward)}, ${date.toLowerCase()}${isNew ? ", nouveau" : ""}`;
  return (
    <Tooltip title={rewardLabel(reward)} lines={[date]}>
      {/* Focusable : au clavier aussi, l'infobulle donne la date. */}
      <div
        role="img"
        tabIndex={0}
        aria-label={label}
        className={`relative flex h-11 min-w-11 flex-col items-center justify-center rounded-full border-2 px-1.5 ${FOCUS_RING} ${
          reward.surprise ? "border-green-400/60 bg-green-400/15" : BADGE_STYLES[tier]
        }`}
      >
        <span className="celebrate-emoji text-sm leading-none">{reward.surprise ? "🍀" : kindEmojis(reward.kind)[0]}</span>
        <span className="text-[10px] font-semibold leading-tight tabular-nums">{reward.count}</span>
        {isNew && (
          <span className="absolute -top-2.5 -right-2.5 rounded-full bg-[var(--color-accent-solid)] px-1 text-[8px] font-bold uppercase leading-[14px] text-white">
            {tr("nouveau")}
          </span>
        )}
      </div>
    </Tooltip>
  );
}

/** Prochaine médaille, cachée pour garder la surprise. */
function LockedBadge() {
  return (
    <Tooltip title={tr("Prochaine récompense")} lines={[tr("Continuez pour la découvrir")]}>
      <div
        role="img"
        tabIndex={0}
        aria-label={tr("Prochaine récompense, à découvrir")}
        className={`flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-overlay/20 text-[var(--color-muted)] ${FOCUS_RING}`}
      >
        <span className="celebrate-emoji text-sm opacity-60">🔒</span>
      </div>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- Accessibilité

const auditDate = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(`${AUDIT.date}T12:00:00`));

function AccessibilitySection() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(declarationMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const { status, rate } = conformity();
  const grid = AUDIT.rgaaGrid;
  const tiles: [string, string, string][] = [
    [
      tr("Conformité RGAA"),
      rate === null ? tr("Non conforme") : formatPercent(rate),
      rate === null ? tr("{count} à vérifier avec Orca", { count: trn(grid.NT, "{n} critère", "{n} critères") }) : status,
    ],
    [tr("Critères conformes"), `${grid.C} / ${grid.C + grid.NC + grid.NT}`, tr("{NA} non applicables", { NA: grid.NA })],
    [tr("Score Lighthouse"), formatPercent(scoreAfter()), tr("{viewsAtFullScore} vues sur {value} à 100 %", { viewsAtFullScore: viewsAtFullScore(), value: EVALUATED_VIEWS.length * 2 })],
  ];

  return (
    <>
      <SectionTitle title={tr("Accessibilité")} subtitle={tr("Compte rendu de l'évaluation et déclaration d'accessibilité de Merathon.")} />

      <div className="mb-6 grid grid-cols-3 gap-2.5 max-[760px]:grid-cols-1">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border border-overlay/10 bg-overlay/[0.03] px-3 py-2.5">
            <p className="text-[var(--color-muted)]">{label}</p>
            <p className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums">{value}</p>
            <p className="text-[10px] text-[var(--color-muted)]">{hint}</p>
          </div>
        ))}
      </div>

      <Group title={tr("Méthode")} description={tr("Évaluation du {auditDate}, référence : {standard}.", { auditDate, standard: AUDIT.standard })}>
        <BulletList items={AUDIT.tools} />
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">{AUDIT.environment}</p>
      </Group>

      <Group
        title={tr("Grille d'audit RGAA")}
        description={tr("Statut et constat de chacun des 106 critères, et protocole de test avec le lecteur d'écran Orca.")}
        value={grid.NT ? tr("{NT} à tester", { NT: grid.NT }) : tr("complète")}
      >
        <div className="mb-3 grid grid-cols-4 gap-2 text-center max-[760px]:grid-cols-2">
          {([["C", tr("Conformes")], ["NC", tr("Non conformes")], ["NA", tr("Non applicables")], ["NT", tr("Non testés")]] as const).map(([key, label]) => (
            <div key={key} className="rounded-md border border-overlay/10 px-2 py-1.5">
              <p className="text-base font-semibold tabular-nums">{AUDIT.rgaaGrid[key]}</p>
              <p className="text-[10px] text-[var(--color-muted)]">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void openUrl(RGAA_GRID_URL)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-overlay/15 hover:bg-overlay/5"
          >
            <ExternalLink size={13} strokeWidth={1.75} />
            {tr("Grille RGAA")}
          </button>
          <button
            onClick={() => void openUrl(ORCA_PROTOCOL_URL)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-overlay/15 hover:bg-overlay/5"
          >
            <ExternalLink size={13} strokeWidth={1.75} />
            {tr("Protocole de test Orca")}
          </button>
        </div>
      </Group>

      <Group title={tr("Corrections apportées")} value={String(AUDIT.fixes.length)}>
        <FindingList items={AUDIT.fixes} />
      </Group>

      <Group title={tr("Non-conformités connues")} description={tr("Relevées dans le code ou par les tests manuels.")} value={String(AUDIT.nonCompliant.length)}>
        {AUDIT.nonCompliant.length ? (
          <FindingList items={AUDIT.nonCompliant} />
        ) : (
          <p className="text-[11px] text-[var(--color-muted)]">{tr("Aucune à ce jour : toutes celles relevées ont été corrigées (voir ci-dessus).")}</p>
        )}
      </Group>

      <Group title={tr("Vérifications manuelles")}>
        <BulletList items={AUDIT.manualChecks} />
      </Group>

      <Group title={tr("Non évalué")}>
        <BulletList items={AUDIT.notEvaluated} />
      </Group>

      <Group title={tr("Vues évaluées")} description={tr("Score Lighthouse de chaque vue, en thème sombre puis en thème clair.")} value={String(EVALUATED_VIEWS.length)}>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {EVALUATED_VIEWS.map((view) => (
            <li key={view.name} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate" title={view.name}>{view.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-muted)]">
                <span aria-hidden>{view.dark} · {view.light}</span>
                <span className="sr-only">{tr("{dark} % en thème sombre, {light} % en thème clair", { dark: view.dark, light: view.light })}</span>
              </span>
            </li>
          ))}
        </ul>
      </Group>

      <Group title={tr("Déclaration d'accessibilité")} description={tr("Sur le modèle de déclaration du RGAA 4.1.2.")}>
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-overlay/15 hover:bg-overlay/5"
          >
            {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
            {copied ? tr("Copiée") : tr("Copier en Markdown")}
          </button>
          <span role="status" className="sr-only">{copied ? tr("Déclaration copiée dans le presse-papiers") : ""}</span>
          <button
            onClick={() => void openUrl(ISSUES_URL)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-overlay/15 hover:bg-overlay/5"
          >
            <ExternalLink size={13} strokeWidth={1.75} />
            {tr("Signaler un problème d'accessibilité")}
          </button>
        </div>
        <article aria-label={tr("Déclaration d'accessibilité")} className="rounded-lg border border-overlay/10 bg-overlay/[0.03] px-4 py-3 leading-relaxed">
          {declaration().map((block) => (
            <section key={block.heading} className="mb-3 last:mb-0">
              <h5 className="mb-1 font-semibold">{block.heading}</h5>
              {block.paragraphs?.map((p) => <p key={p} className="mb-1 text-[11px]"><Linkified text={p} /></p>)}
              {block.list && <BulletList items={block.list} linkify />}
            </section>
          ))}
        </article>
      </Group>
    </>
  );
}

function BulletList({ items, linkify = false }: { items: string[]; linkify?: boolean }) {
  return (
    <ul className="list-disc pl-4 space-y-1 text-[11px]">
      {items.map((item) => <li key={item}>{linkify ? <Linkified text={item} /> : item}</li>)}
    </ul>
  );
}

function FindingList({ items }: { items: Finding[] }) {
  return (
    <ul className="space-y-2">
      {items.map((f) => (
        <li key={f.title} className="rounded-md border border-overlay/10 px-3 py-2">
          <p className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{f.title}</span>
            <span className="shrink-0 font-mono text-[10px] text-[var(--color-muted)]">{criteria(f)}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{f.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/** Texte dont les adresses web s'ouvrent dans le navigateur. */
function Linkified({ text }: { text: string }) {
  // Sans la ponctuation qui termine la phrase.
  const parts = text.split(/(https?:\/\/[^\s;,)]*[^\s;,).])/);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={part}
        href={part}
        onClick={(e) => {
          e.preventDefault();
          void openUrl(part);
        }}
        className="text-[var(--color-accent-text)] underline underline-offset-2 break-all"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

// ---------------------------------------------------------------- Éléments communs

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-0.5 text-[var(--color-muted)]">{subtitle}</p>
    </div>
  );
}

function Group({ title, description, value, children }: {
  title: string;
  description?: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-start justify-between gap-4">
        <div>
          <h4 className="font-semibold">{title}</h4>
          {description && <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{description}</p>}
        </div>
        {value && (
          <span className="shrink-0 px-2 py-0.5 rounded-md bg-overlay/[0.07] font-mono text-[11px] tabular-nums">{value}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** Curseur à crans, avec graduations ; le cran par défaut est souligné. */
function Slider({ label, valueText, min, max, value, onChange, ticks, defaultIndex }: {
  /** Nom annoncé par les lecteurs d'écran. */
  label: string;
  /** Valeur annoncée (« 110 % »), à la place du numéro du cran. */
  valueText: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  ticks: string[];
  defaultIndex: number;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={valueText}
        className="pref-slider w-full"
        style={{ "--fill": `${percent}%` } as React.CSSProperties}
      />
      <div className="mt-1 flex justify-between px-[7px]">
        {ticks.map((t, i) => (
          <span
            key={i}
            className={`w-0 flex justify-center text-[9px] tabular-nums ${
              i === defaultIndex ? "text-[var(--color-text)] font-semibold" : "text-[var(--color-muted)]"
            }`}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
