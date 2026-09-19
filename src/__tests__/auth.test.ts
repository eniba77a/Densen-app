import { describe, expect, it } from "vitest";
import {
  checkPassword,
  ageBandFromDob,
  youthDefaultsFor,
  decideSignUp,
  verifyPassword,
  hashPassword,
  generateToken,
  sha256Hex,
  tokenUsable,
  isLockedOut,
  LOCKOUT_THRESHOLD,
  normalizeEmail,
} from "../../convex/authInternals";
import { ageBand } from "../data/governance";

/** Build an ISO DOB making the person exactly `age` years old at `now` (UTC). */
function dobForAge(age: number, now: Date, offsetDays = 0): string {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  base.setUTCFullYear(base.getUTCFullYear() - age);
  base.setUTCDate(base.getUTCDate() - offsetDays);
  return base.toISOString().slice(0, 10);
}

const NOW = new Date("2026-09-19T12:00:00Z");

describe("password policy", () => {
  it("accepts a strong password", () => {
    expect(checkPassword("Dance!2026x")).toEqual({ ok: true });
  });
  it("rejects short, no-digit, and no-letter passwords", () => {
    expect(checkPassword("short1x").ok).toBe(false);
    expect(checkPassword("nodigitshere").ok).toBe(false);
    expect(checkPassword("1234567890").ok).toBe(false);
  });
  it("rejects breached/trivial passwords", () => {
    expect(checkPassword("password1").ok).toBe(false);
  });
  it("rejects over-long passwords", () => {
    expect(checkPassword("a1".repeat(65)).ok).toBe(false);
  });
});

describe("age band parity (server vs client)", () => {
  it("maps ages to the same bands on both ends", () => {
    for (const age of [9, 12, 13, 14, 15, 16, 17, 18, 25, 40, 70]) {
      const dob = dobForAge(age, NOW, 5); // birthday 5 days past: age is exact
      const server = ageBandFromDob(dob, NOW);
      if ("error" in server) throw new Error("server rejected a valid DOB: " + dob);
      const client = ageBand(dob, NOW);
      const serverClientVocab =
        server.band === "child_u13" ? "under13" : server.band;
      expect(serverClientVocab).toBe(client);
      expect(server.ageYears).toBe(age);
    }
  });
  it("places the 13th/16th/18th birthdays into the stronger band", () => {
    // Exact birthday: person turns the age TODAY.
    expect(ageBandFromDob(dobForAge(13, NOW, 0), NOW)).toMatchObject({ band: "teen13_15" });
    expect(ageBandFromDob(dobForAge(16, NOW, 0), NOW)).toMatchObject({ band: "teen16_17" });
    expect(ageBandFromDob(dobForAge(18, NOW, 0), NOW)).toMatchObject({ band: "adult" });
    // One day BEFORE the birthday they are still the younger band.
    expect(ageBandFromDob(dobForAge(13, NOW, -1), NOW)).toMatchObject({ band: "child_u13" });
    expect(ageBandFromDob(dobForAge(18, NOW, -1), NOW)).toMatchObject({ band: "teen16_17" });
  });
  it("fails closed on malformed, future, and absurd DOBs", () => {
    expect(ageBandFromDob("not-a-date", NOW)).toEqual({ error: "invalid_dob" });
    expect(ageBandFromDob("2026-13-40", NOW)).toEqual({ error: "invalid_dob" });
    expect(ageBandFromDob("2027-01-01", NOW)).toEqual({ error: "invalid_dob" });
    expect(ageBandFromDob("1800-01-01", NOW)).toEqual({ error: "invalid_dob" });
  });
});

describe("youth defaults (server-authoritative)", () => {
  it("adults get social defaults", () => {
    const d = youthDefaultsFor("adult");
    expect(d.privateAccount).toBe(false);
    expect(d.allowDuet).toBe(true);
    expect(d.messagesFrom).toBe("followers");
  });
  it("16-17 are private but discoverable", () => {
    const d = youthDefaultsFor("teen16_17");
    expect(d.privateAccount).toBe(true);
    expect(d.discoverableByHandle).toBe(true);
    expect(d.allowDuet).toBe(false);
  });
  it("under 16 are private, non-discoverable, no stranger messaging", () => {
    for (const band of ["child_u13", "teen13_15"] as const) {
      const d = youthDefaultsFor(band);
      expect(d.privateAccount).toBe(true);
      expect(d.discoverableByHandle).toBe(false);
      expect(d.messagesFrom).toBe("none");
      expect(d.showCity).toBe(false);
    }
  });
});

