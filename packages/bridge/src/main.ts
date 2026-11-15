import { App } from './app.js';
import { ConfigStore } from './config.js';
import { rootLog, setLogLevel } from './log.js';
import { configDir, publicDir } from './paths.js';
import { PlacementStore } from './placements.js';
import { UiServer } from './server/server.js';

const dir = configDir();
const config = ConfigStore.inDir(dir);
const placements = PlacementStore.inDir(dir);
setLogLevel(config.get().logLevel);
rootLog.info('config loaded', { dir, config: config.get() });

const app = new App(config, placements);
const server = new UiServer(app, publicDir());

await app.start();
try {
  await server.start(config.get().server);
} catch (err) {
  const { bindHost, uiPort } = config.get().server;
  rootLog.error(
    'cannot start the web UI server; is the port in use? Set UI_PORT or server.uiPort.',
    {
      host: bindHost,
      port: uiPort,
      err: (err as Error).message,
    },
  );
  await app.stop();
  process.exit(1);
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  rootLog.info('shutting down');
  await server.stop();
  await app.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
