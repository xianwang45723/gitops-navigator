/** What the core code logs through. The extension passes a VS Code log channel; tests pass nothing. */
export interface Logger {
  trace(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const noop = () => {};
export const silentLogger: Logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop };
