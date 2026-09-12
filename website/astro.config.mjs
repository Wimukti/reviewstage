import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://wimukti.github.io",
  base: "/reviewstage",
  output: "static",
  trailingSlash: "always",
  vite: { plugins: [tailwindcss()] },
  integrations: [
    sitemap(),
    starlight({
      title: "ReviewStage",
      description:
        "ReviewStage drafts your PR review from the real diff, on your own Claude plan, and stages every finding privately. Nothing posts until you click.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/app.css"],
      components: {
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
        Footer: "./src/components/starlight/Footer.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
      },
      expressiveCode: {
        themes: ["github-dark-default", "github-light"],
        useStarlightDarkModeSwitch: true,
        useStarlightUiThemeColors: true,
        styleOverrides: { borderRadius: "0.75rem", codeFontFamily: "var(--font-mono)" },
      },
      editLink: { baseUrl: "https://github.com/Wimukti/reviewstage/edit/main/website/" },
      lastUpdated: true,
      social: [
        { icon: "github", label: "ReviewStage on GitHub", href: "https://github.com/Wimukti/reviewstage" },
      ],
      sidebar: [
        { label: "Home", link: "/" },
        { label: "Start here", autogenerate: { directory: "start" } },
        { label: "Guides", autogenerate: { directory: "guides" } },
        { label: "Security", autogenerate: { directory: "security" } },
        { label: "Operations", autogenerate: { directory: "operations" } },
        { label: "Developers", autogenerate: { directory: "developers" } },
      ],
    }),
  ],
});
