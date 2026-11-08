import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const WINDOW_MS = 60 * 60 * 1000;

/** Drops timestamps that fell out of the rolling window. */
export function pruneWindow(timestamps: readonly number[], now: number, windowMs = WINDOW_MS): number[] {
  return timestamps.filter((value) => Number.isFinite(value) && now - value < windowMs);
}

export interface BudgetSnapshot {
  used: number;
  remaining: number;
}

/**
 * Counts automatic model requests per host in a rolling hour. The file only stores timestamps;
 * it never contains draft text. Unreadable or malformed files stop automatic requests.
 */
export class AutoBudget {
  private readonly file: string | null;
  private readonly now: () => number;
  private memory: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string | null, now: () => number = () => Date.now()) {
    this.file = file;
    this.now = now;
  }

  private async read(now: number): Promise<number[]> {
    if (!this.file) {
      this.memory = pruneWindow(this.memory, now);
      return [...this.memory];
    }
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      // An unreadable limit file must not silently disable the limit.
      throw new Error("自动建议计数文件无法读取");
    }
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("自动建议计数文件格式无效");
    }
    const timestamps = (parsed as { timestamps?: unknown }).timestamps;
    if (!Array.isArray(timestamps) || !timestamps.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("自动建议计数文件格式无效");
    }
    return pruneWindow(timestamps, now);
  }

  private async write(timestamps: number[]): Promise<void> {
    if (!this.file) {
      this.memory = [...timestamps];
      return;
    }
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    let created = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      created = true;
      try {
        await handle.writeFile(JSON.stringify({ timestamps }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.file);
      created = false;
    } finally {
      if (created) await unlink(temporary).catch(() => undefined);
    }
  }

  /** All plugin processes using the same counter must reserve a slot under the same lock. */
  private async withFileLock<T>(work: () => Promise<T>): Promise<T> {
    if (!this.file) return work();
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const lockPath = `${this.file}.lock`;
    const deadline = Date.now() + 2000;
    let handle;
    for (;;) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) {
          throw new Error("自动建议计数暂不可用");
        }
        await delay(20);
      }
    }
    try {
      return await work();
    } finally {
      try {
        await handle.close();
      } finally {
        await unlink(lockPath);
      }
    }
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  status(limit: number): Promise<BudgetSnapshot> {
    return this.serialize(() => this.withFileLock(async () => {
      const used = (await this.read(this.now())).length;
      return { used, remaining: Math.max(limit - used, 0) };
    }));
  }

  /** Reserves one automatic request; returns false when the hour's limit is already used. */
  take(limit: number): Promise<{ allowed: boolean; snapshot: BudgetSnapshot; reason?: "limit" | "unavailable" }> {
    return this.serialize(async () => {
      try {
        return await this.withFileLock(async () => {
          const now = this.now();
          const timestamps = await this.read(now);
          if (timestamps.length >= limit) {
            return { allowed: false, reason: "limit" as const, snapshot: { used: timestamps.length, remaining: 0 } };
          }
          timestamps.push(now);
          await this.write(timestamps);
          return {
            allowed: true,
            snapshot: { used: timestamps.length, remaining: Math.max(limit - timestamps.length, 0) },
          };
        });
      } catch {
        return { allowed: false, reason: "unavailable", snapshot: { used: limit, remaining: 0 } };
      }
    });
  }
}
