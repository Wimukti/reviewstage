import { expect, test } from "@playwright/test";
import { PR, PR2, PR3, PR5, REPO, REPO2, patchJson } from "./fixture";

// The fields the server lanes landed, seen through the page. Most of these run against the real
// server and the offline fixture; the three that cannot — a review replaced between render and
// post, a branch that moved under a reviewer, a connected Claude account this suite must never
// have — patch one field of the real response, because what is under test is what the page does
// with the field, not how the server worked it out.

const enc = (r: string) => encodeURIComponent(r);
const prPath = (repo: string, num: string) => `/pr?repo=${enc(repo)}&pr=${num}`;

test.describe("posting a review that has been re-run", () => {
  test("the 409 is a reload, not a retry", async ({ page }) => {
    await page.route("**/api/post", async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          error:
            "This review has been re-run since you opened it, so your selection no longer " +
            "lines up with the findings on the server — nothing was posted. Reload the page " +
            "and pick again.",
          reviewKey: "rk1:newrunkeyhere",
          sentKey: "rk1:oldrunkeyhere",
        },
      });
    });
    await page.goto(prPath(REPO, PR));
    const panel = page.getByTestId("post-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /post selected/i }).click();

    const refusal = page.getByTestId("rerun-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(/re-run/i);
    await expect(refusal).toContainText(/nothing was posted/i);
    await expect(refusal.getByRole("button", { name: /reload the page/i })).toBeVisible();
    // The button stops offering a post that cannot succeed until the page is reloaded.
    await expect(panel.getByRole("button", { name: /post selected/i })).toBeDisabled();
  });

  test("the post carries the server's review key, never a locally computed one", async ({ page }) => {
    let sent: string | null = null;
    await page.route("**/api/post", async (route) => {
      sent = JSON.parse(route.request().postData() || "{}").review_key;
      await route.fulfill({ json: { bannerHtml: "<div class='banner ok'><span>OK</span><div>posted</div></div>" } });
    });
    await page.goto(prPath(REPO, PR));
    await page.getByTestId("post-panel").getByRole("button", { name: /post selected/i }).click();
    await expect.poll(() => sent).toMatch(/^rk1:/);
  });
});

test.describe("approving after the branch moved", () => {
  test("says so and routes through the confirmation", async ({ page }) => {
    // Everything the server computed, except that GitHub is now a commit ahead of the review.
    await patchJson(page, `**/api/pr?repo=${enc(REPO2)}&pr=${PR3}*`, (body) => ({
      review: {
        ...body.review,
        approve: {
          ...body.review.approve,
          lgtm: true,
          blockers: 0,
          reviewedHead: "0badf00dcafe",
          currentHead: "1111222233334444",
        },
      },
    }));
    await page.goto(prPath(REPO2, PR3));

    // The status line says so at a glance; the full warning lives inside the Approve section.
    await expect(page.getByTestId("status-head-moved")).toHaveText("Branch moved");
    await page.getByTestId("sec-approve").click();
    const moved = page.getByTestId("head-moved");
    await expect(moved).toBeVisible();
    await expect(moved).toContainText(/branch has moved/i);
    await expect(moved).toContainText("0badf00");
    await expect(moved).toContainText("1111222");

    // LGTM, and still gated: the confirmation is the only way through.
    const panel = page.getByTestId("approve-panel");
    const btn = panel.getByRole("button", { name: /approve/i });
    await expect(btn).toBeDisabled();
    const ack = panel.getByRole("checkbox");
    await expect(ack).toBeVisible();
    await ack.check();
    await expect(btn).toBeEnabled();

    // And the commit the verdict was read against goes with the approval.
    let body: Record<string, unknown> = {};
    await page.route("**/api/approve", async (route) => {
      body = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({ json: { bannerHtml: "<div class='banner ok'><span>OK</span><div>done</div></div>" } });
    });
    await btn.click();
    await expect.poll(() => body.reviewed_head).toBe("0badf00dcafe");
    await expect.poll(() => body.ack).toBe(true);
  });

  test("an unmoved branch approves without an extra confirmation", async ({ page }) => {
    await patchJson(page, `**/api/pr?repo=${enc(REPO2)}&pr=${PR3}*`, (body) => ({
      review: {
        ...body.review,
        approve: {
          ...body.review.approve,
          lgtm: true,
          blockers: 0,
          reviewedHead: "0badf00dcafe",
          currentHead: "0badf00dcafe",
        },
      },
    }));
    await page.goto(prPath(REPO2, PR3));
    await page.getByTestId("sec-approve").click();
    await expect(page.getByTestId("head-moved")).toHaveCount(0);
    await expect(page.getByTestId("status-head-moved")).toHaveCount(0);
    await expect(page.getByTestId("pr-state")).toHaveCount(0);
    await expect(page.getByTestId("no-approve")).toHaveCount(0);
    await expect(page.getByTestId("approve-panel").getByRole("button", { name: /approve/i })).toBeEnabled();
  });
});

