import { ConfigStore } from './config.js';
import { rootLog, setLogLevel } from './log.js';
import { configDir } from './paths.js';
import { Pipeline } from './pipeline/pipeline.js';
import { PlacementStore } from './placements.js';

const dir = configDir();
const config = ConfigStore.inDir(dir);
const placements = PlacementStore.inDir(dir);
setLogLevel(config.get().logLevel);
rootLog.info('config loaded', { dir, config: config.get() });

const pipeline = new Pipeline(placements.active());
placements.on('change', (p) => pipeline.setPlacement(p));

await pipeline.startSource(config.get().source).catch(() => {});
await pipeline.startEmitter(config.get().output).catch(() => {});

async function shutdown() {
  rootLog.info('shutting down');
  await pipeline.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
