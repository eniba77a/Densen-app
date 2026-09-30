/**
 * Day-3 safety parity + decision tests.
 * =====================================
 * The client scanners (src/data/safety.ts) are the UX preview; the server core
 * (convex/safetyCore.ts) is the authoritative gate. These tests prove the two
 * stay in lockstep — same inputs, same verdicts — so a client display can never
 * contradict a server decision, and a rule change on one side without the other
 * fails here.
 */
import { describe, expect, it } from "vitest";
import {
  scanCommentCore,
  scanGroomingCore,
  scanVideoSubmissionCore,
  canMessageCore,
  evaluateContactPatternCore,
} from "../../convex/safetyCore";
import {
  scanComment,
  scanGrooming,
  scanVideoSubmission,
  canMessage,
  evaluateContactPattern,
} from "../data/safety";

/** Client labels are Bi ({en,sq}) — parity asserts via verdict + rule counts. */

describe("comment scanner parity (client ↔ server)", () => {
  const cases: { text: string; targetIsMinor: boolean }[] = [
    { text: "you look so sexy in this", targetIsMinor: true },
    { text: "you look so sexy in this", targetIsMinor: false },
    { text: "send me pics please", targetIsMinor: false },
    { text: "kill yourself", targetIsMinor: false },
    { text: "this is disgusting", targetIsMinor: false },
    { text: "this is disgusting", targetIsMinor: true },
    { text: "add me on whatsapp", targetIsMinor: false },
    { text: "add me on whatsapp", targetIsMinor: true },
    { text: "buy likes now", targetIsMinor: false },
    { text: "what a beautiful performance, bravo!", targetIsMinor: false },
    { text: "loved the footwork in the second eight-count", targetIsMinor: true },
  ];

  for (const c of cases) {
    it(`parity: "${c.text.slice(0, 30)}" (minor=${c.targetIsMinor})`, () => {
      const client = scanComment(c.text, c.targetIsMinor);
      const server = scanCommentCore(c.text, c.targetIsMinor);
      // verdicts must match exactly
      expect(server.verdict).toBe(client.verdict);
      // rule counts must match (server IDs ↔ client labels, 1:1)
      expect(server.ruleIds.length).toBe(client.matched.length);
      if (client.verdict === "clean") expect(server.ruleIds).toHaveLength(0);
    });
  }

  it("server returns stable rule IDs", () => {
    const s = scanCommentCore("add me on whatsapp", true);
    expect(s.verdict).toBe("blocked");
    expect(s.ruleIds).toContain("contact");
  });

  it("clean text yields zero rules on both sides", () => {
    expect(scanCommentCore("gorgeous lines today", true)).toEqual({ verdict: "clean", ruleIds: [] });
    expect(scanComment("gorgeous lines today", true).matched).toHaveLength(0);
  });
});

describe("grooming scanner parity (client ↔ server)", () => {
  const cases = [
    "don't tell your parents about our special classes",
    "our little secret ok?",
    "send me a pic of you",
    "you're so much more mature than the others",
    "let's keep working on that spin",
  ];
  for (const text of cases) {
    it(`parity: "${text.slice(0, 32)}"`, () => {
      const client = scanGrooming(text);
      const server = scanGroomingCore(text);
      expect(server.severity).toBe(client.severity);
      expect(server.ruleIds.length).toBe(client.matched.length);
    });
  }
  it("critical rules surface stable ids", () => {
    expect(scanGroomingCore("send me a pic of you").ruleIds).toContain("images");
  });
});

describe("video submission gate parity (client ↔ server)", () => {
  it("clean adult post publishes on both sides", () => {
    const input = { caption: "new combo drop", hashtags: ["dance"], audioLicensed: true, creatorIsMinor: false };
    expect(scanVideoSubmissionCore(input).status).toBe("published");
    expect(scanVideoSubmission(input).status).toBe("clean");
  });

  it("blocked signal on client ⇒ server blocked", () => {
    const input = { caption: "add me on whatsapp for more", hashtags: [], audioLicensed: true, creatorIsMinor: false };
    expect(scanVideoSubmissionCore(input).status).toBe("blocked");
    expect(scanVideoSubmission(input).status).toBe("blocked");
  });

  it("review-level signal on client ⇒ server holds for moderation", () => {
    const input = { caption: "check link in bio", hashtags: ["stunt"], audioLicensed: true, creatorIsMinor: false };
    expect(scanVideoSubmissionCore(input).status).toBe("in_review");
    expect(scanVideoSubmission(input).status).toBe("review");
  });

  it("minors are never auto-published past review (both sides)", () => {
    const input = { caption: "my teacher says i'm improving", hashtags: [], audioLicensed: false, creatorIsMinor: true };
    expect(scanVideoSubmissionCore(input).status).toBe("in_review");
    expect(scanVideoSubmission(input).status).toBe("blocked");
  });

  it("audio-unlicensed ⇒ review on server (enforcement), review on client (UX)", () => {
    const input = { caption: "freestyle friday", hashtags: [], audioLicensed: false, creatorIsMinor: false };
    expect(scanVideoSubmissionCore(input).status).toBe("in_review");
    expect(scanVideoSubmission(input).status).toBe("review");
  });
});

