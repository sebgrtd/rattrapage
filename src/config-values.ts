export function numberInRange(value: unknown, name: string, min: number, max: number, integer = true): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) throw new Error(`${name}: valeur attendue entre ${min} et ${max}`);
  return n;
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Objet JSON attendu');
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) throw new Error(`${name}: texte attendu`);
  return value;
}
