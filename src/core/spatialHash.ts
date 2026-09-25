/**
 * Uniform grid over a bounded square world using linked lists in typed arrays.
 * Rebuilt every frame — O(n) and allocation-free.
 */
export class SpatialHash {
  readonly cellSize: number;
  readonly cols: number;
  readonly half: number;
  private readonly heads: Int32Array;
  private readonly next: Int32Array;
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private count = 0;

  constructor(worldHalfSize: number, cellSize: number, capacity: number) {
    this.cellSize = cellSize;
    this.half = worldHalfSize;
    this.cols = Math.ceil((worldHalfSize * 2) / cellSize) + 1;
    this.heads = new Int32Array(this.cols * this.cols).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.xs = new Float32Array(capacity);
    this.zs = new Float32Array(capacity);
  }

  clear(): void {
    this.heads.fill(-1);
    this.count = 0;
  }

  private cellOf(v: number): number {
    const c = Math.floor((v + this.half) / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  /** Insert item index `id` (must be < capacity). */
  insert(id: number, x: number, z: number): void {
    if (id >= this.next.length) return;
    const cell = this.cellOf(z) * this.cols + this.cellOf(x);
    this.next[id] = this.heads[cell]!;
    this.heads[cell] = id;
    this.xs[id] = x;
    this.zs[id] = z;
    this.count++;
  }

  get size(): number {
    return this.count;
  }

  /** Visit every id whose stored point lies within radius r of (x, z). Return true from cb to stop early. */
  query(x: number, z: number, r: number, cb: (id: number, d2: number) => boolean | void): void {
    const r2 = r * r;
    const c0 = this.cellOf(x - r);
    const c1 = this.cellOf(x + r);
    const r0 = this.cellOf(z - r);
    const r1 = this.cellOf(z + r);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        let id = this.heads[row * this.cols + col]!;
        while (id !== -1) {
          const dx = this.xs[id]! - x;
          const dz = this.zs[id]! - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2 && cb(id, d2) === true) return;
          id = this.next[id]!;
        }
      }
    }
  }
}
