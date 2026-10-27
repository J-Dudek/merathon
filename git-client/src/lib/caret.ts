const MIRRORED = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "tabSize",
] as const;

/**
 * Position du curseur dans un textarea, en pixels depuis son coin haut gauche (défilement déduit) : un double invisible
 * du champ reçoit le texte jusqu'au curseur, suivi d'un repère dont on lit la position.
 */
export function caretPosition(el: HTMLTextAreaElement, pos: number): { top: number; left: number; height: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const prop of MIRRORED) mirror.style[prop] = style[prop];
  Object.assign(mirror.style, {
    position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", overflowWrap: "break-word",
  });
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(pos) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const height = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 12) * 1.2;
  const result = { top: marker.offsetTop - el.scrollTop, left: marker.offsetLeft - el.scrollLeft, height };
  mirror.remove();
  return result;
}
