# AGENTS.md

A TypeScript bridge between a phone face tracker and VNyan. It rotates head tracking from the
phone's off-axis frame into the user's own frame, and serves a web UI for calibration and
settings. Background: [README.md](README.md). Protocol facts and what still needs a live test:
[docs/protocols.md](docs/protocols.md).

## Commands

```sh
npm install
npm run dev          # bridge (tsx watch, :8787) + Vite (:5173, proxies /api and /ws)
npm test             # vitest run (all packages)
npm run typecheck    # tsc --noEmit in every workspace
npm run lint         # biome check . ; `npm run format` applies fixes
npm run build        # shared → web → bridge (dist/)
npm run simulate -w @offaxis/bridge   # fake off-axis iFacialMocap phone + fake VNyan client
```

Before committing, run `npm run lint`, `npm run typecheck` and `npm test`. All three must be clean.

## Layout

npm workspaces, ESM throughout, Node 22+.

- `packages/shared`: zod config schema (`config.ts`), WS message types and the client-message
  schema (`messages.ts`), and pose/placement types. Bridge and UI both import these, so add
  fields here first.
- `packages/bridge/src`:
  - `math/`: **pure**, with no I/O. vec/mat3/quat helpers, the canonical Euler convention
    (`euler.ts`), and calibration plus correction (`frame.ts`). Unit-test everything here.
  - `protocols/`: pure codecs. iFacialMocap, VTS iPhone JSON, minimal OSC, and axis flips.
  - `sources/`: `TrackingSource` implementations (UDP I/O). They emit canonical `TrackingFrame`s.
  - `emitters/`: `Emitter` implementations. `vts` impersonates the VTS iPhone app (primary);
    `vmc` is experimental.
  - `pipeline/`: source → corrector → emitter. It hot-swaps the source or emitter on config
    changes.
  - `calibration/`: guided capture state machine and stillness window.
  - `alerts/`, `triggers/`: alerts, the phone-moved detector, the global hotkey (optional
    `uiohook-napi`, loaded dynamically), the eyes-closed gesture, and VNyan WebSocket triggers.
  - `app.ts`: state hub. It wires everything together, builds snapshots, handles client messages
    and applies config changes.
  - `server/`: plain `node:http` server, the REST mirror, static UI, and `/ws` (`ws`). It sends
    snapshots at 15 Hz.
  - `config.ts`, `placements.ts`: persistence in `CONFIG_DIR` (default `<repo>/data`). Writes are
    atomic. Env vars override config but are never written back.
- `packages/web/src`: Vite + React 19, no UI framework.
  - `ws.ts`: singleton store plus `useBridge()`, with auto-reconnect.
  - `pages/Full.tsx`, `pages/Dock.tsx`: the two layouts. `/dock` is about 300 px wide for OBS.
  - `panels/`: one component per UI panel.
  - `styles.css`: hand-written.

## Frames and conventions (read before touching math or protocols)

- **Canonical phone frame:** x = right as the user sees the screen, y = up, z = out of the screen
  toward the user. Units are metres and degrees.
- **User frame:** x = the user's left, y = up, z = forward toward the monitor. `R` (phone → user)
  has rows `[left; up; forward]`. A straight-on phone is `R_STRAIGHT = diag(-1, 1, -1)`.
- **Euler angles:** `H = Ry(yaw)·Rx(pitch)·Rz(roll)`. Signs are documented in `math/euler.ts`.
- **Correction:** `p' = R(p − P0)`, rotation `Δ = H0⁻¹·H` (in the neutral head's axes, without
  `R`: iFacialMocap re-centres rotation itself, and conjugating by `qR` leaked roll into pitch).
  The emitted pose is what a straight-on phone at distance |P0| would report. The identity placement (`default`, never calibrated) must
  stay an exact passthrough, and a test checks this.
- **Two-point calibration:** assumes the phone has no roll (phone x is level), so
  `l' = (phoneRight × f) × f`. This deliberately differs from the plan's `phoneUp × f`, which is
  only exact when yaw or pitch is zero.
- **Levelling (`calibration.levelFromArc`, on by default):** a natural lean hinges below the head,
  so the head dips and the chord P0 → P1 points down. `buildLevelledFrame` records each lean's
  path and uses its 3D tangent at P0 (quadratic fit, iterated to a fixed point) instead of the
  chord. It assumes the user sits upright at rest, and falls back to the chord, with a
  `levelNote`, when the path is too quick, noisy or curved.
- **Protocol mappings:** each protocol's mapping to the canonical frame lives in `protocols/*.ts`
  and is marked UNVERIFIED until it has been tested live. Don't "fix" a sign without a live test.
  Users correct signs with `source.flip` / `output.flip`.
- **Blendshapes:** canonical form is ARKit camelCase (`eyeBlinkLeft`), 0–1. Convert only at
  protocol boundaries, and never modify the values.

## Code style

- Biome formats the code: 2 spaces, single quotes, semicolons, line width 100. Use `import type`
  for types (`verbatimModuleSyntax`).
- Bridge imports use `.js` extensions (NodeNext). Web imports have no extension.
- `strict` and `noUncheckedIndexedAccess` are on. Narrow or cast instead of using `!` in source
  code; tests may use `!`.
- Comments explain *why*, not what. Keep the existing density.
- Logging: `createLogger('component')` with a message and a fields object. Never use
  `console.log` in the bridge outside `scripts/`.
- `@offaxis/shared` resolves to `src/` through the `development` export condition (tsx, Vite,
  Vitest, tsc `customConditions`) and to `dist/` in production builds.
- The web build targets `chrome95`, because OBS's dock browser is an older CEF. Avoid very new
  CSS and JS.

## Testing

- `*.test.ts` sits next to the code it tests. Vitest runs from the repo root.
- New math needs synthetic round-trip tests: build poses in a known user frame, apply a known
  phone offset, then assert the original values come back within 1e-6.
- Calibrator tests inject a fake clock (`now`) and call `tick()` by hand.
- `pipeline/loopback.test.ts` runs real UDP on localhost using ephemeral ports.
- Port 8787 may already be in use on dev machines. For manual runs, use `UI_PORT=18787 npm start`.
- To check the UI, run the bridge plus `npm run simulate`, then open the page. Screenshot `/dock`
  inside a 300 px iframe: headless Chrome has a minimum window width.

## Things that need a human with hardware

These need a phone, VNyan on Windows and OBS. Don't claim any of them as verified:

- VNyan accepts a loopback VTS phone.
- The axis signs are correct.
- The dock renders inside OBS.
- `uiohook-napi` works on Windows.

Record results in `docs/protocols.md`.

## Commits

Make small commits, one per logical step, in the imperative mood. Commit only when asked.
`data/`, `config.json` and `placements.json` are gitignored and must never be committed.
