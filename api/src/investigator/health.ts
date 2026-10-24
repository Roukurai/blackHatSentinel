import { probeModels } from "./llm.js";
import type { LlmConfig } from "./types.js";

const OK_TTL_MS = 120_000;
const PROBE_INTERVAL_MS = 30_000;

export class HealthTracker {
  private lastOkAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly cfg: LlmConfig) {}

  markOk(): void {
    this.lastOkAt = Date.now();
  }

  llmHealth(): "ok" | "down" {
    if (!this.cfg.configured) return "down";
    if (Date.now() - this.lastOkAt <= OK_TTL_MS) return "ok";
    return "down";
  }

  startHealthProbe(): () => void {
    if (this.timer) return () => this.stop();
    const run = async () => {
      const ok = await probeModels(this.cfg, 5000);
      if (ok) this.markOk();
    };
    void run();
    this.timer = setInterval(() => void run(), PROBE_INTERVAL_MS);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
    return () => this.stop();
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
