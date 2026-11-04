// Backend Tauri simulé pour enregistrer la démo : dépôts, comptes et PR entièrement fictifs.
(() => {
  const NOW = Date.parse("2026-10-20T16:00:00Z");
  const hours = (h) => Math.floor((NOW - h * 3600e3) / 1000);
  const iso = (h) => new Date(NOW - h * 3600e3).toISOString();
  const hex = (s) => { let out = ""; for (let k = 0; out.length < 40; k++) { let h = 2166136261 ^ k; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; h = Math.imul(h ^ (h >>> 13), 1540483477) >>> 0; out += ((h ^ (h >>> 15)) >>> 0).toString(16).padStart(8, "0"); } return out.slice(0, 40); };

  const ME = "camille-atelier";
  const people = {
    camille: ["Camille Martin", "camille@atelier.example"],
    yanis: ["Yanis Roux", "yanis@atelier.example"],
    lea: ["Lea Moreau", "lea@atelier.example"],
    theo: ["Theo Laurent", "theo@atelier.example"],
    ines: ["Ines Petit", "ines@atelier.example"],
    sam: ["Sam Bernard", "sam@atelier.example"],
  };
  const c = (id, message, who, age, parents, refs = [], files = null) => ({ id, message, who, age, parents, refs, files });
  const R = (name, kind) => ({ name, kind });

  const SITE = "/home/camille/projects/showcase-site";
  const SHOP = "/home/camille/projects/online-shop";

  const siteCommits = [
    c("n2", "Newsletter: sign-up form", "camille", 3, ["n1"], [R("HEAD", "head"), R("feature/newsletter", "head"), R("origin/feature/newsletter", "remote")], ["src/newsletter/SignupForm.tsx", "src/newsletter/api.ts"]),
    c("g3", "Contact form: validate the email", "yanis", 5, ["g2"], [R("feature/contact-form", "local"), R("origin/feature/contact-form", "remote")], ["src/contact/validate.ts", "src/contact/Form.tsx"]),
    c("f1", "Mobile: fix the menu not opening", "lea", 7, ["m3"], [R("fix/mobile-menu", "local"), R("origin/fix/mobile-menu", "remote")], ["src/nav/MobileMenu.tsx"]),
    c("g2", "Contact form: add the fields", "yanis", 9, ["g1"], [], ["src/contact/Form.tsx"]),
    c("n1", "Newsletter: welcome email template", "camille", 11, ["m1"], [], ["emails/welcome.html"]),
    c("p3", "Gallery: lazy-load the images", "ines", 14, ["p2"], [R("feature/gallery", "local"), R("origin/feature/gallery", "remote")], ["src/gallery/Grid.tsx"]),
    c("m1", "Update the build dependencies", "sam", 20, ["m2"], [R("main", "local"), R("origin/main", "remote")], ["package.json", "package-lock.json"]),
    c("g1", "Contact form: page skeleton", "yanis", 26, ["m3"], [], ["src/contact/Page.tsx"]),
    c("p2", "Gallery: responsive grid", "ines", 30, ["p1"], [], ["src/gallery/Grid.tsx", "src/gallery/grid.css"]),
    c("m2", "Merge branch 'feature/pricing'", "sam", 34, ["m3", "t2"], [], []),
    c("t2", "Pricing: monthly and yearly toggle", "theo", 40, ["t1"], [], ["src/pricing/Toggle.tsx"]),
    c("p1", "Gallery: first version of the page", "ines", 46, ["m3"], [], ["src/gallery/Page.tsx"]),
    c("t1", "Pricing page", "theo", 52, ["m3"], [], ["src/pricing/Page.tsx"]),
    c("m3", "Compress the images to WebP", "lea", 60, ["m4"], [R("v1.2.0", "tag")], ["public/hero.webp", "public/team.webp"]),
    c("m4", "Merge branch 'feature/footer'", "sam", 72, ["m5", "o1"], [], []),
    c("o1", "Footer: social links", "theo", 80, ["m5"], [], ["src/layout/Footer.tsx"]),
    c("m5", "Mobile menu with a burger icon", "lea", 90, ["m6"], [], ["src/nav/MobileMenu.tsx"]),
    c("m6", "Two-column layout on large screens", "lea", 110, ["m7"], [R("v1.1.0", "tag")], ["src/layout/Layout.tsx"]),
    c("m7", "Team page", "ines", 130, ["m8"], [], ["src/team/Page.tsx"]),
    c("m8", "Header with the logo", "sam", 150, ["m9"], [], ["src/layout/Header.tsx"]),
    c("m9", "Home page", "sam", 170, ["m10"], [R("v1.0.0", "tag")], ["src/home/Page.tsx"]),
    c("m10", "Initial commit", "sam", 190, [], [], ["README.md", "package.json"]),
  ];
  const shopCommits = [
    c("s4", "Product pagination", "camille", 8, ["s3"], [R("feature/pagination", "local"), R("origin/feature/pagination", "remote")], ["src/products/Pagination.tsx"]),
    c("s3", "Cart: keep it between sessions", "theo", 22, ["s2"], [R("HEAD", "head"), R("main", "head"), R("origin/main", "remote")], ["src/cart/store.ts"]),
    c("s2", "Product list", "camille", 60, ["s1"], [], ["src/products/List.tsx"]),
    c("s1", "Initial commit", "camille", 120, [], [], ["README.md"]),
  ];

  const DIFFS = {
    "src/contact/validate.ts": [["context", "export function validate(values: ContactValues) {"], ["added", "  const email = values.email.trim();"], ["added", "  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) return \"Please enter a valid email.\";"], ["added", "  if (values.message.length < 10) return \"Your message is too short.\";"], ["context", "  return null;"], ["context", "}"]],
    "src/contact/Form.tsx": [["context", "export function ContactForm() {"], ["removed", "  const [error] = useState(null);"], ["added", "  const [error, setError] = useState<string | null>(null);"], ["added", "  const onSubmit = () => setError(validate(values));"], ["context", "  return <form onSubmit={onSubmit}>{fields}</form>;"], ["context", "}"]],
    "src/newsletter/SignupForm.tsx": [["context", "export function SignupForm() {"], ["added", "  const [email, setEmail] = useState(\"\");"], ["added", "  const submit = () => subscribe(email).then(showThanks);"], ["added", "  return ("], ["added", "    <form onSubmit={submit}>"], ["added", "      <input type=\"email\" value={email} onChange={(e) => setEmail(e.target.value)} />"], ["added", "      <button>Subscribe</button>"], ["added", "    </form>"], ["added", "  );"], ["context", "}"]],
    "src/newsletter/signup.css": [["context", ".signup {"], ["context", "  display: flex;"], ["added", "  gap: 0.5rem;"], ["added", "  max-width: 28rem;"], ["context", "}"], ["added", ".signup input[type=\"email\"] {"], ["added", "  flex: 1;"], ["added", "  border-radius: 0.25rem;"], ["added", "}"]],
  };
  const fileDiff = (path) => {
    const rows = DIFFS[path] ?? [["context", `// ${path}`], ["removed", "const previous = true;"], ["added", "const updated = true;"], ["added", "export default updated;"], ["context", ""]];
    let o = 11, n = 11;
    const lines = rows.map(([kind, content]) => {
      const line = { kind, content, old_lineno: kind === "added" ? null : o, new_lineno: kind === "removed" ? null : n };
      if (kind !== "added") o++;
      if (kind !== "removed") n++;
      return line;
    });
    return { path, is_binary: false, hunks: [{ header: `@@ -11,${o - 11} +11,${n - 11} @@`, old_start: 11, new_start: 11, lines }] };
  };

  const toCommit = (x) => ({
    hash: hex(x.id), short_hash: hex(x.id).slice(0, 7), message: x.message, author: people[x.who][0], email: people[x.who][1],
    timestamp: hours(x.age), parents: x.parents.map(hex), refs: x.refs,
  });
  const filesOf = (x) => (x.files ?? []).map((path, i) => ({ path, old_path: null, status: i === 1 && path.includes("new") ? "added" : "modified", additions: 4 + (path.length % 9), deletions: path.length % 3 }));

  const state = {
    synced: false,
    extraCommit: null,
    status: [],
    worktrees: [],
    identityMismatch: false,
    profiles: [],
    sshKeys: [],
    hostTrusted: false,
    commentsAdded: [],
    threads: [],
    reviewPosted: false,
    created: null,
    siteCommits,
    calls: [],
  };

  const headFor = (path) => {
    const wt = state.worktrees.find((w) => w.path === path);
    if (wt) return wt.branch;
    return path === SHOP ? "main" : state.head ?? "feature/newsletter";
  };
  const isShop = (path) => path === SHOP;
  const commitsOf = (path) => {
    if (isShop(path)) return shopCommits;
    if (!state.worktrees.some((w) => w.path === path)) return state.siteCommits;
    const branch = headFor(path);
    return state.siteCommits.map((x) => {
      const others = x.refs.filter((r) => r.name !== "HEAD").map((r) => (r.kind === "head" ? R(r.name, "local") : r));
      if (!others.some((r) => r.name === branch)) return { ...x, refs: others };
      return { ...x, refs: [R("HEAD", "head"), ...others.map((r) => (r.name === branch ? R(branch, "head") : r))] };
    });
  };
  const findCommit = (path, hash) => commitsOf(path).find((x) => hex(x.id) === hash) ?? state.siteCommits.find((x) => hex(x.id) === hash) ?? commitsOf(path)[0];

  function branchesOf(path) {
    const list = [];
    const commits = commitsOf(path);
    const head = headFor(path);
    for (const x of commits) {
      for (const r of x.refs) {
        if (r.name === "HEAD" || r.kind === "tag") continue;
        const remote = r.kind === "remote";
        list.push({ name: r.name, is_remote: remote, target_hash: hex(x.id), is_head: !remote && r.name === head, upstream: remote ? null : `origin/${r.name}`, ahead: 0, behind: 0 });
      }
    }
    return list;
  }

  const user = (login) => ({ login, id: login.length, name: Object.values(people).find((p) => p[0].split(" ")[0].toLowerCase() === login.split("-")[0])?.[0] ?? login });

  const prs = () => {
    const site = "atelier-demo/showcase-site", shop = "atelier-demo/online-shop";
    const g3 = hex(state.synced ? "g4" : "g3");
    return [
      { project: site, number: 12, title: "Contact form with validation", user: "yanis-roux", body: "Adds the **contact form** and validates its fields.\n\n- Checks the email format\n- Refuses messages that are too short\n\nCloses #6", head: "feature/contact-form", sha: g3, created: iso(26), updated: iso(state.synced ? 0.1 : 5), requested: [ME], assignees: [ME], labels: ["feature"], state: "blocked", comments: state.synced ? 2 : 1, mine: false, ci: "SUCCESS", reviews: state.reviewPosted ? [{ id: 2, user: { login: ME }, state: "APPROVED", body: "Looks good, thanks!", submitted_at: iso(0.2) }] : [] },
      { project: site, number: 9, title: "Responsive photo gallery", user: ME, body: "Responsive gallery with lazy-loaded images.", head: "feature/gallery", sha: hex("p3"), created: iso(46), updated: iso(state.synced ? 0.1 : 14), requested: state.synced ? [] : ["lea-moreau"], assignees: [ME], labels: ["feature", "design"], state: state.synced ? "clean" : "blocked", comments: 0, mine: true, ci: state.synced ? "SUCCESS" : "PENDING", reviews: state.synced ? [{ id: 3, user: { login: "lea-moreau" }, state: "APPROVED", body: "", submitted_at: iso(0.1) }] : [] },
      { project: site, number: 7, title: "Fix the mobile menu", user: "lea-moreau", body: "The burger icon did not open the menu on iOS.", head: "fix/mobile-menu", sha: hex("f1"), created: iso(7), updated: iso(7), requested: ["sam-bernard"], assignees: [], labels: ["bug"], state: "blocked", comments: 0, mine: false, ci: "SUCCESS", reviews: [] },
      ...(state.created ? [{ project: site, number: 15, title: state.created.title, user: ME, body: state.created.body, head: state.created.head, sha: hex("n2"), created: iso(0), updated: iso(0), requested: state.created.reviewers ?? [], assignees: [], labels: [], state: "blocked", comments: 0, mine: true, ci: "PENDING", reviews: [] }] : []),
      { project: shop, number: 4, title: "Product pagination", user: "theo-laurent", body: "Paginates the product list, 24 items per page.", head: "feature/pagination", sha: hex("s4"), created: iso(30), updated: iso(state.synced ? 0.1 : 8), requested: state.synced ? [ME] : [], assignees: [], labels: ["feature"], state: "blocked", comments: state.synced ? 1 : 0, mine: false, ci: "SUCCESS", reviews: [], onlyAfterSync: true },
      { project: "atelier-demo/design-tokens", number: 21, title: "Prepare the dark theme colours", user: "ines-petit", body: "", head: "feat/dark", sha: hex("x1"), created: iso(50), updated: iso(50), requested: [ME], assignees: [], labels: [], state: "blocked", comments: 0, mine: false, ci: "SUCCESS", reviews: [] },
      { project: "atelier-demo/design-tokens", number: 18, title: "Typography scale", user: ME, body: "", head: "feat/type", sha: hex("x2"), created: iso(70), updated: iso(70), requested: ["ines-petit"], assignees: [ME], labels: [], state: "blocked", comments: 0, mine: true, ci: "FAILURE", reviews: [{ id: 8, user: { login: "ines-petit" }, state: "CHANGES_REQUESTED", body: "", submitted_at: iso(60) }] },
    ];
  };
  const rawPr = (p) => ({
    number: p.number, title: p.title, state: "open", node_id: `PR_${p.number}`, merged_at: null, draft: false, user: { login: p.user }, html_url: `https://github.com/${p.project}/pull/${p.number}`,
    created_at: p.created, updated_at: p.updated, labels: p.labels.map((name) => ({ name, color: name === "bug" ? "d73a4a" : "2f81f7" })), head: { ref: p.head, sha: p.sha }, base: { ref: "main" },
    requested_reviewers: p.requested.map((login) => ({ login })), assignees: p.assignees.map((login) => ({ login })), body: p.body, mergeable: true, mergeable_state: p.state, comments: p.comments, review_comments: state.threads.filter((t) => p.number === 12).length,
  });
  const searchPr = (p) => ({
    number: p.number, title: p.title, url: `https://github.com/${p.project}/pull/${p.number}`, createdAt: p.created, updatedAt: p.updated, isDraft: false, headRefName: p.head, baseRefName: "main", headRefOid: p.sha,
    author: { login: p.user }, repository: { nameWithOwner: p.project }, labels: { nodes: p.labels.map((name) => ({ name })) }, assignees: { nodes: p.assignees.map((login) => ({ login })) },
    reviewRequests: { nodes: p.requested.map((login) => ({ requestedReviewer: { login } })) },
    reviewDecision: p.reviews.some((r) => r.state === "CHANGES_REQUESTED") ? "CHANGES_REQUESTED" : p.reviews.some((r) => r.state === "APPROVED") ? "APPROVED" : "REVIEW_REQUIRED",
    latestOpinionatedReviews: { nodes: p.reviews.map((r) => ({ state: r.state })) }, mergeable: "MERGEABLE",
    commits: { nodes: [{ commit: { statusCheckRollup: { state: p.ci }, committer: { user: { login: p.mine ? ME : p.user } } } }] },
  });

  const TEMPLATE = "## Description\n\n<!-- What does this change, and why? -->\n\n## How to test\n\n- [ ] Open the page on mobile and on desktop\n- [ ] Check the browser console\n\n## Screenshots\n";
  const issues = [
    { number: 8, title: "Add a newsletter sign-up to the footer", state: "open", user: { login: "sam-bernard" }, html_url: "https://github.com/atelier-demo/showcase-site/issues/8", created_at: iso(200), labels: [{ name: "feature" }] },
    { number: 6, title: "Contact form: validate the fields", state: "open", user: { login: "yanis-roux" }, html_url: "https://github.com/atelier-demo/showcase-site/issues/6", created_at: iso(300), labels: [] },
    { number: 5, title: "Mobile: the menu does not open on iOS", state: "open", user: { login: "lea-moreau" }, html_url: "https://github.com/atelier-demo/showcase-site/issues/5", created_at: iso(320), labels: [{ name: "bug" }] },
  ];

  function forgeGet(path) {
    const [p] = path.split("?");
    let m;
    if (p === "/user") return { login: ME, id: 1, name: "Camille Martin" };
    if ((m = p.match(/^\/users\/(.+)$/))) return user(decodeURIComponent(m[1]));
    if (p === "/user/repos") return [];
    if ((m = p.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/))) {
      const project = `${m[1]}/${m[2]}`, rest = m[3];
      const list = prs().filter((x) => x.project === project);
      let n;
      if (rest === "") return { default_branch: "main", allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true, permissions: { push: true } };
      if (rest === "/pulls") return list.filter((x) => !x.onlyAfterSync || project.endsWith("shop")).map(rawPr);
      if ((n = rest.match(/^\/pulls\/(\d+)$/))) return rawPr(list.find((x) => x.number === +n[1]));
      if ((n = rest.match(/^\/pulls\/(\d+)\/reviews$/))) return list.find((x) => x.number === +n[1])?.reviews ?? [];
      if ((n = rest.match(/^\/issues\/(\d+)\/comments$/))) {
        const out = +n[1] === 12 ? [{ id: 1, user: { login: "yanis-roux" }, body: "Ready for review. The regex is deliberately simple.", created_at: iso(5) }] : [];
        if (+n[1] === 12 && state.synced) out.push({ id: 2, user: { login: "yanis-roux" }, body: "Pushed a fix for the trimmed email.", created_at: iso(0.1) });
        if (+n[1] === 4 && state.synced) out.push({ id: 3, user: { login: "theo-laurent" }, body: "Could you take a look at the page size?", created_at: iso(0.1) });
        return out;
      }
      if (rest.match(/^\/commits\/[^/]+\/check-runs$/)) {
        const sha = rest.split("/")[2];
        const pr = list.find((x) => x.sha === sha);
        const done = pr?.ci !== "PENDING";
        return { check_runs: [["build", done, "success"], ["unit-tests", done, pr?.ci === "FAILURE" ? "failure" : "success"], ["lint", true, "success"]].map(([name, d, conclusion]) => ({ name, status: d ? "completed" : "in_progress", conclusion: d ? conclusion : null, html_url: null })) };
      }
      if (rest.match(/^\/commits\/[^/]+\/status$/)) return { statuses: [] };
      if (rest === "/assignees") return ["yanis-roux", "lea-moreau", "sam-bernard", "theo-laurent", "ines-petit", ME].map((login, id) => ({ login, id }));
      if (rest === "/labels") return [{ name: "feature", color: "2f81f7" }, { name: "bug", color: "d73a4a" }, { name: "design", color: "8957e5" }];
      if (rest === "/milestones") return [{ number: 1, title: "v1.3" }];
      if (rest === "/branches") return branchesOf(SITE).filter((b) => b.is_remote).map((b) => ({ name: b.name.replace("origin/", "") }));
      if (rest === "/issues") return issues;
      if ((n = rest.match(/^\/issues\/(\d+)$/))) return issues.find((i) => i.number === +n[1]) ?? issues[0];
      if (rest === "/contents/.github") return [{ name: "pull_request_template.md", path: ".github/pull_request_template.md", type: "file" }];
      if (rest === "/contents/.github/pull_request_template.md") return { encoding: "base64", content: btoa(TEMPLATE) };
      if (rest.startsWith("/contents")) return [];
    }
    if (p === "/search/issues") return { items: [] };
    console.warn("MOCK-FORGE-GET", path);
    return [];
  }

  function forgeSend(method, path, body) {
    let m;
    if (path === "/user/keys") return { id: 1 };
    if ((m = path.match(/\/pulls\/12\/reviews$/))) {
      state.reviewPosted = true;
      for (const comment of body.comments ?? []) state.threads.push({ ...comment, id: `T${state.threads.length}`, by: ME });
      return { id: 2 };
    }
    if (path.match(/\/pulls\/12\/comments$/)) { state.threads.push({ ...body, id: `T${state.threads.length}`, by: ME }); return { id: 5 }; }
    if ((m = path.match(/\/repos\/[^/]+\/[^/]+\/pulls$/)) && method === "POST") {
      state.created = { title: body.title, body: body.body, head: body.head };
      return rawPr({ project: "atelier-demo/showcase-site", number: 15, title: body.title, user: ME, body: body.body, head: body.head, sha: hex("n2"), created: iso(0), updated: iso(0), requested: [], assignees: [], labels: [], state: "blocked", comments: 0, reviews: [] });
    }
    if (path.match(/\/pulls\/15\/requested_reviewers$/)) { state.created.reviewers = body.reviewers; return {}; }
    return {};
  }

  function forgeGraphql(query, variables) {
    const all = prs();
    if (query.includes("viewer { login }")) {
      const open = all.filter((p) => !p.onlyAfterSync || state.synced);
      return {
        viewer: { login: ME },
        assigned: { nodes: open.filter((p) => !p.mine && p.assignees.includes(ME)).map(searchPr) },
        reviewing: { nodes: open.filter((p) => !p.mine && p.requested.includes(ME)).map(searchPr) },
        authored: { nodes: open.filter((p) => p.mine).map(searchPr) },
      };
    }
    if (query.includes("pullRequests(states: OPEN")) {
      const project = `${variables.owner}/${variables.repo}`;
      return { repository: { pullRequests: { nodes: all.filter((p) => p.project === project).map((p) => ({ number: p.number, reviewDecision: searchPr(p).reviewDecision, latestOpinionatedReviews: searchPr(p).latestOpinionatedReviews })) } } };
    }
    if (query.includes("viewerCanMergeAsAdmin")) return { repository: { pullRequest: { viewerCanMergeAsAdmin: false } } };
    if (query.includes("reviewThreads")) {
      return { repository: { pullRequest: { reviewThreads: { nodes: variables.number !== 12 ? [] : state.threads.map((t, i) => ({ id: t.id, isResolved: false, path: t.path, line: t.line, diffSide: t.side === "LEFT" ? "LEFT" : "RIGHT", comments: { nodes: [{ databaseId: 100 + i, body: t.body, createdAt: iso(0.1), author: { login: t.by } }] } })) } } } };
    }
    return {};
  }

  const key = {
    name: "id_ed25519", path: "/home/camille/.ssh/id_ed25519",
    public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemo camille@atelier-laptop",
    fingerprint: "SHA256:dEmOfIcTiOnAlFiNgErPrInTfOrThEdEmOnStRaTiOn0", encrypted: false,
  };

  // Terminal simulé : renvoie ce qui est tapé, et la sortie de quelques commandes.
  const terminals = new Map();
  const callbacks = new Map();
  let nextCallback = 1;
  const send = (channel, message) => {
    const id = channel?.id;
    channel._i = (channel._i ?? -1) + 1;
    callbacks.get(id)?.({ message, index: channel._i });
  };
  const PROMPT = "\x1b[32mcamille@atelier\x1b[0m:\x1b[34m~/projects/showcase-site\x1b[0m$ ";

  const handlers = {
    set_language: () => null,
    is_wsl: () => false,
    app_info: () => ({ os: "linux", arch: "x86_64", libgit2: "1.9.1", debug: false }),
    list_accounts: () => [{ id: "acc1", provider: "github", label: "Camille Atelier", base_url: "https://github.com", username: ME, auth: "oauth" }],
    oauth_defaults: () => ({ github: null, gitlab: null }),
    open_repository: ({ path }) => handlers.get_repo_info({ path }),
    get_repo_info: ({ path }) => ({ path, head_branch: headFor(path), head_detached: false, head_hash: hex(commitsOf(path).find((x) => x.refs.some((r) => r.kind === "head"))?.id ?? "n2"), state: "clean", pending_message: null, interactive_rebase: null }),
    get_identity: () => ({ name: "Camille Martin", email: state.identityMismatch ? "camille.old@example.com" : "camille@atelier.example" }),
    set_identity: () => null,
    get_commits: ({ path }) => commitsOf(path).map(toCommit),
    get_branches: ({ path }) => branchesOf(path),
    get_tags: ({ path }) => commitsOf(path).flatMap((x) => x.refs.filter((r) => r.kind === "tag").map((r) => ({ name: r.name, target_hash: hex(x.id), message: null }))),
    get_commit_details: ({ path, hash }) => {
      const x = findCommit(path, hash), [author, email] = people[x.who];
      return { hash: hex(x.id), short_hash: hex(x.id).slice(0, 7), summary: x.message, message: x.message, author, email, author_time: hours(x.age), committer: author, committer_email: email, commit_time: hours(x.age), parents: x.parents.map(hex), files: filesOf(x) };
    },
    get_commit_file_diff: ({ filePath }) => fileDiff(filePath),
    get_compare_file_diff: ({ filePath }) => fileDiff(filePath),
    diff_commits: () => ["src/contact/Form.tsx", "src/contact/validate.ts", "src/newsletter/SignupForm.tsx", "emails/welcome.html", "package.json"].map((path, i) => ({ path, old_path: null, status: i === 1 ? "added" : "modified", additions: 3 + i * 4, deletions: i })),
    compare_refs: () => ({ merge_base: hex("m3"), head: hex("g3"), commits: 3, files: [{ path: "src/contact/validate.ts", old_path: null, status: "added", additions: 3, deletions: 0 }, { path: "src/contact/Form.tsx", old_path: null, status: "modified", additions: 2, deletions: 1 }] }),
    commit_trailers: () => [],
    branch_divergence: ({ path, head }) => ({ head: branchesOf(path).find((b) => b.name === head)?.target_hash ?? head, ahead: 3, behind: 0 }),
    get_status: ({ path }) => (path === SITE ? state.status : []),
    get_diff: ({ filePath }) => fileDiff(filePath),
    stage_files: ({ paths }) => { state.status = state.status.map((f) => (paths.includes(f.path) ? { ...f, staged: true } : f)); return null; },
    stage_all: () => { state.status = state.status.map((f) => ({ ...f, staged: true })); return null; },
    unstage_files: ({ paths }) => { state.status = state.status.map((f) => (paths.includes(f.path) ? { ...f, staged: false } : f)); return null; },
    unstage_all: () => { state.status = state.status.map((f) => ({ ...f, staged: false })); return null; },
    create_commit: ({ message }) => {
      const head = state.siteCommits[0];
      const refs = head.refs;
      head.refs = refs.filter((r) => r.kind !== "head");
      state.siteCommits.unshift(c("n3", message, "camille", 0.01, [head.id], refs.filter((r) => r.kind === "head"), ["src/newsletter/signup.css"]));
      state.status = [];
      return hex("n3");
    },
    list_stashes: () => [],
    list_remotes: ({ path }) => [{ name: "origin", url: `https://github.com/atelier-demo/${path.split("/").pop().replace(/-new-hero$/, "")}.git` }],
    fetch_remote: () => null,
    list_submodules: () => [],
    list_worktrees: ({ path }) => {
      const main = { name: null, path: SITE, branch: state.head ?? "feature/newsletter", head_hash: hex("n2"), is_main: true, is_current: path === SITE, locked: false, valid: true };
      if (isShop(path)) return [{ ...main, path: SHOP, branch: "main", head_hash: hex("s3"), is_current: true }];
      return [main, ...state.worktrees.map((w) => ({ name: w.name, path: w.path, branch: w.branch, head_hash: hex("n2"), is_main: false, is_current: path === w.path, locked: false, valid: true }))];
    },
    add_worktree: ({ target, branch }) => {
      state.worktrees.push({ name: target.split("/").pop(), path: target, branch });
      const head = state.siteCommits.find((x) => x.refs.some((r) => r.kind === "head"));
      head.refs = [...head.refs, R(branch, "local")];
      return null;
    },
    remove_worktree: ({ name }) => { state.worktrees = state.worktrees.filter((w) => w.name !== name); return null; },
    lfs_status: () => ({ uses_lfs: false, version: "3.5.1", patterns: [], files: [] }),
    forge_api: ({ path }) => forgeGet(path),
    forge_api_send: ({ method, path, body }) => forgeSend(method, path, body),
    forge_graphql: ({ query, variables }) => forgeGraphql(query, variables),
    notify_desktop: () => null,
    close_desktop_notification: () => null,
    open_new_window: () => null,
    ssh_setup_info: () => ({ keys: [], new_key_path: "/home/camille/.ssh/id_ed25519", machine: "atelier-laptop" }),
    ssh_create_key: () => { state.sshKeys = [key]; return key; },
    ssh_all_keys: () => state.sshKeys,
    ssh_existing_key: () => key,
    ssh_host_status: () => (state.hostTrusted ? { state: "known" } : { state: "unknown", fingerprint: "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU", published: true }),
    ssh_trust_host: () => { state.hostTrusted = true; return null; },
    ssh_check_connection: () => ({ authenticated: true, username: ME, message: `Hi ${ME}! You've successfully authenticated.` }),
    list_git_profiles: () => ({ profiles: state.profiles, other_rules: [] }),
    save_git_profile: ({ profile }) => {
      const saved = { ...profile, id: "atelier", managed: true };
      state.profiles = [saved];
      state.identityMismatch = true;
      return saved;
    },
    delete_git_profile: () => { state.profiles = []; return null; },
    git_identity_status: () => {
      const profile = state.profiles[0] ?? null;
      const mismatch = !!profile && state.identityMismatch;
      return { name: "Camille Martin", email: mismatch ? "camille.old@example.com" : profile?.user_email ?? "camille@atelier.example", origin: mismatch ? "repo" : profile ? "profile" : "global", profile, mismatch, outside: false };
    },
    clear_local_identity: () => { state.identityMismatch = false; return null; },
    terminal_open: ({ onEvent }) => {
      const id = terminals.size + 1;
      terminals.set(id, { channel: onEvent, line: "" });
      setTimeout(() => send(onEvent, { kind: "output", data: PROMPT }), 50);
      return id;
    },
    terminal_write: ({ id, data }) => {
      const t = terminals.get(id);
      if (!t) return null;
      if (data === "\r") {
        const out = t.line === "git log --oneline -3"
          ? state.siteCommits.slice(0, 3).map((x) => `\x1b[33m${hex(x.id).slice(0, 7)}\x1b[0m ${x.message}`).join("\r\n") + "\r\n"
          : t.line === "git status" ? `On branch ${state.head ?? "feature/newsletter"}\r\nnothing to commit, working tree clean\r\n` : "";
        t.line = "";
        send(t.channel, { kind: "output", data: `\r\n${out}${PROMPT}` });
      } else {
        t.line += data;
        send(t.channel, { kind: "output", data });
      }
      return null;
    },
    terminal_resize: () => null,
    terminal_close: () => null,
    "plugin:event|listen": () => Math.floor(Math.random() * 1e6),
    "plugin:event|unlisten": () => null,
    "plugin:event|emit": () => null,
    "plugin:event|emit_to": () => null,
    "plugin:updater|check": () => null,
    "plugin:notification|is_permission_granted": () => true,
    "plugin:notification|request_permission": () => "granted",
    "plugin:notification|notify": () => null,
    "plugin:window|is_focused": () => true,
    "plugin:window|is_visible": () => true,
    "plugin:window|is_minimized": () => false,
    "plugin:window|theme": () => "dark",
    "plugin:opener|open_url": () => null,
    "plugin:dialog|open": () => "/home/camille/projects",
    "plugin:app|version": () => "3.0.0",
    "plugin:app|name": () => "Merathon",
    "plugin:app|tauri_version": () => "2.0.0",
  };

  window.__demo = {
    state,
    applySync() {
      state.synced = true;
      const g = state.siteCommits.find((x) => x.id === "g3");
      const i = state.siteCommits.indexOf(g);
      const refs = g.refs;
      g.refs = refs.filter((r) => r.kind === "local");
      state.siteCommits.splice(i, 0, c("g4", "Contact form: trim the email before validating", "yanis", 0.1, ["g3"], refs.filter((r) => r.kind === "remote"), ["src/contact/validate.ts"]));
    },
    ageSnapshot() {
      const raw = JSON.parse(localStorage.getItem("merathon.myPullRequests") ?? "{}");
      for (const k of Object.keys(raw)) raw[k].at = 0;
      localStorage.setItem("merathon.myPullRequests", JSON.stringify(raw));
    },
    dirty() { state.status = [{ path: "src/newsletter/signup.css", status: "modified", staged: false }]; },
  };

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb) { const id = nextCallback++; callbacks.set(id, cb); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    runCallback(id, data) { callbacks.get(id)?.(data); },
    callbacks,
    convertFileSrc: (p) => p,
    plugins: { path: { sep: "/", delimiter: ":" } },
    invoke(cmd, args = {}) {
      const handler = handlers[cmd];
      if (!handler) {
        if (!cmd.startsWith("plugin:webview") && !cmd.startsWith("plugin:window")) console.warn("MOCK-UNKNOWN", cmd);
        return Promise.resolve(null);
      }
      try {
        return Promise.resolve(handler(args)).then((v) => new Promise((res) => setTimeout(() => res(v), 15)));
      } catch (e) {
        console.error("MOCK-ERROR", cmd, e);
        return Promise.reject(String(e));
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };

  // Horloge figée sur la date de la démo, pour des dates stables dans l'interface.
  const realNow = Date.now.bind(Date), start = realNow();
  const offset = NOW - start;
  const RealDate = Date;
  class DemoDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(realNow() + offset); } static now() { return realNow() + offset; } }
  window.Date = DemoDate;

  try {
    if (!localStorage.getItem("merathon.display")) {
      localStorage.setItem("merathon.display", JSON.stringify({ language: "en", languageChosen: true, theme: "dark", zoom: 1, density: "normal", syncInterval: 5 }));
      localStorage.setItem("merathon.milestones", JSON.stringify({ counts: { commit: 12, branch: 12, pr: 12, merge: 12 }, rewards: [], seenAt: 0 }));
      localStorage.setItem("merathon.open-tabs", JSON.stringify({ paths: [SITE, SHOP], active: 0 }));
    }
  } catch { /* démo uniquement */ }
})();
