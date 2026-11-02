import { useEffect, useMemo, useState } from "react";
import { listRemotes } from "../ipc/commands";
import { useAccountsStore } from "../store/useAccountsStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { prFreshness, seenKey, useSeenPrsStore, type SeenPr } from "../store/useSeenPrsStore";
import { cachedMyPullRequests, onMyPullRequests } from "./myPullRequests";
import { hostOf, parseRemoteUrl } from "./remoteUrl";
import type { ForgeAccount, MyPullRequests, PrSummary } from "../types/forge";
import type { RemoteInfo } from "../types/git";

export interface PendingPr {
  accountId: string;
  pr: PrSummary;
}

/**
 * PR / MR avec du nouveau, tous comptes confondus : modifiées depuis leur dernière consultation, ou à traiter et jamais
 * ouvertes. Une PR que j'ai ouverte et jamais consultée dans Merathon ne compte pas.
 */
export function pendingPullRequests(lists: { accountId: string; data: MyPullRequests }[], seen: Record<string, SeenPr>): PendingPr[] {
  const pending = new Map<string, PendingPr>();
  for (const { accountId, data } of lists) {
    const authored = new Set(data.authored.map((pr) => pr.projectPath + "#" + pr.number));
    for (const pr of [...data.assigned, ...data.authored]) {
      const key = seenKey(accountId, pr.projectPath, pr.number);
      const kind = prFreshness(seen[key], pr).kind;
      if (kind === "updated" || (kind === "unread" && !authored.has(pr.projectPath + "#" + pr.number))) pending.set(key, { accountId, pr });
    }
  }
  return [...pending.values()];
}

/** Clé d'un projet sur un compte : la casse d'une URL de remote peut différer de celle renvoyée par la forge. */
const projectKey = (accountId: string, projectPath: string) => `${accountId}|${projectPath.toLowerCase()}`;

/** Projets d'un dépôt sur chaque compte : tous ses remotes comptent (dans un fork, la PR est souvent sur `upstream`). */
export function repoProjects(remotes: RemoteInfo[], accounts: ForgeAccount[]): Set<string> {
  const projects = new Set<string>();
  for (const account of accounts) {
    const host = hostOf(account.base_url);
    for (const remote of remotes) {
      const parsed = parseRemoteUrl(remote.url);
      if (host && parsed?.host === host) projects.add(projectKey(account.id, parsed.path));
    }
  }
  return projects;
}

/** Nombre de PR avec du nouveau qui appartiennent à l'un de ces projets. */
export function pendingInProjects(pending: PendingPr[], projects: Set<string>): number {
  return pending.filter(({ accountId, pr }) => projects.has(projectKey(accountId, pr.projectPath))).length;
}

/**
 * Nombre de PR / MR avec du nouveau de chaque dépôt : les mêmes que la pastille de l'icône, qui s'effacent de même une
 * fois consultées. Rien si les notifications sont désactivées (les listes ne sont alors plus actualisées).
 */
export function usePendingByRepo(paths: string[]): Record<string, number> {
  const accounts = useAccountsStore((s) => s.accounts);
  const seen = useSeenPrsStore((s) => s.seen);
  const enabled = useDisplayStore((s) => s.notifications.enabled);
  const [version, setVersion] = useState(0);
  const [remotes, setRemotes] = useState<Record<string, RemoteInfo[]>>({});
  const pathsKey = paths.join("\n");

  useEffect(() => onMyPullRequests(() => setVersion((v) => v + 1)), []);

  // Relus à chaque nouvelle liste : un remote a pu être ajouté depuis, y compris dans un onglet en arrière-plan.
  useEffect(() => {
    let cancelled = false;
    const list = pathsKey ? pathsKey.split("\n") : [];
    void Promise.all(list.map(async (path) => [path, await listRemotes(path).catch(() => [])] as const)).then((entries) => {
      if (!cancelled) setRemotes(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [pathsKey, version]);

  return useMemo(() => {
    if (!enabled) return {};
    const lists = accounts.flatMap((a) => {
      const data = cachedMyPullRequests(a.id);
      return data ? [{ accountId: a.id, data }] : [];
    });
    const pending = pendingPullRequests(lists, seen);
    return Object.fromEntries(Object.entries(remotes).map(([path, list]) => [path, pendingInProjects(pending, repoProjects(list, accounts))]));
    // `version` : `cachedMyPullRequests` a une nouvelle liste.
  }, [accounts, seen, enabled, remotes, version]); // eslint-disable-line react-hooks/exhaustive-deps
}