describe("signup decision core", () => {
  const valid = {
    firstName: "Era",
    handle: "era_dances",
    email: "ERA@Example.com",
    password: "Dance!2026x",
    dob: dobForAge(20, NOW, 3),
    wantsTeacher: false,
  };

  it("accepts a valid adult signup and normalizes email/handle", () => {
    const d = decideSignUp(valid, { emailTaken: false, handleTaken: false }, NOW);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.rows.user.email).toBe(normalizeEmail(valid.email));
      expect(d.rows.user.role).toBe("user"); // never granted at signup
      expect(d.rows.profile.handle).toBe("era_dances");
      expect(d.rows.profile.isPrivate).toBe(false);
    }
  });

  it("applies youth defaults server-side for a 14-year-old", () => {
    const d = decideSignUp(
      { ...valid, dob: dobForAge(14, NOW, 3) },
      { emailTaken: false, handleTaken: false },
      NOW
    );
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.isMinor).toBe(true);
      expect(d.rows.profile.isPrivate).toBe(true);
      expect(d.rows.privacy.privateAccount).toBe(true);
    }
  });

  it("requires a guardian for children", () => {
    const child = { ...valid, dob: dobForAge(10, NOW, 3) };
    const denied = decideSignUp(child, { emailTaken: false, handleTaken: false }, NOW);
    expect(denied).toEqual({ ok: false, error: "guardian_required" });
    const bad = decideSignUp({ ...child, guardianName: "123?" }, { emailTaken: false, handleTaken: false }, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("guardian_invalid");
    const ok = decideSignUp({ ...child, guardianName: "Ana Krasniqi" }, { emailTaken: false, handleTaken: false }, NOW);
    expect(ok.ok).toBe(true);
  });

  it("denies teacher intent for minors and never grants the role", () => {
    const d = decideSignUp(
      { ...valid, dob: dobForAge(15, NOW, 3), wantsTeacher: true },
      { emailTaken: false, handleTaken: false },
      NOW
    );
    expect(d).toEqual({ ok: false, error: "teacher_intent_minor" });
    const adult = decideSignUp(
      { ...valid, wantsTeacher: true },
      { emailTaken: false, handleTaken: false },
      NOW
    );
    expect(adult.ok).toBe(true);
    if (adult.ok) {
      expect(adult.rows.user.role).toBe("user");
      expect(adult.teacherIntent).toBe(true);
    }
  });

  it("enforces uniqueness decisions (no silent overwrite)", () => {
    expect(decideSignUp(valid, { emailTaken: true, handleTaken: false }, NOW).ok).toBe(false);
    expect(decideSignUp(valid, { emailTaken: false, handleTaken: true }, NOW).ok).toBe(false);
  });

  it("rejects reserved and malformed handles", () => {
    for (const h of ["admin", "densen", "ab", "Bad Handle", "very_long_handle_over_24_chars"]) {
      const d = decideSignUp({ ...valid, handle: h }, { emailTaken: false, handleTaken: false }, NOW);
      expect(d.ok).toBe(false);
    }
  });
});

describe("password hashing + verification", () => {
  it("hashes and verifies a password (round trip)", async () => {
    const hash = await hashPassword("Dance!2026x");
    expect(hash.startsWith("pbkdf2-sha256$")).toBe(true);
    expect(await verifyPassword("Dance!2026x", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
    expect(await verifyPassword("garbage", "not-a-hash")).toBe(false);
  });
  it("produces unique salts", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });
});

describe("verification tokens", () => {
  it("stores only hashes; raw tokens are unique and URL-safe", async () => {
    const raw1 = generateToken();
    const raw2 = generateToken();
    expect(raw1).not.toBe(raw2);
    expect(raw1).toMatch(/^[A-Za-z0-9_-]+$/);
    const hex = await sha256Hex(raw1);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).not.toContain(raw1);
  });
  it("single-consume semantics: expired or consumed tokens are unusable", () => {
    const row = { tokenHash: "h", expiresAt: 1000 };
    expect(tokenUsable(row, 999)).toBe(true);
    expect(tokenUsable(row, 1000)).toBe(false);
    expect(tokenUsable({ ...row, consumedAt: 500 }, 999)).toBe(false);
  });
});

describe("login throttling core", () => {
  it("locks after threshold and unlocks after the window", () => {
    expect(isLockedOut(LOCKOUT_THRESHOLD - 1, 10_000)).toBe(false);
    expect(isLockedOut(LOCKOUT_THRESHOLD, 10_000, 9_000)).toBe(true);
    expect(isLockedOut(LOCKOUT_THRESHOLD, 10_000 + 15 * 60 * 1000, 10_000)).toBe(false);
  });
});