test.describe("a QA guide whose last run failed", () => {
  test("keeps the guide, and says what went wrong above it", async ({ page }) => {
    await page.goto(`/qa?repo=${enc(REPO)}&pr=${PR2}`);

    // The guide on disk is still the thing the reader came for.
    await expect(page.locator(".qaguide")).toContainText(/must pass/i);
    await expect(page.getByRole("button", { name: /copy guide/i })).toBeVisible();

    const strip = page.getByTestId("qa-last-run");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(/last attempt failed/i);
    await expect(strip).toContainText(/missing the P1 section/i);
    await expect(strip).toContainText(/unchanged, not a result of that run/i);

    // Above the guide, not hidden behind it.
    const stripBox = await strip.boundingBox();
    const guideBox = await page.locator(".qaguide").boundingBox();
    expect(stripBox!.y).toBeLessThan(guideBox!.y);

    // The agent's own last words, behind a disclosure rather than lost to the box.
    const log = page.getByTestId("qa-log");
    await expect(log).toBeVisible();
    await expect(log.locator("pre")).toBeHidden();
    await log.locator("summary").click();
    await expect(log.locator("pre")).toContainText(/stopped mid-section/i);

    // And what the build cost, the same chip the review page carries.
    await expect(page.getByTestId("qa-usage")).toContainText(/27,100 tokens/);
  });
});

test.describe("a merged pull request", () => {
  test("reads as merged, and does not offer an approval GitHub would refuse", async ({ page }) => {
    await page.goto("/?tab=posted");
    const row = page.locator(".row").filter({ hasText: `#${PR5}` }).first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("pr-state")).toHaveText("Merged");
    await expect(row.getByTestId("no-approve")).toBeVisible();
    // "no longer requested" is true of every merged PR and told the reviewer nothing.
    await expect(row).not.toContainText(/no longer requested/i);
  });

  test("an open PR says none of that", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    const row = page.locator(".row").filter({ hasText: `#${PR}` }).first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("pr-state")).toHaveCount(0);
    await expect(row.getByTestId("no-approve")).toHaveCount(0);
  });

  test("its detail page says so too, before the click rather than after", async ({ page }) => {
    // /api/pr used to carry no GitHub state at all, so this page offered a live Approve button
    // on a merged PR and the server's refusal only arrived once it had been pressed.
    await page.goto(prPath(REPO, PR5));
    // Merged is one item on the status line, not a banner; the sentence is its title.
    await expect(page.getByTestId("pr-state").first()).toHaveText("Merged");
    await expect(page.getByTestId("pr-state").first()).toHaveAttribute("title", /merged/i);
  });

  test("an open PR's detail page shows no such banner", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await expect(page.getByTestId("pr-state")).toHaveCount(0);
  });
});

test.describe("decisions taken in dry run", () => {
  test("the learnings page marks them and says they are in no rate", async ({ page }) => {
    await page.goto("/learnings");
    await expect(page.getByTestId("dry-count")).toContainText("2");
    await expect(page.getByTestId("dry-banner")).toContainText(/DRY_RUN=1/);
    await expect(page.getByTestId("dry-banner")).toContainText(/none of the keep rates/i);
    await expect(page.getByTestId("dry-row").first()).toBeVisible();
  });

  test("insights accounts for them rather than reading as an empty install", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("dry-banner")).toContainText(/DRY_RUN=1/);
    await expect(page.getByTestId("dry-donut-note")).toContainText(/2 decision/);
  });

  test("the chart marks today's bar as the part-day it is", async ({ page }) => {
    // partialLast compared the server's %m/%d/%y string against an ISO date, so it was never
    // true and the hatch could not render.
    await page.goto("/dashboard");
    await expect(page.getByText(/hatched bar is today/i)).toBeVisible();
    await expect(page.locator('rect[fill="url(#rs-partial)"]')).toHaveCount(1);
  });
});

