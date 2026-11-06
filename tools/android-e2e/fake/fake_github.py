"""Faux GitHub Enterprise pour tester Merathon (données fictives).

REST /api/v3, GraphQL /api/graphql (requêtes reconnues par mots-clés), git smart HTTP via git http-backend.
Écoute 127.0.0.1:$E2E_GITHUB_PORT (8765) ; l'émulateur y accède par `adb reverse tcp:8765 tcp:8765`.
Dépôts et journal des requêtes (requests.log) dans $E2E_WORK (créé par make_repos.sh).
Actions de test : /__test/reset, /__test/teammate-push, /__test/ci?pr=9&state=pending, /__test/approve?pr=9&by=lea,
/__test/state (état des PR, en JSON).
"""
import base64, json, os, re, subprocess, sys, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get("E2E_WORK") or os.path.join(os.path.dirname(HERE), ".work")
SRV = os.path.join(WORK, "srv")
PORT = int(os.environ.get("E2E_GITHUB_PORT", "8765"))
BASE = "http://localhost:%d" % PORT
ME = "camille"
LOG = open(os.path.join(WORK, "requests.log"), "a", buffering=1)
GITENV = {**{k: v for k, v in os.environ.items() if k in ("PATH", "LANG")}, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}

USERS = {
    "camille": {"id": 1, "login": "camille", "name": "Camille Martin"},
    "noah": {"id": 2, "login": "noah", "name": "Noah Petit"},
    "lea": {"id": 3, "login": "lea", "name": "Léa Bernard"},
}
LOCK = threading.Lock()
SEQ = [1000]


def nid():
    SEQ[0] += 1
    return SEQ[0]


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def git(repo, *args, input=None):
    r = subprocess.run(["git", "-C", os.path.join(SRV, "atelier", repo + ".git"), *args],
                       capture_output=True, input=input, env=GITENV)
    return r.stdout.decode().strip(), r.returncode


def sha(repo, ref):
    out, code = git(repo, "rev-parse", "--verify", "-q", ref)
    return out if code == 0 else None


LABELS = [{"name": "bug", "color": "d73a4a"}, {"name": "amélioration", "color": "a2eeef"}, {"name": "mobile", "color": "0e8a16"}]
MILESTONES = [{"number": 1, "title": "v1.1"}, {"number": 2, "title": "v2.0"}]

STATE = {"site-vitrine": {}, "boutique-api": {}}


def mkpr(repo, number, title, author, head, base="main", body="", reviewers=(), assignees=(), labels=(), draft=False, created="2026-10-25T09:00:00Z"):
    STATE[repo].setdefault("prs", {})[number] = {
        "number": number, "title": title, "user": author, "head": head, "base": base, "body": body,
        "reviewers": list(reviewers), "assignees": list(assignees), "labels": list(labels), "draft": draft,
        "state": "open", "merged_at": None, "created_at": created, "updated_at": created,
        "comments": [], "reviews": [], "threads": [], "ci": "success",
    }


