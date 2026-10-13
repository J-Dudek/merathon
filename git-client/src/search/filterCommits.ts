import type { CommitInfo } from "../types/git";

export function filterCommits(commits: CommitInfo[], query: string): CommitInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return commits;

  return commits.filter(
    (c) =>
      c.hash.startsWith(q) ||
      c.short_hash.startsWith(q) ||
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.refs.some((r) => r.name.toLowerCase().includes(q))
  );
}