test.describe("the queue filters on the server", () => {
  test("every tab and tile counts the filtered set, not the whole install", async ({ page }) => {
    await page.goto("/?tab=all");
    const tab = (name: RegExp) => page.locator(".tab").filter({ hasText: name }).first();

    // Unfiltered: both repositories are in reach.
    await expect(page.locator(".row")).not.toHaveCount(0);
    const allBefore = Number((await tab(/^All/).locator(".cnt").innerText()).replace(/,/g, ""));
    expect(allBefore).toBeGreaterThan(1);

    // The request really does carry the filter — the server, not the browser, narrows it.
    const filtered = page.waitForRequest((r) => r.url().includes(`repo=${enc(REPO2)}`));
    await page.getByLabel("Filter by repository").selectOption(REPO2);
    await filtered;

    // Only acme/api is left, and the All count agrees with the rows rather than with the
    // whole install — which is what the old "all" caveat was apologising for.
    await expect(page.locator(".row .repochip", { hasText: REPO })).toHaveCount(0);
    const rows = await page.locator(".row").count();
    await expect.poll(async () =>
      Number((await tab(/^All/).locator(".cnt").innerText()).replace(/,/g, "")),
    ).toBe(rows);
    expect(rows).toBeLessThan(allBefore);
    await expect(page.getByTestId("filter-note")).toContainText(/every count above is for the filtered set/i);

    // Restore, so the shared server is left as it was found for the other specs.
    await page.getByLabel("Filter by repository").selectOption("");
  });

  test("a search narrows the counts too", async ({ page }) => {
    await page.goto("/?tab=all");
    const sent = page.waitForRequest((r) => r.url().includes("q=rate-limit"));
    await page.locator("#qsearch").fill("rate-limit");
    await sent;
    await expect(page.locator(".row")).toHaveCount(1);
    await expect(page.locator(".row").first()).toContainText(/rate-limit the lead-time endpoint/i);
  });
});

// One suggestion, synthesised: the live list is server state the rules spec deliberately
// spends (accept turns a suggestion into a rule), and the draft button's behaviour should not
// depend on which spec ran first. `connected` is a Claude account this suite must never have.
const SUGGESTION = {
  signature: "e2e-draft-signature",
  outcome: "dropped",
  severity: "nit",
  dir: "src/javascripts",
  count: 4,
  prs: 3,
  repos: [REPO],
  gist: "Prefer const over let for this binding",
  findings: [
    { repo: REPO, pr: PR, path: "src/javascripts/Badge.tsx", line: 10, severity: "nit",
      at: 1778000000, gist: "Prefer const over let for this binding" },
  ],
  target: "team",
  targetLabel: "the team default",
  rule: "",
  rationale: "",
  dismissed: false,
  dismissedBy: "",
  connected: true,
  needsDraft: true,
  drafting: false,
};

test.describe("drafting a rule", () => {
  test("is an explicit click, and the server is told to draft", async ({ page }) => {
    let skills: Record<string, unknown> = {};
    await patchJson(page, "**/api/skills", (body) => {
      skills = body;
      return { suggestions: [SUGGESTION] };
    });
    await page.goto("/skills");

    const s = page.getByTestId("rule-suggestion").first();
    await expect(s.getByTestId("rule-sentence")).toHaveCount(0);
    const draft = s.getByTestId("rule-draft");
    await expect(draft).toBeVisible();
    await expect(draft).toBeEnabled();

    // Nothing was spent getting here — the page load itself asked for no draft.
    let drafted: Record<string, unknown> | null = null;
    await page.route("**/api/skills/suggestion", async (route) => {
      drafted = JSON.parse(route.request().postData() || "{}");
      // What the server answers a failed draft with: the whole Skills view again, plus the
      // reason. It never raises — a spent quota is news, not an exception.
      await route.fulfill({
        json: {
          ...skills,
          suggestions: [],
          bannerHtml:
            "<div class='banner err'><span>x</span><div>Could not draft a rule: Claude did not answer.</div></div>",
        },
      });
    });
    await draft.click();
    await expect.poll(() => drafted?.action).toBe("draft");
    await expect.poll(() => drafted?.signature).toBe(SUGGESTION.signature);
    await expect(page.locator(".banner.err")).toContainText(/could not draft a rule/i);
  });

  test("a remembered draft failure is shown, not silently retried", async ({ page }) => {
    await patchJson(page, "**/api/skills", () => ({
      suggestions: [{ ...SUGGESTION, draftError: "Claude did not answer within 90 seconds." }],
    }));
    await page.goto("/skills");
    await expect(page.getByTestId("rule-draft-error")).toContainText(
      /did not answer within 90 seconds/i,
    );
    await expect(page.getByTestId("rule-draft")).toBeVisible();
  });

  test("with no Claude account there is no button to press", async ({ page }) => {
    await patchJson(page, "**/api/skills", () => ({
      suggestions: [{ ...SUGGESTION, connected: false }],
    }));
    await page.goto("/skills");
    await expect(page.getByTestId("rule-draft")).toHaveCount(0);
    await expect(page.getByTestId("rule-pending")).toContainText(/connect your claude account/i);
  });

  test("a draft already running on the server is not offered again", async ({ page }) => {
    await patchJson(page, "**/api/skills", () => ({
      suggestions: [{ ...SUGGESTION, drafting: true }],
    }));
    await page.goto("/skills");
    const draft = page.getByTestId("rule-draft");
    await expect(draft).toBeDisabled();
    await expect(draft).toHaveText(/drafting/i);
  });
});

