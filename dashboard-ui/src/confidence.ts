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

const lowerFirst = (text: string | undefined | null): string => {
  const t = (text ?? "").trim().replace(/\.+$/, "");
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

  const parts: string[] = [];
  if (ev === "pass") {
    const syms = (evidence?.symbols ?? []).filter(Boolean).slice(0, 2);
    parts.push("the cited lines exist" + (syms.length ? " and mention " + syms.map((s) => `\`${s}\``).join(", ") : ""));
  } else if (ev === "warn") {
    parts.push(lowerFirst(evidence?.line) || "the evidence check failed");
  } else if (evidence && (evidence.flags ?? []).length) {
    parts.push("the file is outside this diff, so its lines could not be checked");
  } else {
    parts.push("the diff could not be checked");
  }
  const reasonTxt = checked?.reason ?? "";
  if (verdict === "stands") parts.push("a second pass could not disprove it");
  else if (verdict === "weakened") parts.push("a second pass weakened it" + (reasonTxt ? `: ${lowerFirst(reasonTxt)}` : ""));
  else if (verdict === "refuted") parts.push("a second pass refuted it" + (reasonTxt ? `: ${lowerFirst(reasonTxt)}` : ""));
  else if (disproof && typeof disproof === "object") {
    const st = disproof.status;
    if (st === "failed") parts.push("the second pass failed");
    else if ((st === "done" || st === "partial") && !checked) parts.push("no second pass for this severity");
  }
  if (rate !== null) parts.push(`reviewers kept ${pct(rate)} of findings like this here`);
  return {
    level,
    label: LABELS[level],
    reason: `${LABELS[level]}: ${parts.join(", ")}.`,
    inputs: { evidence: ev, disproof: verdict, keepRate: rate, n: cal ? cal.n : null },
  };
}

export const isMaybe = (b: Badge | null | undefined): boolean => !!b && b.level === "maybe";
