// 定时任务调度 - "历练任务"
import { Storage } from '../core/Storage';

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;        // 简化格式: "HH:MM" 每天, 或 cron 表达式
  command?: string;    // 可选执行的命令
  enabled: boolean;
  lastRun?: number;
  createdAt: number;
}

const TASKS_KEY = 'lingpet.scheduledTasks';

export class ScheduleManager {
  private tasks: ScheduledTask[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private onTaskTrigger?: (task: ScheduledTask) => void;

  constructor(private storage: Storage) {
    this.tasks = storage.get<ScheduledTask[]>(TASKS_KEY) || [];
  }

  setOnTaskTrigger(cb: (task: ScheduledTask) => void): void {
    this.onTaskTrigger = cb;
  }

  getTasks(): ScheduledTask[] {
    return [...this.tasks];
  }

  addTask(task: Omit<ScheduledTask, 'id' | 'createdAt'>): ScheduledTask {
    const newTask: ScheduledTask = {
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now()
    };
    this.tasks.push(newTask);
    this.save();
    if (newTask.enabled) this.scheduleTask(newTask);
    return newTask;
  }

  removeTask(id: string): void {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.clearTimer(id);
    this.save();
  }

  toggleTask(id: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return;
    task.enabled = !task.enabled;
    this.save();
    if (task.enabled) {
      this.scheduleTask(task);
    } else {
      this.clearTimer(id);
    }
  }

  private scheduleTask(task: ScheduledTask): void {
    this.clearTimer(task.id);
    const delay = this.calcNextDelay(task.cron);
    if (delay <= 0) return;

    const timer = setTimeout(() => {
      task.lastRun = Date.now();
      this.save();
      this.onTaskTrigger?.(task);
      // 执行命令（如果有）
      if (task.command) {
        this.runCommand(task.command);
      }
      // 重新调度（每日重复）
      if (task.enabled) this.scheduleTask(task);
    }, delay);

    this.timers.set(task.id, timer);
  }

  private calcNextDelay(cron: string): number {
    // 简化：支持 "HH:MM" 每日定时
    const match = cron.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const hour = parseInt(match[1]);
      const minute = parseInt(match[2]);
      const now = new Date();
      const next = new Date();
      next.setHours(hour, minute, 0, 0);
      if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
      }
      return next.getTime() - now.getTime();
    }
    // 简单 cron 解析（仅支持分 时 日 月 周，每日重复）
    // 此处简化为不支持复杂 cron，返回 -1
    return -1;
  }

  private async runCommand(command: string): Promise<void> {
    try {
      const { exec } = require('child_process');
      exec(command, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          console.error(`LingPet task command failed: ${err.message}`);
        }
      });
    } catch (e) {
      console.error(`LingPet task command error: ${e}`);
    }
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  startAll(): void {
    for (const task of this.tasks) {
      if (task.enabled) this.scheduleTask(task);
    }
  }

  stopAll(): void {
    for (const id of this.timers.keys()) {
      this.clearTimer(id);
    }
  }

  private save(): void {
    this.storage.set(TASKS_KEY, this.tasks);
  }
}