test.describe("a profile that has drifted from the checkout", () => {
  test("is badged stale and names both commits", async ({ page }) => {
    // Real: the fixture ships a base clone whose HEAD is not the commit the profile was built
    // against, which is the only way the server will answer anything but "cannot tell".
    await page.goto("/skills");
    const card = page.getByTestId("repo-profile").filter({ hasText: REPO }).first();
    await expect(card.getByTestId("profile-stale")).toHaveText("Stale");
    await card.locator("> summary").click();
    const note = card.getByTestId("profile-stale-note");
    await expect(note).toContainText(/out of date with the checkout/i);
    await expect(note).toContainText("deadbeefcafe");
  });

  test("a repository with no profile at all is not called stale", async ({ page }) => {
    await page.goto("/skills");
    const card = page.getByTestId("repo-profile").filter({ hasText: REPO2 }).first();
    await expect(card.getByTestId("profile-stale")).toHaveCount(0);
  });

  test("the earlier versions the card counts are reachable, and restorable", async ({ page }) => {
    await page.goto("/skills");
    const card = page.getByTestId("repo-profile").filter({ hasText: REPO }).first();
    await card.locator("> summary").click();

    const versions = card.getByTestId("profile-versions");
    await expect(versions).toBeVisible();
    await expect(versions.locator("summary")).toContainText(/earlier version/i);
    await versions.locator("summary").click();

    // Reading one changes nothing — restoring is a separate, explicit click.
    await expect(versions.getByRole("button", { name: "Restore" }).first()).toBeVisible();
    // Newest first, so the last row is the oldest version the fixture ships.
    await versions.getByRole("button", { name: "View" }).last().click();
    const view = card.getByTestId("profile-version-view");
    await expect(view).toContainText(/read only/i);
    await expect(view).toContainText(/critical paths/i);
    // It really is that one, not the live profile: it has the shorter rule and no do-not-flag.
    await expect(view).toContainText("Money is always integer cents.");
    await expect(view).not.toContainText(/pnpm-lock/);
  });
});

test.describe("an older server that sends none of this", () => {
  test("renders no placeholders where the new fields would be", async ({ page }) => {
    // Everything new stripped from /api/pr — the page must be quieter, never broken, and must
    // never print "undefined" at the reviewer.
    await patchJson(page, `**/api/pr?repo=${enc(REPO2)}&pr=${PR3}*`, (body) => {
      const { reviewKey, truncated, preselectCapped, maxPerPost, anchorsUnknown, anchorError,
        ...review } = body.review;
      void reviewKey; void truncated; void preselectCapped; void maxPerPost;
      void anchorsUnknown; void anchorError;
      return {
        // The three PR-state fields are new too: an older server sends none of them, and the
        // page must fall back to offering the approval rather than gating on `undefined`.
        prState: undefined, merged: undefined, canApprove: undefined,
        review: {
          ...review,
          findings: review.findings.map((f: Record<string, unknown>) => {
            const { preselect, ...rest } = f;
            void preselect;
            return rest;
          }),
          approve: review.approve && { lgtm: review.approve.lgtm, blockers: review.approve.blockers,
            defaultMsg: review.approve.defaultMsg },
        },
      };
    });
    await page.goto(prPath(REPO2, PR3));
    await expect(page.getByTestId("post-panel")).toBeVisible();
    await expect(page.getByTestId("truncated")).toHaveCount(0);
    await expect(page.getByTestId("preselect-capped")).toHaveCount(0);
    await expect(page.getByTestId("status-head-moved")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("undefined");
    await expect(page.locator("body")).not.toContainText("NaN");
    // With no pre-selection from the server, the old rule still applies: everything not low.
    await expect(page.locator(".finding.is-staged")).toHaveCount(1);
  });
});
