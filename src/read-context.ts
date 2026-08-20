import { RmParseError } from "./errors.js";

export type ReadWarningKind =
  | "trailing-data"
  | "unknown-block"
  | "unreadable-block"
  | "truncated-block"
  | "unknown-pen"
  | "unknown-color"
  | "unknown-paragraph-style"
  | "unknown-text-format"
  | "tree-assembly";

export interface ReadWarning {
  kind: ReadWarningKind;
  message: string;
  blockType?: number;
}

export interface ReadOptions {
  onWarning?: (warning: ReadWarning) => void;
  strict?: boolean;
}

export class ReadContext {
  readonly strict: boolean;
  readonly #onWarning: ((warning: ReadWarning) => void) | undefined;
  readonly #warningKeys = new Set<string>();

  constructor(options: ReadOptions = {}) {
    this.strict = options.strict ?? false;
    this.#onWarning = options.onWarning;
  }

  warn(warning: ReadWarning): void {
    this.#onWarning?.(warning);
  }

  warnOnce(key: string, warning: ReadWarning): void {
    if (this.#warningKeys.has(key)) return;
    this.#warningKeys.add(key);
    this.warn(warning);
  }

  structural(error: RmParseError, warning: ReadWarning): void {
    if (this.strict) throw error;
    this.warn(warning);
  }
}