def reset():
    for r in STATE:
        STATE[r].clear()
        STATE[r]["prs"] = {}
        STATE[r]["issues"] = {}
    mkpr("site-vitrine", 9, "Ajoute le panier", "noah", "feature/panier", body="Ajoute un panier simple.\n\nCloses #8",
         reviewers=["camille"], labels=["amélioration"], created="2026-10-25T09:00:00Z")
    mkpr("site-vitrine", 7, "Corrige le menu sur mobile", "camille", "fix/menu-mobile", body="Le menu ne s'ouvrait pas.",
         reviewers=["lea"], assignees=["camille"], labels=["bug", "mobile"], created="2026-10-26T11:00:00Z")
    pr9 = STATE["site-vitrine"]["prs"][9]
    pr9["comments"].append({"id": nid(), "user": "lea", "body": "Joli ! Pense au total du panier.", "created_at": "2026-10-25T12:00:00Z"})
    pr9["threads"].append({"id": "T_1", "path": "js/panier.js", "line": 4, "side": "RIGHT", "resolved": False,
                           "comments": [{"id": nid(), "user": "lea", "body": "Vérifier que l'article n'est pas nul ?", "created_at": "2026-10-25T12:05:00Z"}]})
    pr7 = STATE["site-vitrine"]["prs"][7]
    pr7["reviews"].append({"id": nid(), "user": "lea", "state": "APPROVED", "body": "OK pour moi", "submitted_at": "2026-10-26T15:00:00Z"})
    issues = STATE["site-vitrine"]["issues"]
    for n, t, st, lab in [(8, "Ajouter un panier", "open", ["amélioration"]), (5, "Le menu ne s'ouvre pas sur mobile", "open", ["bug", "mobile"]),
                          (3, "Ajouter une page contact", "open", []), (2, "Faute dans le titre", "closed", ["bug"])]:
        issues[n] = {"number": n, "title": t, "state": st, "user": "lea", "labels": lab, "created_at": "2026-10-20T10:00:00Z", "body": ""}


reset()


def user(login):
    u = USERS.get(login) or {"id": 99, "login": login}
    return {"id": u["id"], "login": u["login"]}


def raw_pr(repo, p, detail=False):
    head_sha = sha(repo, "refs/heads/" + p["head"]) or sha(repo, "refs/pull/%d/head" % p["number"]) or ""
    d = {
        "number": p["number"], "node_id": "PR_%s_%d" % (repo, p["number"]), "title": p["title"], "state": p["state"],
        "user": user(p["user"]), "html_url": "%s/atelier/%s/pull/%d" % (BASE, repo, p["number"]),
        "created_at": p["created_at"], "updated_at": p["updated_at"], "merged_at": p["merged_at"], "draft": p["draft"],
        "labels": [l for l in LABELS if l["name"] in p["labels"]], "head": {"ref": p["head"], "sha": head_sha},
        "base": {"ref": p["base"]}, "requested_reviewers": [user(u) for u in p["reviewers"]],
        "assignees": [user(u) for u in p["assignees"]], "body": p["body"],
    }
    if detail:
        mergeable = True
        base_sha = sha(repo, "refs/heads/" + p["base"])
        if head_sha and base_sha:
            _, code = git(repo, "merge-tree", "--write-tree", base_sha, head_sha)
            mergeable = code == 0
        d.update({"mergeable": mergeable, "mergeable_state": "clean" if mergeable else "dirty",
                  "comments": len(p["comments"]), "review_comments": sum(len(t["comments"]) for t in p["threads"])})
    return d


def raw_issue(repo, i):
    return {"number": i["number"], "title": i["title"], "state": i["state"], "user": user(i["user"]),
            "html_url": "%s/atelier/%s/issues/%d" % (BASE, repo, i["number"]), "created_at": i["created_at"],
            "updated_at": i["created_at"], "labels": [l for l in LABELS if l["name"] in i["labels"]], "body": i.get("body", "")}


def review_decision(p):
    last = {}
    for r in p["reviews"]:
        if r["state"] in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            last[r["user"]] = r["state"]
    return [s for s in last.values() if s != "DISMISSED"]


def search_node(repo, p):
    head_sha = sha(repo, "refs/heads/" + p["head"]) or ""
    committer = None
    if head_sha:
        email, _ = git(repo, "log", "-1", "--format=%ce", head_sha)
        committer = email.split("@")[0]
    rollup = {"success": "SUCCESS", "pending": "PENDING", "failure": "FAILURE"}[p["ci"]]
    return {
        "number": p["number"], "title": p["title"], "url": "%s/atelier/%s/pull/%d" % (BASE, repo, p["number"]),
        "createdAt": p["created_at"], "updatedAt": p["updated_at"], "isDraft": p["draft"], "headRefName": p["head"],
        "baseRefName": p["base"], "headRefOid": head_sha, "author": {"login": p["user"]},
        "repository": {"nameWithOwner": "atelier/" + repo}, "labels": {"nodes": [{"name": l} for l in p["labels"]]},
        "assignees": {"nodes": [{"login": a} for a in p["assignees"]]},
        "reviewRequests": {"nodes": [{"requestedReviewer": {"login": r}} for r in p["reviewers"]]},
        "reviewDecision": None, "latestOpinionatedReviews": {"nodes": [{"state": s} for s in review_decision(p)]},
        "mergeable": "MERGEABLE",
        "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": rollup}, "committer": {"user": {"login": committer} if committer else None}}}]},
    }


