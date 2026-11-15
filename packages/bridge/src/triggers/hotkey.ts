import { createLogger } from '../log.js';

const log = createLogger('hotkey');

export interface ParsedHotkey {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Key name as uiohook-napi's `UiohookKey` spells it: `C`, `7`, `F5`. */
  key: string;
}

export function parseHotkey(combo: string): ParsedHotkey {
  const parts = combo.split('+').map((p) => p.trim());
  const key = (parts.pop() ?? '').toUpperCase();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    ctrl: mods.has('ctrl'),
    alt: mods.has('alt'),
    shift: mods.has('shift'),
    meta: mods.has('meta'),
    key,
  };
}

interface KeyEvent {
  keycode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

interface UiohookModule {
  uIOhook: {
    on(event: 'keydown', cb: (e: KeyEvent) => void): unknown;
    removeAllListeners(event?: string): unknown;
    start(): void;
    stop(): void;
  };
  UiohookKey: Record<string, number>;
}

/**
 * Global hotkey via uiohook-napi (an optional dependency, loaded only when enabled). Works on
 * Windows and X11; global hooks do not work under Wayland or in a container.
 */
export class GlobalHotkey {
  private mod: UiohookModule | null = null;
  private running = false;

  constructor(private readonly onPress: () => void) {}

  async enable(combo: string): Promise<boolean> {
    this.disable();
    const hk = parseHotkey(combo);
    try {
      // Package name in a variable so bundlers/tsc don't require it to be installed.
      const name = 'uiohook-napi';
      this.mod ??= (await import(name)) as UiohookModule;
    } catch (err) {
      log.warn('uiohook-napi is not available; global hotkey disabled', {
        err: (err as Error).message,
      });
      return false;
    }
    const keycode = this.mod.UiohookKey[hk.key];
    if (keycode === undefined) {
      log.warn('unknown hotkey key', { combo });
      return false;
    }
    this.mod.uIOhook.on('keydown', (e) => {
      if (
        e.keycode === keycode &&
        e.ctrlKey === hk.ctrl &&
        e.altKey === hk.alt &&
        e.shiftKey === hk.shift &&
        e.metaKey === hk.meta
      ) {
        log.info('hotkey pressed', { combo });
        this.onPress();
      }
    });
    try {
      this.mod.uIOhook.start();
      this.running = true;
      log.info('global hotkey enabled', { combo });
      return true;
    } catch (err) {
      log.warn('could not start global keyboard hook', { err: (err as Error).message });
      this.mod.uIOhook.removeAllListeners('keydown');
      return false;
    }
  }

  disable(): void {
    if (!this.mod) return;
    this.mod.uIOhook.removeAllListeners('keydown');
    if (this.running) this.mod.uIOhook.stop();
    this.running = false;
  }
}
