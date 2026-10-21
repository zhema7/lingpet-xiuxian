// 系统资源监控 - CPU/内存/进程
import * as os from 'os';
import { exec } from 'child_process';
import { SystemStatus, ProcessInfo } from '../types';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SystemMonitor {
  private lastCpuTimes: { idle: number; total: number } | null = null;
  private onAlert?: (type: 'cpu' | 'memory', value: number) => void;

  constructor(
    private cpuThreshold: number = 90,
    private memoryThreshold: number = 90
  ) {}

  setOnAlert(cb: (type: 'cpu' | 'memory', value: number) => void): void {
    this.onAlert = cb;
  }

  /** 获取当前系统状态 */
  async getStatus(): Promise<SystemStatus> {
    const cpuUsage = this.getCpuUsage();
    const memInfo = this.getMemoryInfo();
    const processes = await this.getProcessList();

    const status: SystemStatus = {
      cpuUsage,
      memoryUsage: memInfo.usagePercent,
      memoryTotalGB: memInfo.totalGB,
      memoryUsedGB: memInfo.usedGB,
      processCount: processes.length,
      topProcesses: processes.slice(0, 5)
    };

    // 告警检查
    if (cpuUsage >= this.cpuThreshold) {
      this.onAlert?.('cpu', cpuUsage);
    }
    if (memInfo.usagePercent >= this.memoryThreshold) {
      this.onAlert?.('memory', memInfo.usagePercent);
    }

    return status;
  }

  private getCpuUsage(): number {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      const times = cpu.times;
      idle += times.idle;
      total += times.user + times.nice + times.sys + times.idle + times.irq;
    }

    let usage = 0;
    if (this.lastCpuTimes) {
      const idleDiff = idle - this.lastCpuTimes.idle;
      const totalDiff = total - this.lastCpuTimes.total;
      if (totalDiff > 0) {
        usage = Math.round((1 - idleDiff / totalDiff) * 100);
      }
    }
    this.lastCpuTimes = { idle, total };
    return usage;
  }

  private getMemoryInfo(): { totalGB: number; usedGB: number; usagePercent: number } {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      totalGB: Math.round((total / 1024 / 1024 / 1024) * 100) / 100,
      usedGB: Math.round((used / 1024 / 1024 / 1024) * 100) / 100,
      usagePercent: Math.round((used / total) * 100)
    };
  }

  private async getProcessList(): Promise<ProcessInfo[]> {
    try {
      const isWindows = os.platform() === 'win32';
      let stdout: string;

      if (isWindows) {
        const result = await execAsync('tasklist /FO CSV /NH');
        stdout = result.stdout;
      } else {
        const result = await execAsync("ps aux --sort=-%cpu | head -n 6");
        stdout = result.stdout;
      }

      return this.parseProcessList(stdout, isWindows);
    } catch {
      return [];
    }
  }

  private parseProcessList(output: string, isWindows: boolean): ProcessInfo[] {
    const processes: ProcessInfo[] = [];
    const lines = output.trim().split('\n');

    if (isWindows) {
      // tasklist CSV 格式: "name","pid","session","session#","mem"
      for (const line of lines.slice(0, 20)) {
        const parts = line.split(',').map(p => p.replace(/"/g, ''));
        if (parts.length >= 5) {
          const memStr = parts[4].replace(/,/g, '');
          const memKB = parseInt(memStr);
          processes.push({
            pid: parseInt(parts[1]),
            name: parts[0],
            cpuPercent: 0, // tasklist 不提供 CPU%，简化为 0
            memPercent: isNaN(memKB) ? 0 : Math.round((memKB / (os.totalmem() / 1024)) * 1000) / 10
          });
        }
      }
    } else {
      // ps aux 格式
      for (const line of lines.slice(1, 6)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          processes.push({
            pid: parseInt(parts[1]),
            name: parts[10],
            cpuPercent: parseFloat(parts[2]),
            memPercent: parseFloat(parts[3])
          });
        }
      }
    }

    return processes;
  }
}