def find_pr_by_node(node):
    m = re.match(r"PR_(.+)_(\d+)$", node or "")
    return STATE[m.group(1)]["prs"][int(m.group(2))] if m else None


def find_thread(tid):
    for repo in STATE:
        for p in STATE[repo]["prs"].values():
            for t in p["threads"]:
                if t["id"] == tid:
                    return t
    return None


def graphql(q, v):
    if "mutation" in q:
        if "resolveReviewThread" in q or "unresolveReviewThread" in q:
            t = find_thread(v.get("id"))
            if t:
                t["resolved"] = "unresolve" not in q
            return {"x": {"thread": {"isResolved": bool(t and t["resolved"])}}}
        if "PullRequestToDraft" in q or "ReadyForReview" in q:
            p = find_pr_by_node(v.get("id"))
            if p:
                p["draft"] = "ToDraft" in q
            return {"x": {"pullRequest": {"isDraft": bool(p and p["draft"])}}}
        if "requestReviews" in q:
            p = find_pr_by_node(v.get("id"))
            ids = {u["id"]: l for l, u in USERS.items()}
            if p:
                p["reviewers"] = [ids[int(i.split("_")[1])] for i in v.get("users", [])]
            return {"requestReviews": {"clientMutationId": None}}
        return {}
    if "viewer" in q and "search" in q:
        out = {"viewer": {"login": ME}}
        for key, pred in [("assigned", lambda p: ME in p["assignees"]), ("reviewing", lambda p: ME in p["reviewers"]), ("authored", lambda p: p["user"] == ME)]:
            out[key] = {"nodes": [search_node(r, p) for r in STATE for p in STATE[r]["prs"].values() if p["state"] == "open" and pred(p)]}
        return out
    repo = v.get("repo") or v.get("name")
    data = {}
    if repo in STATE:
        prs = STATE[repo]["prs"]
        if "pullRequests(states: OPEN" in q:
            nodes = [{"number": p["number"], "reviewDecision": None, "latestOpinionatedReviews": {"nodes": [{"state": s} for s in review_decision(p)]}}
                     for p in sorted(prs.values(), key=lambda p: p["created_at"], reverse=True) if p["state"] == "open"]
            data["repository"] = {"pullRequests": {"nodes": nodes}}
        elif "viewerCanMergeAsAdmin" in q:
            data["repository"] = {"pullRequest": {"viewerCanMergeAsAdmin": True}}
        elif "reviewThreads" in q and "reviewRequests" not in q:
            p = prs.get(v.get("number"))
            data["repository"] = {"pullRequest": p and {"reviewThreads": {"nodes": [{
                "id": t["id"], "isResolved": t["resolved"], "path": t["path"], "line": t["line"], "diffSide": t["side"],
                "comments": {"nodes": [{"databaseId": c["id"], "body": c["body"], "createdAt": c["created_at"], "author": {"login": c["user"]}} for c in t["comments"]]},
            } for t in p["threads"]]}}}
        elif "reviewRequests" in q:
            p = prs.get(v.get("number"))
            data["repository"] = {"pullRequest": p and {"id": "PR_%s_%d" % (repo, p["number"]), "reviewRequests": {"nodes": []}}}
    for k, val in v.items():
        if re.match(r"u\d+$", k):
            data[k] = {"id": "U_%d" % USERS[val]["id"]} if val in USERS else None
    return data


