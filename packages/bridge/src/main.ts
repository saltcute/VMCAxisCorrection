import { ConfigStore } from './config.js';
import { rootLog, setLogLevel } from './log.js';
import { configDir } from './paths.js';

const store = ConfigStore.inDir(configDir());
setLogLevel(store.get().logLevel);
rootLog.info('config loaded', { dir: configDir(), config: store.get() });
