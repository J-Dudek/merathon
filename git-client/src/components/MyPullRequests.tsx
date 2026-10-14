import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { prFreshness, seenKey, useSeenPrsStore } from "../store/useSeenPrsStore";
import { errorMessage } from "../lib/actions";
import { onSynced } from "../lib/autoSync";
import { cachedMyPullRequests, loadMyPullRequests, onMyPullRequests } from "../lib/myPullRequests";
import { useDisplayStore } from "../store/useDisplayStore";
import { MY_PR_STATUSES, groupByProject, myPrStatus, sortByStatus } from "../lib/prStatus";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { PRRow, checkoutPullRequest, markPullRequestRead, useLinkedForge } from "./PullRequestList";
import { PullRequestReviewDialog } from "./PullRequestReviewDialog";
import { PanelSection as Section } from "./PanelSection";
import type { ForgeAccount, MyPullRequests, PrSummary } from "../types/forge";

/**
 * PR / MR ouvertes du compte, tous projets confondus. Rechargées après chaque synchronisation périodique, qui s'en
 * charge elle-même quand les notifications sont activées (la nouvelle liste arrive alors par `onMyPullRequests`).
 */
function useMyPullRequests(account: ForgeAccount) {
  const [data, setData] = useState<MyPullRequests | null>(() => cachedMyPullRequests(account.id));
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      await loadMyPullRequests(account);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setFetching(false);
    }
  }, [account]);

  useEffect(() => {
    reload();
    const stopList = onMyPullRequests((id) => {
      if (id === account.id) setData(cachedMyPullRequests(id));
    });
    const stopSync = onSynced(() => {
      if (!useDisplayStore.getState().notifications.enabled) void reload();
    });
    return () => {
      stopList();
      stopSync();
    };
  }, [reload, account.id]);

  return { data, loading: fetching && !data, error, reload };
}

/** MR à traiter (assigné ou relecteur demandé) par projet, et MR ouvertes par moi avec leur état. */
export function MyPullRequestsSection({ account, showAccount }: {
  account: ForgeAccount;
  /** Plusieurs comptes : le nom du compte est ajouté aux titres. */
  showAccount: boolean;
}) {
  const { data, loading, error, reload } = useMyPullRequests(account);
  const [reviewing, setReviewing] = useState<PrSummary | null>(null);
  const { menu, open, close } = useContextMenu();
  const seen = useSeenPrsStore((s) => s.seen);
  const linked = useLinkedForge();
  const prLabel = account.provider === "gitlab" ? "MR" : "PR";
  const sign = account.provider === "gitlab" ? "!" : "#";
  const suffix = showAccount ? ` · ${account.label}` : "";

  const keyOf = (pr: PrSummary) => seenKey(account.id, pr.projectPath, pr.number);
  /** Remote local quand le dépôt ouvert est celui de la PR : fichiers modifiés et checkout disponibles. */
  const localRemote = (pr: PrSummary) =>
    linked && linked.account.id === account.id && linked.projectPath === pr.projectPath ? linked.remoteName : null;

  /** `meta` porte déjà l'état de la relecture : sans lui, une approbation est signalée à côté du titre. */
  function row(pr: PrSummary, subtitle: string, meta?: React.ReactNode) {
    const freshness = prFreshness(seen[keyOf(pr)], pr);
    return (
      <PRRow
        key={`${pr.projectPath}${sign}${pr.number}`}
        pr={pr}
        freshness={freshness}
        approved={!meta && pr.review === "approved"}
        typeLabel={prLabel}
        indent={24}
        subtitle={subtitle}
        hint="Clic : voir le détail · Clic droit : navigateur, lu / non lu"
        onClick={() => setReviewing(pr)}
        onContextMenu={(e) => open(e, [
          { label: "Voir le détail…", action: () => setReviewing(pr) },
          { label: "Ouvrir dans le navigateur", action: () => openUrl(pr.url) },
          freshness.kind === "read"
            ? { label: "Marquer comme non lue", action: () => useSeenPrsStore.getState().markUnread(keyOf(pr)) }
            : { label: "Marquer comme lue", action: () => markPullRequestRead(account, pr.projectPath, pr) },
        ])}
        meta={meta}
      />
    );
  }

  const refresh = (
    <button className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]" title="Rafraîchir" onClick={reload}>
      ↻
    </button>
  );
  const status = (
    <>
      {loading && <p className="px-3 py-1 text-xs text-[var(--color-muted)] animate-pulse">Chargement…</p>}
      {error && <p className="px-3 py-1 text-xs text-red-400 break-words">{error}</p>}
    </>
  );

  return (
    <>
      <Section title={`${prLabel}s à traiter${suffix}`} action={refresh}>
        {status}
        {data && groupByProject(data.assigned).map(([project, prs]) => (
          <div key={project}>
            <p className="px-3 pt-1 text-[10px] font-semibold text-[var(--color-muted)] truncate" title={project}>
              {project} <span className="font-normal">({prs.length})</span>
            </p>
            {prs.map((pr) => row(pr, `${prLabel}${sign}${pr.number} · ${pr.author} · ${pr.sourceBranch} → ${pr.targetBranch}`))}
          </div>
        ))}
        {data && !data.assigned.length && <Empty text={`Aucune ${prLabel} assignée ou à relire`} />}
      </Section>

      <Section title={`Mes ${prLabel}s${suffix}`} action={refresh}>
        {status}
        {data && sortByStatus(data.authored).map((pr) => row(
          pr,
          `${pr.projectPath}${sign}${pr.number} · ${pr.sourceBranch} → ${pr.targetBranch}`,
          <StatusBadges pr={pr} />,
        ))}
        {data && !data.authored.length && <Empty text={`Aucune ${prLabel} ouverte par toi`} />}
      </Section>

      {menu && <ContextMenu menu={menu} onClose={close} />}
      {reviewing && (
        <PullRequestReviewDialog
          account={account}
          projectPath={reviewing.projectPath}
          remoteName={localRemote(reviewing)}
          number={reviewing.number}
          onCheckout={localRemote(reviewing) ? (pr) => checkoutPullRequest(localRemote(reviewing)!, pr) : undefined}
          onChanged={reload}
          onClose={() => setReviewing(null)}
        />
      )}
    </>
  );
}

const CI_DOTS: Record<NonNullable<PrSummary["ci"]>, { className: string; label: string }> = {
  success: { className: "bg-green-400", label: "réussie" },
  failure: { className: "bg-red-400", label: "en échec" },
  pending: { className: "bg-amber-300 animate-pulse", label: "en cours" },
};

/** État principal (brouillon, conflits, changements demandés…) et pastille de CI. Le brouillon est déjà signalé par la ligne. */
function StatusBadges({ pr }: { pr: PrSummary }) {
  const status = myPrStatus(pr);
  const style = MY_PR_STATUSES[status];
  const ci = pr.ci && CI_DOTS[pr.ci];
  return (
    <>
      {status !== "draft" && (
        <span className={`text-[9px] px-1 rounded border shrink-0 ${style.className}`}>{style.label}</span>
      )}
      {ci && (
        <span className="inline-flex items-center gap-1 text-[9px] text-[var(--color-muted)] shrink-0" title={`CI ${ci.label}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${ci.className}`} />
          CI
        </span>
      )}
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-3 py-1 text-xs text-[var(--color-muted)] italic">{text}</p>;
}
