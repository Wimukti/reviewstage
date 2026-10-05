# ReviewStage launch video: voice-over script

Timed to `reviewstage-launch-1080p-clean.mp4` (90.5 s, 30 fps). Times are where each scene
starts and ends on the clean cut; start speaking about a quarter second after the cut and finish
before the next one. Every line stays at or under 2.6 words per second, so there is room to breathe.

| # | Time | On screen | Spoken line | Words · pace |
| --- | --- | --- | --- | --- |
| 1 | 0–4 s | Hook card: “AI wrote the PR.” then “You still have to review it.” | “I review a lot of pull requests an agent wrote.” | 10 · 2.5/s |
| 2 | 4–9 s | Terminal types `npx reviewstage`; “ReviewStage is running.” | “So I built ReviewStage. One command, and it's a real desktop app.” | 12 · 2.4/s |
| 3 | 9–18 s | Wizard: GitHub token → Connect Claude → pick two repos → the queue. | “Sign in with GitHub, connect your own Claude plan, and pick the repos you review. That's the setup.” | 18 · 1.9/s |
| 4 | 18–24 s | Empty queue; a notification slides in; #38851 appears in To review. | “When a teammate asks for your review, it lands right here.” | 11 · 2.0/s |
| 5 | 24–42 s | Open #38851, pick Standard effort, Run review; phases tick; three findings with file:line. | “I open it and run a review. Claude Code reads the real diff on my own plan and drafts findings, each one pinned to a file and a line.” | 29 · 1.6/s |
| 6 | 42–54 s | Tick two findings, edit one, Post selected → “Posted as acme-dev”. | “I tick the ones worth saying, fix the wording, and post. It goes up as a plain comment under my name. Nothing posts until I click.” | 26 · 2.1/s |
| 7 | 54–61 s | Settings → Your phone → Enable phone access → QR code. | “Scan one code and your phone is signed in as you.” | 11 · 1.7/s |
| 8 | 61–77 s | Desktop left, phone right: push banner → queue → PR → swipe two → Post → next PR. | “Now a review ping reaches my phone. I swipe right on the findings I agree with, post, and it hands me the next one.” | 24 · 1.4/s |
| 9 | 77–83 s | Skills → Suggested rules: a rule drafted from four dropped findings. | “Drop the same kind of nit a few times, and it suggests a rule.” | 14 · 2.3/s |
| 10 | 83–90 s | End card: npx reviewstage · reviewstage.dev · github.com/Wimukti/reviewstage. | “It's open source, MIT, and runs on your Claude plan. N P X reviewstage.” | 14 · 1.9/s |

Total: 169 words over 90.5 s (1.9 words/s on average).

## Recording tips

- Read it as yourself, the way you would explain it to a colleague at your desk. Plain words, no
  announcer voice. If a line feels long when you say it, drop words; never speed up.
- Record each scene's line as its own take (ten short takes), with a second of room tone before
  and after. It is far easier to place short takes than to fix one long read.
- A quiet room with soft surfaces beats a good microphone in an echoing one. Keep the mic a hand's
  width from your mouth, slightly off-axis, with a pop filter.
- Record at 48 kHz, 24-bit, peaks around −12 dBFS. Leave the final level to the command below,
  which normalises to −16 LUFS integrated (true peak −1.5 dB), the usual target for YouTube and
  social video.
- Lay the takes on one track in your editor at the times above, export a single WAV
  (`voiceover.wav`) exactly as long as the video or shorter, then run the command below. There is no
  music bed, so there is nothing to duck.

## Laying the voice on the clean cut

```bash
ffmpeg -i reviewstage-launch-1080p-clean.mp4 -i voiceover.wav \
  -filter_complex "[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart \
  reviewstage-launch-1080p-voice.mp4
```

The video stream is copied untouched; `apad` plus `-shortest` makes the audio exactly as long as the
picture. For a captioned version with voice, run the same command on
`reviewstage-launch-1080p.mp4`.
