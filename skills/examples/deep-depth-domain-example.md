# Example — a domain-specific "deep" depth instruction

ReviewStage appends a depth instruction to the active skill for each effort level (Quick /
Standard / Deep). The built-in Deep text is generic; teams can edit it on the Skills page
(stored as `_effort_deep.md`). This is what one team's Deep instruction grew into once it
encoded the flows that had bitten them — a pricing pipeline feeding an ordering flow on a
multi-partner commerce platform. Every product identifier has been replaced with a placeholder
in *italics*; the structure is the reusable part.

---

Effort level: DEEP — do a thorough deep analysis. Work through this method before writing any
finding, and report only what you can tie to concrete evidence (the diff, the code, review
threads, commit history):

1. **Intent.** Read the PR description and review threads; identify what the change is trying to
   do and which behaviours it touches (data flow/state, query/API logic, UI, business rules,
   error handling).
2. **Comprehensive impact search FIRST.** Before judging any line, search the whole repository for
   every component the change affects — callers and dependents of changed functions/fields,
   shared models, GraphQL queries/mutations/fragments, and any *per-partner* or *per-vendor*
   branching. Build the full blast radius up front; never discover impacts reactively.
3. **Trace data flow end to end** for each meaningful change (request → controller → library →
   model → response; on the frontend document → cache → component).
4. **Domain gates.** For any PR that could plausibly touch these flows, trace the flow explicitly
   and judge by flow impact, not keywords:
   - ***Pricing → ordering price.*** Could this change what *the pricing service* returns, whether
     it is called at all, or the price the buyer finally sees — even incidentally (a refactor that
     flips a flag, reorders a param into a pricing call, changes retry/error handling or caching
     around a price fetch, or restructures a per-customer price loop)? Walk five stages:
     (1) the pricing REQUEST — *request builders, mappers, validators, batch jobs*; (2) RESPONSE
     handling — *response mappers, price caching, fallbacks from service prices to database /
     price-level / estimate*; (3) FLAGS & routing that decide service-vs-database — *every feature
     flag and per-partner setting read on the price path* (a change that accidentally flips,
     defaults, bypasses or stops reading one of these is the canonical bug); (4) PERSISTENCE into
     what buyers order from — *the sync libraries and price-updater jobs* (watch chunking / early
     continue-break / swallowed exceptions / transaction changes that update SOME customers'
     prices and not others); (5) DISPLAY & use at ordering time — *draft pricing, unit-price
     helpers, edit-order re-pricing, the zero-price validation rule, order-UI price fields*. Flag
     anything that could cause a WRONG, STALE, MISSING or ZERO price to reach a buyer, naming the
     stage and the concrete buyer-visible failure. NOT in scope on their own: order minimums,
     delivery surcharges, taxes, transaction fees, back-office rebates — unless the change also
     alters a service-derived item price.
   - ***Catalog & search.*** Catalog data the pricing service prices against, *search-index*
     changes, category/product-model changes, *catalog-service* integration paths.
   - ***Partner-specific.*** Any branching on *partner code / vendor id / integrator type*, *sync
     libraries*, per-partner config/cutoff/pricing rules. Most partners are *service-integrated* —
     a change "only" to the non-integrated path still matters, and vice versa.
5. **Then examine**, reporting only genuine issues: correctness & logic (conditionals,
   short-circuits, off-by-one/boundaries, skip-conditions that exclude valid states,
   null/undefined and defaults for new fields); error handling (failure modes covered, errors
   surfaced not swallowed, loading/empty states, missing try/catch on critical paths); concurrency
   & races; edge cases ONLY where the PR changes their handling (empty collections,
   single-vs-many, first-time/no-data, migration of old data under new code, network failure);
   performance & scalability (N+1 queries, unbounded loops/allocations, hot-path cost); security
   (input validation, authz gaps, injection, secrets); *ORM* property renames on persisted
   records; *client-cache* correctness.
6. **Finding quality.** Give each finding an honest confidence and keep only high-signal ones.
   Every finding must state the concrete user-facing impact and a specific failing scenario (the
   exact inputs/state that produce the wrong output or crash) — no vague or speculative findings.
   Cover the ground exhaustively in your analysis prose, but do not pad the findings list.
7. **Quality gates (note, don't block):** if the PR adds, removes, renames or changes the default
   of a feature flag without a matching update to *your feature-flag documentation*, call it out
   with the flag name and what to document; if it adds meaningful new logic with no tests, name
   the key functions/hooks that lack coverage.

Take the time the 40-minute budget allows. This is analysis depth only — you still write findings
for a human to review and post, and you never post to GitHub yourself.
