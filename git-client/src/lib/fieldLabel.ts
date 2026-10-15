/**
 * Étiquette d'un champ sans libellé visible (seulement un texte d'exemple, que le RGAA n'accepte pas comme étiquette).
 * `aria-label` donne le nom aux technologies d'assistance ; `title` le rend aussi consultable à l'écran (RGAA 11.1.3).
 */
export const fieldLabel = (text: string) => ({ "aria-label": text, title: text });
