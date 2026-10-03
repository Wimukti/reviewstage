/* The app's own class recipes, for static Astro markup that has no React island to render a
 * <Button> or a <Badge> in. Same cva variants, same output as the component; app.css @sources
 * the component files so every class here is in the site's Tailwind build. */
import { buttonVariants } from "@app/components/ui/button";
import { badgeVariants } from "@app/components/ui/badge";
import { cn } from "@app/lib/utils";

type ButtonArgs = NonNullable<Parameters<typeof buttonVariants>[0]>;
type BadgeArgs = NonNullable<Parameters<typeof badgeVariants>[0]>;

export const button = (args: ButtonArgs = {}, extra = "") => cn(buttonVariants(args), extra);
export const badge = (args: BadgeArgs = {}, extra = "") => cn(badgeVariants(args), extra);
