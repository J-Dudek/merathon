import { withCommentCounts } from "../components/PullRequestList";
import { useAccountsStore } from "../store/useAccountsStore";
import type { ForgeAccount, MyPullRequests, PrSummary } from "../types/forge";

/** Dernières listes chargées par compte : affichées tout de suite au retour sur l'onglet Comptes. */
const cache = new Map<string, MyPullRequests>();
const listeners = new Set<(accountId: string) => void>();

export function cachedMyPullRequests(accountId: string): MyPullRequests | null {
  return cache.get(accountId) ?? null;
}

/** Appelé à chaque nouvelle liste d'un compte ; renvoie la fonction de désinscription. */
export function onMyPullRequests(listener: (accountId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishMyPullRequests(accountId: string, data: MyPullRequests) {
  cache.set(accountId, data);
  listeners.forEach((l) => l(accountId));
}

/** PR / MR ouvertes du compte, tous projets confondus, avec leur nombre de commentaires (GitHub). */
export async function fetchMyPullRequests(account: ForgeAccount): Promise<MyPullRequests> {
  const mine = await (await useAccountsStore.getState().client(account)).getMyPullRequests();
  const project = (pr: PrSummary) => pr.projectPath;
  const [assigned, authored] = await Promise.all([
    withCommentCounts(account, mine.assigned, project),
    withCommentCounts(account, mine.authored, project),
  ]);
  return { assigned, authored };
}

/** Recharge la liste du compte et la diffuse. */
export async function loadMyPullRequests(account: ForgeAccount): Promise<MyPullRequests> {
  const data = await fetchMyPullRequests(account);
  publishMyPullRequests(account.id, data);
  return data;
}
