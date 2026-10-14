import { useRepoStore } from "../store/useRepoStore";
import { useUiStore } from "../store/useUiStore";
import { useTabsStore } from "../store/useTabsStore";
import {
  AppWindow, BookOpen, CloudDownload, FolderOpen, FolderPlus, History, Info, Monitor, Moon, RefreshCw, Settings, SquarePlus, Sun, X, type LucideIcon,
} from "lucide-react";
import {
  createBranch, fetchRemote, openNewWindow, pull, push, stashApply, stashSave,
} from "../ipc/commands";
import { reportMerge, runGit } from "../lib/actions";
import { chooseAndInitRepo, chooseAndOpenRepo, openRepoAt } from "../lib/repoActions";
import { ContextMenu, useContextMenu, type MenuEntry } from "./ContextMenu";
import { SearchBar } from "./SearchBar";
import { Tooltip } from "./Tooltip";
import { checkForUpdates } from "../lib/updater";
import { syncOpenRepos, useSyncRunning } from "../lib/autoSync";
import { useThemeStore } from "../lib/theme";
import { useDisplayStore, type ThemePreference } from "../store/useDisplayStore";
import logoMark from "../assets/logo-mark.webp";
import type { RepoInfo } from "../types/git";

/** Position courante affichée dans la barre d'outils. */
function headLabel(info: RepoInfo): string {
  const rebase = info.interactive_rebase;
  if (rebase) return `Rebase interactif ${rebase.step}/${rebase.total}`;
  if (info.head_detached) return `HEAD détaché @ ${info.head_hash?.slice(0, 7)}`;
  return `⎇ ${info.head_branch ?? ""}`;
}

