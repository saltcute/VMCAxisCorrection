# VNyan Off-Axis Tracking Correction — Plan

Nov 15, 2026 · @salt

## Goal and context

Build a small TypeScript bridge with a web UI. It sits between the phone and VNyan, rotates head tracking out of the phone's off-axis frame into the user's own frame, and passes the corrected stream to VNyan as if it came straight from a phone.

**The problem.** Phone-tracker calibration in VNyan, VTube Studio and iFacialMocap only subtracts a neutral head angle; it never rotates the coordinate frame. With the phone yawed θ to one side, leaning straight toward the monitor shows up as forward (Z) plus a sideways (X) component of about sin θ, and head pitch and roll mix slightly. VNyan turns head position into body lean, so the avatar leans diagonally.

**What the tool does.**

- Receives raw ARKit blendshapes + head rotation + position from the phone (iFacialMocap first).
- Runs a short guided calibration: sit normally (P0), lean straight forward (P1), optionally lean left (P2). This gives the user's forward axis as the phone sees it.
- Applies the inverse rotation to every frame and re-sends the stream to VNyan, with blendshapes passed through untouched.
- Ships a local web UI for calibration, live status, settings and saved placements. It also works as an OBS custom browser dock.

**Non-goals.** No changes to VNyan itself, no model editing, and no automatic yaw estimation without a calibration step (the phone has no reference for which way the user faces).

## Architecture and stack

A single long-running TypeScript process sits between the phone and VNyan. A per-frame path corrects the pose and re-emits it; a separate calibrator produces the rotation that path uses; a web UI drives calibration and shows live state.

&#91;embedded content: bridge architecture · per-frame path + calibration\]

Every frame goes left to right along the top row. The calibrator only runs when triggered, and hands the corrector a new R and neutral pose.

**Getting the stream into VNyan.** VNyan reads phone tracking natively from iFacialMocap, VTube Studio (iPhone) and MeowFace, and has four VMC-protocol receiver layers. The bridge needs one of these entry points. Decide in milestone 2 with a spike, in this order:

1. **Impersonate the VTS iPhone app (preferred).** Point VNyan's phone tracker at `127.0.0.1` with "VTube Studio" selected. The bridge answers on the VTS phone app's UDP port (21412) and streams VTS-format JSON (blendshapes, head rotation, head position) to the port VNyan asks for. This keeps VNyan's full ARKit layer (head position → body lean, its smoothing and settings). It also avoids a port clash: the bridge receives from iFacialMocap on UDP 49983, which VNyan's own iFacialMocap mode would also need on the same PC.
2. **VMC protocol (fallback).** Send OSC to one of VNyan's VMC receiver layers: blendshapes via `/VMC/Ext/Blend/Val` + `/VMC/Ext/Blend/Apply`, and the head as bone or tracker transforms. Body lean then has to be computed by the bridge, so this is more work.
3. **VNyan C# plugin (last resort).** A Unity plugin that corrects tracking inside VNyan. Only if 1 and 2 both fail; it means writing the core in C# instead of TypeScript.

**Stack.**

- **Bridge:** TypeScript on Node 22+ (Bun is fine if everything works on it). `dgram` for UDP, `ws` for the UI WebSocket, `osc` (only if the VMC fallback is used), `uiohook-napi` for the global hotkey, `zod` for config, Vitest or `bun test`.
- **Web UI:** Vite + React + TypeScript, built to static files and served by the bridge itself. No UI framework beyond React; a small amount of hand-written CSS that works in OBS's dock browser.
- **Lint/format:** Biome for both packages. Monorepo with `packages/bridge` and `packages/web`.
- Plain hand-written vector/quaternion helpers instead of a 3D math library.
- Config in `config.json`, placements in `placements.json`; both gitignored.

## Math: calibration and correction

Calibration produces one rotation matrix R (phone frame → user frame) plus a neutral pose. Every frame is then corrected with two cheap operations.

**Building R from captured points.** P0 = rest position, P1 = leaned-forward position, P2 = leaned-left position (optional).

```latex
\hat f = \frac{P_1 - P_0}{\lVert P_1 - P_0 \rVert}, \quad
\hat l = \frac{l' - (l' \cdot \hat f)\,\hat f}{\lVert l' - (l' \cdot \hat f)\,\hat f \rVert}, \quad
\hat u = \hat f \times \hat l, \quad
R = \begin{bmatrix} \hat l & \hat u & \hat f \end{bmatrix}^{\mathsf T}
```

