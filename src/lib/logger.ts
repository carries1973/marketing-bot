type Level = 'info' | 'warn' | 'error' | 'debug';

function log(level: Level, agent: string, message: string, data?: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    agent,
    message,
    ...(data !== undefined ? { data } : {}),
  };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(entry));
}

export const logger = {
  info: (agent: string, message: string, data?: unknown) => log('info', agent, message, data),
  warn: (agent: string, message: string, data?: unknown) => log('warn', agent, message, data),
  error: (agent: string, message: string, data?: unknown) => log('error', agent, message, data),
  debug: (agent: string, message: string, data?: unknown) => log('debug', agent, message, data),
};
