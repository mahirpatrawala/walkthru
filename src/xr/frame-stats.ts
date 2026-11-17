// Frame-time bookkeeping for the `?debug` panel. Pure. A ring of the last frames' times: the mean, the 95th percentile, the worst, the share over budget.
import { FRAME_BUDGET_MS } from './config';

export interface FrameSummary {
  frames: number;
  /** mean frame-to-frame time, ms, and the frame rate it implies */
  meanMs: number; fps: number;
  p95Ms: number; maxMs: number;
  /** the share of frames longer than the budget (1.25 x the refresh interval: one dropped refresh) */
  overBudget: number;
  /** mean time the page spent in its own frame callback, ms */
  cpuMs: number;
}

export class FrameStats {
  private readonly dts: number[] = [];
  private readonly cpu: number[] = [];
  constructor(private readonly size = 180, private readonly budgetMs = FRAME_BUDGET_MS * 1.25) {}

  /** `dtMs`: time since the last frame. `cpuMs`: how long this page's own work took in it, when measured. */
  push(dtMs: number, cpuMs = 0): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.dts.push(dtMs); this.cpu.push(cpuMs);
    if (this.dts.length > this.size) { this.dts.shift(); this.cpu.shift(); }
  }

  reset(): void { this.dts.length = 0; this.cpu.length = 0; }

  summary(): FrameSummary {
    const n = this.dts.length;
    if (n === 0) return { frames: 0, meanMs: 0, fps: 0, p95Ms: 0, maxMs: 0, overBudget: 0, cpuMs: 0 };
    const sum = this.dts.reduce((a, b) => a + b, 0);
    const sorted = [...this.dts].sort((a, b) => a - b);
    const p95 = sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)];
    const meanMs = sum / n;
    return {
      frames: n, meanMs, fps: 1000 / meanMs, p95Ms: p95, maxMs: sorted[n - 1],
      overBudget: this.dts.filter((d) => d > this.budgetMs).length / n,
      cpuMs: this.cpu.reduce((a, b) => a + b, 0) / n,
    };
  }
}

/** The lines the debug panel shows. */
export function debugLines(s: FrameSummary, extra: { calls?: number; triangles?: number; geometries?: number; textures?: number; hz?: number | null; presenting?: boolean; scale?: number | null } = {}): string[] {
  const f = (v: number): string => v.toFixed(1);
  return [
    `${extra.presenting ? 'in VR' : 'flat'}  ${f(s.fps)} fps  target ${extra.hz ?? 72} Hz`,
    `frame ${f(s.meanMs)} ms  p95 ${f(s.p95Ms)}  max ${f(s.maxMs)}`,
    `over budget ${(s.overBudget * 100).toFixed(0)}%  cpu ${f(s.cpuMs)} ms`,
    `calls ${extra.calls ?? 0}  tris ${Math.round((extra.triangles ?? 0) / 1000)}k`,
    `geo ${extra.geometries ?? 0}  tex ${extra.textures ?? 0}${extra.scale ? `  scale ${extra.scale}` : ''}`,
  ];
}
