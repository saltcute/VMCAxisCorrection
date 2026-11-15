import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Config, ConfigSchema } from '@offaxis/shared';
import type { z } from 'zod';
import { createLogger } from './log.js';

const log = createLogger('config');

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k] as Json, v) : v;
  }
  return out;
}

/** Environment variables override config.json; they are applied on top and never written back. */
export function envOverrides(env: NodeJS.ProcessEnv = process.env): Json {
  const server: Json = {};
  const triggers: Json = {};
  const out: Json = {};
  if (env.BIND_HOST) server.bindHost = env.BIND_HOST;
  if (env.UI_PORT) server.uiPort = Number(env.UI_PORT);
  if (env.HOTKEY_ENABLED) triggers.hotkeyEnabled = env.HOTKEY_ENABLED === 'true';
  if (env.VTS_REPLY_HOST) out.output = { vtsReplyHost: env.VTS_REPLY_HOST };
  if (env.LOG_LEVEL) out.logLevel = env.LOG_LEVEL;
  if (Object.keys(server).length) out.server = server;
  if (Object.keys(triggers).length) out.triggers = triggers;
  return out;
}

export function formatIssues(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '(root)';
    errors[key] ??= issue.message;
  }
  return errors;
}

export type UpdateResult =
  | { ok: true; config: Config }
  | { ok: false; errors: Record<string, string> };

/**
 * Holds the persisted config (config.json) and the effective one (file + env overrides).
 * Emits `change(next, prev)` with effective configs after a successful update.
 */
export class ConfigStore extends EventEmitter<{ change: [Config, Config] }> {
  private file: Config;
  private effective: Config;

  constructor(private readonly path: string) {
    super();
    this.file = this.load();
    this.effective = this.withEnv(this.file);
  }

  static inDir(dir: string): ConfigStore {
    return new ConfigStore(resolve(dir, 'config.json'));
  }

  get(): Config {
    return this.effective;
  }

  update(patch: Json): UpdateResult {
    const parsed = ConfigSchema.safeParse(deepMerge(this.file as unknown as Json, patch));
    if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };
    const effective = ConfigSchema.safeParse(
      deepMerge(parsed.data as unknown as Json, envOverrides()),
    );
    if (!effective.success) return { ok: false, errors: formatIssues(effective.error) };
    const prev = this.effective;
    this.file = parsed.data;
    this.effective = effective.data;
    this.save();
    this.emit('change', this.effective, prev);
    return { ok: true, config: this.effective };
  }

  private withEnv(file: Config): Config {
    const parsed = ConfigSchema.safeParse(deepMerge(file as unknown as Json, envOverrides()));
    if (!parsed.success) {
      log.warn('ignoring invalid environment overrides', { errors: formatIssues(parsed.error) });
      return file;
    }
    return parsed.data;
  }

  private load(): Config {
    if (!existsSync(this.path)) {
      const config = ConfigSchema.parse({});
      this.file = config;
      this.save();
      log.info('wrote default config', { path: this.path });
      return config;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (err) {
      throw new Error(`Cannot read ${this.path}: ${(err as Error).message}`);
    }
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid ${this.path}: ${JSON.stringify(formatIssues(parsed.error))}`);
    }
    return parsed.data;
  }

  private save(): void {
    writeJsonAtomic(this.path, this.file);
  }
}

export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}
