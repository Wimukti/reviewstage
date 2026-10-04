/* The one-line install, named once so the fold's Install button, the Install section and the
 * verify script cannot drift apart. */
export const installCommand = "npx reviewstage";
/* The team install, for the Install page and the Team tier. */
export const teamInstallCommand =
  "git clone https://github.com/Wimukti/reviewstage && cd reviewstage && cp .env.example .env && docker compose up -d";
