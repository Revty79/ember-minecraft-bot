import type { LogPrefix, Logger } from "./types";

function format(prefix: LogPrefix, message: string): string {
  return `[${prefix}] ${message}`;
}

export function createLogger(): Logger {
  return {
    log(prefix: LogPrefix, message: string, data?: unknown): void {
      if (data === undefined) {
        console.log(format(prefix, message));
        return;
      }
      console.log(format(prefix, message), data);
    },
    warn(prefix: LogPrefix, message: string, data?: unknown): void {
      if (data === undefined) {
        console.warn(format(prefix, message));
        return;
      }
      console.warn(format(prefix, message), data);
    },
    error(prefix: LogPrefix, message: string, data?: unknown): void {
      if (data === undefined) {
        console.error(format(prefix, message));
        return;
      }
      console.error(format(prefix, message), data);
    }
  };
}
