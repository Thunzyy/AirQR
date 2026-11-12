const objectToString = Object.prototype.toString;

export type JsonObject = { readonly [name: string]: JsonValue };
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | JsonObject;

export type WireObject = { readonly [name: string]: WireValue | undefined };
export type WireValue =
  | JsonValue
  | bigint
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array
  | DataView
  | ArrayBuffer
  | SharedArrayBuffer
  | Blob
  | File
  | Error
  | Date
  | readonly WireValue[]
  | WireObject;

export type LogScalar = string | number | boolean | null;
export type LogValue =
  | WireValue
  | Event
  | { readonly [name: string]: LogValue | undefined }
  | readonly LogValue[];
export type LogContext = {
  readonly [name: string]: LogValue | undefined;
};

export function caughtMessage(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

export function globalHas(name: string): boolean {
  if (!(name in globalThis)) {
    return false;
  }
  const descriptor =
    Object.getOwnPropertyDescriptor(globalThis, name) ??
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis), name);
  if (descriptor && "value" in descriptor) {
    return descriptor.value !== undefined && descriptor.value !== null;
  }
  if (descriptor?.get) {
    const value = descriptor.get.call(globalThis);
    return value !== undefined && value !== null;
  }
  return true;
}

export function wireTag(value: WireValue): string {
  return objectToString.call(value);
}

export function isWireString(value: WireValue | undefined): value is string {
  return value !== undefined && wireTag(value) === "[object String]";
}

export function isWireNumber(value: WireValue | undefined): value is number {
  return value !== undefined && wireTag(value) === "[object Number]" && Number.isFinite(value);
}

export function isWireBoolean(value: WireValue | undefined): value is boolean {
  return value !== undefined && wireTag(value) === "[object Boolean]";
}

export function isWireArray(value: WireValue | undefined): value is readonly WireValue[] {
  return Array.isArray(value);
}

export function isWireObject(value: WireValue | undefined): value is WireObject {
  return value !== undefined && value !== null && wireTag(value) === "[object Object]";
}

export function asWireObject(value: WireValue | undefined): WireObject {
  return isWireObject(value) ? value : {};
}

export function asWireString(value: WireValue | undefined): string | undefined {
  if (isWireString(value)) {
    return value;
  }
  if (isWireNumber(value)) {
    return String(value);
  }
  return undefined;
}

export function asFiniteNumberList(value: WireValue | undefined): number[] | undefined {
  if (isWireArray(value)) {
    const numbers = value
      .map((entry) => asWireFiniteNumber(entry))
      .filter((entry): entry is number => entry !== undefined);
    return numbers.length > 0 ? numbers : undefined;
  }
  if (!isWireObject(value)) {
    return undefined;
  }
  const length = asWireFiniteNumber(value.length);
  if (length === undefined || length < 0 || !Number.isInteger(length)) {
    return undefined;
  }
  const numbers: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const parsed = asWireFiniteNumber(value[String(index)]);
    if (parsed !== undefined) {
      numbers.push(parsed);
    }
  }
  return numbers.length > 0 ? numbers : undefined;
}

export function asWireFiniteNumber(value: WireValue | undefined): number | undefined {
  if (isWireNumber(value)) {
    return value;
  }
  if (isWireString(value) && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function firstWireFiniteNumber(
  ...values: Array<WireValue | undefined>
): number | undefined {
  for (const value of values) {
    const parsed = asWireFiniteNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

export function asWireBoolean(value: WireValue | undefined): boolean | undefined {
  return isWireBoolean(value) ? value : undefined;
}

export function asUint8Array(value: WireValue | undefined): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return undefined;
}

export function asUint32Array(value: WireValue | undefined): Uint32Array | undefined {
  return value instanceof Uint32Array ? value : undefined;
}

export function parseJsonText(text: string): JsonValue {
  return JSON.parse(text);
}

export function errorMessage(error: WireValue | Error): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isWireString(error)) {
    return error;
  }
  return String(error);
}

export function isCallable(value: WireValue | undefined): boolean {
  return value instanceof Function;
}
