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
- Confirm the coin's face genuinely sweeps toward and away from the camera as it
  flips (heads → edge → tails → edge → heads), i.e. the face normal passes
  through both +z and -z. It must NOT look like a flat card hinging about a fixed
  pencil laid on the glass, nor drift into a vertical-rolling / spinning-top pose.
- Confirm the flip has a natural wobble: at the face-on moments the coin is
  tilted a few degrees (β is ~78°, not 90°), and the flip axis appears to wander,
  rather than a perfectly regular planar flip.
- Confirm a hard/long swipe produces noticeably more flips (higher `omega`)
  without proportionally faster lateral movement — the coin is flicked, not thrown.
- Confirm drag and release starts a flip and updates stats when the coin lands.
- Confirm the landing result is derived from the current orientation
  (`sign(coinState.nz)`), never from a preselected result — the reported face
  must always equal the visibly-shown face (0 mismatches over many flips).
- Confirm heads/tails is fair (~50/50) over a large batch, and that both the
  heads (+z) and tails (rotateY(180)) faces render correctly.
- Confirm the coin settles flat to whichever face was showing when it slowed
  below `FLIP.flattenOmega`, collapsing the precession cone (β → ~2°, L → the
  camera pole) rather than snapping a scripted angle; it should slow first, then
  flatten, never enter settle while still spinning fast.
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
That reads as an artificial final flip. Let the spin run down; the result is read
directly from the orientation (`sign(coinState.nz)` at the moment it slows below
`FLIP.flattenOmega`), and the coin then flattens to that same face.

## Physics Architecture — torque-free precession (rewritten 2026-07-04)

The orientation model is the closed-form free precession of a symmetric disc, NOT
Euler angles or an ODE integrator. It replaced the earlier `axisAngle`/`tumble`/
`rz`/`vTumble`/`precessRate`/`wobbleAmp` scheme, which only ever rotated the coin
about a screen-plane axis (`rotate3d(ax,ay,0,tumble)` — the Z axis component was
hard-coded 0) plus ad-hoc sine wobbles, and so read as a flat card hinging about a
pencil / a mechanically regular flip.

The model (all in `startThrow`, `stepThrow`, `updateOrientation`, `renderCoin`):
- **One fixed world axis `L`** (`Lx,Ly,Lz`) is chosen once at release and held
  constant for the whole flight = angular-momentum conservation. `L` is biased
  roughly horizontal in the screen plane (`FLIP.inPlaneSpread`) with a small lean
  toward the camera (`FLIP.leanMax`). **`L` must be roughly in the screen plane,
  NOT pointing at the camera** — that is what makes the face sweep through ±z and
  actually flip. (The design-workflow draft suggested "L toward camera, β 20–40°";
  that geometry does not flip and was corrected here.)
- **The face normal `n` cones around `L`** at fixed half-angle `beta` as the
  precession azimuth `psi` accumulates: `n = cos β·L + sin β·(cos ψ·e1 + sin ψ·e2)`
  where `{e1,e2}` span the plane ⟂ `L`. `beta ≈ 78°` gives a clear flip with a
  natural ~12° wobble; `β = 90°` is a clean textbook flip; small β is a frisbee
  spin. This is the single "wobble" knob.
- **One master angular speed `omega`** (deg/s) drives both `psi` (flip) and `phi`
  (in-plane face spin, scaled by `FLIP.phiRate`). No sines. `omega` is capped at
  `FLIP.speedMax` so per-frame rotation stays < ~25° (no stroboscopic aliasing —
  this replaced the rejected tanh-cap + motion-blur attempt).
- **Render**: `updateOrientation()` computes `n`; `renderCoin` turns it into the
  axis-angle that rotates +z onto `n` (`axis = cross(+z,n) = (-ny,nx,0)`, angle =
  `acos(nz)`) plus `rotateZ(phi)`. CSS: `rotate3d(--ax,--ay,--az,--tilt) rotateZ(--phi)`.
  `getVisibleSide` / `getEdgeAmount` read the SAME `n`, so shown face and recorded
  result can never diverge.
- **Ground settle**: once `|omega| < FLIP.flattenOmega`, latch the currently-up
  pole, lerp `L` → that camera pole and `beta` → ~2°, so the cone collapses and the
  coin lies flat on the face it was showing. `finishSettle` reads the latched pole.
- **Bounce / walls**: a floor bounce bleeds `omega` (`FLIP.bounceSpinKeep`) but
  never touches `L` (momentum direction conserved); wall hits mirror the relevant
  `L` component (`L` is a pseudovector) and damp `omega`.

Tunable knobs live in the `FLIP` config object at the top of `script.js`
(`betaDeg` = wobble, `speedBase`/`speedCoupling`/`speedMax` = flip speed,
`phiRate`, `inPlaneSpread`, `leanMax`, `groundSpinDamp`, `restitution`).

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
