// A TypeScript port of bin/rs_confidence.py — the three-level badge (trust-and-plain Part 2) —
// for the server-less replay (src/replay/map.ts). It is held to the Python module's own output
// by src/confidence.test.ts (parity against src/stage/fixture.json, which scripts/stage-fixture.mjs
// fills from the Python CLI) and mirrors bin/test_rs_confidence.py row for row.
//
//   Checked  evidence PASS and the disproof verdict is `stands` and, when the calibration bucket
//            is usable (n ≥ 20, buckets separate), its keep-rate is ≥ 70%
//   Likely   evidence PASS with no verdict or `weakened`; also when the evidence could not be
//            checked (no diff, or only the file is outside the diff)
//   Maybe    any evidence WARN, the verdict `refuted`, or a usable keep-rate < 40%
import type { Badge, BadgeLevel, Checked, DisproofData, Evidence } from "./api";

export const CHECKED_RATE = 70;
export const MAYBE_RATE = 40;
export const LABELS: Record<BadgeLevel, string> = { checked: "Checked", likely: "Likely", maybe: "Maybe" };
const UNCHECKABLE_FLAGS = new Set(["path_not_in_diff"]);

export interface Calibration {
  keepRate: number | null;
  n: number;
  usable: boolean;
}

export type EvidenceState = "pass" | "warn" | "none";

export function evidenceState(evidence: Evidence | null | undefined): EvidenceState {
  if (!evidence || (evidence.status !== "pass" && evidence.status !== "warn")) return "none";
  const flags = evidence.flags ?? [];
  if (evidence.status === "pass") return "pass";
  if (flags.length === 1 && UNCHECKABLE_FLAGS.has(flags[0])) return "none";
  return "warn";
}

/** A stripped string closed with a full stop, or "" for nothing. */
const sentence = (text: string | undefined | null): string => {
  const t = (text ?? "").trim();
  return t && !/[.!?]$/.test(t) ? `${t}.` : t;
};

/** The first letter lowered, so a note can follow a label and a colon. A backtick stays. */
export const lowerFirst = (text: string | undefined | null): string => {
  const t = (text ?? "").trim();
  return t && /[A-Za-z]/.test(t[0]) ? t[0].toLowerCase() + t.slice(1) : t;
};

const pct = (rate: number) => `${rate.toFixed(1)}%`;

// Python's `_review_data` passes the review-level record so the reason can say why there is no
// verdict; the replay passes the fixture's.
export function badge(
  evidence: Evidence | null | undefined,
  checked: Checked | null | undefined = null,
  calibration: Calibration | null | undefined = null,
  disproof: Pick<DisproofData, "status"> | { status?: string } | null | undefined = null,
): Badge {
  const ev = evidenceState(evidence);
  const verdict = checked?.verdict ?? null;
  const cal = calibration && calibration.usable ? calibration : null;
  const rate = cal && cal.keepRate !== null && cal.keepRate !== undefined ? Number(cal.keepRate) : null;
  let level: BadgeLevel;
  if (ev === "warn" || verdict === "refuted" || (rate !== null && rate < MAYBE_RATE)) level = "maybe";
  else if (ev === "pass" && verdict === "stands" && (rate === null || rate >= CHECKED_RATE)) level = "checked";
  else level = "likely";

  // The reason is the card's one verdict row under Evidence, so it never repeats what the
  // Evidence row already says: the verdict word and the second pass's own sentence when there
  // is one; otherwise why there is no verdict (the evidence note only when no Evidence row is
  // shown: a WARN the badge rests on, or no evidence at all). The calibration clause last.
  const parts: string[] = [];
  const reasonTxt = sentence(checked?.reason);
  if (verdict === "stands" || verdict === "weakened" || verdict === "refuted") {
    parts.push(verdict[0].toUpperCase() + verdict.slice(1) + "." + (reasonTxt ? ` ${reasonTxt}` : ""));
  } else {
    if (ev === "warn") parts.push(sentence(evidence?.line) || "The evidence check failed.");
    else if (!evidence) parts.push("The diff could not be checked.");
    if (ev !== "warn") {
      const st = disproof && typeof disproof === "object" ? disproof.status : undefined;
      if (st === "failed") parts.push("The second pass failed.");
      else if (st === "done" || st === "partial") parts.push("No second pass for this severity.");
      else parts.push("No second pass ran.");
    }
  }
  if (rate !== null) parts.push(`Reviewers kept ${pct(rate)} of findings like this here.`);
  return {
    level,
    label: LABELS[level],
    reason: `${LABELS[level]}: ${parts.join(" ")}`,
    inputs: { evidence: ev, disproof: verdict, keepRate: rate, n: cal ? cal.n : null },
  };
}

export const isMaybe = (b: Badge | null | undefined): boolean => !!b && b.level === "maybe";
