// The fold's frame: the real PR page (StageScene, inside its shadow-rooted island) playing the
// staging sequence once, with a Replay control that bumps the island's playKey. One island for
// the whole hero, as design §7 asks; the light behind it is the light DOM's `.stage-hero`.
import { useState } from "react";
import StageIsland from "../stage/StageIsland";
import { FrameBar } from "./FrameBar";

export default function HeroStage() {
  const [playKey, setPlayKey] = useState(0);
  const [playing, setPlaying] = useState(true);
  return (
    <div className="stage-frame lift" data-hero-stage data-playing={playing ? "1" : undefined}>
      <FrameBar title="private stage">
        <button
          type="button"
          className="frame-btn"
          data-replay
          disabled={playing}
          onClick={() => {
            setPlaying(true);
            setPlayKey((k) => k + 1);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
          Replay
        </button>
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
