// What the click would have done. Opens when the store records a post: the review event, each
// kept comment as GitHub would show it (path:line and the body, edits included), and the one
// call to action — run this on your own PR. Nothing here sends anything; the sheet says so.
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Send } from "lucide-react";
import { Md } from "../Md";
import { StatusBadge } from "../ui";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { bump } from "./events";
import { INSTALL_URL } from "./ReplayBanner";
import { POSTED_EVENT, type WouldPost } from "./store";

export const INSTALL_COMMAND = "npx reviewstage";

export function PostPreview() {
  const [post, setPost] = useState<WouldPost | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      setPost((e as CustomEvent<WouldPost>).detail);
      setOpen(true);
    };
    window.addEventListener(POSTED_EVENT, on);
    return () => window.removeEventListener(POSTED_EVENT, on);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    bump("install_copied");
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
    } catch {
      /* no clipboard permission: the command is on screen to copy by hand */
    }
    setCopied(true);
  };

  const n = post?.comments.length ?? 0;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        data-testid="replay-post-preview"
        className="mx-auto max-h-[90dvh] w-full max-w-[720px] gap-0 overflow-y-auto rounded-t-2xl border-0 bg-background pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
      >
        <SheetHeader className="px-4 pb-2 pt-4 text-left">
          <SheetTitle className="m-0 font-display text-xl tracking-tight">What would be posted</SheetTitle>
          <SheetDescription className="text-[15px]">
            <b className="text-foreground">Precomputed example — nothing was sent.</b> On your own PR this is the
            moment the review goes to GitHub, under your name.
          </SheetDescription>
        </SheetHeader>
        {post && (
          <div className="flex flex-col gap-3 px-4">
            <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="replay-post-event">
              <Send aria-hidden="true" className="size-4" />
              <span>
                {post.requestChanges ? "Request changes" : "Comment"} review on{" "}
                <b className="text-foreground">
                  {post.repo}#{post.pr}
                </b>{" "}
                as <b className="text-foreground">{post.login}</b> · {n} comment{n === 1 ? "" : "s"}
              </span>
            </p>
            {post.comments.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">Nothing kept — the review would carry the summary alone.</p>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {post.comments.map((c) => (
                  <li key={c.i} className="rounded-lg bg-card px-4 py-3" data-testid="replay-post-comment">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge kind={c.severity} />
                      <span className="font-medium text-foreground">
                        {c.path}:{c.line}
                      </span>
                      <span>{c.anchorable === false ? "in the summary" : "inline"}</span>
                    </div>
                    <Md className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{c.body}</Md>
                    {c.suggestion && (
                      <pre className="mb-0 mt-2 overflow-x-auto rounded-md bg-green/10 p-3 text-xs">
                        <code>{c.suggestion}</code>
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-2 rounded-xl bg-card p-4" data-testid="replay-cta">
              <p className="m-0 text-base font-semibold">Run this on your PR</p>
              <p className="mb-3 mt-1 text-sm text-muted-foreground">
                One command. Your GitHub account, your Claude subscription, your call on every comment.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="h-11 rounded-full px-5 font-mono text-sm"
                  onClick={() => void copy()}
                  data-testid="replay-cta-copy"
                  aria-label={`Copy the install command: ${INSTALL_COMMAND}`}
                >
                  <span className="opacity-60">$</span> {INSTALL_COMMAND}
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </Button>
                <Button asChild variant="secondary" className="h-11">
                  <a href={INSTALL_URL} data-testid="replay-cta-link">
                    Install guide
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
                <span className="sr-only" aria-live="polite">
                  {copied ? "Copied" : ""}
                </span>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
