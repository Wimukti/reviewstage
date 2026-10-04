// /repos — change or add the repositories this install watches, after the wizard. Personal
// mode only: a team install's list lives in .env, so it is sent to Settings instead.
import { useEffect } from "react";
import type { Me } from "./api";
import { RepoPicker } from "./RepoPicker";
import { navigate } from "./router";
import { PageHeader, StatusBadge } from "./ui";
import { Card, CardContent } from "@/components/ui/card";

export function Repos({ me, reload }: { me: Me; reload: () => Promise<unknown> }) {
  useEffect(() => {
    if (!me.personal) navigate("/settings");
  }, [me.personal]);
  if (!me.personal) return null;
  const n = (me.repos || []).length;
  return (
    <>
      <PageHeader
        title="Repositories"
        help={
          <>
            Review requests from these repositories reach your queue. Tick to add, untick to stop
            watching; the change applies on the next poll, with no restart.
          </>
        }
        actions={<StatusBadge tone="graphite" icon={null} data-testid="repos-count">{n.toLocaleString("en-US")} watched</StatusBadge>}
      />
      <Card className="py-0">
        <CardContent className="px-7 pb-6 pt-5 max-[899px]:px-5">
          <RepoPicker
            me={me}
            cta="Save"
            onSaved={async () => {
              await reload();
              navigate("/");
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
