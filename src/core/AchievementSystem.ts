// 成就系统
import { Achievement, PetState } from '../types';
import { PetStateManager } from './PetState';

/** 所有成就定义 */
export const ACHIEVEMENTS: Achievement[] = [
  // 境界成就
  { id: 'realm_qi', name: '初入仙途', description: '达到炼气期', reward: { spiritStones: 50 }, condition: s => s.level >= 1 },
  { id: 'realm_zhu', name: '筑基成功', description: '达到筑基期', reward: { spiritStones: 200, spiritEnergy: 100 }, condition: s => s.level >= 2 },
  { id: 'realm_jie', name: '结丹大成', description: '达到结丹期', reward: { spiritStones: 500, items: { 'pill_break_3': 1 } }, condition: s => s.level >= 5 },
  { id: 'realm_yuan', name: '元婴出窍', description: '达到元婴期', reward: { spiritStones: 1000 }, condition: s => s.level >= 8 },
  { id: 'realm_hua', name: '化神为真', description: '达到化神期', reward: { spiritStones: 3000 }, condition: s => s.level >= 11 },
  // 行为成就
  { id: 'commit_10', name: '筑基积累', description: '累计提交10次代码', reward: { spiritStones: 100 }, condition: s => s.totalCommits >= 10 },
  { id: 'commit_100', name: '勤修不辍', description: '累计提交100次代码', reward: { spiritStones: 500, spiritEnergy: 200 }, condition: s => s.totalCommits >= 100 },
  { id: 'task_10', name: '历练新手', description: '完成10次任务', reward: { spiritStones: 80 }, condition: s => s.totalTasksCompleted >= 10 },
  { id: 'task_100', name: '历练达人', description: '完成100次任务', reward: { spiritStones: 400 }, condition: s => s.totalTasksCompleted >= 100 },
  { id: 'error_50', name: '降妖除魔', description: '修复50个错误', reward: { spiritStones: 150 }, condition: s => s.totalErrorsFixed >= 50 },
  { id: 'error_500', name: '心魔不侵', description: '修复500个错误', reward: { spiritStones: 600, spiritEnergy: 300 }, condition: s => s.totalErrorsFixed >= 500 },
  // 互动成就
  { id: 'affinity_50', name: '心意相通', description: '好感度达到50', reward: { spiritStones: 200 }, condition: s => s.affinity >= 50 },
  { id: 'affinity_100', name: '生死契阔', description: '好感度达到100', reward: { spiritStones: 1000, items: { 'food_ginseng': 5 } }, condition: s => s.affinity >= 100 },
  // 签到成就
  { id: 'streak_7', name: '七日不辍', description: '连续签到7天', reward: { spiritStones: 300 }, condition: s => s.loginStreak >= 7 },
  { id: 'streak_30', name: '苦修一月', description: '连续签到30天', reward: { spiritStones: 2000, items: { 'pill_break_2': 3 } }, condition: s => s.loginStreak >= 30 },
  // 隐藏成就
  { id: 'night_owl', name: '夜行者', description: '凌晨2点仍在编码', reward: { spiritStones: 100 }, condition: s => false, hidden: true } // 运行时动态判断
];

export class AchievementSystem {
  private newlyUnlocked: Achievement[] = [];
  private checking = false;

  constructor(private petState: PetStateManager) {}

  /** 检查并解锁成就，返回新解锁的成就 */
  checkAndUnlock(): Achievement[] {
    // 防重入：发奖会触发 notify → 再次进入本方法，未先标记就会无限递归
    if (this.checking) return [];
    this.checking = true;
    try {
      const state = this.petState.getState();
      const unlocked: Achievement[] = [];

      for (const ach of ACHIEVEMENTS) {
        if (state.achievements.includes(ach.id)) continue;
        if (!ach.condition(state)) continue;
        // 必须先标记已解锁，再发奖励（奖励会再触发状态广播）
        this.petState.unlockAchievement(ach.id);
        // 发放奖励
        if (ach.reward.spiritStones) this.petState.addSpiritStones(ach.reward.spiritStones);
        if (ach.reward.spiritEnergy) this.petState.addSpiritEnergy(ach.reward.spiritEnergy);
        if (ach.reward.items) {
          for (const [itemId, count] of Object.entries(ach.reward.items)) {
            this.petState.addItem(itemId, count);
          }
        }
        unlocked.push(ach);
      }

      this.newlyUnlocked = unlocked;
      return unlocked;
    } finally {
      this.checking = false;
    }
  }

  getNewlyUnlocked(): Achievement[] {
    const result = this.newlyUnlocked;
    this.newlyUnlocked = [];
    return result;
  }

  getUnlockedAchievements(): Achievement[] {
    const state = this.petState.getState();
    return ACHIEVEMENTS.filter(a => state.achievements.includes(a.id));
  }

  getAllAchievements(): Achievement[] {
    return ACHIEVEMENTS;
  }
}
