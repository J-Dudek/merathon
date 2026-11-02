import { describe, expect, it } from "vitest";
import { connectionHint, isKeyAlreadyRegistered, passphraseProblem, sshKeysPage } from "./sshSetup";

describe("sshSetup", () => {
  it("reconnaît une clé déjà enregistrée sur GitHub et GitLab", () => {
    expect(isKeyAlreadyRegistered("Validation Failed: key is already in use")).toBe(true);
    expect(isKeyAlreadyRegistered("fingerprint has already been taken")).toBe(true);
    expect(isKeyAlreadyRegistered("Resource not accessible by personal access token")).toBe(false);
  });

  it("donne la page d'ajout de clé de chaque forge", () => {
    expect(sshKeysPage({ provider: "github", base_url: "https://github.com/" })).toBe("https://github.com/settings/ssh/new");
    expect(sshKeysPage({ provider: "gitlab", base_url: "https://gitlab.corp.io" })).toBe("https://gitlab.corp.io/-/user_settings/ssh_keys");
  });

  it("exige une confirmation identique de la passphrase", () => {
    expect(passphraseProblem("", "")).toBeNull();
    expect(passphraseProblem("a", "a")).toBeNull();
    expect(passphraseProblem("a", "b")).not.toBeNull();
  });

  it("oriente vers l'agent SSH seulement si la clé peut avoir une passphrase", () => {
    expect(connectionHint(true, "Permission denied (publickey)")).toContain("ssh-add");
    expect(connectionHint(null, "Permission denied (publickey)")).toContain("ssh-add");
    expect(connectionHint(false, "Permission denied (publickey)")).toContain("enregistrée");
    expect(connectionHint(false, "Connection timed out")).toContain("port");
  });
});
