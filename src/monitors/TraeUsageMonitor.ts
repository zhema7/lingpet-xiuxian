// 灵气采集监控 - 基于 VS Code 活动事件估算（替代原 TRAE 远程 Token API）
// 原因：TRAE CN 积分（Entitlement）存储在远程 CDN (user-entitlement)，本地无明文可读
// 方案：监听编辑器事件（编辑/保存/切换）+ 打坐时间 = 灵气增长

import * as vscode from 'vscode';

export interface UsageDelta {
  /** 估算本轮采集到的灵气点数 */
  credits: number;
  /** 触发来源 */
  source: 'edit' | 'save' | 'switch' | 'idle_gain' | 'manual';
}

export class TraeUsageMonitor {
  private textChangeCount: number = 0;
  private saveCount: number = 0;
  private switchCount: number = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastTickStats = { textChanges: 0, saves: 0, switches: 0 };

  private onDelta?: (delta: UsageDelta) => void;
  private listeners: vscode.Disposable[] = [];
  private idleGainInterval: number; // 打坐增长间隔（毫秒）

  constructor() {
    this.idleGainInterval = 10 * 60 * 1000; // 默认每 10 分钟打坐 +10
  }

  /** 设置灵气增量回调 */
  setOnDelta(cb: (delta: UsageDelta) => void): void {
    this.onDelta = cb;
  }

  /** 监听编辑器事件 */
  start(): void {
    // 文本变化 → 每次编辑 +1 灵气
    this.listeners.push(
      vscode.workspace.onDidChangeTextDocument(() => {
        this.textChangeCount++;
        this.emit({ credits: 1, source: 'edit' });
      })
    );

    // 保存 → 完成历练 +3 灵气
    this.listeners.push(
      vscode.workspace.onDidSaveTextDocument(() => {
        this.saveCount++;
        this.emit({ credits: 3, source: 'save' });
      })
    );

    // 切换编辑器 → 感应天地 +0.5（取整为 1）
    this.listeners.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.switchCount++;
        this.emit({ credits: 1, source: 'switch' });
      })
    );

    // 打坐自动增长：每 idleGainInterval 秒 +10 点
    const intervalSec = vscode.workspace.getConfiguration('lingpet')
      .get<number>('usagePollInterval', 10) * 60; // 配置转换为分钟→毫秒（配置名沿用但值改为分钟）
    this.idleGainInterval = intervalSec * 1000;

    this.idleTimer = setInterval(() => {
      // 计算本轮增量
      const textDelta = this.textChangeCount - this.lastTickStats.textChanges;
      const saveDelta = this.saveCount - this.lastTickStats.saves;
      const switchDelta = this.switchCount - this.lastTickStats.switches;
      this.lastTickStats = {
        textChanges: this.textChangeCount,
        saves: this.saveCount,
        switches: this.switchCount
      };

      // 基础打坐 10 点 + 本轮活跃加成
      const idleBonus = 10 + Math.floor(textDelta * 0.2) + saveDelta + Math.floor(switchDelta * 0.5);
      this.emit({ credits: idleBonus, source: 'idle_gain' });
    }, this.idleGainInterval);
  }

  /** 手动触发一次灵气采集 */
  fetchUsage(): { textChanges: number; saves: number; switches: number } {
    this.emit({ credits: 5, source: 'manual' });
    return {
      textChanges: this.textChangeCount,
      saves: this.saveCount,
      switches: this.switchCount
    };
  }

  stop(): void {
    for (const d of this.listeners) d.dispose();
    this.listeners = [];
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** 获取当前会话总采集量 */
  getSessionStats(): { textChanges: number; saves: number; switches: number } {
    return {
      textChanges: this.textChangeCount,
      saves: this.saveCount,
      switches: this.switchCount
    };
  }

  private emit(delta: UsageDelta): void {
    if (this.onDelta && delta.credits > 0) {
      try { this.onDelta(delta); } catch { /* ignore */ }
    }
  }
}
