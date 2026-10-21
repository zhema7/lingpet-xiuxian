// VS Code 任务监控 - 构建/测试等任务的开始与结束
import * as vscode from 'vscode';

export interface TaskEvent {
  taskName: string;
  success: boolean;
  exitCode?: number;
  durationMs: number;
}

export class TaskMonitor {
  private taskStartTimes = new Map<string, number>();
  private onTaskEnd?: (event: TaskEvent) => void;

  setOnTaskEnd(cb: (event: TaskEvent) => void): void {
    this.onTaskEnd = cb;
  }

  activate(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // 任务开始
    disposables.push(
      vscode.tasks.onDidStartTask(e => {
        const key = this.getTaskKey(e.execution);
        this.taskStartTimes.set(key, Date.now());
      })
    );

    // 任务进程结束
    disposables.push(
      vscode.tasks.onDidEndTaskProcess(e => {
        const key = this.getTaskKey(e.execution);
        const startTime = this.taskStartTimes.get(key) || Date.now();
        this.taskStartTimes.delete(key);

        const exitCode = e.exitCode;
        const event: TaskEvent = {
          taskName: e.execution.task.name,
          success: exitCode === 0,
          exitCode: exitCode ?? undefined,
          durationMs: Date.now() - startTime
        };

        this.onTaskEnd?.(event);
      })
    );

    // 任务结束（兜底）
    disposables.push(
      vscode.tasks.onDidEndTask(e => {
        const key = this.getTaskKey(e.execution);
        if (this.taskStartTimes.has(key)) {
          const startTime = this.taskStartTimes.get(key)!;
          this.taskStartTimes.delete(key);
          // 没有 exitCode 时视为成功（某些任务不触发 onDidEndTaskProcess）
          this.onTaskEnd?.({
            taskName: e.execution.task.name,
            success: true,
            durationMs: Date.now() - startTime
          });
        }
      })
    );

    return disposables;
  }

  private getTaskKey(execution: vscode.TaskExecution): string {
    return `${execution.task.name}_${execution.task.source}_${execution.task.detail || ''}`;
  }
}
