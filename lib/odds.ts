export type OddsFormat = 'decimal' | 'american' | 'fractional';

export function americanToDecimal(american: number): number {
  if (american === 0) throw new Error('Invalid American odds 0');
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function fractionalToDecimal(input: string): number {
  const [a, b] = input.split('/').map(Number);
  if (!isFinite(a) || !isFinite(b) || b === 0) throw new Error('Invalid fractional odds');
  return 1 + a / b;
}

export function toDecimal(format: OddsFormat, value: number | string): number {
  switch (format) {
    case 'decimal':
      if (typeof value !== 'number') return Number(value);
      return value;
    case 'american':
      if (typeof value !== 'number') return Number(value);
      return americanToDecimal(value);
    case 'fractional':
      if (typeof value !== 'string') return fractionalToDecimal(String(value));
      return fractionalToDecimal(value);
    default:
      throw new Error('Unsupported odds format');
  }
}

