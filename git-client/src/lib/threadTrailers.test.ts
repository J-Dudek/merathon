import { describe, it, expect } from "vitest";
import {
  appendThreadTrailers, draftFromMessage, extractThreadTrailers, planThreadReplies, threadLinksOf, threadReplyBody, THREAD_REPLY_MARKER,
} from "./threadTrailers";
import type { ReviewThread } from "../types/forge";
import type { CommitTrailers } from "../types/git";

const thread = (id: string, resolved: boolean | null = false, bodies: string[] = ["à corriger"]): ReviewThread => ({
  id, replyTo: `r${id}`, path: "a.ts", side: "new", line: 1, resolved,
  comments: bodies.map((body, i) => ({ id: String(i), author: "bob", body, createdAt: "" })),
});

const commit = (hash: string, trailers: [string, string][]): CommitTrailers => ({ hash, short_hash: hash.slice(0, 7), trailers });

describe("appendThreadTrailers", () => {
  it("adds a trailer paragraph", () => {
    expect(appendThreadTrailers("fix: a\n\nbody\n", { t1: "resolve", t2: "address" }))
      .toBe("fix: a\n\nbody\n\nResolves-Thread: t1\nAddresses-Thread: t2");
  });

  it("joins an existing trailer block", () => {
    expect(appendThreadTrailers("fix: a\n\nCo-Authored-By: Bob <b@x>", { t1: "resolve" }))
      .toBe("fix: a\n\nCo-Authored-By: Bob <b@x>\nResolves-Thread: t1");
  });

  it("never mistakes the summary for a trailer block", () => {
    expect(appendThreadTrailers("fix: a", { t1: "address" })).toBe("fix: a\n\nAddresses-Thread: t1");
  });

  it("leaves the message alone without links", () => {
    expect(appendThreadTrailers("fix: a\n", {})).toBe("fix: a");
  });
});

describe("extractThreadTrailers", () => {
  it("removes thread trailers and keeps the other ones", () => {
    const { text, links } = extractThreadTrailers("body\n\nCo-Authored-By: Bob <b@x>\nResolves-Thread: t1\naddresses-thread: t2");
    expect(text).toBe("body\n\nCo-Authored-By: Bob <b@x>");
    expect(links).toEqual({ t1: "resolve", t2: "address" });
  });

  it("round-trips with appendThreadTrailers", () => {
    const message = appendThreadTrailers("fix: a\n\nbody", { t1: "resolve" });
    expect(extractThreadTrailers(message)).toEqual({ text: "fix: a\n\nbody", links: { t1: "resolve" } });
  });
});

describe("draftFromMessage", () => {
  it("splits summary, description and threads", () => {
    expect(draftFromMessage("fix: a\n\nbody\n\nResolves-Thread: t1")).toEqual({ summary: "fix: a", description: "body", threads: { t1: "resolve" } });
    expect(draftFromMessage("fix: a")).toEqual({ summary: "fix: a", description: "", threads: {} });
  });
});

describe("threadLinksOf", () => {
  it("prefers resolving over addressing", () => {
    expect(threadLinksOf([["Addresses-Thread", "t1"], ["Resolves-Thread", "t1"], ["Signed-off-by", "x"]])).toEqual({ t1: "resolve" });
  });
});

describe("planThreadReplies", () => {
  it("groups commits per thread, oldest first", () => {
    const plans = planThreadReplies(
      [commit("bbb", [["Resolves-Thread", "t1"]]), commit("aaa", [["Addresses-Thread", "t1"]])],
      [thread("t1")],
    );
    expect(plans).toEqual([{ thread: thread("t1"), hashes: ["aaa", "bbb"], resolve: true }]);
  });

  it("ignores threads that are not in the pull request", () => {
    expect(planThreadReplies([commit("aaa", [["Resolves-Thread", "other"]])], [thread("t1")])).toEqual([]);
  });

  it("does not reply twice but still resolves", () => {
    const replied = thread("t1", false, ["à corriger", `Traité dans aaa.\n\n${THREAD_REPLY_MARKER}`]);
    expect(planThreadReplies([commit("bbb", [["Resolves-Thread", "t1"]])], [replied]))
      .toEqual([{ thread: replied, hashes: [], resolve: true }]);
    expect(planThreadReplies([commit("bbb", [["Addresses-Thread", "t1"]])], [replied])).toEqual([]);
  });

  it("only resolves unresolved resolvable threads", () => {
    const plans = planThreadReplies(
      [commit("aaa", [["Resolves-Thread", "done"], ["Resolves-Thread", "outdated"]])],
      [thread("done", true), thread("outdated", null)],
    );
    expect(plans.map((p) => [p.thread.id, p.resolve])).toEqual([["done", false], ["outdated", false]]);
  });
});

describe("threadReplyBody", () => {
  it("lists the commits and carries the marker", () => {
    expect(threadReplyBody(["aaa", "bbb"])).toBe(`Traité dans aaa, bbb.\n\n${THREAD_REPLY_MARKER}`);
  });
});
