// The app's Md, fed a string. Astro hands a framework component's JSX children over as a
// rendered slot, not as text, and react-markdown needs the text — so the pages pass it as a prop.
import { Md } from "@app/Md";

export function MdText({ text, className }: { text: string; className?: string }) {
  return <Md className={className}>{text}</Md>;
}
