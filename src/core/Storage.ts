// 状态持久化 - 封装 VS Code globalState
import * as vscode from 'vscode';
import { PetState } from '../types';

const STORAGE_KEY = 'lingpet.petState.v1';

export class Storage {
  constructor(private context: vscode.ExtensionContext) {}

  getPetState(): PetState | undefined {
    return this.context.globalState.get<PetState>(STORAGE_KEY);
  }

  savePetState(state: PetState): void {
    this.context.globalState.update(STORAGE_KEY, state);
  }

  clear(): void {
    this.context.globalState.update(STORAGE_KEY, undefined);
  }

  // 通用键值存储
  get<T>(key: string): T | undefined {
    return this.context.globalState.get<T>(`lingpet.${key}`);
  }

  set<T>(key: string, value: T): void {
    this.context.globalState.update(`lingpet.${key}`, value);
  }
}
