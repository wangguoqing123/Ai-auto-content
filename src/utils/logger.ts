export interface Logger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

function write(level: string, message: string, details?: Record<string, unknown>): void {
  const entry = { timestamp: new Date().toISOString(), level, message, ...details };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else console.log(output);
}

export const logger: Logger = {
  info: (message, details) => write('info', message, details),
  warn: (message, details) => write('warn', message, details),
  error: (message, details) => write('error', message, details),
};
