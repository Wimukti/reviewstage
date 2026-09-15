import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown → HTML via react-markdown + remark-gfm. Links open in a new tab.
//
// `tasks` makes GFM task-list checkboxes usable. remark-gfm renders them as *disabled* inputs
// (correct for a rendered document, wrong for a QA guide a tester is meant to work through), so
// the override drops `disabled` and hands the box its initial state as `defaultChecked` — React
// then leaves the ticking to the DOM instead of re-deriving it from the markdown on every render.
export function Md({
  children,
  className,
  tasks,
}: {
  children: string;
  className?: string;
  tasks?: boolean;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener" />,
          input: ({ node: _n, checked, disabled, type, ...p }) =>
            tasks && type === "checkbox" ? (
              <input {...p} type="checkbox" defaultChecked={!!checked} />
            ) : (
              <input {...p} type={type} checked={checked} disabled={disabled} readOnly />
            ),
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
