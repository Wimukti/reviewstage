import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

const site = "https://wimukti.github.io";
const base = "/reviewstage";

export default defineConfig({
  site,
  base,
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
      head: [
        { tag: "link", attrs: { rel: "icon", href: `${base}/favicon.ico`, sizes: "16x16 32x32 48x48" } },
        { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "192x192", href: `${base}/favicon-192.png` } },
        { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "512x512", href: `${base}/favicon-512.png` } },
        { tag: "link", attrs: { rel: "apple-touch-icon", sizes: "180x180", href: `${base}/apple-touch-icon.png` } },
        { tag: "meta", attrs: { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#F6F6F9" } },
        { tag: "meta", attrs: { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#101117" } },
        { tag: "meta", attrs: { property: "og:image", content: `${site}${base}/og.png` } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: `${site}${base}/og.png` } },
      ],
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
        styleOverrides: { borderRadius: "8px", codeFontFamily: "var(--mono)" },
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
