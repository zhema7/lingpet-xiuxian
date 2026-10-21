// 修仙灵兽 - 共享类型定义

/** 灵兽种类 */
export type PetType = 'tihun' | 'mojiao' | 'liuyi';

/** 灵兽属性 */
export type PetElement = 'ghost' | 'water' | 'ice';

/** 境界阶段（每级三阶） */
export type RealmStage = 'initial' | 'middle' | 'upper';

/** 修士境界名称 */
export const CULTIVATION_REALMS = [
  '炼气期', '筑基期', '结丹期', '元婴期',
  '化神期', '炼虚期', '合体期', '大乘期',
  '真仙', '金仙', '太乙', '大罗', '道祖'
] as const;

export type CultivationRealm = typeof CULTIVATION_REALMS[number];

/** 灵兽等级 -> 境界映射 */
export function levelToRealm(level: number): CultivationRealm {
  if (level <= 1) return '炼气期';
  if (level <= 4) return '筑基期';
  if (level <= 7) return '结丹期';
  if (level <= 10) return '元婴期';
  if (level <= 11) return '化神期';
  if (level <= 12) return '炼虚期';
  if (level <= 13) return '合体期';
  if (level <= 14) return '大乘期';
  if (level <= 15) return '真仙';
  if (level <= 16) return '金仙';
  if (level <= 17) return '太乙';
  if (level <= 18) return '大罗';
  return '道祖';
}

/** 阶位名称 */
export const STAGE_NAMES: Record<RealmStage, string> = {
  initial: '初阶',
  middle: '中阶',
  upper: '上阶'
};

/** 动作状态 */
export type PetAction =
  | 'idle'
  | 'look_around'
  | 'cultivate'
  | 'eat'
  | 'happy'
  | 'fight'
  | 'sleep'
  | 'evolve'
  | 'talk'
  | 'drag'
  | 'panic'
  | 'bored';

/** 宠物完整状态 */
export interface PetState {
  petType: PetType;
  name: string;
  level: number;          // 1-19
  stage: RealmStage;      // 初/中/上阶
  spiritEnergy: number;   // 当前灵气（经验）
  energyToNext: number;   // 升级所需灵气
  spiritStones: number;   // 灵石
  affinity: number;       // 好感度 0-100
  mood: 'happy' | 'normal' | 'sad' | 'angry';
  lastLoginDate: string;  // 上次签到日期 YYYY-MM-DD
  loginStreak: number;    // 连续签到天数
  totalCodingMinutes: number;
  totalCommits: number;
  totalTasksCompleted: number;
  totalErrorsFixed: number;
  achievements: string[]; // 已解锁成就ID
  inventory: Record<string, number>; // 道具ID -> 数量
  furniture?: string[];      // 已购家具ID（布置在灵兽袋空间）
  traeCreditsTotal?: number; // TRAE 累计积分消耗（高境界门槛）
  createdAt: number;
}

/** TRAE 用量数据 */
export interface TraeUsage {
  planUsed: number;
  planTotal: number;
  extraUsed: number;
  extraTotal: number;
  remainingPercent: number;
  expireDate?: string;
  updatedAt: number;
}

/** 系统资源数据 */
export interface SystemStatus {
  cpuUsage: number;       // 0-100
  memoryUsage: number;    // 0-100
  memoryTotalGB: number;
  memoryUsedGB: number;
  processCount: number;
  topProcesses: ProcessInfo[];
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memPercent: number;
}

/** 成就定义 */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  reward: { spiritStones?: number; spiritEnergy?: number; items?: Record<string, number> };
  condition: (state: PetState) => boolean;
  hidden?: boolean;
}

/** 商店物品 */
export interface ShopItem {
  id: string;
  name: string;
  description: string;
  price: number;
  type: 'pill' | 'food' | 'skin' | 'technique' | 'material';
  effect?: string;
}

/** 日常任务 */
export interface DailyQuest {
  id: string;
  name: string;
  description: string;
  target: number;
  progress: number;
  reward: { spiritStones: number; spiritEnergy: number };
  completed: boolean;
  claimed: boolean;
}

/** Webview 消息协议 */
export interface WebviewMessage {
  type: string;
  payload?: any;
}

/** 扩展 -> Webview 消息 */
export type ExtToWebviewMessage =
  | { type: 'stateUpdate'; payload: PetState }
  | { type: 'usageUpdate'; payload: TraeUsage }
  | { type: 'systemUpdate'; payload: SystemStatus }
  | { type: 'action'; payload: { action: PetAction; message?: string } }
  | { type: 'notification'; payload: { title: string; message: string; action?: PetAction } }
  | { type: 'evolve'; payload: { newLevel: number; newRealm: string } }
  | { type: 'achievementUnlock'; payload: Achievement };

/** Webview -> 扩展 消息 */
export type WebviewToExtMessage =
  | { type: 'requestState' }
  | { type: 'click' }
  | { type: 'feed' }
  | { type: 'petHead' }
  | { type: 'openShop' }
  | { type: 'openAchievements' }
  | { type: 'openQuests' }
  | { type: 'buyItem'; payload: { itemId: string } }
  | { type: 'claimQuest'; payload: { questId: string } }
  | { type: 'setName'; payload: { name: string } };