describe("messaging gate parity (client ↔ server)", () => {
  type Row = {
    name: string;
    ctx: Parameters<typeof canMessage>[0];
  };
  const rows: Row[] = [
    {
      name: "adult blocked by minor",
      ctx: {
        fromIsAdult: true,
        fromIsVerifiedTeacher: false,
        toIsMinor: true,
        toPref: "everyone",
        followingBack: false,
        isContact: false,
        isBlockedByEither: true,
      },
    },
    {
      name: "adult → minor, no contact",
      ctx: {
        fromIsAdult: true,
        fromIsVerifiedTeacher: false,
        toIsMinor: true,
        toPref: "everyone",
        followingBack: false,
        isContact: false,
        isBlockedByEither: false,
      },
    },
    {
      name: "adult → minor, followed back",
      ctx: {
        fromIsAdult: true,
        fromIsVerifiedTeacher: false,
        toIsMinor: true,
        toPref: "everyone",
        followingBack: true,
        isContact: false,
        isBlockedByEither: false,
      },
    },
    {
      name: "teen → minor, no contact",
      ctx: {
        fromIsAdult: false,
        fromIsVerifiedTeacher: false,
        toIsMinor: true,
        toPref: "everyone",
        followingBack: false,
        isContact: false,
        isBlockedByEither: false,
      },
    },
    {
      name: "adult → adult, followers-only, no contact",
      ctx: {
        fromIsAdult: true,
        fromIsVerifiedTeacher: false,
        toIsMinor: false,
        toPref: "followers",
        followingBack: false,
        isContact: false,
        isBlockedByEither: false,
      },
    },
    {
      name: "messaging off",
      ctx: {
        fromIsAdult: true,
        fromIsVerifiedTeacher: false,
        toIsMinor: false,
        toPref: "none",
        followingBack: true,
        isContact: false,
        isBlockedByEither: false,
      },
    },
    {
      name: "adult → minor inside existing thread",
      ctx: {
        fromIsAdult: true,
        fromIsVerifiedTeacher: false,
        toIsMinor: true,
        toPref: "everyone",
        followingBack: false,
        isContact: true,
        isBlockedByEither: false,
      },
    },
  ];

  for (const r of rows) {
    it(`parity: ${r.name}`, () => {
      const client = canMessage(r.ctx);
      const server = canMessageCore(r.ctx);
      expect(server.allowed).toBe(client.allowed);
      // guardian-visibility must agree whenever a message is allowed
      if (server.allowed) expect(!!server.guardianVisible).toBe(!!client.guardianVisible);
      // minor-flag agreement on denial
      if (!server.allowed && client.flag) expect(server.flag).toBe(client.flag);
    });
  }

  it("adult→minor denial carries the adult_to_minor flag on both sides", () => {
    const ctx = {
      fromIsAdult: true,
      fromIsVerifiedTeacher: false,
      toIsMinor: true,
      toPref: "everyone" as const,
      followingBack: false,
      isContact: false,
      isBlockedByEither: false,
    };
    expect(canMessageCore(ctx).flag).toBe("adult_to_minor");
    expect(canMessage(ctx).flag).toBe("adult_to_minor");
  });

  it("teacher→minor threads are guardian-visible on both sides", () => {
    const ctx = {
      fromIsAdult: true,
      fromIsVerifiedTeacher: true,
      toIsMinor: true,
      toPref: "everyone" as const,
      followingBack: true,
      isContact: false,
      isBlockedByEither: false,
    };
    expect(canMessageCore(ctx).guardianVisible).toBe(true);
    expect(canMessage(ctx).guardianVisible).toBe(true);
  });
});

describe("contact-pattern parity (client ↔ server)", () => {
  const cases: [number, boolean][] = [
    [0, true],
    [1, true],
    [2, true],
    [3, true],
    [4, true],
    [5, true],
    [0, false],
    [5, false],
    [6, false],
    [9, false],
  ];
  for (const [n, minor] of cases) {
    it(`parity: attempts=${n} toIsMinor=${minor}`, () => {
      expect(evaluateContactPatternCore(n, minor)).toBe(evaluateContactPattern(n, minor));
    });
  }
  it("restrict threshold matches the client constant", () => {
    expect(evaluateContactPatternCore(4, true)).toBe("restrict");
    expect(evaluateContactPatternCore(3, true)).toBe("watch");
  });
});
