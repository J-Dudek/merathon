import { useEffect, useState } from "react";
import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { isWsl } from "../ipc/commands";
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

/** Pastille rouge avec le nombre (« 9+ » au-delà), de diamètre `d`, dont le coin haut droit est en (`right`, `top`). */
function drawBadge(ctx: CanvasRenderingContext2D, count: number, right: number, top: number, d: number) {
  ctx.fillStyle = "#e5484d";
  ctx.beginPath();
  ctx.arc(right - d / 2, top + d / 2, d / 2, 0, Math.PI * 2);
  ctx.fill();
  const text = count > 9 ? "9+" : String(count);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(d * (text.length > 1 ? 0.53 : 0.66))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, right - d / 2, top + d / 2 + d / 32);
}

/** Image Tauri du canvas. Les pixels passent en tableau : un `Uint8ClampedArray` arrive en objet côté Rust. */
function canvasImage(ctx: CanvasRenderingContext2D, width: number, height: number): Promise<Image> {
  return Image.new(Array.from(ctx.getImageData(0, 0, width, height).data), width, height);
}

/** Icône superposée de la barre des tâches Windows : la pastille seule. */
async function overlayImage(count: number): Promise<Image | undefined> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  drawBadge(ctx, count, SIZE, 0, SIZE);
  return canvasImage(ctx, SIZE, SIZE);
}

/**
 * Sous WSL, aucun lanceur ne lit `setBadgeCount` et l'icône superposée est hors de portée (la fenêtre Windows est
 * celle de WSLg) : la pastille est dessinée dans l'icône de la fenêtre, que WSLg transmet à la barre des tâches.
 */
async function badgedWindowIcon(count: number): Promise<Image | null> {
  const icon = await defaultWindowIcon();
  if (!icon || count === 0) return icon;
  const { width, height } = await icon.size();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return icon;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(await icon.rgba()), width, height), 0, 0);
  // Grande, pour rester lisible une fois l'icône réduite dans la barre des tâches.
  drawBadge(ctx, count, width, 0, Math.round(width * 0.6));
  return canvasImage(ctx, width, height);
}

const wsl = isWsl().catch(() => false);

/**
 * Pastille sur l'icône : Dock (macOS), lanceur qui la gère (Linux), icône superposée (Windows), icône de la fenêtre
 * (WSL). 0 l'efface.
 */
async function showBadge(count: number) {
  const win = getCurrentWindow();
  if (isWindows) await win.setOverlayIcon(count > 0 ? await overlayImage(count) : undefined);
  else if (await wsl) {
    const icon = await badgedWindowIcon(count);
    if (icon) await win.setIcon(icon);
  } else await win.setBadgeCount(count > 0 ? count : undefined);
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
