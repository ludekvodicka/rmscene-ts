export type ParseErrorKind =
  | "invalid-header"
  | "unexpected-eof"
  | "invalid-length"
  | "invalid-value"
  | "unexpected-tag"
  | "block-overflow"
  | "malformed-block"
  | "truncated-block";

export interface ParseErrorDetails {
  offset: number;
  blockType?: number | undefined;
  cause?: unknown;
}

export class RmParseError extends Error {
  readonly kind: ParseErrorKind;
  readonly offset: number;
  readonly blockType: number | undefined;

  constructor(kind: ParseErrorKind, message: string, details: ParseErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "RmParseError";
    this.kind = kind;
    this.offset = details.offset;
    this.blockType = details.blockType;
  }
}
