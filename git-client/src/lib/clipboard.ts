/**
 * Copie un texte dans le presse-papiers. `navigator.clipboard` n'existe qu'en contexte sécurisé (HTTPS, localhost) : servi en HTTP
 * par un NAS sur le réseau local (http://192.168.x.x:8765), il est absent, et on retombe sur une copie par un champ temporaire.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(field);
  const focused = document.activeElement as HTMLElement | null;
  try {
    field.select();
    if (!document.execCommand("copy")) throw new Error("copy refused");
  } finally {
    field.remove();
    focused?.focus?.();
  }
}
