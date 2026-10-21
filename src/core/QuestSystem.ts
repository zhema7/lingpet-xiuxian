// 日常/周常任务系统
import { DailyQuest, PetState } from '../types';
import { PetStateManager } from './PetState';
import { Storage } from './Storage';

const DAILY_QUESTS_KEY = 'lingpet.dailyQuests';
const DAILY_DATE_KEY = 'lingpet.dailyDate';

/** 日常任务模板池 */
const DAILY_QUEST_TEMPLATES: Omit<DailyQuest, 'progress' | 'completed' | 'claimed'>[] = [
  { id: 'dq_code_30', name: '苦修半时辰', description: '累计编码30分钟', target: 30, reward: { spiritStones: 50, spiritEnergy: 30 } },
  { id: 'dq_commit_3', name: '筑基三次', description: '提交3次代码', target: 3, reward: { spiritStones: 60, spiritEnergy: 40 } },
  { id: 'dq_task_2', name: '完成历练', description: '完成2次构建/测试任务', target: 2, reward: { spiritStones: 40, spiritEnergy: 25 } },
  { id: 'dq_error_5', name: '降妖5只', description: '修复5个错误', target: 5, reward: { spiritStones: 45, spiritEnergy: 30 } },
  { id: 'dq_feed_1', name: '投喂灵兽', description: '喂食灵兽1次', target: 1, reward: { spiritStones: 30, spiritEnergy: 20 } },
  { id: 'dq_pet_5', name: '抚摸灵兽', description: '抚摸灵兽5次', target: 5, reward: { spiritStones: 30, spiritEnergy: 20 } },
  { id: 'dq_usage_100', name: '消耗灵气', description: 'TRAE积分消耗100', target: 100, reward: { spiritStones: 80, spiritEnergy: 50 } }
];

export class QuestSystem {
  private quests: DailyQuest[] = [];

  constructor(private petState: PetStateManager, private storage: Storage) {
    this.loadOrRefresh();
  }

  private loadOrRefresh(): void {
    const today = new Date().toISOString().slice(0, 10);
    const savedDate = this.storage.get<string>(DAILY_DATE_KEY);
    const savedQuests = this.storage.get<DailyQuest[]>(DAILY_QUESTS_KEY);

    if (savedDate === today && savedQuests) {
      this.quests = savedQuests;
    } else {
      // 新的一天，随机选3个任务
      this.quests = this.generateDailyQuests();
      this.storage.set(DAILY_DATE_KEY, today);
      this.storage.set(DAILY_QUESTS_KEY, this.quests);
    }
  }

  private generateDailyQuests(): DailyQuest[] {
    const shuffled = [...DAILY_QUEST_TEMPLATES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3).map(t => ({
      ...t,
      progress: 0,
      completed: false,
      claimed: false
    }));
  }

  getQuests(): DailyQuest[] {
    return [...this.quests];
  }

  /** 更新任务进度 */
  updateProgress(questId: string, amount: number = 1): void {
    const quest = this.quests.find(q => q.id === questId);
    if (!quest || quest.completed) return;
    quest.progress = Math.min(quest.target, quest.progress + amount);
    if (quest.progress >= quest.target) {
      quest.completed = true;
    }
    this.save();
  }

  /** 领取奖励 */
  claimQuest(questId: string): { success: boolean; message: string } {
    const quest = this.quests.find(q => q.id === questId);
    if (!quest) return { success: false, message: '任务不存在' };
    if (!quest.completed) return { success: false, message: '任务未完成' };
    if (quest.claimed) return { success: false, message: '已领取' };

    quest.claimed = true;
    this.petState.addSpiritStones(quest.reward.spiritStones);
    this.petState.addSpiritEnergy(quest.reward.spiritEnergy);
    this.save();
    return { success: true, message: `领取奖励：灵石+${quest.reward.spiritStones}，灵气+${quest.reward.spiritEnergy}` };
  }

  private save(): void {
    this.storage.set(DAILY_QUESTS_KEY, this.quests);
  }
}
