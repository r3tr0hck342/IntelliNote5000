const SENSITIVE_KEYS = ['apikey', 'api_key', 'token', 'authorization', 'password', 'secret'];

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-_.]+/gi,
  /\bsk-[A-Za-z0-9]{10,}\b/g,
  /\bapi[_-]?key\s*[:=]\s*[^,\s]+/gi,
  /\btoken\s*[:=]\s*[^,\s]+/gi,
];

const isSensitiveKey = (key: string) => SENSITIVE_KEYS.some(item => key.toLowerCase().includes(item));

export const redactSensitiveText = (text: string): string => {
  if (!text) return text;
  return SENSITIVE_VALUE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[REDACTED]'), text);
};

export const redactSensitiveData = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveData);
  }
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactSensitiveData(val),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
};
