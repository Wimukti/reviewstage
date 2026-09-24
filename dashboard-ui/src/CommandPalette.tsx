import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Me, type QueueRow } from "./api";
import { parsePrRef, prUrl } from "./pr";
import { navigate } from "./router";
import { Icon, NavIcon } from "./icons";

// The command palette is the one place to search + review any PR. Opened by the sidebar's
// "Review a PR" button, by ⌘K / Ctrl-K anywhere, or by the reviewstage:open-palette event.
const EVT = "reviewstage:open-palette";
export function openPalette() {
  window.dispatchEvent(new Event(EVT));
}

interface Cmd {
  id: string;
  group: string;
  run: () => void;
  num?: string; // PR rows
  repo?: string;
  title?: string;
  author?: string;
  label?: string; // action / nav rows
  sub?: string;
  icon?: React.ReactNode;
}

const SECTIONS: [string, string, React.ReactNode][] = [
  ["Queue", "/", NavIcon.queue],
  ["QA guides", "/qa", NavIcon.qa],
  ["Learnings", "/learnings", NavIcon.learnings],
  ["Skills", "/skills", NavIcon.skills],
  ["Integrations", "/integrations", NavIcon.integrations],
  ["Settings", "/settings", NavIcon.settings],
];

const optId = (i: number) => `cmdk-opt-${i}`;

export function CommandPalette({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [rows, setRows] = useState<QueueRow[]>([]);
  // A bare number the queue does not know, with several repositories configured: the single
  // "Review PR #n" offer expands into one row per repository only once it is chosen.
  const [pickFor, setPickFor] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setSel(0);
    setPickFor("");
  }, []);
  const go = useCallback(
    (to: string) => {
      navigate(to);
      close();
    },
    [close],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onEvt = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(EVT, onEvt);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(EVT, onEvt);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setSel(0);
    inputRef.current?.focus();
    if (rows.length === 0) {
      api
        .queue("all", "newest")
        .then((d) => setRows(d.rows))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Typing again leaves the repository step behind.
  useEffect(() => {
    setPickFor("");
  }, [q]);

  const repos = useMemo(() => {
    const set = new Set<string>(me.repos || []);
    for (const r of rows) if (r.repo) set.add(r.repo);
    return [...set];
  }, [me.repos, rows]);
  const multi = repos.length > 1;
  const parsed = parsePrRef(q, repos);
  const needle = q.trim().toLowerCase();

  const cmds: Cmd[] = useMemo(() => {
    const out: Cmd[] = [];
    if (pickFor) {
      for (const r of repos) {
        out.push({
          id: `review-${r}`,
          group: "Review",
          label: `Review PR #${pickFor} in ${r}`,
          sub: "open the review page",
          icon: <Icon name="git" />,
          run: () => go(prUrl({ repo: r, num: pickFor })),
        });
      }
      return out;
    }
    const matched: QueueRow[] = [];
    for (const r of rows) {
      if (needle && !`${r.repo} ${r.repo}#${r.num} #${r.num} ${r.title} ${r.author}`.toLowerCase().includes(needle)) continue;
      if (matched.length >= 6) break;
      matched.push(r);
    }
    // "Review PR #n" is offered once, and only when what was typed no longer matches a row the
    // queue already knows — a partial number still has its rows to open.
    if (parsed && matched.length === 0) {
      if (parsed.repo) {
        out.push({
          id: "review",
          group: "Review",
          label: `Review PR #${parsed.number}`,
          sub: multi ? `in ${parsed.repo}` : "open the review page",
          icon: <Icon name="git" />,
          run: () => go(prUrl({ repo: parsed.repo, num: parsed.number })),
        });
      } else {
        const num = parsed.number;
        out.push({
          id: "review",
          group: "Review",
          label: `Review PR #${num}`,
          sub: multi ? "choose the repository" : "open the review page",
          icon: <Icon name="git" />,
          run: () => {
            if (multi) {
              setPickFor(num);
              setSel(0);
            } else go(prUrl({ repo: repos[0] || "", num }));
          },
        });
      }
    }
    for (const r of matched) {
      out.push({
        id: `pr-${r.repo}-${r.num}`,
        group: "Your PRs",
        num: r.num,
        repo: multi ? r.repo : "",
        title: r.title,
        author: r.author,
        run: () => go(prUrl({ repo: r.repo, num: r.num })),
      });
    }
    for (const [label, to, icon] of SECTIONS) {
      if (needle && !label.toLowerCase().includes(needle)) continue;
      out.push({ id: `go-${to}`, group: "Go to", label, icon, run: () => go(to) });
    }
    return out;
  }, [parsed?.repo, parsed?.number, multi, repos, needle, rows, go, pickFor]);

  useEffect(() => {
    setSel((s) => Math.max(0, Math.min(s, cmds.length - 1)));
  }, [cmds.length]);

  // keep the highlighted row in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (pickFor) setPickFor("");
      else close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, cmds.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      cmds[sel]?.run();
    }
  };

  // Options are grouped so the group name is read once, not on every row.
  const groups: { name: string; items: { c: Cmd; i: number }[] }[] = [];
  cmds.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.items.push({ c, i });
    else groups.push({ name: c.group, items: [{ c, i }] });
  });

  return (
    <div className="cmdk-back" onMouseDown={close}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-inwrap">
          <span className="cmdk-search" aria-hidden="true"><Icon name="search" /></span>
          <input
            ref={inputRef}
            className="cmdk-in"
            type="text"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="cmdk-listbox"
            aria-activedescendant={cmds.length ? optId(sel) : undefined}
            placeholder="PR URL, owner/name#123, or a number, or jump to…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="cmdk-list" ref={listRef} role="listbox" id="cmdk-listbox" aria-label="Results">
          {cmds.length === 0 && (
            <div className="cmdk-empty">No matches — paste a PR URL, owner/name#123, or a number to review it.</div>
          )}
          {groups.map((g) => {
            const hid = `cmdk-group-${g.name.replace(/\W+/g, "-").toLowerCase()}`;
            return (
              <div key={g.name} role="group" aria-labelledby={hid}>
                <div className="cmdk-grouphead" id={hid} role="presentation">{g.name}</div>
                {g.items.map(({ c, i }) => (
                  <div
                    key={c.id}
                    id={optId(i)}
                    role="option"
                    aria-selected={i === sel}
                    data-i={i}
                    className={"cmdk-row" + (i === sel ? " sel" : "")}
                    onMouseEnter={() => setSel(i)}
                    onClick={c.run}
                  >
                    {c.num ? (
                      <>
                        <span className="cmdk-num">#{c.num}</span>
                        {c.repo && <span className="cmdk-repo">{c.repo}</span>}
                        <span className="cmdk-title">{c.title}</span>
                        {c.author && <span className="cmdk-sub">{c.author}</span>}
                      </>
                    ) : (
                      <>
                        {c.icon && <span className="cmdk-ico">{c.icon}</span>}
                        <span className="cmdk-title">{c.label}</span>
                        {c.sub && <span className="cmdk-sub">{c.sub}</span>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
