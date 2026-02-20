type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, context: string, message: string, data?: unknown): void {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level}] [${context}]`;

  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function createLogger(context: string): {
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  debug: (message: string, data?: unknown) => void;
} {
  return {
    info: (message: string, data?: unknown): void => log('INFO', context, message, data),
    warn: (message: string, data?: unknown): void => log('WARN', context, message, data),
    error: (message: string, data?: unknown): void => log('ERROR', context, message, data),
    debug: (message: string, data?: unknown): void => log('DEBUG', context, message, data),
  };
}
