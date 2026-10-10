// Every shipped example, in the order the examples index lists them. The website imports the
// same JSON files by path (website/src/content/examples.ts), so the static pages and the live
// replay cannot disagree.
import webhookRetry from "../../fixtures/replay/webhook-retry.json";
import rateLimitTenant from "../../fixtures/replay/rate-limit-tenant.json";
import cacheStaleRead from "../../fixtures/replay/cache-stale-read.json";
import type { ReplayFixture } from "./types";

export const FIXTURES: ReplayFixture[] = [
  webhookRetry as ReplayFixture,
  rateLimitTenant as ReplayFixture,
  cacheStaleRead as ReplayFixture,
];

/** The fixture a `?example=<slug>` names, or the first one. */
export function pickFixture(slug: string | null | undefined): ReplayFixture {
  return FIXTURES.find((f) => f.slug === slug) ?? FIXTURES[0];
}
