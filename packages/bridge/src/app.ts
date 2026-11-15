import { EventEmitter } from 'node:events';
import type { BridgeEvent, ClientMessage, Config, ServerMessage, Snapshot } from '@offaxis/shared';
import { Alerts, PhoneMovedDetector } from './alerts/alerts.js';
import { Calibrator } from './calibration/calibrator.js';
import type { ConfigStore } from './config.js';
import { createLogger, setLogLevel } from './log.js';
import { quatToEuler } from './math/euler.js';
import { phoneInUserFrame, R_STRAIGHT } from './math/frame.js';
import { mulVec } from './math/mat3.js';
import { sub } from './math/vec.js';
import { Pipeline, type ProcessedFrame } from './pipeline/pipeline.js';
import type { PlacementStore } from './placements.js';
import { EyesClosedGesture } from './triggers/gesture.js';
import { GlobalHotkey } from './triggers/hotkey.js';
import { VnyanTriggers } from './triggers/vnyan.js';

const log = createLogger('app');

/** No packets for this long → "phone link lost" alert. */
const PHONE_LOST_MS = 3000;
/** Phone streaming but no consumer request for this long → "VNyan not connected" alert. */
const VNYAN_IDLE_MS = 5000;

export type AppEvents = {
  /** Broadcast to every UI client. */
  message: [ServerMessage];
  /** Server-level settings changed (bind host / port); the HTTP server must restart. */
  serverConfigChanged: [Config['server']];
};

type Reply = { ok: true } | { ok: false; error: string };

/** The bridge's state hub: owns the pipeline, calibrator, placements, alerts and triggers. */
export class App extends EventEmitter<AppEvents> {
  readonly pipeline: Pipeline;
  readonly calibrator: Calibrator;
  readonly alerts = new Alerts();
  private readonly phoneMoved = new PhoneMovedDetector();
  private readonly gesture: EyesClosedGesture;
  private readonly hotkey: GlobalHotkey;
  private readonly vnyan: VnyanTriggers;
  private watchdog: NodeJS.Timeout | null = null;
  private startedAt = Date.now();

  constructor(
    readonly config: ConfigStore,
    readonly placements: PlacementStore,
  ) {
    super();
    const cfg = config.get();
    this.pipeline = new Pipeline(placements.active());
    this.calibrator = new Calibrator(cfg.calibration, (c) => {
      const name = placements.active().name;
      placements.save({ name, ...c, createdAt: new Date().toISOString() });
      return name;
    });
    this.gesture = new EyesClosedGesture(cfg.triggers.gestureThreshold, cfg.triggers.gestureHoldMs);
    this.hotkey = new GlobalHotkey(() => this.startCalibration('hotkey'));
    this.vnyan = new VnyanTriggers(cfg.vnyan);

    placements.on('change', (p) => {
      this.pipeline.setPlacement(p);
      this.broadcastPlacements();
    });
    this.pipeline.on('frame', (f) => this.onFrame(f));
    this.calibrator.on('step', (step, prompt) =>
      this.event({ type: 'event', event: 'calibrationStep', step, prompt }),
    );
    this.calibrator.on('capture', (point) =>
      this.event({ type: 'event', event: 'captureDone', point }),
    );
    this.calibrator.on('result', (result) => {
      this.event({ type: 'event', event: 'calibrationResult', result });
      if (result.ok) this.alerts.clear('phoneMoved');
      void this.vnyan.fire(result.ok ? 'success' : 'failure');
    });
    this.alerts.on('raised', (alert) => this.event({ type: 'event', event: 'alert', alert }));
    config.on('change', (next, prev) => void this.applyConfig(next, prev));
  }

  async start(): Promise<void> {
    const cfg = this.config.get();
    setLogLevel(cfg.logLevel);
    this.startedAt = Date.now();
    await this.pipeline.startSource(cfg.source).catch(() => {});
    await this.pipeline.startEmitter(cfg.output).catch(() => {});
    if (cfg.triggers.hotkeyEnabled) await this.hotkey.enable(cfg.triggers.hotkey);
    this.watchdog = setInterval(() => this.checkLinks(), 500);
  }

  async stop(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    this.calibrator.dispose();
    this.hotkey.disable();
    this.vnyan.close();
    await this.pipeline.stop();
  }

  startCalibration(by: string): void {
    log.info('calibration requested', { by });
    this.calibrator.start();
  }