def contents(repo, path):
    ref = "HEAD"
    if path:
        kind, code = git(repo, "cat-file", "-t", "%s:%s" % (ref, path))
        if code:
            return 404, {"message": "Not Found"}
        if kind == "blob":
            out = subprocess.run(["git", "-C", os.path.join(SRV, "atelier", repo + ".git"), "show", "%s:%s" % (ref, path)], capture_output=True, env=GITENV).stdout
            return 200, {"name": path.split("/")[-1], "path": path, "type": "file", "encoding": "base64", "content": base64.encodebytes(out).decode()}
    out, code = git(repo, "ls-tree", "%s:%s" % (ref, path) if path else ref)
    if code:
        return 404, {"message": "Not Found"}
    entries = []
    for line in out.splitlines():
        meta, name = line.split("\t", 1)
        typ = meta.split()[1]
        entries.append({"name": name, "path": (path + "/" if path else "") + name, "type": "dir" if typ == "tree" else "file"})
    return 200, entries


def rest(method, path, query, body):
    if path == "/user":
        return 200, {**USERS[ME], "email": "camille@example.com"}
    if path == "/user/keys" and method == "POST":
        with open(os.path.join(WORK, "authorized_keys"), "a") as f:
            f.write(body.get("key", "").strip() + "\n")
        return 201, {"id": nid(), "title": body.get("title"), "key": body.get("key")}
    if path == "/user/repos":
        return 200, [{"name": r, "full_name": "atelier/" + r, "clone_url": "%s/atelier/%s.git" % (BASE, r),
                      "ssh_url": "git@localhost:atelier/%s.git" % r, "private": True,
                      "description": {"site-vitrine": "Site de l’atelier", "boutique-api": "API de la boutique"}[r],
                      "updated_at": "2026-10-27T08:00:00Z"} for r in STATE]
    m = re.match(r"/users/([^/]+)$", path)
    if m:
        return (200, USERS[m.group(1)]) if m.group(1) in USERS else (404, {"message": "Not Found"})
    if path == "/search/issues":
        q = query.get("q", [""])[0]
        m = re.search(r"repo:atelier/(\S+)", q)
        repo = m.group(1) if m else "site-vitrine"
        words = [w for w in q.split() if not w.startswith(("repo:", "is:"))]
        items = [raw_issue(repo, i) for i in STATE.get(repo, {}).get("issues", {}).values() if all(w.lower() in i["title"].lower() for w in words)]
        return 200, {"total_count": len(items), "items": items}
    m = re.match(r"/repos/atelier/([^/]+)(/.*)?$", path)
    if not m or m.group(1) not in STATE:
        return 404, {"message": "Not Found"}
    repo, rest_path = m.group(1), m.group(2) or ""
    st = STATE[repo]
    prs, issues = st["prs"], st["issues"]
    if rest_path == "":
        return 200, {"name": repo, "full_name": "atelier/" + repo, "default_branch": "main", "allow_merge_commit": True,
                     "allow_squash_merge": True, "allow_rebase_merge": True, "permissions": {"push": True, "admin": True}}
    if rest_path == "/branches":
        out, _ = git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads")
        return 200, [{"name": b} for b in out.splitlines()]
    if rest_path == "/assignees":
        return 200, [user(u) for u in USERS]
    if rest_path == "/labels":
        return 200, LABELS
    if rest_path == "/milestones":
        return 200, MILESTONES
    m = re.match(r"/contents/?(.*)$", rest_path)
    if m:
        return contents(repo, unquote(m.group(1)))
    m = re.match(r"/commits/([0-9a-f]+)/(check-runs|status)$", rest_path)
    if m:
        p = next((p for p in prs.values() if sha(repo, "refs/heads/" + p["head"]) == m.group(1)), None)
        ci = p["ci"] if p else "success"
        if m.group(2) == "check-runs":
            run = {"name": "tests", "status": "completed" if ci != "pending" else "in_progress", "conclusion": None if ci == "pending" else ci, "html_url": BASE + "/ci/1"}
            return 200, {"total_count": 1, "check_runs": [run]}
        return 200, {"statuses": []}
    if rest_path == "/pulls" and method == "GET":
        state = query.get("state", ["open"])[0]
        lst = [raw_pr(repo, p) for p in sorted(prs.values(), key=lambda p: p["created_at"], reverse=True) if state == "all" or p["state"] == state]
        return 200, lst
    if rest_path == "/pulls" and method == "POST":
        if not sha(repo, "refs/heads/" + body["head"]):
            return 422, {"message": "Validation Failed", "errors": [{"message": "head branch %s not found" % body["head"]}]}
        n = max([*prs, *issues, 0]) + 1
        mkpr(repo, n, body["title"], ME, body["head"], body.get("base", "main"), body.get("body") or "", draft=body.get("draft", False), created=now())
        return 201, raw_pr(repo, prs[n], True)
    m = re.match(r"/pulls/(\d+)(/.*)?$", rest_path)
    if m:
        p = prs.get(int(m.group(1)))
        if not p:
            return 404, {"message": "Not Found"}
        sub = m.group(2) or ""
        p_touch = lambda: p.__setitem__("updated_at", now())
        if sub == "" and method == "GET":
            return 200, raw_pr(repo, p, True)
        if sub == "" and method == "PATCH":
            for k in ("title", "body", "state", "base"):
                if k in body:
                    p[k] = body[k]
            p_touch()
            return 200, raw_pr(repo, p, True)
        if sub == "/reviews" and method == "GET":
            return 200, [{"id": r["id"], "user": user(r["user"]), "state": r["state"], "body": r["body"], "submitted_at": r["submitted_at"]} for r in p["reviews"]]
        if sub == "/reviews" and method == "POST":
            ev = body.get("event", "COMMENT")
            p["reviews"].append({"id": nid(), "user": ME, "state": {"APPROVE": "APPROVED", "REQUEST_CHANGES": "CHANGES_REQUESTED"}.get(ev, "COMMENTED"),
                                 "body": body.get("body") or "", "submitted_at": now()})
            for c in body.get("comments", []):
                p["threads"].append({"id": "T_%d" % nid(), "path": c["path"], "line": c.get("line"), "side": c.get("side", "RIGHT"), "resolved": False,
                                     "comments": [{"id": nid(), "user": ME, "body": c["body"], "created_at": now()}]})
            if ME in p["reviewers"]:
                p["reviewers"].remove(ME)
            p_touch()
            return 200, {"id": nid()}
        if sub == "/comments" and method == "POST":
            t = {"id": "T_%d" % nid(), "path": body["path"], "line": body.get("line"), "side": body.get("side", "RIGHT"), "resolved": False,
                 "comments": [{"id": nid(), "user": ME, "body": body["body"], "created_at": now()}]}
            p["threads"].append(t)
            p_touch()
            return 201, {"id": t["comments"][0]["id"]}
        m2 = re.match(r"/comments/(\d+)/replies$", sub)
        if m2 and method == "POST":
            for t in p["threads"]:
                if any(c["id"] == int(m2.group(1)) for c in t["comments"]):
                    t["comments"].append({"id": nid(), "user": ME, "body": body["body"], "created_at": now()})
                    p_touch()
                    return 201, {"id": nid()}
            return 404, {"message": "Not Found"}
        if sub == "/requested_reviewers" and method == "POST":
            p["reviewers"] = list(dict.fromkeys(p["reviewers"] + body.get("reviewers", [])))
            return 201, raw_pr(repo, p)
        if sub == "/merge" and method == "PUT":
            return merge(repo, p, body.get("merge_method", "merge"))
        if sub == "/update-branch" and method == "PUT":
            return 202, {"message": "Updating pull request branch."}
    m = re.match(r"/issues/(\d+)(/.*)?$", rest_path)
    if m:
        n, sub = int(m.group(1)), m.group(2) or ""
        if n in prs:
            p = prs[n]
            if sub == "/comments" and method == "GET":
                return 200, [{"id": c["id"], "user": user(c["user"]), "body": c["body"], "created_at": c["created_at"]} for c in p["comments"]]
            if sub == "/comments" and method == "POST":
                p["comments"].append({"id": nid(), "user": ME, "body": body["body"], "created_at": now()})
                p["updated_at"] = now()
                return 201, {"id": nid()}
            if sub == "" and method == "PATCH":
                if "assignees" in body: p["assignees"] = body["assignees"]
                if "labels" in body: p["labels"] = body["labels"]
                return 200, {}
            if sub == "" and method == "GET":
                return 200, {**raw_issue(repo, {**p, "user": p["user"]}), "pull_request": {}}
        if n in issues and sub == "":
            return 200, raw_issue(repo, issues[n])
        return 404, {"message": "Not Found"}
    if rest_path == "/issues":
        state = query.get("state", ["open"])[0]
        return 200, [raw_issue(repo, i) for i in sorted(issues.values(), key=lambda i: -i["number"]) if state == "all" or i["state"] == state]
    return 404, {"message": "Not Found: " + path}