- With P2: l' = P2 − P0 (Gram–Schmidt against f).
- Without P2: l' = cross(phone up axis, f), so the phone is assumed roughly upright in roll. Keep this as the default; P2 is an opt-in third step.
- Reject the calibration if |P1 − P0| is below a configurable minimum lean distance, or if l' is nearly parallel to f.

**Correcting position.**

```latex
p' = R\,(p - P_0)
```

Output p' as X (left/right), Y (up/down), Z (forward/back) in the user frame, scaled by config to the units the output protocol expects.

**Correcting rotation.** Convert the phone's head Euler angles to a quaternion H; H0 is the head quaternion captured at P0. The head's change from neutral, expressed in the user frame:

```latex
D = q_R \, H \, H_0^{-1} \, q_R^{-1}
```

Decompose D back to yaw / pitch / roll in the axis order and signs the output protocol (VTS phone JSON or VMC) expects. Subtracting angles is not enough: it leaves the pitch/roll cross-coupling this tool exists to remove.

**Implementation notes.**

- Put the math in a pure module (`src/math/`) with no I/O so it can be unit-tested with synthetic data.
- Test: generate poses in a known user frame, rotate them by a known phone offset (for example 30° yaw, 15° pitch), run calibration and correction, and assert the original values come back within 1e-6.
- Sign conventions (ARKit is right-handed and the front camera is mirrored) are the most likely bug. Verify each axis with a live test before trusting the unit tests.

## Calibration

One guided capture routine that auto-captures each point when the user holds still. Any of three triggers can start it, and all three call the same `startCalibration()`.

**Guided routine (state machine).**

1. `idle` → trigger → `waitStillRest` (prompt: "Sit normally and look at your monitor").
2. Position variance over a \~400 ms window falls below a threshold → capture P0 and H0 → `waitLean` (prompt: "Lean straight forward").
3. Displacement from P0 exceeds the minimum lean distance, then the user holds still again → capture P1.
4. If three-point mode is on: `waitLeanLeft` → capture P2.
5. Compute R, validate, save it to the active placement, go back to `idle`. Any step times out after \~10 s → cancel and keep the old calibration.

If the face is lost during capture, pause the timer and resume when it's found again. The state machine publishes every transition to the web UI.

**Triggers.**

- **Web UI button** (primary). In both the full page and the OBS dock. `POST /api/calibrate` does the same, so a Stream Deck can trigger it too.
- **Global hotkey.** Configurable combo (default Ctrl+Alt+C) via `uiohook-napi`. Windows/X11 only; global hooks don't work under Wayland.
- **Face gesture.** Both eyes closed (`eyeBlink_L` and `eyeBlink_R` > 0.8) for 2 s. Off by default.

**Placements.** Each calibration is stored as a named placement (for example "desk left" or "monitor top") holding R, the neutral pose and the time it was made. Switching placement applies instantly, so moving the phone between known spots needs no recalibration.

**Feedback in VNyan (optional).** On capture success or failure, fire a user-named VNyan trigger through VNyan's WebSocket interface, so a node graph can play a reaction on the avatar.

**Recalibration hint.** If the face has been lost for more than 2 s and the first pose after it reappears differs from the last one by a large jump, show "phone may have moved" in the web UI. Never recalibrate automatically.

## Web UI

The web UI is the main way to use the tool: calibrate, check that the correction is right, switch placements and change settings without editing JSON. The bridge serves it at `http://localhost:8787` in two layouts: the full page at `/`, and a compact layout at `/dock` sized for an OBS custom browser dock (about 300 px wide).

**Panels.**

| Panel      | What it shows and does                                                                                                                                                                                                    | In `/dock`                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Status bar | Phone link (packets/s, last packet time), VNyan link (whether VNyan has requested the stream), face found, active placement                                                                                               | Yes, as one status dot + tooltip |
| Calibrate  | Big Calibrate and Cancel buttons, the current prompt, a stillness meter, the step timeout, then the result: yaw/pitch offset, lean distance, pass/fail                                                                    | Yes                              |
| Live view  | Top-down (X–Z) and side (Y–Z) plots: phone position and facing, detected forward axis, and the last \~2 s of head position, raw vs corrected. Leaning forward should draw a straight vertical line in the corrected trail | No                               |
| Numbers    | Raw vs corrected head rotation and position, updating live                                                                                                                                                                | No                               |
| Placements | Saved calibrations by name; select, rename, delete, "save current as…"                                                                                                                                                    | Dropdown only                    |
| Settings   | Phone IP, ports, output mode, three-point mode, stillness threshold, minimum lean distance, position scale, gesture trigger, hotkey, VNyan trigger names                                                                  | No                               |
| Alerts     | "Phone may have moved" banner with a Recalibrate button; connection-lost warnings                                                                                                                                         | Yes                              |

