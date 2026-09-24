// One React entry point for every stage island on the site. Astro passes a client:only
// component's slot content as static HTML, not as React children, so the scene is chosen by
// prop here and rendered inside StageFrame's shadow root. The W lane's hero and strip use this.
import { StageFrame } from "./StageFrame";
import { StageScene, type SceneState } from "@app/stage/StageScene";
import { StageQueueCard, type QueueCardState } from "@app/stage/StageQueueCard";
import { StageProgress } from "@app/stage/StageProgress";

type Props =
  | { scene: "scene"; state: SceneState; play?: boolean; playKey?: number; className?: string; label?: string }
  | { scene: "queue"; state?: QueueCardState; className?: string; label?: string }
  | { scene: "progress"; cur?: number; className?: string; label?: string };

export default function StageIsland(props: Props) {
  const { className, label } = props;
  return (
    <StageFrame className={className} label={label}>
      {props.scene === "scene" ? (
        <StageScene state={props.state} play={props.play} playKey={props.playKey} />
      ) : props.scene === "queue" ? (
        <StageQueueCard state={props.state} />
      ) : (
        <StageProgress cur={props.cur} />
      )}
    </StageFrame>
  );
}
