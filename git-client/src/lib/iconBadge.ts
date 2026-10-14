import { useEffect, useState } from "react";
import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAccountsStore } from "../store/useAccountsStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { prFreshness, seenKey, useSeenPrsStore, type SeenPr } from "../store/useSeenPrsStore";
import { cachedMyPullRequests, onMyPullRequests } from "./myPullRequests";
import { restoreMyPullRequests } from "./prNotifications";
import type { MyPullRequests } from "../types/forge";

/**
 * PR / MR avec du nouveau, tous comptes confondus : modifiées depuis leur dernière consultation, ou à traiter et jamais
 * ouvertes. Une PR que j'ai ouverte et jamais consultée dans Merathon ne compte pas.
 */
export function pendingCount(lists: { accountId: string; data: MyPullRequests }[], seen: Record<string, SeenPr>): number {
  const counted = new Set<string>();
  for (const { accountId, data } of lists) {
    const authored = new Set(data.authored.map((pr) => pr.projectPath + "#" + pr.number));
    for (const pr of [...data.assigned, ...data.authored]) {
      const key = seenKey(accountId, pr.projectPath, pr.number);
      const kind = prFreshness(seen[key], pr).kind;
      if (kind === "updated" || (kind === "unread" && !authored.has(pr.projectPath + "#" + pr.number))) counted.add(key);
    }
  }
  return counted.size;
}

const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
const SIZE = 32;

/** Pastille rouge avec le nombre (« 9+ » au-delà), pour l'icône superposée de la barre des tâches Windows. */
async function overlayImage(count: number): Promise<Image | undefined> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = "#e5484d";
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.fill();
  const text = count > 9 ? "9+" : String(count);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${text.length > 1 ? 17 : 21}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, SIZE / 2, SIZE / 2 + 1);
  return Image.new(ctx.getImageData(0, 0, SIZE, SIZE).data, SIZE, SIZE);
}

/** Pastille sur l'icône : Dock (macOS), lanceur qui la gère (Linux), icône superposée (Windows). 0 l'efface. */
async function showBadge(count: number) {
  const win = getCurrentWindow();
  if (isWindows) await win.setOverlayIcon(count > 0 ? await overlayImage(count) : undefined);
  else await win.setBadgeCount(count > 0 ? count : undefined);
}

/** Tient la pastille à jour : nouvelles listes de PR, consultations, comptes et préférences. */
export function useIconBadge() {
  const accounts = useAccountsStore((s) => s.accounts);
  const seen = useSeenPrsStore((s) => s.seen);
  const { enabled, badge } = useDisplayStore((s) => s.notifications);
  const [version, setVersion] = useState(0);

  useEffect(() => onMyPullRequests(() => setVersion((v) => v + 1)), []);
  useEffect(() => restoreMyPullRequests(accounts.map((a) => a.id)), [accounts]);

  useEffect(() => {
    const lists = accounts.flatMap((a) => {
      const data = cachedMyPullRequests(a.id);
      return data ? [{ accountId: a.id, data }] : [];
    });
    const count = enabled && badge ? pendingCount(lists, seen) : 0;
    showBadge(count).catch((e) => console.warn("Pastille de l'icône :", e));
  }, [accounts, seen, enabled, badge, version]);
}
