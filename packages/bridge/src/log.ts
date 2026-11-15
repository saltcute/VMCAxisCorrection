type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = (process.env.LOG_LEVEL as Level | undefined) ?? 'info';
const pretty = process.stdout.isTTY && process.env.LOG_FORMAT !== 'json';

export function setLogLevel(level: Level): void {
  // LOG_LEVEL in the environment always wins over config.json.
  if (!process.env.LOG_LEVEL) threshold = level;
}

export type Logger = Record<Level, (msg: string, fields?: Record<string, unknown>) => void> & {
  child(component: string): Logger;
};

function write(level: Level, component: string, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < order[threshold]) return;
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (pretty) {
    const time = new Date().toISOString().slice(11, 23);
    const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
    out.write(`${time} ${level.toUpperCase().padEnd(5)} [${component}] ${msg}${extra}\n`);
  } else {
    out.write(
      `${JSON.stringify({ time: new Date().toISOString(), level, component, msg, ...fields })}\n`,
    );
  }
}

export function createLogger(component: string): Logger {
  return {
    debug: (m, f) => write('debug', component, m, f),
    info: (m, f) => write('info', component, m, f),
    warn: (m, f) => write('warn', component, m, f),
    error: (m, f) => write('error', component, m, f),
    child: (sub) => createLogger(`${component}:${sub}`),
  };
}

export const rootLog = createLogger('bridge');
