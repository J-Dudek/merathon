import { describe, expect, it } from "vitest";
import { identityIssue, keyNameFor, profileForAccount, profileForDir } from "./gitProfiles";
import type { GitProfile, IdentityStatus } from "../types/git";

const profile = (patch: Partial<GitProfile> = {}): GitProfile => ({
  id: "pro", label: "Pro", dir: "/dev/pro", user_name: "Camille", user_email: "c@pro.example", account_id: "gl", ssh_key: null, managed: true, ...patch,
});
const status = (patch: Partial<IdentityStatus>): IdentityStatus => ({
  name: "Camille", email: "c@perso.example", origin: "repo", profile: profile(), mismatch: true, outside: false, ...patch,
});

describe("gitProfiles", () => {
  it("trouve le profil d'un dossier sans confondre deux noms proches", () => {
    const list = [profile()];
    expect(profileForDir(list, "/dev/pro")?.id).toBe("pro");
    expect(profileForDir(list, "/dev/pro/app/")?.id).toBe("pro");
    expect(profileForDir(list, "/dev/pro-bis")).toBeUndefined();
    expect(profileForDir(list, "")).toBeUndefined();
    expect(profileForDir([profile({ dir: "C:/dev/pro" })], "C:\\dev\\pro\\app")?.id).toBe("pro");
  });

  it("trouve le profil lié à un compte", () => {
    expect(profileForAccount([profile()], "gl")?.id).toBe("pro");
    expect(profileForAccount([profile()], "gh")).toBeUndefined();
  });

  it("propose un nom de clé sûr", () => {
    expect(keyNameFor("GitLab Été (client)")).toBe("id_ed25519_gitlab_ete_client");
    expect(keyNameFor("!!!")).toBe("id_ed25519_profil");
  });

  it("ne signale rien quand l'identité est cohérente", () => {
    expect(identityIssue(null)).toBeNull();
    expect(identityIssue(status({ mismatch: false }))).toBeNull();
  });

  it("propose de reprendre le profil seulement si le réglage vient du dépôt", () => {
    const local = identityIssue(status({ origin: "repo" }))!;
    expect(local.canUseProfile).toBe(true);
    expect(local.message).toContain("c@perso.example");
    expect(local.message).toContain("c@pro.example");
    const global = identityIssue(status({ origin: "global" }))!;
    expect(global.canUseProfile).toBe(false);
    expect(global.message).toContain("[user]");
  });
});
