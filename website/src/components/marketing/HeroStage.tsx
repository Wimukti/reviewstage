// The fold's frame: the real PR page (StageScene, inside its shadow-rooted island) playing the
// staging sequence once, with a Replay control that bumps the island's playKey. One island for
// the whole hero, as design §7 asks; the light behind it is the light DOM's `.stage-hero`.
import { useState } from "react";
import { EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@app/components/ui/button";
import StageIsland from "../stage/StageIsland";
import { FrameBar } from "./FrameBar";

export default function HeroStage() {
  const [playKey, setPlayKey] = useState(0);
  const [playing, setPlaying] = useState(true);
  return (
    <div className="stage-frame lift grid content-start overflow-hidden rounded-lg bg-card shadow-sm" data-hero-stage data-playing={playing ? "1" : undefined}>
      <FrameBar tone="graphite" icon={EyeOff} title="Private stage">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="max-sm:h-11"
          data-replay
          disabled={playing}
          onClick={() => {
            setPlaying(true);
            setPlayKey((k) => k + 1);
          }}
        >
          <RotateCcw aria-hidden="true" />
          Replay
        </Button>
      </FrameBar>
      <StageIsland
        scene="scene"
        state="staged"
        play
        playKey={playKey}
        onDone={() => setPlaying(false)}
        label="The PR page: findings arrive, two are staged, the post button lights up"
      />
    </div>
  );
}
