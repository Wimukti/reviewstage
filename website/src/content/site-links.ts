/* Every internal href goes through `withBase` so the site works under a GitHub Pages
 * sub-path (`base: '/reviewstage'`). */
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const withBase = (path: string) => (path.startsWith("http") ? path : `${base}${path}`);

export interface LinkColumn { title: string; links: Array<{ label: string; href: string }>; }

export const repo = "https://github.com/Wimukti/reviewstage";

const l = {
  home: { label: "Home", href: "/" },
  getStarted: { label: "Get started", href: "/start/" },
  install: { label: "Install", href: "/start/install/" },
  firstReview: { label: "First review", href: "/start/first-review/" },
  teamMode: { label: "Team mode", href: "/start/team-mode/" },
  reviewing: { label: "Reviewing a PR", href: "/guides/reviewing/" },
  skills: { label: "Skills & learnings", href: "/guides/skills-and-learnings/" },
  qa: { label: "QA guides", href: "/guides/qa-guide/" },
  notifications: { label: "Notifications", href: "/guides/notifications/" },
  insights: { label: "Insights", href: "/guides/insights/" },
  security: { label: "Security model", href: "/security/" },
  configuration: { label: "Configuration", href: "/operations/configuration/" },
  troubleshooting: { label: "Troubleshooting", href: "/operations/troubleshooting/" },
  architecture: { label: "Architecture", href: "/developers/architecture/" },
  contributing: { label: "Contributing", href: "/developers/contributing/" },
  roadmap: { label: "Roadmap", href: "/developers/roadmap/" },
  github: { label: "GitHub", href: repo },
  license: { label: "License (MIT)", href: `${repo}/blob/main/LICENSE` },
  issues: { label: "Issues", href: `${repo}/issues` },
};

export const navLinks = [
  { label: "Docs", href: l.getStarted.href },
  { label: "Guides", href: l.reviewing.href },
  { label: "Security", href: l.security.href },
  { label: "Developers", href: l.architecture.href },
];

export const marketingFooterColumns: LinkColumn[] = [
  { title: "Product", links: [l.getStarted, l.install, l.firstReview, l.teamMode] },
  { title: "Documentation", links: [l.reviewing, l.skills, l.qa, l.notifications, l.configuration, l.troubleshooting] },
  { title: "Developers", links: [l.architecture, l.contributing, l.roadmap] },
  { title: "Project", links: [l.github, l.issues, l.license, l.security] },
];

export const docsFooterColumns: LinkColumn[] = [
  { title: "Start", links: [l.getStarted, l.install, l.firstReview] },
  { title: "Operate", links: [l.security, l.configuration, l.troubleshooting] },
  { title: "Build", links: [l.architecture, l.contributing, l.roadmap] },
  { title: "Project", links: [l.home, l.github, l.license] },
];