def merge(repo, p, method):
    head = sha(repo, "refs/heads/" + p["head"])
    base = sha(repo, "refs/heads/" + p["base"])
    tree, code = git(repo, "merge-tree", "--write-tree", base, head)
    if code:
        return 405, {"message": "Pull Request is not mergeable"}
    tree = tree.splitlines()[0]
    env_id = ["-c", "user.name=Camille Martin", "-c", "user.email=camille@example.com"]
    if method == "squash":
        new, _ = git(repo, *env_id, "commit-tree", tree, "-p", base, "-m", "%s (#%d)" % (p["title"], p["number"]))
    else:
        new, _ = git(repo, *env_id, "commit-tree", tree, "-p", base, "-p", head, "-m", "Merge pull request #%d from atelier/%s\n\n%s" % (p["number"], p["head"], p["title"]))
    git(repo, "update-ref", "refs/heads/" + p["base"], new, base)
    git(repo, "update-ref", "refs/pull/%d/head" % p["number"], head)
    p["state"], p["merged_at"] = "closed", now()
    return 200, {"merged": True, "sha": new}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        LOG.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % a))

    def body_bytes(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            data = b""
            while True:
                size = int(self.rfile.readline().strip() or b"0", 16)
                if size == 0:
                    self.rfile.readline()
                    return data
                data += self.rfile.read(size)
                self.rfile.readline()
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def send(self, code, obj, ctype="application/json"):
        data = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_any(self):
        u = urlsplit(self.path)
        raw = self.body_bytes()
        if re.match(r"/atelier/[^/]+\.git/", u.path):
            return self.git_http(u, raw)
        if u.path.startswith("/__test/"):
            return self.control(u.path[8:], raw)
        body = json.loads(raw or b"{}") if raw else {}
        if u.path == "/api/graphql":
            with LOCK:
                data = graphql(body.get("query", ""), body.get("variables") or {})
            LOG.write("   graphql %s\n" % re.sub(r"\s+", " ", body.get("query", ""))[:90])
            return self.send(200, {"data": data})
        if u.path.startswith("/api/v3"):
            with LOCK:
                code, data = rest(self.command, u.path[7:] or "/", parse_qs(u.query), body)
            return self.send(code, data)
        self.send(404, {"message": "Not Found"})

    def control(self, cmd, raw):
        """Actions de test : /__test/teammate-push, /__test/reset, /__test/ci?pr=9&state=pending"""
        if cmd == "reset":
            with LOCK:
                reset()
            return self.send(200, {"ok": True})
        if cmd == "teammate-push":
            # noah pousse un commit sur feature/panier et commente la PR #9
            work = os.path.join(WORK, "teammate")
            subprocess.run(["rm", "-rf", work])
            subprocess.run(["git", "clone", "-q", "-b", "feature/panier", os.path.join(SRV, "atelier", "site-vitrine.git"), work], env=GITENV)
            with open(os.path.join(work, "js", "panier.js"), "a") as f:
                f.write("\nexport function total() {\n  return panier.length;\n}\n")
            env = {**GITENV, "GIT_AUTHOR_NAME": "Noah Petit", "GIT_AUTHOR_EMAIL": "noah@example.com", "GIT_COMMITTER_NAME": "Noah Petit", "GIT_COMMITTER_EMAIL": "noah@example.com"}
            subprocess.run(["git", "-C", work, "commit", "-qam", "Ajoute le total du panier"], env=env)
            subprocess.run(["git", "-C", work, "push", "-q", "origin", "feature/panier"], env=env)
            with LOCK:
                p = STATE["site-vitrine"]["prs"][9]
                p["comments"].append({"id": nid(), "user": "noah", "body": "J'ai ajouté le total, comme suggéré.", "created_at": now()})
                p["updated_at"] = now()
            return self.send(200, {"ok": True})
        if cmd.startswith("ci"):
            q = parse_qs(urlsplit(self.path).query)
            with LOCK:
                STATE[q.get("repo", ["site-vitrine"])[0]]["prs"][int(q["pr"][0])]["ci"] = q["state"][0]
            return self.send(200, {"ok": True})
        if cmd == "state":
            with LOCK:
                data = {r: {str(n): {k: p[k] for k in ("state", "merged_at", "reviewers", "title")} | {"reviews": [rv["state"] + ":" + rv["user"] for rv in p["reviews"]], "comments": [c["body"] for c in p["comments"]]}
                            for n, p in STATE[r]["prs"].items()} for r in STATE}
            return self.send(200, data)
        if cmd == "approve":
            q = parse_qs(urlsplit(self.path).query)
            with LOCK:
                STATE["site-vitrine"]["prs"][int(q["pr"][0])]["reviews"].append({"id": nid(), "user": q.get("by", ["lea"])[0], "state": "APPROVED", "body": "", "submitted_at": now()})
            return self.send(200, {"ok": True})
        self.send(404, {"message": "unknown"})

    def git_http(self, u, raw):
        env = {**GITENV, "GIT_PROJECT_ROOT": SRV, "GIT_HTTP_EXPORT_ALL": "1", "PATH_INFO": u.path, "QUERY_STRING": u.query,
               "REQUEST_METHOD": self.command, "CONTENT_TYPE": self.headers.get("Content-Type", ""), "REMOTE_USER": ME,
               "REMOTE_ADDR": "127.0.0.1", "CONTENT_LENGTH": str(len(raw))}
        if self.headers.get("Content-Encoding"):
            env["HTTP_CONTENT_ENCODING"] = self.headers["Content-Encoding"]
        if self.headers.get("Git-Protocol"):
            env["GIT_PROTOCOL"] = self.headers["Git-Protocol"]
        if not self.headers.get("Authorization"):
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="fake"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        out = subprocess.run(["git", "http-backend"], input=raw, capture_output=True, env=env).stdout
        head, _, data = out.partition(b"\r\n\r\n")
        code = 200
        headers = []
        for line in head.decode().split("\r\n"):
            k, _, val = line.partition(": ")
            if k.lower() == "status":
                code = int(val.split()[0])
            elif k:
                headers.append((k, val))
        self.send_response(code)
        for k, val in headers:
            self.send_header(k, val)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any


class Server(ThreadingHTTPServer):
    request_queue_size = 64
    daemon_threads = True


if __name__ == "__main__":
    print("faux GitHub sur %s" % BASE, flush=True)
    Server(("127.0.0.1", PORT), H).serve_forever()
