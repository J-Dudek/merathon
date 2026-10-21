import { useEffect, useRef } from "react";
import type { InteractiveStop, TimelineStep } from "../types/git";
import { actionLabel } from "./InteractiveRebaseDialog";

const STATUS_LABEL: Record<TimelineStep["status"], string> = { done: "fait", current: "en cours", todo: "à faire" };

/** Ce qu'est devenue une étape : libellé court (le panneau est étroit) et précision éventuelle ; null si rien à signaler. */
export function stepOutcome(step: TimelineStep, reason: InteractiveStop["reason"]): { label: string; detail?: string } | null {
  if (step.status === "current") return reason === "conflict" ? { label: "conflit", detail: "à résoudre" } : { label: "à modifier" };
  if (step.status === "todo") return null;
  if (step.action === "drop") return { label: "supprimé" };
  if (step.skipped) return { label: "sauté", detail: "ses changements étaient déjà présents" };
  if (step.action === "squash" || step.action === "fixup") return { label: "fusionné", detail: "dans le commit précédent" };
  if (step.new_hash === step.hash) return { label: "inchangé" };
  return step.new_hash ? { label: `→ ${step.new_hash.slice(0, 7)}`, detail: "nouveau hash" } : null;
}

const SUMMARY_TONE: Record<TimelineStep["status"], string> = {
  done: "text-sky-100",
  current: "font-semibold text-sky-100",
  todo: "text-sky-200/60",
};

const DOT: Record<TimelineStep["status"], string> = {
  done: "bg-green-400 border-green-400",
  current: "bg-sky-400 border-sky-300 ring-2 ring-sky-400/40",
  todo: "bg-transparent border-sky-200/50",
};

/** Frise du rebase interactif arrêté : étapes faites, étape en cours, étapes à venir. */
export function RebaseTimeline({ stop }: { stop: InteractiveStop }) {
  const currentRef = useRef<HTMLLIElement>(null);

  // L'étape en cours reste visible quand le plan est long.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [stop.hash, stop.reason]);

  return (
    <ol aria-label="Plan du rebase, du plus ancien au plus récent" className="relative max-h-48 overflow-y-auto pr-1">
      <TimelineRow dot="bg-sky-200/50 border-sky-200/50" last={false}>
        <span className="text-sky-200/70">base</span>
        <span className="font-mono text-sky-200/70">{stop.onto}</span>
      </TimelineRow>
      {stop.timeline.map((step, i) => {
        const outcome = stepOutcome(step, stop.reason);
        const dropped = step.action === "drop" || step.skipped;
        return (
          <TimelineRow
            key={step.hash}
            ref={step.status === "current" ? currentRef : undefined}
            current={step.status === "current"}
            dot={DOT[step.status]}
            last={i === stop.timeline.length - 1}
          >
            <span className="sr-only">{STATUS_LABEL[step.status]} :</span>
            <span className={`shrink-0 w-[3.75rem] ${step.status === "todo" ? "text-sky-200/60" : "text-sky-100"}`}>{actionLabel(step.action)}</span>
            <span className="font-mono shrink-0 text-[var(--color-accent-text)]">{step.short_hash}</span>
            <span
              className={`truncate min-w-0 ${dropped ? "line-through opacity-60" : ""} ${SUMMARY_TONE[step.status]}`}
              title={step.summary}
            >
              {step.summary}
            </span>
            {outcome && (
              <span
                className={`ml-auto shrink-0 text-[10px] ${step.status === "current" ? "text-amber-300" : "text-sky-200/70"}`}
                title={outcome.detail}
              >
                {outcome.label}
                {outcome.detail && <span className="sr-only"> ({outcome.detail})</span>}
              </span>
            )}
          </TimelineRow>
        );
      })}
    </ol>
  );
}

function TimelineRow({ ref, dot, last, current, children }: {
  ref?: React.Ref<HTMLLIElement>;
  dot: string;
  last: boolean;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li ref={ref} aria-current={current ? "step" : undefined} className={`relative flex items-center gap-1.5 pl-4 py-0.5 text-[11px] rounded ${current ? "bg-sky-400/15" : ""}`}>
      {/* Trait vertical reliant les étapes, puis la pastille de l'étape. */}
      {!last && <span aria-hidden className="absolute left-[5px] top-1/2 h-full w-px bg-sky-200/30" />}
      <span aria-hidden className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full border ${dot}`} />
      {children}
    </li>
  );
}
