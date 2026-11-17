// Essai de la page ouverte par l'icône du menu DSM (package/app/open.js), sans navigateur : node test-launcher.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const code = readFileSync(new URL("package/app/open.js", import.meta.url), "utf8");

function run({ url = "", port = "8765", protocol, hostname = "nas.example", language = "fr-FR" }) {
  const elements = { message: {}, link: { hidden: true }, help: {} };
  let redirected = null;
  const window = { MERATHON_URL: url, MERATHON_PORT: port, location: { protocol, hostname, replace: (to) => (redirected = to) } };
  const document = { getElementById: (id) => elements[id] };
  new Function("window", "document", "navigator", code)(window, document, { language });
  return { redirected, ...elements };
}

// Adresse indiquée à l'installation (proxy inverse) : on y va, quel que soit le protocole de DSM.
assert.equal(run({ url: "https://merathon.nas.example", protocol: "https:" }).redirected, "https://merathon.nas.example");

// Pas d'adresse, DSM en HTTP : le port du service, directement.
assert.equal(run({ protocol: "http:", port: "8764" }).redirected, "http://nas.example:8764/");

// Pas d'adresse, DSM en HTTPS : pas de redirection vers une erreur, mais le lien et la marche à suivre.
const https = run({ protocol: "https:" });
assert.equal(https.redirected, null);
assert.equal(https.link.href, "http://nas.example:8765/");
assert.equal(https.link.hidden, false);
assert.match(https.help.textContent, /MERATHON_PUBLIC_URL/);
assert.match(run({ protocol: "https:", language: "en-GB" }).help.textContent, /reverse proxy/);

// Une adresse qui n'est pas http(s) (fichier modifié à la main) n'est jamais suivie.
assert.equal(run({ url: "javascript:alert(1)", protocol: "http:" }).redirected, "http://nas.example:8765/");

console.log("OK : page de l'icône");
