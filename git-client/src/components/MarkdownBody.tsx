import { createContext, memo, useContext, useMemo, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Image } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { remarkEmojiShortcodes, resolveForgeLink } from "../lib/markdown";

const REMARK_PLUGINS = [remarkGfm, remarkEmojiShortcodes];
// Le HTML écrit dans le texte (<details>, <br>, <img>…) est filtré avec les règles de GitHub : ni script, ni style, ni événement.
const REHYPE_PLUGINS = [rehypeRaw, rehypeSanitize];

const InsideLink = createContext(false);

function ForgeLink({ href, prUrl, children }: { href?: string; prUrl: string; children: ReactNode }) {
  const url = href ? resolveForgeLink(href, prUrl) : null;
  if (!url) return <>{children}</>;
  return (
    <a
      href={url}
      // Le lien s'ouvre dans le navigateur du système : la fenêtre de l'application ne doit pas quitter son interface.
      onClick={(e) => { e.preventDefault(); openUrl(url).catch(() => {}); }}
    >
      <InsideLink.Provider value={true}>{children}</InsideLink.Provider>
    </a>
  );
}

/** La CSP n'autorise aucune image distante : une image devient un lien vers sa source. */
function ForgeImage({ src, alt, prUrl }: { src?: string; alt?: string; prUrl: string }) {
  const insideLink = useContext(InsideLink);
  const label = (
    <span className="markdown-image">
      <Image size={12} aria-hidden="true" />
      {alt || "Image"}
    </span>
  );
  return insideLink ? label : <ForgeLink href={src} prUrl={prUrl}>{label}</ForgeLink>;
}

/** Texte Markdown d'une PR / MR (description, commentaire), avec ses emojis. `prUrl` sert à résoudre les liens relatifs. */
export const MarkdownBody = memo(function MarkdownBody({ text, prUrl, className = "" }: {
  text: string;
  prUrl: string;
  className?: string;
}) {
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => <ForgeLink href={href} prUrl={prUrl}>{children}</ForgeLink>,
    img: ({ src, alt }) => <ForgeImage src={typeof src === "string" ? src : undefined} alt={alt} prUrl={prUrl} />,
    // Les titres du texte restent sous ceux de la fenêtre (h3), pour garder une hiérarchie correcte.
    h1: "h4",
    h2: "h5",
    h3: "h6",
    h4: "h6",
    h5: "h6",
  }), [prUrl]);

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