**Transport.** One WebSocket at `/ws`.

- Server → client: a state snapshot at 15 Hz (status, raw and corrected pose, calibration state, active placement) plus event messages (calibration step changed, capture done, alert).
- Client → server: `startCalibration`, `cancelCalibration`, `selectPlacement`, `savePlacement`, `renamePlacement`, `deletePlacement`, `updateConfig`.
- REST mirror for external triggers: `POST /api/calibrate`, `POST /api/placement/:name`.
- Message types and the config schema (zod) live in `packages/shared` and are imported by both bridge and UI, so the two can't drift apart.

**Behaviour.**

- Settings are validated by the bridge on save; invalid fields show inline errors and nothing is written.
- Changes to ports or output mode restart the affected component without restarting the process.
- The UI reconnects on its own if the bridge restarts, and shows "bridge offline" until it does.
- Binds to `127.0.0.1` by default. A config flag allows LAN access so a tablet can act as a remote.
- Must render correctly in OBS's dock browser (Chromium-based CEF): test there, not just in a normal browser.
- Plots are drawn with plain SVG or Canvas from the snapshot stream; no charting library.

## Milestones

Build in this order. Each milestone ends with something that runs, and Claude Code should stop and report after each one.

1. **Scaffold.** Monorepo with `packages/bridge`, `packages/web`, `packages/shared`; Biome; config schema in zod with defaults; structured logging.
   - Done when: `npm run dev` starts the bridge and the Vite dev server, and the bridge logs the loaded config.
2. **Input + output spike (decides the output mode).** iFacialMocap UDP client parsing into `{ blendshapes, head: { rot, pos }, faceFound, t }` behind a `TrackingSource` interface. Then try VTS-iPhone impersonation toward VNyan on `127.0.0.1`, passing frames through unchanged. If VNyan won't accept it, try the VMC fallback.
   - Done when: the avatar in VNyan tracks through the bridge the same as it does connected directly to the phone. Write down which output mode worked and why.
3. **Math module + tests.** Everything in the Math section, pure functions, synthetic round-trip tests.
   - Done when: tests pass for yaw-only, pitch-only and combined offsets, plus the 3-point mode.
4. **Correction in the pipeline + placements.** Source → corrector → emitter, with placements loaded from and saved to `placements.json`. Identity placement = passthrough.
   - Done when: a hand-written R in `placements.json` visibly changes lean direction in VNyan.
5. **Web UI skeleton.** HTTP server + `/ws` in the bridge, shared message types, the full page with the Status bar, Numbers panel and a working Calibrate button (wired to a stub).
   - Done when: the page shows live raw values and reconnects after a bridge restart.
6. **Calibration routine.** The state machine and stillness detection, wired to the UI's Calibrate panel and saved as a placement.
   - Done when: with the phone about 30° to one side, after calibrating from the UI, leaning forward no longer makes the avatar lean sideways (live test).
7. **Rest of the full UI.** Live view plots, Placements panel, Settings panel with validated save and component restart, Alerts.
   - Done when: every setting in the table can be changed from the UI without touching a file.
8. **Dock layout.** `/dock` layout plus the REST mirror.
   - Done when: it works as an OBS custom browser dock, and `POST /api/calibrate` starts a calibration.
9. **Extras.** Global hotkey, face-gesture trigger, VNyan trigger feedback, the "phone may have moved" alert.
10. **Optional.** VTS iPhone app as a second input source; VMC as a selectable output mode if it wasn't needed in step 2.

**Repo layout.** `packages/shared` (message types, config schema), `packages/bridge/src/` with `sources/`, `emitters/`, `math/` (pure), `calibration/`, `server/` (HTTP + WS), `main.ts`; `packages/web/src/` with `pages/Full.tsx`, `pages/Dock.tsx`, `panels/`, `ws.ts`.

## Deployment: Docker Compose

The bridge only talks over the network, so it can run on a home server (Unraid) in Docker instead of next to VNyan. VNyan then points its phone tracker at the server's IP, which also removes the UDP 49983 clash: the bridge and VNyan no longer share a machine. Build this after milestone 8, once the UI works.

