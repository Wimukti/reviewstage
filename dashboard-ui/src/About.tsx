import { useId, useState } from "react";
import { Icon } from "./icons";

// The page header of design §6: a display-type title, the one permitted orientation disclosure
// behind a `?` button, and whatever control belongs beside the title (range pills, the QA form).
// The sentence that used to sit under every title is gone; where a page still needs a word of
// orientation it goes in `about` and opens on demand.
export function PageHead({
  title,
  about,
  aboutTestId,
  children,
}: {
  title: React.ReactNode;
  about?: React.ReactNode;
  aboutTestId?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="pagehead">
      <div className="pagehead-t">
        <h1>{title}</h1>
        {about && (
          <button
            type="button"
            className="about"
            aria-label="About this page"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="question" />
          </button>
        )}
      </div>
      {children}
      {about && open && (
        <div className="explainbox" id={id} data-testid={aboutTestId ?? "about-page"}>
          <div className="dbody">{about}</div>
        </div>
      )}
    </div>
  );
}
