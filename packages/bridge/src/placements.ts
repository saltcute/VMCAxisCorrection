import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Placement, PlacementsFile } from '@offaxis/shared';
import { z } from 'zod';
import { writeJsonAtomic } from './config.js';
import { createLogger } from './log.js';
import { identityPlacement } from './math/frame.js';
import { isRotation } from './math/mat3.js';

const log = createLogger('placements');

const num = z.number().finite();
const PlacementSchema = z.object({
  name: z.string().min(1),
  R: z.tuple([num, num, num, num, num, num, num, num, num]),
  p0: z.tuple([num, num, num]),
  h0: z.tuple([num, num, num, num]),
  createdAt: z.string().default(() => new Date().toISOString()),
  threePoint: z.boolean().default(false),
});
const FileSchema = z.object({
  active: z.string(),
  placements: z.array(PlacementSchema),
});

export class PlacementStore extends EventEmitter<{ change: [Placement] }> {
  private data: PlacementsFile;

  constructor(private readonly path: string) {
    super();
    this.data = this.load();
  }

  static inDir(dir: string): PlacementStore {
    return new PlacementStore(resolve(dir, 'placements.json'));
  }

  active(): Placement {
    return this.find(this.data.active) ?? (this.data.placements[0] as Placement);
  }

  list(): { active: string; placements: Placement[] } {
    return { active: this.active().name, placements: [...this.data.placements] };
  }

  select(name: string): void {
    if (!this.find(name)) throw new Error(`No placement named "${name}"`);
    this.data.active = name;
    this.persist();
  }

  /** Insert or replace a placement and make it active. */
  save(p: Placement): void {
    const i = this.data.placements.findIndex((x) => x.name === p.name);
    if (i >= 0) this.data.placements[i] = p;
    else this.data.placements.push(p);
    this.data.active = p.name;
    this.persist();
  }

  /** Copy the active placement under a new name and make it active. */
  saveActiveAs(name: string): void {
    this.save({ ...this.active(), name, createdAt: new Date().toISOString() });
  }

  rename(from: string, to: string): void {
    const p = this.find(from);
    if (!p) throw new Error(`No placement named "${from}"`);
    if (from !== to && this.find(to)) throw new Error(`A placement named "${to}" already exists`);
    p.name = to;
    if (this.data.active === from) this.data.active = to;
    this.persist();
  }

  delete(name: string): void {
    if (!this.find(name)) throw new Error(`No placement named "${name}"`);
    this.data.placements = this.data.placements.filter((p) => p.name !== name);
    if (this.data.placements.length === 0) this.data.placements.push(identityPlacement());
    if (this.data.active === name) this.data.active = (this.data.placements[0] as Placement).name;
    this.persist();
  }

  private find(name: string): Placement | undefined {
    return this.data.placements.find((p) => p.name === name);
  }

  private persist() {
    writeJsonAtomic(this.path, this.data);
    this.emit('change', this.active());
  }

  private load(): PlacementsFile {
    const fresh = { active: 'default', placements: [identityPlacement()] };
    if (!existsSync(this.path)) {
      writeJsonAtomic(this.path, fresh);
      return fresh;
    }
    const parsed = FileSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')));
    if (!parsed.success) throw new Error(`Invalid ${this.path}: ${parsed.error.message}`);
    const data = parsed.data as PlacementsFile;
    for (const p of data.placements) {
      if (!isRotation(p.R, 1e-3)) {
        log.warn('placement R is not a proper rotation; correction will distort', { name: p.name });
      }
    }
    if (data.placements.length === 0) data.placements.push(identityPlacement());
    return data;
  }
}