  /** Handle a validated UI message. */
  handle(msg: ClientMessage): Reply | ServerMessage {
    try {
      switch (msg.type) {
        case 'startCalibration':
          this.startCalibration('ui');
          return { ok: true };
        case 'cancelCalibration':
          this.calibrator.cancel();
          return { ok: true };
        case 'selectPlacement':
          this.placements.select(msg.name);
          this.alerts.clear('phoneMoved');
          return { ok: true };
        case 'savePlacement':
          this.placements.saveActiveAs(msg.name);
          return { ok: true };
        case 'renamePlacement':
          this.placements.rename(msg.from, msg.to);
          return { ok: true };
        case 'deletePlacement':
          this.placements.delete(msg.name);
          return { ok: true };
        case 'dismissAlert':
          this.alerts.clear(msg.id);
          return { ok: true };
        case 'updateConfig': {
          const res = this.config.update(msg.patch);
          return res.ok
            ? { type: 'configResult', requestId: msg.requestId, ok: true }
            : { type: 'configResult', requestId: msg.requestId, ok: false, errors: res.errors };
        }
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Messages a newly connected UI client needs before the first snapshot. */
  welcome(): ServerMessage[] {
    const { active, placements } = this.placements.list();
    return [
      { type: 'config', config: this.config.get() },
      { type: 'placements', active, placements },
      this.snapshot(),
    ];
  }

  snapshot(): Snapshot {
    const cfg = this.config.get();
    const latest = this.pipeline.latestFrame();
    const emitter = this.pipeline.emitterStatus();
    const phone = this.pipeline.phoneStats();
    const fresh = latest !== null && Date.now() - latest.frame.t < PHONE_LOST_MS;
    return {
      type: 'snapshot',
      t: Date.now(),
      status: {
        phone,
        vnyan: emitter,
        faceFound: fresh && (latest?.frame.faceFound ?? false),
        activePlacement: this.placements.active().name,
        outputMode: cfg.output.mode,
        sourceType: cfg.source.type,
      },
      raw: latest ? { rot: latest.frame.head.rot, pos: latest.frame.head.pos } : null,
      corrected: latest
        ? { rot: quatToEuler(latest.corrected.phoneRot), pos: latest.corrected.phonePos }
        : null,
      plot: latest ? this.plotFrame(latest) : null,
      calibration: this.calibrator.status(),
      alerts: this.alerts.list(),
    };
  }

  health(): { ok: true; uptimeSec: number; lastPacketAgeMs: number | null } {
    const last = this.pipeline.phoneStats().lastPacketAt;
    return {
      ok: true,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      lastPacketAgeMs: last === null ? null : Date.now() - last,
    };
  }

  private plotFrame(f: ProcessedFrame) {
    const c = this.pipeline.getCorrector();
    const phone = phoneInUserFrame(c);
    return {
      // What the stream would look like uncorrected: the phone treated as straight-on.
      raw: mulVec(R_STRAIGHT, sub(f.frame.head.pos, c.placement.p0)),
      corrected: f.corrected.userPos,
      phonePos: phone.pos,
      phoneFacing: phone.facing,
    };
  }

  private onFrame(f: ProcessedFrame) {
    const { frame } = f;
    this.calibrator.push({
      t: frame.t,
      pos: frame.head.pos,
      rot: f.rawQ,
      faceFound: frame.faceFound,
    });
    if (this.phoneMoved.push(frame.t, frame.faceFound, frame.head.pos, f.rawQ)) {
      this.alerts.raise({
        id: 'phoneMoved',
        level: 'warn',
        message: 'Phone may have moved. Recalibrate if the avatar leans oddly.',
      });
    }
    const cfg = this.config.get().triggers;
    if (cfg.gestureEnabled && !this.calibrator.isActive()) {
      if (this.gesture.push(frame.t, frame.faceFound, frame.blendshapes)) {
        this.startCalibration('gesture');
      }
    }
  }

  private checkLinks() {
    const now = Date.now();
    const { lastPacketAt } = this.pipeline.phoneStats();
    const phoneAge = lastPacketAt === null ? now - this.startedAt : now - lastPacketAt;
    if (phoneAge > PHONE_LOST_MS) {
      this.phoneMoved.markLost(lastPacketAt ?? now);
      this.alerts.raise({
        id: 'phoneLost',
        level: 'error',
        message:
          lastPacketAt === null
            ? 'No data from the phone yet. Check the phone IP and that the tracking app is running.'
            : 'Phone connection lost.',
      });
    } else {
      this.alerts.clear('phoneLost');
    }
    const em = this.pipeline.emitterStatus();
    const consumerAge = em.lastRequestAt === null ? now - this.startedAt : now - em.lastRequestAt;
    if (phoneAge <= PHONE_LOST_MS && !em.requesting && consumerAge > VNYAN_IDLE_MS) {
      this.alerts.raise({
        id: 'vnyanIdle',
        level: 'warn',
        message:
          this.config.get().output.mode === 'vts'
            ? 'VNyan has not requested the stream. Set its phone tracker to "VTube Studio" with this bridge’s IP.'
            : 'VMC output is not sending.',
      });
    } else if (em.requesting) {
      this.alerts.clear('vnyanIdle');
    }
  }

  private async applyConfig(next: Config, prev: Config) {
    const changed = (k: keyof Config) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]);
    setLogLevel(next.logLevel);
    if (changed('source')) {
      log.info('restarting source');
      await this.pipeline.startSource(next.source).catch(() => {});
    }
    if (changed('output')) {
      log.info('restarting emitter');
      await this.pipeline.startEmitter(next.output).catch(() => {});
    }
    if (changed('calibration')) this.calibrator.setConfig(next.calibration);
    if (changed('triggers')) {
      this.gesture.configure(next.triggers.gestureThreshold, next.triggers.gestureHoldMs);
      if (next.triggers.hotkeyEnabled) await this.hotkey.enable(next.triggers.hotkey);
      else this.hotkey.disable();
    }
    if (changed('vnyan')) this.vnyan.setConfig(next.vnyan);
    if (changed('server')) this.emit('serverConfigChanged', next.server);
    this.emit('message', { type: 'config', config: next });
  }

  private broadcastPlacements() {
    const { active, placements } = this.placements.list();
    this.emit('message', { type: 'placements', active, placements });
  }

  private event(e: BridgeEvent) {
    this.emit('message', e);
  }
}
