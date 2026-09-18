import type { Me } from "./api";
// The mark in both inks: the dark-ink variant on light paper, the server's light-ink variant
// (rs_assets.LOGO) on dark. CSS shows whichever matches the theme; the other stays in the DOM
// so a theme switch needs no re-render.
import logoInk from "../../assets/logo.svg";

export function Logo({ me, className }: { me: Me; className?: string }) {
  const cls = className ? " " + className : "";
  return (
    <>
      <img className={"logo-on-light" + cls} src={logoInk} alt="" />
      {me.logo && <img className={"logo-on-dark" + cls} src={me.logo} alt="" />}
    </>
  );
}
