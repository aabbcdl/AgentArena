export function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `Task pack field "${label}" must be a string. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": "my-value"`
    );
  }
  if (value.trim().length === 0) {
    throw new Error(
      `Task pack field "${label}" must be a non-empty string. ` +
      `Received empty or whitespace-only string. ` +
      `Example: "${label}": "my-value"`
    );
  }
  return value;
}

export function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertString(value, label);
}

export function assertOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(
      `Task pack field "${label}" must be a number. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": 1000`
    );
  }
  if (!Number.isInteger(value)) {
    throw new Error(
      `Task pack field "${label}" must be an integer. ` +
      `Received: ${value}. ` +
      `Example: "${label}": 1000`
    );
  }
  if (value <= 0) {
    throw new Error(
      `Task pack field "${label}" must be a positive integer. ` +
      `Received: ${value}. ` +
      `Example: "${label}": 1000`
    );
  }
  return value;
}

export function assertOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(
      `Task pack field "${label}" must be a number. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": 1.5`
    );
  }
  return value;
}

export function assertOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(
      `Task pack field "${label}" must be a boolean. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": true`
    );
  }
  return value;
}

export function assertOptionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(
      `Task pack field "${label}" must be a number. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": 0`
    );
  }
  if (!Number.isInteger(value)) {
    throw new Error(
      `Task pack field "${label}" must be an integer. ` +
      `Received: ${value}. ` +
      `Example: "${label}": 0`
    );
  }
  if (value < 0) {
    throw new Error(
      `Task pack field "${label}" must be a non-negative integer. ` +
      `Received: ${value}. ` +
      `Example: "${label}": 0`
    );
  }
  return value;
}

export function assertStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Task pack field "${label}" must be an array. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": ["value1", "value2"]`
    );
  }
  return value.map((entry, index) => assertString(entry, `${label}[${index}]`));
}

export function assertStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Task pack field "${label}" must be an object. ` +
      `Received type: ${Array.isArray(value) ? "array" : typeof value}. ` +
      `Example: "${label}": { "KEY": "value" }`
    );
  }
  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
    key,
    assertString(entryValue, `${label}.${key}`)
  ]);
  return Object.fromEntries(entries);
}

export function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Task pack field "${label}" must be an object. ` +
      `Received type: ${Array.isArray(value) ? "array" : typeof value}. ` +
      `Example: "${label}": { "key": "value" }`
    );
  }
  return value as Record<string, unknown>;
}