export function Toolbar({ onClone }: { onClone: () => void }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const info = useRepoStore((s) => s.info);
  const branches = useRepoStore((s) => s.branches);
  const stashes = useRepoStore((s) => s.stashes);
  const recent = useRepoStore((s) => s.recentRepos);
  const newTab = useTabsStore((s) => s.newTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const activeTab = useTabsStore((s) => s.activeId);
  const tabCount = useTabsStore((s) => s.tabs.length);
  const setPreferencesOpen = useUiStore((s) => s.setPreferencesOpen);
  const setMemoOpen = useUiStore((s) => s.setMemoOpen);
  const busy = useUiStore((s) => s.busy);
  const ask = useUiStore((s) => s.ask);
  const syncing = useSyncRunning();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const head = branches.find((b) => b.is_head && !b.is_remote);
  const repoName = repoPath?.split(/[\\/]/).pop();

  function repoMenu(): MenuEntry[] {
    const others = recent.filter((p) => p !== repoPath).slice(0, 6);
    return [
      { header: "Dépôt" },
      { label: "Ouvrir…", icon: FolderOpen, shortcut: "Ctrl+O", action: chooseAndOpenRepo },
      { label: "Cloner…", icon: CloudDownload, action: onClone },
      { label: "Initialiser…", icon: FolderPlus, action: chooseAndInitRepo },
      ...(others.length > 0
        ? [
            { header: "Récents" },
            ...others.map((p) => ({ label: p.split(/[\\/]/).pop() ?? p, hint: p, icon: History, action: () => openRepoAt(p) })),
          ]
        : []),
      "separator",
      { label: "Nouvel onglet", icon: SquarePlus, shortcut: "Ctrl+T", action: newTab },
      { label: "Nouvelle fenêtre", icon: AppWindow, shortcut: "Ctrl+Maj+N", action: () => openNewWindow() },
      ...(repoPath || tabCount > 1
        ? [{ label: "Fermer l'onglet", icon: X, shortcut: "Ctrl+W", action: () => closeTab(activeTab) }]
        : []),
      "separator",
      { label: "Préférences…", icon: Settings, shortcut: "Ctrl+,", action: () => setPreferencesOpen(true) },
      { label: "Rechercher des mises à jour…", icon: RefreshCw, action: () => checkForUpdates(true) },
      { label: "Mémo Git", icon: BookOpen, action: () => setMemoOpen(true) },
      { label: "À propos de Merathon", icon: Info, action: () => setPreferencesOpen(true, "about") },
    ];
  }

  async function doPull(rebase: boolean) {
    if (!repoPath) return;
    const result = await runGit(() => pull(repoPath, rebase), { busy: rebase ? "Pull (rebase)…" : "Pull…" });
    reportMerge(result, "Pull terminé");
  }

  async function doPush(force = false) {
    if (!repoPath || !info?.head_branch) return;
    if (force) {
      const ok = await ask({
        title: "Push forcé",
        message: `Écraser la branche distante de « ${info.head_branch} » avec la version locale ?\nLes commits distants absents en local seront perdus.`,
        danger: true,
        confirmLabel: "Forcer le push",
      });
      if (!ok) return;
    }
    await runGit(() => push(repoPath, { force }), {
      busy: "Push…",
      success: head?.upstream ? `Push de ${info.head_branch} terminé` : `${info.head_branch} publiée sur le remote`,
    });
  }

  async function doFetch() {
    if (!repoPath) return;
    await runGit(() => fetchRemote(repoPath), { busy: "Fetch…", success: "Fetch terminé" });
  }

  async function doBranch() {
    if (!repoPath) return;
    const result = await ask({
      title: "Nouvelle branche",
      message: `Depuis ${info?.head_branch ?? "HEAD"}`,
      input: { placeholder: "nom-de-branche" },
      checkbox: { label: "Basculer sur la nouvelle branche", initial: true },
      confirmLabel: "Créer",
    });
    const name = result?.value.trim();
    if (!name) return;
    await runGit(() => createBranch(repoPath, name, "HEAD", result!.checked), { success: `Branche ${name} créée` });
  }

  async function doStash() {
    if (!repoPath) return;
    const result = await ask({
      title: "Mettre de côté (stash)",
      input: { placeholder: "Message (optionnel)" },
      checkbox: { label: "Inclure les fichiers non suivis", initial: true },
      confirmLabel: "Stash",
    });
    if (!result) return;
    await runGit(() => stashSave(repoPath, result.value.trim() || null, result.checked), { success: "Modifications mises de côté" });
  }

  async function doPop() {
    if (!repoPath || stashes.length === 0) return;
    await runGit(() => stashApply(repoPath, 0, true), { success: "Stash réappliqué" });
  }

  const disabled = !repoPath || !!busy;

  return (
    <header className="flex items-center gap-1.5 px-3 h-11 shrink-0 bg-[var(--color-bg-secondary)] border-b border-overlay/10">
      <Tooltip
        title="Ouvrir le menu du dépôt"
        lines={[
          "Ouvrir, cloner, dépôts récents, onglets, préférences…",
          ...(repoPath ? [<span className="font-mono">{repoPath}</span>] : []),
        ]}
      >
        <button
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-overlay/10 max-w-60 min-w-0"
          onClick={(e) => openMenu(e, repoMenu())}
          aria-label={repoPath ? `Ouvrir le menu du dépôt (${repoPath})` : "Ouvrir le menu du dépôt"}
          aria-haspopup="menu"
        >
          <img
            src={logoMark}
            alt=""
            width={24}
            height={24}
            draggable={false}
            className="w-6 h-6 rounded-md ring-1 ring-overlay/10 shrink-0 select-none"
          />
          <span className="text-sm font-semibold text-[var(--color-text)] truncate">{repoName ?? "Merathon"}</span>
          <span className="text-[10px] text-[var(--color-muted)]">▾</span>
        </button>
      </Tooltip>
      {info && (
        <span className="text-xs font-mono text-[var(--color-accent)] truncate max-w-48" title="Branche courante">
          {headLabel(info)}
        </span>
      )}
      {repoPath && (
        <Tooltip
          title={syncing ? "Synchronisation en cours…" : "Synchroniser maintenant"}
          lines={["Fetch de chaque dépôt ouvert et actualisation de ses PR / MR"]}
        >
          <button
            className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10 disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => void syncOpenRepos()}
            disabled={syncing || !!busy}
            aria-label="Synchroniser les dépôts ouverts"
          >
            <RefreshCw size={13} strokeWidth={1.75} className={syncing ? "animate-spin" : ""} />
          </button>
        </Tooltip>
      )}

      <div className="w-px h-5 bg-overlay/10 mx-1" />

      <ToolBtn
        label="Pull"
        icon="⇣"
        badge={head?.behind}
        disabled={disabled || !head}
        onClick={() => doPull(false)}
        onMenu={(e) => openMenu(e, [
          { label: "Pull (fast-forward si possible, sinon merge)", action: () => doPull(false) },
          { label: "Pull (rebase)", action: () => doPull(true) },
        ])}
      />
      <ToolBtn
        label="Push"
        icon="⇡"
        badge={head?.ahead}
        disabled={disabled || !head}
        onClick={() => doPush(false)}
        onMenu={(e) => openMenu(e, [
          { label: "Push", action: () => doPush(false) },
          { label: "Push forcé…", action: () => doPush(true), danger: true },
        ])}
      />
      <ToolBtn label="Fetch" icon="⟳" disabled={disabled} onClick={doFetch} />
      <ToolBtn label="Branche" icon="⎇" disabled={disabled || !info?.head_hash} onClick={doBranch} />
      <ToolBtn label="Stash" icon="⊟" disabled={disabled} onClick={doStash} />
      <ToolBtn label="Pop" icon="⊞" badge={stashes.length || undefined} disabled={disabled || stashes.length === 0} onClick={doPop} />

      {busy && <span className="text-xs text-[var(--color-muted)] animate-pulse ml-2">{busy}</span>}

      <div className="ml-auto flex items-center gap-2">
        <ThemeButton onOpen={openMenu} />
        <SearchBar />
        <button
          className="text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
          onClick={() => openNewWindow()}
          title="Ouvrir une nouvelle fenêtre"
        >
          ⧉
        </button>
      </div>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </header>
  );
}

