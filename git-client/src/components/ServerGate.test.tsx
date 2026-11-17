import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ServerGate } from "./ServerGate";
import { useServerStore } from "../store/useServerStore";

const session = (over: object) => ({ auth: "token", authenticated: false, user: null, forbidden: false, ...over });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));

function serve(routes: Record<string, () => Promise<Response>>) {
  const fetchMock = vi.fn((input: URL | string) => {
    const path = new URL(String(input), "https://nas/").pathname.replace(/^.*\/api\//, "");
    const route = routes[path];
    if (!route) throw new Error(`route inattendue : ${path}`);
    return route();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ServerGate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    useServerStore.setState({ info: null });
  });

  it("n'ajoute rien hors du mode serveur (Tauri)", () => {
    render(<ServerGate>contenu</ServerGate>);
    expect(screen.getByText("contenu")).toBeTruthy();
  });

  it("affiche l'application une fois connecté, et charge les infos du serveur", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    serve({
      session: () => json(session({ authenticated: true, user: "admin", auth: "dsm" })),
      "invoke/server_info": () => json({ version: "2.17.0", user: "admin", terminal: true, roots: ["/volume1/git"], auth: "dsm" }),
    });
    render(<ServerGate>contenu</ServerGate>);

    expect(await screen.findByText("contenu")).toBeTruthy();
    await waitFor(() => expect(useServerStore.getState().info?.terminal).toBe(true));
  });

  it("demande le jeton, et ouvre l'application une fois accepté", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    let signedIn = false;
    serve({
      session: () => json(session({ authenticated: signedIn })),
      login: () => {
        signedIn = true;
        return json(null, 204);
      },
      "invoke/server_info": () => json({ version: "2.17.0", user: null, terminal: false, roots: [], auth: "token" }),
    });
    render(<ServerGate>contenu</ServerGate>);

    const field = await screen.findByLabelText("Jeton d'accès du serveur");
    expect(screen.queryByText("contenu")).toBeNull();
    fireEvent.change(field, { target: { value: "un-jeton" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByText("contenu")).toBeTruthy();
  });

  it("montre l'erreur quand le jeton est refusé", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    serve({ session: () => json(session({})), login: () => json("jeton incorrect", 401) });
    render(<ServerGate>contenu</ServerGate>);

    fireEvent.change(await screen.findByLabelText("Jeton d'accès du serveur"), { target: { value: "mauvais" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect((await screen.findByRole("alert")).textContent).toContain("jeton incorrect");
    expect(screen.queryByText("contenu")).toBeNull();
  });

  it("explique à un utilisateur DSM sans autorisation pourquoi il ne peut pas entrer", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    serve({ session: () => json(session({ auth: "dsm", user: "dave", forbidden: true })) });
    render(<ServerGate>contenu</ServerGate>);

    expect((await screen.findByRole("alert")).textContent).toContain("dave n'est pas autorisé");
  });

  it("invite à se reconnecter à DSM quand la session DSM n'existe plus", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    serve({ session: () => json(session({ auth: "dsm" })) });
    render(<ServerGate>contenu</ServerGate>);

    expect(await screen.findByText(/Ta session DSM n'est plus ouverte/)).toBeTruthy();
  });

  it("signale un serveur injoignable", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    serve({ session: () => json("erreur", 502) });
    render(<ServerGate>contenu</ServerGate>);

    expect((await screen.findByRole("alert")).textContent).toContain("Le serveur Merathon ne répond pas");
  });
});
