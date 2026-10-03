import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { BarChart3, BookOpen, ClipboardCheck, Code2, GitPullRequest, Inbox, Plug, Settings } from "lucide-react";
import { api, type Me, type QueueRow } from "./api";
import { parsePrRef, prUrl } from "./pr";
import { navigate } from "./router";
import { RepoPill } from "./ui";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  icon?: LucideIcon;
}

const SECTIONS: [string, string, LucideIcon][] = [
  ["Queue", "/", Inbox],
  ["QA guides", "/qa", ClipboardCheck],
  ["Learnings", "/learnings", BookOpen],
  ["Insights", "/dashboard", BarChart3],
  ["Skills", "/skills", Code2],
  ["Integrations", "/integrations", Plug],
  ["Settings", "/settings", Settings],
];

const ACTIONS = "Actions";
const PRS = "Pull requests";
const PAGES = "Pages";

export function CommandPalette({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<QueueRow[]>([]);
  // A bare number the queue does not know, with several repositories configured: the single
  // "Review PR #n" offer expands into one row per repository only once it is chosen.
  const [pickFor, setPickFor] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
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

  // cmdk 1.1 highlights the first option on mount but drops the scheduled update that tells the
  // input about it (the scheduler's map is replaced while it runs), so until the first arrow key
  // the combobox has no aria-activedescendant. Mirror the highlighted option onto the input
  // whenever it changes; cmdk's own value wins once it starts setting one.
  useEffect(() => {
    if (!open) return;
    // The content mounts in a portal a render after `open`, so watch the document, not the ref.
    const sync = () => {
      const root = rootRef.current;
      if (!root) return;
      const sel = root.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
      const input = root.querySelector<HTMLElement>("[cmdk-input]");
      if (sel && input && input.getAttribute("aria-activedescendant") !== sel.id) {
        input.setAttribute("aria-activedescendant", sel.id);
      }
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
    return () => obs.disconnect();
  }, [open]);

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
          group: ACTIONS,
          label: `Review PR #${pickFor} in ${r}`,
          sub: "open the review page",
          icon: GitPullRequest,
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
          group: ACTIONS,
          label: `Review PR #${parsed.number}`,
          sub: multi ? `in ${parsed.repo}` : "open the review page",
          icon: GitPullRequest,
          run: () => go(prUrl({ repo: parsed.repo, num: parsed.number })),
        });
      } else {
        const num = parsed.number;
        out.push({
          id: "review",
          group: ACTIONS,
          label: `Review PR #${num}`,
          sub: multi ? "choose the repository" : "open the review page",
          icon: GitPullRequest,
          run: () => {
            if (multi) setPickFor(num);
            else go(prUrl({ repo: repos[0] || "", num }));
          },
        });
      }
    }
    for (const r of matched) {
      out.push({
        id: `pr-${r.repo}-${r.num}`,
        group: PRS,
        num: r.num,
        repo: multi ? r.repo : "",
        title: r.title,
        author: r.author,
        run: () => go(prUrl({ repo: r.repo, num: r.num })),
      });
    }
    for (const [label, to, icon] of SECTIONS) {
      if (needle && !label.toLowerCase().includes(needle)) continue;
      out.push({ id: `go-${to}`, group: PAGES, label, icon, run: () => go(to) });
    }
    return out;
  }, [parsed?.repo, parsed?.number, multi, repos, needle, rows, go, pickFor]);

  // Options are grouped so the group name is read once, not on every row.
  const groups: { name: string; items: Cmd[] }[] = [];
  for (const c of cmds) {
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.items.push(c);
    else groups.push({ name: c.group, items: [c] });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent
        className="cmdk top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-xl bg-popover p-0 sm:max-w-[600px]"
        showCloseButton={false}
        // Escape steps back out of the repository choice first; a second one closes.
        onEscapeKeyDown={(e) => {
          if (pickFor) {
            e.preventDefault();
            setPickFor("");
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Search your pull requests, review one by number or URL, or jump to a page.</DialogDescription>
        </DialogHeader>
        <Command
          ref={rootRef}
          shouldFilter={false}
          loop
          className="bg-transparent [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input-wrapper]]:h-12 [&_[cmdk-input-wrapper]]:px-4 [&_[cmdk-input]]:h-12 [&_[cmdk-input]]:text-base [&_[cmdk-item]]:min-h-9 [&_[cmdk-item]]:px-2"
        >
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder="PR URL, owner/name#123, or a number, or jump to…"
            data-testid="palette-input"
            autoComplete="off"
            spellCheck={false}
          />
          <CommandList className="max-h-[min(56vh,460px)] p-1" data-testid="palette-list" aria-label="Results">
            <CommandEmpty className="px-4 py-6 text-sm text-muted-foreground">
              No matches — paste a PR URL, owner/name#123, or a number to review it.
            </CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.name} heading={g.name}>
                {g.items.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={c.run} className="cursor-pointer gap-2.5 data-[selected=true]:bg-blue/14">
                    {c.num ? (
                      <>
                        <span className="shrink-0 text-sm font-medium text-primary">#{c.num}</span>
                        {c.repo && <RepoPill repo={c.repo} />}
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        {c.author && <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{c.author}</span>}
                      </>
                    ) : (
                      <>
                        {c.icon && <c.icon aria-hidden="true" />}
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {c.sub && <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{c.sub}</span>}
                      </>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex gap-4 border-t px-3.5 py-2 text-xs text-muted-foreground">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> open
            </span>
            <span>
              <kbd>esc</kbd> close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
