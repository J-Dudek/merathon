import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import logo from "../assets/logo.webp";
import { serverInfo } from "../ipc/commands";
import { AUTH_REQUIRED_EVENT, fetchSession, login, type SessionStatus } from "../ipc/serverTransport";
import { isServer } from "../lib/platform";
import { useServerStore } from "../store/useServerStore";
import { errorMessage } from "../lib/actions";
import { Button, inputClass } from "./Modal";
import { tr } from "../i18n";

function Panel({ children }: { children: ReactNode }) {
  return (
    <main className="h-screen w-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)] p-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
        <img src={logo} alt="" className="h-16 w-16 rounded-xl" />
        <h1 className="text-lg font-semibold">Merathon</h1>
        {children}
      </div>
    </main>
  );
}

function TokenForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(token);
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full flex flex-col gap-3 text-left">
      <label className="text-xs text-[var(--color-muted)]" htmlFor="merathon-token">
        {tr("Jeton d'accès du serveur")}
      </label>
      <input
        id="merathon-token"
        type="password"
        autoFocus
        autoComplete="current-password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className={inputClass}
      />
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy || token.length === 0}>
        {tr("Se connecter")}
      </Button>
    </form>
  );
}

/**
 * Sur un NAS, l'interface est une page web : elle ne s'affiche qu'une fois la connexion au serveur établie (jeton
 * partagé, ou session DSM). Sans le mode serveur (Tauri), elle ne fait rien.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchSession()
      .then((status) => {
        setFailure(null);
        setSession(status);
        if (status.authenticated) serverInfo().then((info) => useServerStore.setState({ info })).catch(() => {});
      })
      .catch((e) => setFailure(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (!isServer()) return;
    refresh();
    // Session expirée en cours d'utilisation : le serveur répond 401 à une commande.
    window.addEventListener(AUTH_REQUIRED_EVENT, refresh);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, refresh);
  }, [refresh]);

  if (!isServer() || session?.authenticated) return <>{children}</>;

  if (failure) {
    return (
      <Panel>
        <p role="alert" className="text-sm text-red-400">
          {tr("Le serveur Merathon ne répond pas : {error}", { error: failure })}
        </p>
        <Button onClick={refresh}>{tr("Réessayer")}</Button>
      </Panel>
    );
  }
  if (!session) return <Panel>{<p className="text-sm text-[var(--color-muted)]">{tr("Connexion au serveur…")}</p>}</Panel>;

  if (session.forbidden) {
    return (
      <Panel>
        <p role="alert" className="text-sm">
          {tr("{user} n'est pas autorisé à utiliser Merathon. Demande à un administrateur du NAS de t'en donner l'accès.", { user: session.user })}
        </p>
      </Panel>
    );
  }
  if (session.auth === "token") {
    return (
      <Panel>
        <TokenForm onSignedIn={refresh} />
      </Panel>
    );
  }
  return (
    <Panel>
      <p className="text-sm">{tr("Ta session DSM n'est plus ouverte. Reconnecte-toi à DSM, puis rouvre Merathon depuis son menu.")}</p>
      <Button onClick={refresh}>{tr("Réessayer")}</Button>
    </Panel>
  );
}