**What changes in server mode.**

- Use host networking. The phone protocols reply to whichever address and port asked, which breaks or gets fiddly behind Docker's NAT.
- The web UI binds `0.0.0.0` and is reached at `http://<server-ip>:8787` (OBS dock: `/dock`). There's no authentication, so it must stay LAN-only; never port-forward it.
- The global hotkey is off (no keyboard on the server). Calibration comes from the web UI, `POST /api/calibrate` (Stream Deck), or the face gesture. Make `uiohook-napi` an optional dependency, loaded only when `HOTKEY_ENABLED=true`, so the image builds without it.
- Config and placements live in a mounted volume, so they survive rebuilds.
- Add `GET /api/health` (bridge up, last phone packet age) for the container healthcheck.
- Environment variables override `config.json`: `BIND_HOST`, `UI_PORT`, `CONFIG_DIR`, `HOTKEY_ENABLED`, `LOG_LEVEL`.

**`docker-compose.yml`** (repo root):

```yaml
services:
  offaxis-bridge:
    build: .
    image: offaxis-bridge:latest
    container_name: offaxis-bridge
    network_mode: host
    restart: unless-stopped
    environment:
      BIND_HOST: 0.0.0.0
      UI_PORT: 8787
      CONFIG_DIR: /data
      HOTKEY_ENABLED: "false"
      LOG_LEVEL: info
      TZ: America/Toronto
    volumes:
      - ./data:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8787/api/health"]
      interval: 30s
      timeout: 3s
      retries: 3
```

**`Dockerfile`** (multi-stage):

1. `build` stage on `node:22-alpine`: install workspace deps, build `packages/shared`, `packages/web` (Vite) and `packages/bridge` (tsc).
2. `runtime` stage on `node:22-alpine`: production deps only (no optional deps), copy the bridge's `dist/` and the web build into a `public/` folder the bridge serves. Run as a non-root user and `CMD ["node", "dist/main.js"]`.
3. Add a `.dockerignore` for `node_modules`, `data/`, build outputs and `.git`.

**Unraid.** Run it with the Compose Manager plugin from `/mnt/user/appdata/offaxis-bridge/`, so `./data` lands in appdata. If host networking ever conflicts with another container's ports, the alternative is the `br0` custom network, which gives the container its own LAN IP (`networks: br0: { ipv4_address: … }` with `br0` declared as an external network).

**Done when:** `docker compose up -d --build` on the server starts the bridge, the healthcheck reports healthy, VNyan tracks through the server's IP, the OBS dock loads from the server, and placements are still there after `docker compose down && docker compose up -d`.

## Open questions to verify first

The VNyan facts below come from its docs (see Sources). The protocol details come from memory, so Claude Code should confirm each one against current docs or a live test before building on it.

- [ ] **VNyan accepts a loopback phone.** Does VNyan's "VTube Studio" phone tracker work with `127.0.0.1` as the phone IP, and which port does it ask the phone to send to?
- [ ] **VTS iPhone protocol.** Request format sent to UDP 21412, response JSON fields (blendshape names, `Rotation`, `Position` or similar), units, and how often the client must re-request.
- [ ] **iFacialMocap protocol.** Exact handshake string, port (believed to be UDP 49983), packet format (believed to be `name-value|…|=head#rx,ry,rz,tx,ty,tz|…`), position units.
- [ ] **VNyan WebSocket triggers.** Whether VNyan exposes a WebSocket that external apps can send trigger names to, its port, and the message format.
- [ ] **Axis conventions.** Which way positive yaw, pitch and roll point in iFacialMocap vs the output protocol, and whether X is mirrored.
- [ ] **Platform.** VNyan is Windows-only. The bridge runs either on Windows next to it or in Docker on the server; in the Windows case, confirm `uiohook-napi` builds there.

## Sources

- [VNyan on itch.io](https://suvidriel.itch.io/vnyan): supported trackers (iFacialMocap, VTube Studio iPhone, MeowFace) and 4 VMC receivers.
- [VNyan docs: Tracking Layers](https://github-wiki-see.page/m/NeocortexVT/VNyanDocFork/wiki/Tracking-Layers): layer order and phone tracker setup.
- [VTube Studio wiki](https://github.com/DenchiSoft/VTubeStudio/wiki/VTube-Studio-Settings): calibration only resets face direction.
