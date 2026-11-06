import { useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { useUiStore } from "../store/useUiStore";
import { useTabsStore } from "../store/useTabsStore";
import { AppWindow, Archive, ArchiveRestore, ArrowDown, ArrowUp, BookOpen, ChevronDown, CloudDownload, EllipsisVertical, FileText, FolderOpen, FolderPlus, FolderSync, GitBranch, History, Info, Menu, Monitor, Moon, RefreshCw, Settings, SquarePlus, Sun, Users, X, type LucideIcon } from "lucide-react";
import {
  createBranch, fetchRemote, openNewWindow, pull, stashApply, stashSave,
} from "../ipc/commands";
import { reportMerge, runGit } from "../lib/actions";
import { pushBranch } from "../lib/threadReplies";
import { chooseAndInitRepo, chooseAndOpenRepo, openRepoAt } from "../lib/repoActions";
import { ContextMenu, useContextMenu, type MenuEntry } from "./ContextMenu";
import { MobileDrawer } from "./MobileDrawer";
import { SearchBar } from "./SearchBar";
import { Tooltip } from "./Tooltip";
import { checkForUpdates } from "../lib/updater";
import { hasDesktopFeatures, isMobile } from "../lib/platform";
import { syncOpenRepos, useSyncRunning } from "../lib/autoSync";
import { useThemeStore } from "../lib/theme";
import { useDisplayStore, type ThemePreference } from "../store/useDisplayStore";
import logoMark from "../assets/logo-mark.webp";
import type { RepoInfo } from "../types/git";
import { tr, trn } from "../i18n";

/** Position courante affichée dans la barre d'outils. */
function headLabel(info: RepoInfo): string {
  const rebase = info.interactive_rebase;
  if (rebase) return tr("Rebase interactif {step}/{total}", { step: rebase.step, total: rebase.total });
  if (info.head_detached) return tr("HEAD détaché @ {head_hash}", { head_hash: info.head_hash?.slice(0, 7) });
  return info.head_branch ?? "";
}

export function Toolbar({ onClone, onAccounts }: { onClone: () => void; onAccounts: () => void }) {
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
  const openFileEditor = useUiStore((s) => s.openFileEditor);
  const busy = useUiStore((s) => s.busy);
  const ask = useUiStore((s) => s.ask);
  const syncing = useSyncRunning();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const head = branches.find((b) => b.is_head && !b.is_remote);
  const repoName = repoPath?.split(/[\\/]/).pop();

  function repoMenu(): MenuEntry[] {
    const others = recent.filter((p) => p !== repoPath).slice(0, 6);
    return [
      { header: tr("Dépôt") },
      { label: tr("Ouvrir…"), icon: FolderOpen, shortcut: "Ctrl+O", action: chooseAndOpenRepo },
      { label: tr("Cloner…"), icon: CloudDownload, action: onClone },
      { label: tr("Initialiser…"), icon: FolderPlus, action: chooseAndInitRepo },
      // Mobile : les dépôts sont dans le dossier privé de l'application, qu'aucun autre éditeur n'ouvre.
      ...(isMobile() && repoPath ? [{ label: tr("Fichiers du dépôt…"), icon: FileText, action: () => openFileEditor() }] : []),
      ...(others.length > 0
        ? [
            { header: tr("Récents") },
            ...others.map((p) => ({ label: p.split(/[\\/]/).pop() ?? p, hint: p, icon: History, action: () => openRepoAt(p) })),
          ]
        : []),
      "separator",
      { label: tr("Nouvel onglet"), icon: SquarePlus, shortcut: "Ctrl+T", action: newTab },
      ...(hasDesktopFeatures()
        ? [{ label: tr("Nouvelle fenêtre"), icon: AppWindow, shortcut: "Ctrl+Maj+N", action: () => openNewWindow() }]
        : []),
      ...(repoPath || tabCount > 1
        ? [{ label: tr("Fermer l'onglet"), icon: X, shortcut: "Ctrl+W", action: () => closeTab(activeTab) }]
        : []),
      "separator",
      ...(isMobile() ? [{ label: tr("Comptes"), icon: Users, action: onAccounts }] : []),
      { label: tr("Préférences…"), icon: Settings, shortcut: "Ctrl+,", action: () => setPreferencesOpen(true) },
      ...(hasDesktopFeatures()
        ? [{ label: tr("Rechercher des mises à jour…"), icon: RefreshCw, action: () => checkForUpdates(true) }]
        : []),
      { label: tr("Mémo Git"), icon: BookOpen, action: () => setMemoOpen(true) },
      { label: tr("À propos de Merathon"), icon: Info, action: () => setPreferencesOpen(true, "about") },
    ];
  }

  async function doPull(rebase: boolean) {
    if (!repoPath) return;
    const result = await runGit(() => pull(repoPath, rebase), { busy: rebase ? "Pull (rebase)…" : tr("Pull…") });
    reportMerge(result, tr("Pull terminé"));
  }

  async function doPush(force = false) {
    if (!repoPath || !info?.head_branch) return;
    if (force) {
      const ok = await ask({
        title: tr("Push forcé"),
        message: tr("Écraser la branche distante de « {head_branch} » avec la version locale ?\nLes commits distants absents en local seront perdus.", { head_branch: info.head_branch }),
        danger: true,
        confirmLabel: tr("Forcer le push"),
      });
      if (!ok) return;
    }
    await pushBranch(repoPath, info.head_branch, {
      force,
      success: head?.upstream ? tr("Push de {head_branch} terminé", { head_branch: info.head_branch }) : tr("{head_branch} publiée sur le remote", { head_branch: info.head_branch }),
    });
  }

  async function doFetch() {
    if (!repoPath) return;
    await runGit(() => fetchRemote(repoPath), { busy: tr("Fetch…"), success: tr("Fetch terminé") });
  }

  async function doBranch() {
    if (!repoPath) return;
    const result = await ask({
      title: tr("Nouvelle branche"),
      message: tr("Depuis {value}", { value: info?.head_branch ?? "HEAD" }),
      input: { placeholder: tr("nom-de-branche") },
      checkbox: { label: tr("Basculer sur la nouvelle branche"), initial: true },
      confirmLabel: tr("Créer"),
    });
    const name = result?.value.trim();
    if (!name) return;
    await runGit(() => createBranch(repoPath, name, "HEAD", result!.checked), { success: tr("Branche {name} créée", { name }) });
  }

  async function doStash() {
    if (!repoPath) return;
    const result = await ask({
      title: tr("Mettre de côté (stash)"),
      input: { placeholder: "Message (optionnel)", optional: true },
      checkbox: { label: tr("Inclure les fichiers non suivis"), initial: true },
      confirmLabel: "Stash",
    });
    if (!result) return;
    await runGit(() => stashSave(repoPath, result.value.trim() || null, result.checked), { success: tr("Modifications mises de côté") });
  }

  async function doPop() {
    if (!repoPath || stashes.length === 0) return;
    await runGit(() => stashApply(repoPath, 0, true), { success: tr("Stash réappliqué") });
  }

  const disabled = !repoPath || !!busy;

  if (isMobile()) {
    return (
      <MobileToolbar
        repoPath={repoPath}
        repoName={repoName}
        info={info}
        head={head ? { behind: head.behind, ahead: head.ahead } : null}
        stashCount={stashes.length}
        actions={{ pull: doPull, push: doPush, fetch: doFetch, branch: doBranch, stash: doStash, pop: doPop }}
        repoMenu={repoMenu}
      />
    );
  }

  return (
    <header className="flex flex-wrap items-center gap-1.5 px-3 min-h-11 py-1 shrink-0 bg-[var(--color-bg-secondary)] border-b border-overlay/10">
      {/* Titre de niveau 1 pour les technologies d'assistance : les panneaux ont des titres de niveau 2. */}
      <h1 className="sr-only">Merathon{repoName ? ` — ${repoName}` : ""}</h1>
      <Tooltip
        title={tr("Ouvrir le menu du dépôt")}
        lines={[
          tr("Ouvrir, cloner, dépôts récents, onglets, préférences…"),
          ...(repoPath ? [<span className="font-mono">{repoPath}</span>] : []),
        ]}
      >
        <button
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-overlay/10 max-w-60 min-w-0"
          onClick={(e) => openMenu(e, repoMenu())}
          aria-label={repoPath ? tr("Ouvrir le menu du dépôt ({repoPath})", { repoPath }) : tr("Ouvrir le menu du dépôt")}
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
          <ChevronDown size={12} className="text-[var(--color-muted)] shrink-0" />
        </button>
      </Tooltip>
      {info && (
        <span className="text-xs font-mono text-[var(--color-accent-text)] truncate max-w-48" title={tr("Branche courante")}>
          {!info.interactive_rebase && !info.head_detached && <GitBranch size={12} className="inline mr-1 -mt-0.5" />}
          <span className="sr-only">{tr("Branche courante :")}{" "}</span>
          {headLabel(info)}
        </span>
      )}
      {repoPath && (
        <Tooltip
          title={syncing ? tr("Synchronisation en cours…") : tr("Synchroniser maintenant")}
          lines={[tr("Fetch de chaque dépôt ouvert et actualisation de ses PR / MR")]}
        >
          <button
            className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10 disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => void syncOpenRepos()}
            disabled={syncing || !!busy}
            aria-label={tr("Synchroniser les dépôts ouverts")}
          >
            <RefreshCw size={13} strokeWidth={1.75} className={syncing ? "animate-spin" : ""} />
          </button>
        </Tooltip>
      )}

      <div className="w-px h-5 bg-overlay/10 mx-1" />

      <ToolBtn
        label="Pull"
        icon={ArrowDown}
        badge={head?.behind}
        badgeLabel={(n) => trn(n, "{n} commit à récupérer", "{n} commits à récupérer")}
        disabled={disabled || !head}
        onClick={() => doPull(false)}
        onMenu={(e) => openMenu(e, [
          { label: tr("Pull (fast-forward si possible, sinon merge)"), action: () => doPull(false) },
          { label: "Pull (rebase)", action: () => doPull(true) },
        ])}
      />
      <ToolBtn
        label="Push"
        icon={ArrowUp}
        badge={head?.ahead}
        badgeLabel={(n) => trn(n, "{n} commit à envoyer", "{n} commits à envoyer")}
        disabled={disabled || !head}
        onClick={() => doPush(false)}
        onMenu={(e) => openMenu(e, [
          { label: "Push", action: () => doPush(false) },
          { label: tr("Push forcé…"), action: () => doPush(true), danger: true },
        ])}
      />
      <ToolBtn label="Fetch" icon={RefreshCw} disabled={disabled} onClick={doFetch} />
      <ToolBtn label={tr("Branche")} icon={GitBranch} disabled={disabled || !info?.head_hash} onClick={doBranch} />
      <ToolBtn label="Stash" icon={Archive} disabled={disabled} onClick={doStash} />
      <ToolBtn label="Pop" icon={ArchiveRestore} badge={stashes.length || undefined} badgeLabel={(n) => trn(n, "{n} stash", "{n} stashes")} disabled={disabled || stashes.length === 0} onClick={doPop} />

      {/* Opération en cours (Fetch…, Push…) : annoncée par une zone de statut toujours présente. */}
      <span role="status" className="text-xs text-[var(--color-muted)] ml-2">{busy ?? ""}</span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <ThemeButton onOpen={openMenu} />
        <SearchBar />
        {hasDesktopFeatures() && (
          <button
            className="text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
            onClick={() => openNewWindow()}
            title={tr("Ouvrir une nouvelle fenêtre")}
            aria-label={tr("Ouvrir une nouvelle fenêtre")}
          >
            <AppWindow size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </header>
  );
}

interface GitActions {
  pull: (rebase: boolean) => Promise<void>;
  push: (force?: boolean) => Promise<void>;
  fetch: () => Promise<void>;
  branch: () => Promise<void>;
  stash: () => Promise<void>;
  pop: () => Promise<void>;
}

/**
 * Mobile : une seule ligne, pour laisser la place au contenu. Les actions courantes à côté du dépôt (Pull, Push,
 * Fetch, recherche), les autres dans « ⋯ » ; le thème est dans les préférences.
 */
function MobileToolbar({ repoPath, repoName, info, head, stashCount, actions, repoMenu }: {
  repoPath: string | null;
  repoName: string | undefined;
  info: RepoInfo | null;
  /** Branche courante suivie : commits à récupérer et à envoyer. */
  head: { behind?: number; ahead?: number } | null;
  stashCount: number;
  actions: GitActions;
  repoMenu: () => MenuEntry[];
}) {
  const busy = useUiStore((s) => s.busy);
  const syncing = useSyncRunning();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const disabled = !repoPath || !!busy;

  const more: MenuEntry[] = [
    { label: "Pull (rebase)", icon: ArrowDown, disabled: disabled || !head, action: () => void actions.pull(true) },
    { label: tr("Push forcé…"), icon: ArrowUp, danger: true, disabled: disabled || !head, action: () => void actions.push(true) },
    "separator",
    { label: tr("Nouvelle branche…"), icon: GitBranch, disabled: disabled || !info?.head_hash, action: () => void actions.branch() },
    { label: "Stash", icon: Archive, disabled, action: () => void actions.stash() },
    {
      label: stashCount ? `Pop (${trn(stashCount, "{n} stash", "{n} stashes")})` : "Pop",
      icon: ArchiveRestore,
      disabled: disabled || stashCount === 0,
      action: () => void actions.pop(),
    },
    "separator",
    {
      label: syncing ? tr("Synchronisation en cours…") : tr("Synchroniser les dépôts ouverts"),
      hint: tr("Fetch de chaque dépôt ouvert et actualisation de ses PR / MR"),
      icon: FolderSync,
      disabled: syncing || !!busy,
      action: () => void syncOpenRepos(),
    },
  ];

  return (
    <header className="flex flex-wrap items-center gap-0.5 px-2 min-h-14 py-1 shrink-0 bg-[var(--color-bg-secondary)] border-b border-overlay/10">
      <h1 className="sr-only">Merathon{repoName ? ` — ${repoName}` : ""}</h1>
      <button
        className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full text-[var(--color-text)] active:bg-overlay/10"
        onClick={() => setDrawerOpen(true)}
        aria-label={repoPath ? tr("Ouvrir le menu du dépôt ({repoPath})", { repoPath }) : tr("Ouvrir le menu du dépôt")}
        aria-haspopup="dialog"
      >
        <Menu size={22} strokeWidth={1.75} />
      </button>
      <div className="flex-1 min-w-0 pl-1">
        <p className="text-base font-semibold text-[var(--color-text)] truncate">{repoName ?? "Merathon"}</p>
        {(info || busy) && (
          <p className="text-xs font-mono text-[var(--color-accent-text)] truncate">
            {info && (
              <>
                <span className="sr-only">{tr("Branche courante :")}{" "}</span>
                {headLabel(info)}
              </>
            )}
            {/* Opération en cours (Fetch…, Push…), annoncée par la zone de statut ci-dessous. */}
            {busy && <span className="font-sans text-[var(--color-muted)]" aria-hidden>{info ? " · " : ""}{busy}</span>}
          </p>
        )}
      </div>
      {repoPath && (
        <>
          <ToolBtn
            label="Pull"
            icon={ArrowDown}
            badge={head?.behind}
            badgeLabel={(n) => trn(n, "{n} commit à récupérer", "{n} commits à récupérer")}
            disabled={disabled || !head}
            onClick={() => void actions.pull(false)}
          />
          <ToolBtn
            label="Push"
            icon={ArrowUp}
            badge={head?.ahead}
            badgeLabel={(n) => trn(n, "{n} commit à envoyer", "{n} commits à envoyer")}
            disabled={disabled || !head}
            onClick={() => void actions.push(false)}
          />
          <ToolBtn label="Fetch" icon={RefreshCw} disabled={disabled} onClick={() => void actions.fetch()} />
        </>
      )}
      <SearchBar />
      {repoPath && (
        <button
          className="relative w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-full text-[var(--color-text)] active:bg-overlay/10"
          onClick={(e) => openMenu(e, more)}
          aria-label={tr("Autres actions (branche, stash, synchronisation…)")}
          aria-haspopup="menu"
        >
          <EllipsisVertical size={20} strokeWidth={1.75} />
          {/* Stashs à réappliquer : signalés sur le menu, comme sur le bouton Pop du bureau. */}
          {stashCount > 0 && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--color-accent-solid)]" aria-hidden />}
        </button>
      )}
      <span role="status" className="sr-only">{busy ?? ""}</span>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {drawerOpen && <MobileDrawer title={repoName ?? "Merathon"} subtitle={info ? headLabel(info) : undefined} items={repoMenu()} onClose={() => setDrawerOpen(false)} />}
    </header>
  );
}

const THEMES: Record<ThemePreference, { label: string; icon: LucideIcon }> = {
  system: { label: tr("Système"), icon: Monitor },
  dark: { label: tr("Sombre"), icon: Moon },
  light: { label: tr("Clair"), icon: Sun },
};

/** Choix du thème : l'icône montre le réglage actuel, un clic ouvre la liste (aussi dans les préférences). */
function ThemeButton({ onOpen }: { onOpen: (e: React.MouseEvent, items: MenuEntry[]) => void }) {
  const preference = useDisplayStore((s) => s.theme);
  const update = useDisplayStore((s) => s.update);
  const shown = useThemeStore((s) => s.theme);
  const { label, icon: Icon } = THEMES[preference];
  const resolved = shown === "dark" ? tr("sombre") : tr("clair");
  const current = preference === "system" ? `${label} (${resolved})` : label;
  const items: MenuEntry[] = [
    { header: tr("Thème de couleurs") },
    ...(Object.keys(THEMES) as ThemePreference[]).map((value) => ({
      label: THEMES[value].label,
      icon: THEMES[value].icon,
      hint: value === "system" ? tr("Suit le réglage clair / sombre du système") : undefined,
      checked: value === preference,
      action: () => update({ theme: value }),
    })),
  ];

  return (
    <Tooltip title={tr("Ouvrir le menu du thème")} lines={[tr("Actuel : {current}", { current })]} align="right">
      <button
        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
        onClick={(e) => onOpen(e, items)}
        aria-label={tr("Thème : {current}. Ouvrir le menu du thème", { current })}
        aria-haspopup="menu"
      >
        <Icon size={14} strokeWidth={1.75} />
        {label}
        <ChevronDown size={11} />
      </button>
    </Tooltip>
  );
}

function ToolBtn({ label, icon: Icon, badge, badgeLabel, disabled, onClick, onMenu }: {
  label: string;
  icon: LucideIcon;
  badge?: number;
  /** Signification de la pastille, restituée aux technologies d'assistance. */
  badgeLabel?: (n: number) => string;
  disabled?: boolean;
  onClick: () => void;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  const title = badge && badgeLabel ? `${label} (${badgeLabel(badge)})` : label;
  if (isMobile()) {
    // Mobile : icône seule, zone de toucher de 40 px, pastille dans le coin.
    return (
      <button
        className="relative w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-full text-[var(--color-text)] active:bg-overlay/10 disabled:opacity-40"
        onClick={onClick}
        disabled={disabled}
        title={title}
      >
        <Icon size={20} strokeWidth={1.75} />
        <span className="sr-only">{label}</span>
        {!!badge && (
          <span className="absolute top-0.5 right-0 min-w-4 px-1 text-[9px] text-center rounded-full bg-[var(--color-accent-solid)] text-white leading-4">
            <span aria-hidden>{badge}</span>
            <span className="sr-only">{badgeLabel ? ` (${badgeLabel(badge)})` : ` (${badge})`}</span>
          </span>
        )}
      </button>
    );
  }
  return (
    <div className="flex items-stretch">
      <button
        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-l rounded-r-none hover:bg-overlay/10 disabled:opacity-40 disabled:hover:bg-transparent text-[var(--color-text)]"
        style={onMenu ? undefined : { borderRadius: 4 }}
        onClick={onClick}
        disabled={disabled}
        title={title}
      >
        <Icon size={13} strokeWidth={1.75} className="opacity-80 shrink-0" />
        <span>{label}</span>
        {!!badge && (
          <span className="text-[9px] px-1 rounded-full bg-[var(--color-accent-solid)] text-white leading-4">
            <span aria-hidden>{badge}</span>
            <span className="sr-only">{badgeLabel ? ` (${badgeLabel(badge)})` : ` (${badge})`}</span>
          </span>
        )}
      </button>
      {onMenu && (
        <button
          className="text-[9px] min-w-6 px-1 rounded-r hover:bg-overlay/10 disabled:opacity-40 text-[var(--color-muted)]"
          disabled={disabled}
          onClick={onMenu}
          aria-label={tr("Options {label}", { label })}
          aria-haspopup="menu"
        >
          <ChevronDown size={12} />
        </button>
      )}
    </div>
  );
}

