import { useRepoStore } from "../store/useRepoStore";
import logo from "../assets/logo.webp";

interface Props {
  onOpen: () => void;
  onInit: () => void;
  onClone: () => void;
  onOpenPath: (path: string) => void;
}

export function Welcome({ onOpen, onInit, onClone, onOpenPath }: Props) {
  const recent = useRepoStore((s) => s.recentRepos);
  const forget = useRepoStore((s) => s.forgetRecent);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="flex flex-col items-center text-center">
        <img
          src={logo}
          alt="Merathon — Git Repository Manager"
          width={176}
          height={176}
          draggable={false}
          className="w-44 h-44 rounded-3xl shadow-2xl shadow-black/40 ring-1 ring-overlay/10 select-none"
        />
        <p className="text-xs text-[var(--color-muted)] mt-4">Ouvre, crée ou clone un dépôt pour commencer</p>
      </div>
      <div className="flex gap-3">
        <WelcomeBtn onClick={onOpen} icon="📂" label="Ouvrir" />
        <WelcomeBtn onClick={onClone} icon="⇣" label="Cloner" />
        <WelcomeBtn onClick={onInit} icon="✚" label="Initialiser" />
      </div>
      {recent.length > 0 && (
        <div className="w-full max-w-lg">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)] mb-1">Récents</p>
          <ul className="border border-overlay/10 rounded divide-y divide-overlay/5">
            {recent.map((path) => (
              <li key={path} className="flex items-center group hover:bg-overlay/5">
                <button className="flex-1 text-left px-3 py-2 min-w-0" onClick={() => onOpenPath(path)}>
                  <p className="text-xs text-[var(--color-text)] truncate">{path.split(/[\\/]/).pop()}</p>
                  <p className="text-[10px] text-[var(--color-muted)] font-mono truncate">{path}</p>
                </button>
                <button
                  className="px-3 text-[var(--color-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-text)]"
                  title="Retirer de la liste"
                  onClick={() => forget(path)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WelcomeBtn({ onClick, icon, label }: { onClick: () => void; icon: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className="w-28 h-24 flex flex-col items-center justify-center gap-2 rounded-lg border border-overlay/10 bg-overlay/5 hover:bg-overlay/10 transition-colors"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-xs text-[var(--color-text)]">{label}</span>
    </button>
  );
}
