# Merathon on a NAS (Synology, Docker)

Merathon can run on a NAS: the `merathon-server` service (the same Git engine as the desktop app, without a window) serves
the interface to your browser. Repositories stay on the NAS.

## Install the Synology package (DSM 7.2 or later)

1. Download the `.spk` for your processor from the [latest release](https://github.com/J-Dudek/merathon/releases/latest):
   `merathon-<version>-x86_64.spk` (Intel, AMD) or `merathon-<version>-armv8.spk` (64-bit ARM).
2. **Package Center > Manual Install**: pick the file. DSM warns about a package from an unverified publisher: that is expected,
   the package is not signed by Synology.
3. The wizard asks for:
   - the **name of the shared folder** that holds the repositories (for example `git`): DSM creates it if it does not exist and
     automatically gives read/write permission to the package's `merathon` system user (DSM 7 forbids packages from running as root);
   - the **access token** (16 characters or more): it is asked for every time you sign in from a browser (a session lasts 12 hours and
     ends when the package restarts); keep it in a password manager;
   - whether to enable the **integrated terminal** (off by default).
4. Copy your repositories into that shared folder (or clone them from Merathon), then open them from the folder picker.
5. Open Merathon from its DSM menu icon, at `http://<NAS IP>:8765/`, or better through the HTTPS reverse proxy described below.

### The DSM menu icon

The icon opens a page served by DSM, which leads to Merathon: to the **Merathon address** entered in the wizard (your reverse proxy's, for example
`https://merathon.mynas.myds.me`), otherwise to `http://<NAS>:8765/`. With no address and DSM over HTTPS, the page explains what to do instead of
failing. To change the address later: `MERATHON_PUBLIC_URL='https://…'` in `/var/packages/Merathon/var/config.env` (file owned by the `merathon`
user, mode 600), then stop and start the package.

### Automatic updates

Add Merathon's package source in **Package Center > Settings > Package Sources**:

```
https://github.com/J-Dudek/merathon/releases/latest/download/packages.json
```

New versions then show up in Package Center.

## HTTPS: do this before exposing the service outside your local network

Port 8765 speaks plain HTTP: the access token travels in clear text. Put Merathon behind the DSM reverse proxy:

1. **Control Panel > Login Portal > Advanced > Reverse Proxy > Create**;
2. source: `HTTPS`, your host name, a port (or `merathon.your-nas.example`); destination: `HTTP`, `localhost`, `8765`;
3. **Custom Header > Create > WebSocket** (Merathon pushes repository changes and the terminal over a WebSocket): it is the **only** header
   needed. Do not tick HSTS on the rule: your DSM domain's own is enough, and enabling it is a lasting commitment;
4. so that only the proxy reaches the service, set `MERATHON_BIND='127.0.0.1:8765'` in `/var/packages/Merathon/var/config.env`
   (the file must stay owned by the `merathon` user, mode 600), then stop and start the package. The package does not declare its port to DSM:
   with the DSM firewall on and no proxy, open port 8765 by hand.

## "Open" does not work with the NAS name (`mynas.myds.me`)

The service speaks HTTP on port 8765. DSM sends the HSTS header: a browser that has seen it then rewrites **every** `http://mynas.myds.me:<port>` call to `https://`,
on any port, and the connection fails. With the IP address (`http://192.168.x.x:8765/`) there is no HSTS: that is the address to use without a proxy. To use the
NAS name, go through the DSM HTTPS reverse proxy (previous section). Serving HTTPS yourself does not help: DSM's certificate is not readable by a package, and
a self-signed certificate is flatly refused on an HSTS domain.

Served over HTTP, the interface works; copying to the clipboard uses a fallback.

## Sign-in

The package signs in with an **access token**: the sign-in page exchanges it for a session cookie (`HttpOnly`, `SameSite=Strict`) valid for
12 hours. The token is therefore asked again for each new session, and after the package restarts. It is stored in
`/var/packages/Merathon/var/config.env` (`MERATHON_TOKEN`), readable by the package user only.

> The server also has a `dsm` mode (recognising the user's DSM session through `authenticate.cgi`). It is **experimental, not validated and not
> offered by the wizard**: do not enable it in production.

## Docker image (Container Manager, Unraid, TrueNAS…)

The image is published with every release, for x86_64 and 64-bit ARM: `ghcr.io/j-dudek/merathon`.

**Container Manager (DSM):** *Registry > Settings > Add* the `ghcr.io` registry, search for `j-dudek/merathon`, download the `latest` image,
then create the container: port `8765`, variable `MERATHON_TOKEN` (16 characters or more), volumes `/data` (settings and accounts) and
`/repos` (your repositories, for example `/volume1/git`).

**Command line:**

```sh
docker run -d --name merathon -p 8765:8765 \
  -e MERATHON_TOKEN='a-token-of-16-characters-or-more' \
  -v merathon-data:/data -v /volume1/git:/repos ghcr.io/j-dudek/merathon:latest
```

To build it yourself: `docker build -f packaging/docker/Dockerfile -t merathon .` (several minutes of Rust compilation).

The image starts in `token` mode and refuses to start without a token. Repositories live in `/repos` (user `1000`: give it
permissions on the mounted folder). The image ships `git`, `git-lfs` and `ssh`.

## Settings (environment variables)

| Variable | Purpose | Default |
|---|---|---|
| `MERATHON_BIND` | listen address | `127.0.0.1:8765` (the package: `0.0.0.0:8765`) |
| `MERATHON_AUTH` | `token`, `none` (development, local address only) or `dsm` (experimental) | `token` |
| `MERATHON_TOKEN` / `MERATHON_TOKEN_FILE` | access token (16+ characters) or a file holding it | |
| `MERATHON_ALLOWED_ROOTS` | folders where repositories can be opened, separated by `:` — **required** with authentication | |
| `MERATHON_TERMINAL` | `1` to allow the integrated terminal | off |
| `MERATHON_DATA_DIR`, `MERATHON_CONFIG_DIR` | data and accounts | `~/.local/share/merathon`, `<data>/config` |
| `MERATHON_WEB_DIR` | interface (`dist-server/`) | `dist` |
| `MERATHON_BASE_PATH` | URL prefix behind a reverse proxy (`/merathon`) | empty |
| `MERATHON_ALLOWED_USERS`, `MERATHON_ALLOWED_GROUPS` | `dsm` mode: allowed users and groups (`,`-separated) | `administrators` group |
| `MERATHON_DSM_CGI`, `MERATHON_GROUP_FILE` | `dsm` mode: `authenticate.cgi` and the group file | DSM paths |
| `MERATHON_FRAME_ANCESTORS` | origins allowed to show Merathon in a frame | `'self'` |
| `MERATHON_PUBLIC_URL` | Synology package: address opened by the DSM menu icon (read by the start script, not by the server) | empty |
| `MERATHON_KEEP_HOME` | do not replace `HOME` with the data folder | |

Git reads its global configuration, SSH keys and `known_hosts` from `HOME`: the service keeps them in its data folder.
**Every user of the service therefore shares the same Git identity (commit name and e-mail) and the same SSH keys**; only the GitHub /
GitLab accounts (tokens) would be separated per user in the experimental `dsm` mode. Merathon is meant for one person, or a team that shares an identity; Merathon's Git
profiles let you vary the identity from one repository to another. SSH key creation uses `ssh-keygen` (provided by DSM with its OpenSSH).

## Git and Git LFS

Merathon does not need the `git` program: reading, commits, push and pull go through libgit2, built into the binary. Only **Git LFS**
runs `git lfs …`: DSM ships neither `git` nor `git-lfs`. For LFS repositories, install Synology's "Git Server" package (it provides `git`)
and then `git-lfs`; without them Merathon shows "git-lfs is not installed" and everything else works. The Docker image ships both.

## Security

The service gives access to repositories, forge tokens and (if you enable it) a terminal: treat access to it like a shell on the NAS.

- received paths are confined to the allowed folders (`..` and outgoing symlinks refused);
- the `Origin` of requests and of the WebSocket must be the service's own; every command requires the `X-Merathon-Window` header;
- strict CSP, `X-Content-Type-Options`, `Referrer-Policy`;
- the terminal stays off until the administrator turns it on;
- the service refuses `MERATHON_AUTH=none` outside the loopback address.

## Differences from the desktop app

- no automatic update (Package Center or a new Docker image handles it), but Merathon announces new versions published on GitHub: a
  banner when the page loads (at most one check a day, a single announcement per version and per browser), and "Check for updates…" in
  the menu or in Preferences › About. The NAS must be able to reach `api.github.com`;
- no icon badge, no title-bar theme;
- no "New window": Merathon's tabs (and the browser's) take its place; links open in a new tab;
- the interface size is the browser's zoom (Ctrl+= / Ctrl+- / Ctrl+0), which it remembers for Merathon's address: Merathon does not add
  its own zoom on top;
- Merathon's tabs use Alt (Alt+T, Alt+W, Alt+PgDn / PgUp): the browser keeps Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+PgDn / PgUp
  for its own tabs. Ctrl+W therefore closes the browser tab, even from the integrated terminal: while a shell runs there, the browser
  asks for confirmation;
- the folder picker browses the NAS's allowed folders;
- no system notifications: the activity of my PRs / MRs is shown as a banner inside Merathon (Preferences › Synchronization);
- automatic synchronization runs while a Merathon page is open. Several pages (people, tabs) open the same repositories: the NAS runs
  the fetches, pulls and pushes of one repository one after the other (two simultaneous fetches would fight over its locks), and does not
  repeat an automatic fetch another page has just done, less than a minute earlier. A fetch requested by hand is always done;
- "Show in file manager" does not exist;
- Git LFS needs the `git` and `git-lfs` binaries on the NAS (already in the Docker image, to be installed separately with the Synology package).

## Building it yourself

```sh
# interface
cd git-client && npm ci && npm run build:server          # dist-server/
# server (glibc, for development)
cd src-tauri && cargo build --release --no-default-features --features server --bin merathon-server
# static binary and interface for the package: packaging/docker/Dockerfile (the "artifacts" target)
packaging/synology/build-spk.sh <version> x86_64 <merathon-server> <dist-server>
packaging/synology/verify-spk.py packaging/synology/dist/merathon-<version>-x86_64.spk
```