const THEMES: Record<ThemePreference, { label: string; icon: LucideIcon }> = {
  system: { label: "Système", icon: Monitor },
  dark: { label: "Sombre", icon: Moon },
  light: { label: "Clair", icon: Sun },
};

/** Choix du thème : l'icône montre le réglage actuel, un clic ouvre la liste (aussi dans les préférences). */
function ThemeButton({ onOpen }: { onOpen: (e: React.MouseEvent, items: MenuEntry[]) => void }) {
  const preference = useDisplayStore((s) => s.theme);
  const update = useDisplayStore((s) => s.update);
  const shown = useThemeStore((s) => s.theme);
  const { label, icon: Icon } = THEMES[preference];
  const resolved = shown === "dark" ? "sombre" : "clair";
  const current = preference === "system" ? `${label} (${resolved})` : label;
  const items: MenuEntry[] = [
    { header: "Thème de couleurs" },
    ...(Object.keys(THEMES) as ThemePreference[]).map((value) => ({
      label: THEMES[value].label,
      icon: THEMES[value].icon,
      hint: value === "system" ? "Suit le réglage clair / sombre du système" : undefined,
      checked: value === preference,
      action: () => update({ theme: value }),
    })),
  ];

  return (
    <Tooltip title="Ouvrir le menu du thème" lines={[`Actuel : ${current}`]} align="right">
      <button
        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
        onClick={(e) => onOpen(e, items)}
        aria-label={`Thème : ${current}. Ouvrir le menu du thème`}
        aria-haspopup="menu"
      >
        <Icon size={14} strokeWidth={1.75} />
        {label}
        <span className="text-[9px]">▾</span>
      </button>
    </Tooltip>
  );
}

function ToolBtn({ label, icon, badge, disabled, onClick, onMenu }: {
  label: string;
  icon: string;
  badge?: number;
  disabled?: boolean;
  onClick: () => void;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="flex items-stretch">
      <button
        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-l rounded-r-none hover:bg-overlay/10 disabled:opacity-40 disabled:hover:bg-transparent text-[var(--color-text)]"
        style={onMenu ? undefined : { borderRadius: 4 }}
        onClick={onClick}
        disabled={disabled}
        title={label}
      >
        <span className="opacity-80">{icon}</span>
        {label}
        {!!badge && (
          <span className="text-[9px] px-1 rounded-full bg-[var(--color-accent)]/80 text-white leading-4">{badge}</span>
        )}
      </button>
      {onMenu && (
        <button
          className="text-[9px] px-1 rounded-r hover:bg-overlay/10 disabled:opacity-40 text-[var(--color-muted)]"
          disabled={disabled}
          onClick={onMenu}
          aria-label={`Options ${label}`}
        >
          ▾
        </button>
      )}
    </div>
  );
}

