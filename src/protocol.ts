/** PulseHub v1: one complete big-endian frame per UDP datagram. */
export const TELEMETRY = 1;
export const HEARTBEAT = 2;
export type MetricId = 1 | 2 | 3;
export interface Measurement { metricId: MetricId; value: number }
export interface Frame {
  type: 1 | 2;
  deviceId: number;
  seq: number;
  uptimeMs: number;
  measurements: Measurement[];
}
export type DecodeError = 'length' | 'magic' | 'version' | 'type' | 'device' | 'checksum' | 'count' | 'metric';
export type DecodeResult = { ok: true; frame: Frame } | { ok: false; error: DecodeError };

export function checksum(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value ^= byte;
  return value;
}

export function decode(data: Buffer): DecodeResult {
  const invalid = (error: DecodeError): DecodeResult => ({ ok: false, error });
  // Bound-check before every field access; malformed network input never throws.
  if (data.length < 16 || data.length > 512) return invalid('length');
  if (data[0] !== 0x50 || data[1] !== 0x48) return invalid('magic');
  if (data[2] !== 1) return invalid('version');
  const type = data[3];
  if (type !== TELEMETRY && type !== HEARTBEAT) return invalid('type');
  const count = data[14]!;
  if (data.length !== 16 + 3 * count) return invalid('length');
  if (checksum(data) !== 0) return invalid('checksum');
  const deviceId = data.readUInt16BE(4);
  if (deviceId === 0) return invalid('device');
  if (type === HEARTBEAT && count !== 0) return invalid('count');
  const measurements: Measurement[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) {
    const offset = 15 + 3 * i;
    const metricId = data[offset];
    if ((metricId !== 1 && metricId !== 2 && metricId !== 3) || seen.has(metricId)) return invalid('metric');
    seen.add(metricId);
    measurements.push({ metricId, value: data.readInt16BE(offset + 1) });
  }
  return { ok: true, frame: { type, deviceId, seq: data.readUInt32BE(6), uptimeMs: data.readUInt32BE(10), measurements } };
}

/** Used by the simulator; encode validates its own inputs, too. */
export function encode(frame: Frame): Buffer {
  const integer = (value: number, min: number, max: number): boolean => Number.isInteger(value) && value >= min && value <= max;
  if (!integer(frame.deviceId, 1, 65535) || !integer(frame.seq, 0, 0xffffffff) || !integer(frame.uptimeMs, 0, 0xffffffff)) throw new Error('Invalid frame integer');
  if (frame.measurements.length > 3 || frame.measurements.some(m => !integer(m.value, -32768, 32767))) throw new Error('Invalid measurements');
  const data = Buffer.alloc(16 + 3 * frame.measurements.length);
  data.write('PH', 0, 'ascii');
  data[2] = 1; data[3] = frame.type;
  data.writeUInt16BE(frame.deviceId, 4);
  data.writeUInt32BE(frame.seq, 6);
  data.writeUInt32BE(frame.uptimeMs, 10);
  data[14] = frame.measurements.length;
  frame.measurements.forEach((m, i) => { data[15 + 3 * i] = m.metricId; data.writeInt16BE(m.value, 16 + 3 * i); });
  data[data.length - 1] = checksum(data.subarray(0, -1));
  if (!decode(data).ok) throw new Error('Invalid frame structure');
  return data;
}
