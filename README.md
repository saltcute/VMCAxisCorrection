# Off-Axis Bridge

When your phone tracker sits off to one side of your monitor, VNyan, VTube Studio and
iFacialMocap calibration only subtract a neutral head angle. Leaning straight toward the monitor
then shows up partly as a sideways lean, and the avatar leans diagonally.

This bridge sits between the phone and VNyan and fixes that:

1. It receives raw ARKit tracking from the phone (iFacialMocap, or the VTube Studio iPhone app).
2. A short guided calibration finds your forward axis as the phone sees it: sit normally, then
   lean straight forward, and optionally lean left as well.
3. It rotates every frame into your own frame and re-sends it to VNyan as if it came from a phone
   straight in front of you. Blendshapes pass through untouched.

A local web UI handles calibration, live status, saved placements and settings. It also works as
an OBS custom browser dock.

## Quick start (Windows, next to VNyan)

Requires Node 22+.

```sh
npm install
npm run build
npm start
```

1. Open <http://localhost:8787>. Under Settings → Phone input, set the phone's IP and save.
2. In iFacialMocap, keep the app open. The bridge sends the handshake itself.
3. In VNyan, set the phone tracker to **VTube Studio** with phone IP `127.0.0.1`. The bridge
   answers on UDP 21412 like the VTS iPhone app does. Don't also run VNyan's iFacialMocap mode,
   because the bridge already uses UDP 49983.
4. Press **Calibrate**. Sit normally and hold still, then lean straight toward your monitor and hold.
5. Check the Live view: a forward lean should now draw a straight vertical line.

For an OBS dock, add a custom browser dock pointing at <http://localhost:8787/dock>.

To trigger calibration from a Stream Deck or a script, send `POST /api/calibrate`. To switch to a
saved placement, send `POST /api/placement/<name>`.

> **First run:** the axis signs of the phone protocols haven't been verified against a real phone
> yet. Go through the checklist in [docs/protocols.md](docs/protocols.md) once. Any wrong sign can
> be fixed under Settings → Axis flips.

## Docker (home server / Unraid)

```sh
docker compose up -d --build
```

- The UI is at `http://<server-ip>:8787`, and the dock at `/dock`.
- Point VNyan's VTube Studio phone tracker at the server's IP.
- Config and placements live in `./data`.
- The container uses host networking: the phone protocols reply to the sender's address, which
  breaks behind NAT.
- On Unraid, set `PUID: 99` and `PGID: 100`.
- **Rootless Docker or Docker Desktop:** `network_mode: host` doesn't reach the real network there.
  1. Publish the ports instead: `8787/tcp` (or your `UI_PORT`), `49983/udp` and `21412/udp`.
  2. Set `VTS_REPLY_HOST`, or Settings → Output → VNyan IP, to the IP of the PC running VNyan.
     The NAT hides VNyan's address from the bridge.
- The UI has no authentication. Keep it on your LAN and never port-forward it.

## Development

```sh
npm run dev        # bridge (tsx watch) + Vite dev server on :5173
npm run simulate -w @offaxis/bridge   # fake off-axis phone + fake VNyan, no hardware needed
npm test           # Vitest
npm run typecheck
npm run lint       # Biome (npm run format to fix)
```

Configuration lives in `data/config.json`, created with defaults on first run. These environment
variables override it: `BIND_HOST`, `UI_PORT`, `CONFIG_DIR`, `HOTKEY_ENABLED`, `LOG_LEVEL`.

See [AGENTS.md](AGENTS.md) for the code layout and conventions, and
[docs/protocols.md](docs/protocols.md) for protocol details and open questions.
