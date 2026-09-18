import { useEffect, useState } from "react";
import { api, errMessage, type HowData } from "./api";
import { Icon } from "./icons";
import { Banner, Status } from "./ui";

// The step illustrations are live mocks built from the same classes as the pages they explain —
// a finding, the commit bar, the progress list — so they cannot drift from the product the way
// the embedded screenshots of the old interface did. They are pictures: inert and hidden from
// assistive tech, with the step text carrying the meaning.

interface Step {
  n: number;
  title: string;
  txt: React.ReactNode;
  mock?: "slack" | "progress" | "findings" | "post" | "approve";
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "A review is requested",
    txt: "A teammate adds you as a reviewer on a PR. ReviewStage notices within 3 minutes and sends you a Slack card — no need to watch GitHub.",
    mock: "slack",
  },
  {
    n: 2,
    title: "ReviewStage drafts the review",
    txt: (
      <>
        You click through to the PR. ReviewStage checks out the branch and runs the{" "}
        <code>pr-review</code> skill against the real diff — a few minutes for a typical PR on Opus, longer for Deep.
        Nothing is posted to GitHub in this step.
      </>
    ),
    mock: "progress",
  },
  {
    n: 3,
    title: "You decide what's worth saying",
    txt: (
      <>
        The findings appear as editable cards, each with a severity and a <code>file:line</code>.
        Tick the ones you agree with, edit any wording, ignore the rest.
      </>
    ),
    mock: "findings",
  },
  {
    n: 4,
    title: "Post — as you",
    txt: (
      <>
        The selected comments post to the PR as inline review comments under your own GitHub name.
        Always a plain <code>COMMENT</code> review — ReviewStage never requests changes or blocks a merge.
      </>
    ),
    mock: "post",
  },
  {
    n: 5,
    title: "Approve when you're ready",
    txt: "A separate click posts an approval comment and approves the PR, also as you. This is what stops the 'posted comments, forgot to approve' loop.",
    mock: "approve",
  },
];

const GUARANTEES = [
  { t: "Always you", d: "Every comment and approval posts under your own GitHub account." },
  {
    t: "Nothing automatic",
    d: "Nothing reaches GitHub without your click. The review step can't write to GitHub at all.",
  },
  {
    t: "Comments, not blocks",
    d: "ReviewStage posts plain review comments — it never requests changes or blocks a merge.",
  },
  {
    t: "Your credentials, encrypted",
    d: "Your GitHub and Claude tokens are encrypted on the box and used only for your actions.",
  },
];

function Mock({ kind, d }: { kind: NonNullable<Step["mock"]>; d: HowData }) {
  const you = d.reviewer || "you";
  let body: React.ReactNode;
  if (kind === "slack")
    body = (
      <div className="howslack">
        <div className="howslack-top">
          <span className="av">{(d.brand || "R").slice(0, 1)}</span>
          <b>{d.brand}</b>
          <span className="howapp">app</span>
          <span className="muted sm">9:54</span>
        </div>
        <div className="muted sm">
          <b>@{you}</b> review requested
        </div>
        <div className="howslack-t">
          <span className="num">#38849</span> Add lead-time badge to product cards
        </div>
        <div className="muted sm">
          <span className="repochip">acme/widgets</span> · +42 −8 · 5 files
        </div>
        <div className="howslack-btns">
          <span className="btn sm primary">Open review</span>
          <span className="btn sm secondary">Queue</span>
          <span className="btn sm secondary">Open PR</span>
        </div>
      </div>
    );
  else if (kind === "progress")
    body = (
      <div className="panel" style={{ margin: 0 }}>
        <div className="prog-hd">
          Drafting the review <span className="muted sm">· Standard</span>
        </div>
        <ul className="prog">
          {["Fetching the PR", "Checking out the branch", "Reviewing the diff", "Writing the findings"].map((ph, j) => (
            <li key={ph} className={j < 2 ? "done" : j === 2 ? "now" : ""}>
              <span className="pm">
                {j < 2 ? <Icon name="check" /> : j === 2 ? <span className="rundot" /> : <Icon name="circle" />}
              </span>
              {ph}
            </li>
          ))}
        </ul>
        <div className="hint">This page refreshes itself. Nothing reaches GitHub in this step.</div>
      </div>
    );
  else if (kind === "findings")
    body = (
      <div className="finding is-staged">
        <div className="fhead">
          <input type="checkbox" className="fsel" checked readOnly tabIndex={-1} />
          <Status kind="should-fix" />
          <span className="fhead-sp" />
          <span className="loc">app/models/Product.php:42</span>
        </div>
        <div className="fmain">
          <div className="ftitle">A product with no vendor can crash the lead-time badge</div>
          <div className="fimpact">
            <span className="fimpact-l">Why it matters</span>
            A shopper viewing such a product would see the card fail instead of loading.
          </div>
          <div className="factions">
            <span className="fbtn">Comment</span>
            <span className="fbtn accent">Explain simply</span>
          </div>
        </div>
      </div>
    );
  else if (kind === "post")
    body = (
      <div className="commit-bar">
        <div className="inner">
          <span className="muted">
            <b>2 staged</b> · 1 inline · 1 in summary
          </span>
          <span className="spacer" />
          <span className="btn primary">Post as {you}</span>
        </div>
      </div>
    );
  else
    body = (
      <div className="howapprove">
        <Status tone="green">Approved — no blockers</Status>
        <pre>{`Looks good — just handle this before merge:\n- app/models/Product.php:42 — guard a null vendor`}</pre>
        <span className="btn primary" style={{ alignSelf: "flex-start" }}>
          Approve #38849 as {you}
        </span>
      </div>
    );
  return (
    <div className="shot mock" aria-hidden="true" inert data-testid={`how-mock-${kind}`}>
      {body}
    </div>
  );
}

export function HowItWorks() {
  const [d, setD] = useState<HowData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api
      .how()
      .then(setD)
      .catch((e: unknown) => setErr(errMessage(e, "Couldn't load this page.")));
  }, []);
  if (err)
    return (
      <Banner kind="err" data-testid="how-error">{err}</Banner>
    );
  if (!d) return <div className="muted">Loading…</div>;

  return (
    <>
      <h1>How {d.brand} works</h1>
      <p className="lead">
        ReviewStage drafts the PR reviews you owe your team, and lets you send them with a click. It's an
        assistant — you stay the reviewer.
      </p>
      <div className="flow">
        {STEPS.map((s) => (
          <div className="fstep" key={s.n}>
            <div className="fn">{s.n}</div>
            <div className="fb">
              <h4>{s.title}</h4>
              <div className="muted sm">{s.txt}</div>
              {s.mock && <Mock kind={s.mock} d={d} />}
            </div>
          </div>
        ))}
      </div>
      <h2>The guarantees</h2>
      <div className="grid2">
        {GUARANTEES.map((g) => (
          <div className="mini" key={g.t}>
            <div className="t">{g.t}</div>
            <div className="muted sm">{g.d}</div>
          </div>
        ))}
      </div>
      <h2>What the tabs mean</h2>
      <div className="grid2">
        {d.tabs.map((t) => (
          <div className="mini" key={t.key}>
            <div className="t">{t.label}</div>
            <div className="muted sm">{t.desc}</div>
          </div>
        ))}
      </div>
      <p className="fine">
        Questions or something not working? Ping <code>{d.reviewer}</code>.
      </p>
    </>
  );
}
