import type {
  BridgeEvent,
  CalibrationResult,
  ClientMessage,
  Config,
  Placement,
  PlotFrame,
  ServerMessage,
  Snapshot,
} from '@offaxis/shared';
import { useSyncExternalStore } from 'react';

/** How long the live-view trail covers. */
const TRAIL_MS = 2000;
const RECONNECT_MS = 1000;

export interface BridgeState {
  connected: boolean;
  snapshot: Snapshot | null;
  config: Config | null;
  placements: { active: string; placements: Placement[] };
  trail: { t: number; plot: PlotFrame }[];
  /** Latest calibration result event (for flashing the outcome). */
  lastResult: CalibrationResult | null;
  /** Recent human-readable events, newest first. */
  log: { t: number; text: string }[];
  lastError: string | null;
  configResult: { requestId?: string; ok: boolean; errors?: Record<string, string> } | null;
}

let state: BridgeState = {
  connected: false,
  snapshot: null,
  config: null,
  placements: { active: '', placements: [] },
  trail: [],
  lastResult: null,
  log: [],
  lastError: null,
  configResult: null,
};

const listeners = new Set<() => void>();
let ws: WebSocket | null = null;

function set(patch: Partial<BridgeState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function describe(e: BridgeEvent): string | null {
  switch (e.event) {
    case 'captureDone':
      return `Captured ${e.point}`;
    case 'calibrationResult':
      return e.result.ok
        ? `Calibrated "${e.result.placement}"`
        : `Calibration failed: ${e.result.reason}`;
    case 'alert':
      return e.alert.message;
    case 'calibrationStep':
      return null;
  }
}

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'snapshot': {
      const trail = msg.plot ? [...state.trail, { t: msg.t, plot: msg.plot }] : state.trail;
      const cutoff = msg.t - TRAIL_MS;
      set({ snapshot: msg, trail: trail.filter((p) => p.t >= cutoff) });
      return;
    }
    case 'config':
      set({ config: msg.config });
      return;
    case 'placements':
      set({ placements: { active: msg.active, placements: msg.placements } });
      return;
    case 'configResult':
      set({ configResult: msg });
      return;
    case 'error':
      set({
        lastError: msg.message,
        log: [{ t: Date.now(), text: msg.message }, ...state.log].slice(0, 20),
      });
      return;
    case 'event': {
      const text = describe(msg);
      const patch: Partial<BridgeState> = {};
      if (msg.event === 'calibrationResult') patch.lastResult = msg.result;
      if (text) patch.log = [{ t: Date.now(), text }, ...state.log].slice(0, 20);
      set(patch);
      return;
    }
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sock = new WebSocket(`${proto}//${location.host}/ws`);
  ws = sock;
  sock.onopen = () => set({ connected: true, lastError: null });
  sock.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data as string) as ServerMessage);
    } catch {
      // Ignore malformed frames.
    }
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    set({ connected: false, trail: [] });
    setTimeout(connect, RECONNECT_MS);
  };
}

export function send(msg: ClientMessage): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

export function clearConfigResult() {
  set({ configResult: null });
}

let started = false;
export function useBridge(): BridgeState {
  if (!started) {
    started = true;
    connect();
  }
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
