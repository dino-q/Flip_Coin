# Agent Notes

## Project

This is a pure static front-end mini game. Keep it deployable by serving the
folder directly with no build step.

Core files:

- `index.html`
- `style.css`
- `script.js`
- `db.js`
- `assets/default-head.svg`
- `assets/default-tail.svg`
- `assets/card-back.jpg`

## Required Verification

Before delivering any change that touches coin rendering, layout, animation, or
storage, verify all of the following:

- `node --check script.js`
- `node --check db.js`
- Serve the project locally, for example:
  `python -m http.server 4173 --bind 127.0.0.1`
- Open `http://127.0.0.1:4173/` in a real browser.
- Confirm at 100% browser zoom that the game fits the viewport without needing
  manual browser zoom-out.
- Confirm the playfield background is the real card-back bitmap from
  `assets/card-back.jpg`, with a translucent/blurred overlay only. Do not fall
  back to generated card art for the main playfield.
- Confirm the coin front at `rotateY(0deg)` shows `assets/default-head.svg`.
- Confirm the coin back at `rotateY(180deg)` shows `assets/default-tail.svg`.
- Confirm an edge angle around `rotateY(86deg)` shows visible dark coin
  thickness that is not oversized, and confirm face-on angles do not show a
  separate translucent rim/halo outside the coin.
- Confirm the coin side thickness is present for the whole flip, including
  face-on, angled, edge-on, and landing frames. It should read as a thin solid
  side wall, not a translucent glow/halo that appears and disappears.
- Confirm flip axis follows drag direction: horizontal drag = sideways tumble
  (vry dominant), vertical drag = forward tumble (vrx dominant), diagonal = mixed.
  A hard/long swipe should produce noticeably faster spin (more flips) without
  proportionally faster lateral movement — the coin is flicked, not thrown.
- Confirm drag and release starts a flip and updates stats when the coin lands.
- Confirm the landing result is derived from the current coin orientation, not
  forced by a preselected result that causes a late artificial flip.
- Confirm that when the coin lands on its edge (edgeAmount > 0.25), it briefly
  rolls forward like a wheel (angular velocity drives linear movement via
  v = ω × r) with z-axis precession, before gradually falling flat. The edge
  rolling and precession effects decay over ~1 second via `groundAge`.
- Confirm the coin does not get stuck on its edge — the edge snap ramps from
  0.02 to 0.22 over 1 second, and `finishSettle` always snaps to the nearest
  flat angle (±3-4° random offset for natural tilt).
- Confirm the coin does not enter the final settle phase while it is still
  visibly spinning fast; it should slow first, then roll/fall.
- Confirm custom heads/tails uploads persist via IndexedDB.
- Confirm reset stats and restore coin still work.

## Browser Test Dependency

For one-off visual verification on Windows, install Playwright outside the
static project so deployment stays clean:

```powershell
New-Item -ItemType Directory -Force -Path C:\tmp\flip-coin-verify
Set-Location C:\tmp\flip-coin-verify
npm.cmd init -y
npm.cmd install playwright
npx.cmd playwright install chromium
```

Use `npm.cmd` / `npx.cmd` instead of `npm` / `npx` in PowerShell when script
execution policy blocks `.ps1` launchers.

## Coin Rendering Pitfall

Do not put CSS `filter` on `.coin`.

Chromium flattens the 3D subtree when `filter: drop-shadow(...)` is applied to
the transformed coin element. That breaks `backface-visibility`, causing the
front face to remain visible even when the coin is rotated to the back.

Use the separate `.coin-shadow` element for ground shadow instead.

The coin should remain a single 3D object:

- `.coin` is the transformed 3D parent.
- `.coin-face-heads` is the front face.
- `.coin-face-tails` is the back face.
- `.coin-rim` contains rim slices that provide visible thickness.

## Landing Behavior

Do not preselect heads/tails and then rotate the coin to that target at the end.
That reads as an artificial final flip. Let the simulated spin run down, derive
the result from the current 3D orientation, then settle to the nearest equivalent
heads/tails pose with the smallest angular correction.

## Physics Architecture

The physics uses a single continuous `stepThrow` loop — there is no separate
scripted settle animation phase. The coin goes through `idle → dragging →
throwing → idle` with no `settling` phase. Settle conditions (flat enough, slow
enough, on ground, past minDuration) trigger `finishSettle()` which snaps to the
nearest natural angle and calls `finishThrow()`.

Key design decisions:
- **moveSpeed vs spinForce are decoupled**: `moveSpeed` caps at 650 (coin stays
  on the table), `spinForce` caps at 1600 (hard swipe = many flips). This makes
  the coin feel flicked, not thrown.
- **Edge rolling is wheel-physics**: `rollVx = -vry × radius × scale`,
  `rollVy = vrx × radius × scale`. The coin rolls in the direction its spin
  axis dictates, like a real coin on a table.
- **No scripted animations for settle**: previous attempts with spiral paths,
  eased interpolation, and two-phase settle all looked robotic. Pure physics
  with aggressive damping looks most natural.
- **groundAge decay**: edge rolling effects (precession, roll force) decay over
  1 second so the coin always falls flat. Without this, the coin can get stuck
  in a stable vertical equilibrium.

## Audio

Sound is synthesized via Web Audio API buffers — no external audio files. The
flip sound has two parts:

1. A sharp metallic "ting" (3200/5800/8400 Hz sine waves + noise, 80 ms, fast
   exponential decay).
2. Spinning tick sounds (6–10 ticks with decelerating intervals, each a short
   4200–6000 Hz ping with individual decay).

Do not replace with `OscillatorNode` real-time synthesis — buffer-based is more
reliable for short percussive sounds across browsers.

## Image Adjustment

Users can adjust scale, position (x/y), and background opacity via sliders in
the COIN KIT panel. Settings persist in `localStorage` under
`coinBurst.settings` → `adjust.{heads,tails,bg}`.

- Coin face images: CSS `transform: scale() translate()` on the `<img>` inside
  `.coin-face-heads` / `.coin-face-tails`. The `.coin-face` has
  `overflow: hidden` so scaling zooms into the circular clip.
- Background: `background-size` and `background-position` on `.board-art`, plus
  `opacity` on the element itself.
- "全部還原" clears IndexedDB images, resets sliders, and removes adjust
  settings from localStorage.
