import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import type { Orchestrator } from "../orchestrator.js";

interface CronTask {
  id: string;
  cron: string;
  task: string;
  lastRun?: string;
}

interface CronFile {
  tasks: CronTask[];
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tasks = new Map<string, CronTask[]>();

  constructor(
    private config: Config,
    private orchestrator: Orchestrator,
  ) {}

  start() {
    // Load existing cron files
    for (const [userId, userConfig] of Object.entries(this.config.users)) {
      const cronPath = join(userConfig.workspace, "cron.json");
      if (existsSync(cronPath)) {
        try {
          const data: CronFile = JSON.parse(readFileSync(cronPath, "utf-8"));
          this.tasks.set(userId, data.tasks);
          console.log(`[scheduler] Loaded ${data.tasks.length} tasks for ${userId}`);
        } catch {
          console.error(`[scheduler] Failed to load cron.json for ${userId}`);
        }
      }
    }

    // Check every minute
    this.timer = setInterval(() => this.tick(), 60_000);
    console.log("[scheduler] Started (1-minute tick).");
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  addTask(userId: string, cron: string, task: string): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cronTask: CronTask = { id, cron, task };

    if (!this.tasks.has(userId)) {
      this.tasks.set(userId, []);
    }
    this.tasks.get(userId)!.push(cronTask);
    this.save(userId);

    console.log(`[scheduler] Added task for ${userId}: "${task}" (${cron})`);
    return id;
  }

  removeTask(userId: string, taskId: string): boolean {
    const userTasks = this.tasks.get(userId);
    if (!userTasks) {
      return false;
    }
    const idx = userTasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      return false;
    }
    userTasks.splice(idx, 1);
    this.save(userId);
    return true;
  }

  listTasks(userId: string): CronTask[] {
    return this.tasks.get(userId) ?? [];
  }

  private save(userId: string) {
    const userConfig = this.config.users[userId];
    if (!userConfig) {
      return;
    }
    const cronPath = join(userConfig.workspace, "cron.json");
    const data: CronFile = { tasks: this.tasks.get(userId) ?? [] };
    writeFileSync(cronPath, JSON.stringify(data, null, 2));
  }

  private tick() {
    const now = new Date();

    for (const [userId, userTasks] of this.tasks) {
      for (const task of userTasks) {
        if (matchesCron(task.cron, now)) {
          const today = now.toISOString().slice(0, 16); // minute precision
          if (task.lastRun === today) {
            continue;
          } // already ran this minute
          task.lastRun = today;
          this.save(userId);

          console.log(`[scheduler] Firing task for ${userId}: "${task.task}"`);
          this.orchestrator
            .routeMessage(userId, `[Scheduled Task] ${task.task}`, async () => {})
            .catch((err) => console.error(`[scheduler] Error running task:`, err));
        }
      }
    }
  }
}

/**
 * Simple cron matcher: "minute hour dayOfMonth month dayOfWeek"
 * Supports * and exact numbers only (no ranges/steps for simplicity).
 */
function matchesCron(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const checks = [
    { value: date.getMinutes(), field: parts[0] },
    { value: date.getHours(), field: parts[1] },
    { value: date.getDate(), field: parts[2] },
    { value: date.getMonth() + 1, field: parts[3] },
    { value: date.getDay(), field: parts[4] },
  ];

  return checks.every(({ value, field }) => {
    if (field === "*") {
      return true;
    }
    return parseInt(field, 10) === value;
  });
}
