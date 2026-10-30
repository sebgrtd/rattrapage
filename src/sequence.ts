export type SequenceResult = { kind: 'accepted'; lost: number } | { kind: 'duplicate' | 'late'; lost: 0 };
/** uint32 serial arithmetic: only the forward half of the ring is newer. */
export class Sequencer {
  private last: number | undefined;
  inspect(seq: number): SequenceResult {
    if (this.last === undefined) { this.last = seq; return { kind: 'accepted', lost: 0 }; }
    const delta = (seq - this.last) >>> 0;
    if (delta === 0) return { kind: 'duplicate', lost: 0 };
    if (delta >= 0x80000000) return { kind: 'late', lost: 0 };
    this.last = seq;
    return { kind: 'accepted', lost: delta - 1 };
  }
}
