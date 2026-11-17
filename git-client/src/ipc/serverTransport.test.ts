import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** WebSocket simulé : le test décide de l'ouverture et des messages reçus. */
class FakeSocket {
  static readonly instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: URL) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function reply(status: number, body: unknown) {
  let text: string | null = null;
  if (status !== 204) text = typeof body === "string" ? body : JSON.stringify(body);
  return Promise.resolve(new Response(text, { status }));
}

describe("transport du serveur (NAS)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    FakeSocket.instances.length = 0;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("appelle une commande en POST, avec le libellé de l'onglet", async () => {
    fetchMock.mockReturnValue(reply(200, [{ hash: "abc" }]));
    const { invoke, url } = await import("./serverTransport");

    await expect(invoke("get_commits", { path: "/depots/a", limit: 10 })).resolves.toEqual([{ hash: "abc" }]);

    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe(url("api/invoke/get_commits").href);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Merathon-Window"]).toMatch(/^tab-[0-9a-f]{16}$/);
    expect(JSON.parse(init.body as string)).toEqual({ path: "/depots/a", limit: 10 });
  });

  it("fonctionne sans crypto.randomUUID, absent en HTTP sur le réseau local (contexte non sécurisé)", async () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(0xab) });
    fetchMock.mockReturnValue(reply(200, null));
    const { invoke } = await import("./serverTransport");

    await invoke("app_info");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Merathon-Window"]).toBe("tab-abababababababab");
  });

  it("rejette avec l'erreur de la commande, telle que le serveur la renvoie", async () => {
    fetchMock.mockReturnValueOnce(reply(400, { kind: "NotFound", message: "Dépôt introuvable" }));
    fetchMock.mockReturnValueOnce(reply(400, "Dépôt introuvable"));
    const { invoke } = await import("./serverTransport");

    await expect(invoke("open_repository", { path: "/x" })).rejects.toEqual({ kind: "NotFound", message: "Dépôt introuvable" });
    await expect(invoke("open_repository", { path: "/x" })).rejects.toBe("Dépôt introuvable");
  });

  it("garde le texte brut d'une page d'erreur qui n'est pas du JSON (reverse proxy)", async () => {
    fetchMock.mockReturnValue(reply(502, "<html>Bad Gateway</html>"));
    const { invoke } = await import("./serverTransport");
    await expect(invoke("app_info")).rejects.toBe("<html>Bad Gateway</html>");
  });

  it("signale la perte de connexion quand le serveur répond 401", async () => {
    fetchMock.mockReturnValue(reply(401, "connexion requise"));
    const { invoke, AUTH_REQUIRED_EVENT } = await import("./serverTransport");
    const onAuth = vi.fn();
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuth);

    await expect(invoke("app_info")).rejects.toBe("connexion requise");
    expect(onAuth).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_REQUIRED_EVENT, onAuth);
  });

  it("rejette avec un texte quand le serveur est injoignable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { invoke } = await import("./serverTransport");
    await expect(invoke("app_info")).rejects.toBe("Failed to fetch (app_info)");
  });

  it("n'envoie d'un flux que son numéro, et le rend aux messages du WebSocket", async () => {
    fetchMock.mockReturnValue(reply(200, null));
    const { invoke, createChannel } = await import("./serverTransport");
    const received: unknown[] = [];

    await invoke("workdir_watch", { path: "/depots/a", onChange: createChannel((m) => received.push(m)) });

    // Le WebSocket est connecté avant la commande : le serveur y envoie les messages du flux.
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url.pathname).toMatch(/api\/ws$/);
    expect(FakeSocket.instances[0].url.searchParams.get("window")).toMatch(/^tab-/);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ path: "/depots/a", onChange: 1 });

    FakeSocket.instances[0].receive({ t: "channel", id: 1, data: { status: true, refs: false } });
    FakeSocket.instances[0].receive({ t: "channel", id: 99, data: "ignoré" });
    FakeSocket.instances[0].receive({ t: "ping" });
    expect(received).toEqual([{ status: true, refs: false }]);
  });

  it("transmet les événements diffusés aux écouteurs, jusqu'à leur arrêt", async () => {
    const { listen } = await import("./serverTransport");
    const handler = vi.fn();
    const stop = listen("debug-log", handler);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    FakeSocket.instances[0].receive({ t: "event", id: "debug-log", data: { level: "debug", message: "x" } });
    FakeSocket.instances[0].receive({ t: "event", id: "autre", data: 1 });
    stop();
    FakeSocket.instances[0].receive({ t: "event", id: "debug-log", data: { level: "debug", message: "y" } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ level: "debug", message: "x" });
  });

  it("lit l'état de la session et échange le jeton", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { auth: "token", authenticated: false, user: null, forbidden: false }));
    fetchMock.mockReturnValueOnce(reply(204, ""));
    fetchMock.mockReturnValueOnce(reply(401, "jeton incorrect"));
    const { fetchSession, login } = await import("./serverTransport");

    await expect(fetchSession()).resolves.toMatchObject({ auth: "token", authenticated: false });
    await expect(login("bon-jeton")).resolves.toBeUndefined();
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ token: "bon-jeton" });
    await expect(login("mauvais")).rejects.toBeTruthy();
  });
});
