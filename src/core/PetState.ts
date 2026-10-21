// 宠物状态管理
import { PetState, PetType, RealmStage, levelToRealm, CULTIVATION_REALMS, STAGE_NAMES } from '../types';
import { Storage } from './Storage';

export class PetStateManager {
  private state: PetState;
  private listeners: Array<(s: PetState) => void> = [];
  private notifying = false;
  private notifyPending = false;
  public gateNeed: number = 0;

  constructor(private storage: Storage, petType: PetType) {
    const saved = storage.getPetState();
    if (saved) {
      this.state = saved;
    } else {
      this.state = this.createInitialState(petType);
      this.save();
    }
  }

  private createInitialState(petType: PetType): PetState {
    const names: Record<PetType, string> = {
      tihun: '啼魂',
      mojiao: '墨蛟',
      liuyi: '霜蜈'
    };
    return {
      petType,
      name: names[petType],
      level: 1,
      stage: 'initial',
      spiritEnergy: 0,
      energyToNext: this.calcEnergyToNext(1),
      spiritStones: 50,
      affinity: 0,
      mood: 'normal',
      lastLoginDate: '',
      loginStreak: 0,
      totalCodingMinutes: 0,
      totalCommits: 0,
      totalTasksCompleted: 0,
      totalErrorsFixed: 0,
      achievements: [],
      inventory: { 'pill_break_1': 1 },
      furniture: ['futon'],
      traeCreditsTotal: 0,
      createdAt: Date.now()
    };
  }

  /** 升级曲线: 1-4级快速上手(40×lv^1.3)，5级起标准(100×lv^1.8) */
  calcEnergyToNext(level: number): number {
    return level < 5
      ? Math.floor(40 * Math.pow(level, 1.3))
      : Math.floor(100 * Math.pow(level, 1.8));
  }

  /** 高境界积分门槛: 升到该等级所需的 TRAE 累计积分消耗 */
  static readonly CREDITS_GATE: Record<number, number> = {
    5: 30, 6: 80, 7: 150, 8: 260, 9: 400, 10: 600,
    11: 900, 12: 1300, 13: 1800, 14: 2400, 15: 3200
  };

  setTraeCreditsTotal(v: number): void {
    this.state.traeCreditsTotal = v;
    this.save();
    this.notify();
  }

  getState(): PetState {
    return { ...this.state };
  }

  getRealmName(): string {
    const realm = levelToRealm(this.state.level);
    return `${realm}·${STAGE_NAMES[this.state.stage]}`;
  }

  /** 增加灵气，返回是否可升级 */
  addSpiritEnergy(amount: number): { leveledUp: boolean; newLevel?: number } {
    this.state.spiritEnergy += amount;
    let leveledUp = false;
    let newLevel: number | undefined;

    // 检查是否可以升级（需满灵气且有破境丹）
    if (this.state.spiritEnergy >= this.state.energyToNext) {
      const pillId = `pill_break_${this.state.level}`;
      const nextLevel = this.state.stage === 'upper' ? this.state.level + 1 : this.state.level;
      const gate = PetStateManager.CREDITS_GATE[nextLevel] || 0;
      const credits = this.state.traeCreditsTotal || 0;
      if (gate > 0 && credits < gate) {
        this.gateNeed = gate;
      } else if ((this.state.inventory[pillId] || 0) > 0) {
        this.gateNeed = 0;
        this.state.spiritEnergy -= this.state.energyToNext;
        this.state.inventory[pillId]--;
        this.advanceStage();
        leveledUp = true;
        newLevel = this.state.level;
      }
    }

    this.save();
    this.notify();
    return { leveledUp, newLevel };
  }

  private advanceStage(): void {
    const stageOrder: RealmStage[] = ['initial', 'middle', 'upper'];
    const idx = stageOrder.indexOf(this.state.stage);
    if (idx < 2) {
      this.state.stage = stageOrder[idx + 1];
    } else {
      // 上阶满 -> 升一级
      this.state.level++;
      this.state.stage = 'initial';
      this.state.energyToNext = this.calcEnergyToNext(this.state.level);
    }
  }

  addSpiritStones(amount: number): void {
    this.state.spiritStones += amount;
    this.save();
    this.notify();
  }

  spendSpiritStones(amount: number): boolean {
    if (this.state.spiritStones < amount) return false;
    this.state.spiritStones -= amount;
    this.save();
    this.notify();
    return true;
  }

  addAffinity(amount: number): void {
    this.state.affinity = Math.min(100, this.state.affinity + amount);
    this.save();
    this.notify();
  }

  setFurniture(items: string[]): void {
    this.state.furniture = items;
    this.save();
    this.notify();
  }

  addItem(itemId: string, count: number = 1): void {
    this.state.inventory[itemId] = (this.state.inventory[itemId] || 0) + count;
    this.save();
    this.notify();
  }

  removeItem(itemId: string, count: number = 1): boolean {
    if ((this.state.inventory[itemId] || 0) < count) return false;
    this.state.inventory[itemId] -= count;
    if (this.state.inventory[itemId] <= 0) delete this.state.inventory[itemId];
    this.save();
    this.notify();
    return true;
  }

  setMood(mood: PetState['mood']): void {
    this.state.mood = mood;
    this.notify();
  }

  setName(name: string): void {
    this.state.name = name;
    this.save();
    this.notify();
  }

  unlockAchievement(id: string): boolean {
    if (this.state.achievements.includes(id)) return false;
    this.state.achievements.push(id);
    this.save();
    this.notify();
    return true;
  }

  incrementStat(stat: 'totalCodingMinutes' | 'totalCommits' | 'totalTasksCompleted' | 'totalErrorsFixed', amount: number = 1): void {
    (this.state[stat] as number) += amount;
    this.save();
    this.notify();
  }

  /** 每日签到 */
  dailyCheckIn(): { success: boolean; reward: number; streak: number } {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.lastLoginDate === today) {
      return { success: false, reward: 0, streak: this.state.loginStreak };
    }
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (this.state.lastLoginDate === yesterday) {
      this.state.loginStreak++;
    } else {
      this.state.loginStreak = 1;
    }
    this.state.lastLoginDate = today;
    const reward = 100 * (this.state.loginStreak === 1 ? 2 : 1);
    this.addSpiritEnergy(reward);
    this.addSpiritStones(50 * this.state.loginStreak);
    this.save();
    this.notify();
    return { success: true, reward, streak: this.state.loginStreak };
  }

  subscribe(listener: (s: PetState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    // 防重入：监听器里发奖会再次触发 addSpiritStones -> notify，
    // 无限递归最终 RangeError 会打挂扩展主机
    if (this.notifying) {
      this.notifyPending = true;
      return;
    }
    this.notifying = true;
    try {
      let rounds = 0;
      do {
        this.notifyPending = false;
        const snapshot = { ...this.state };
        this.listeners.forEach(l => l(snapshot));
      } while (this.notifyPending && ++rounds < 5);
    } finally {
      this.notifying = false;
    }
  }

  private save(): void {
    this.storage.savePetState(this.state);
  }
}
