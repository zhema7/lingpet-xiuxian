// Webview 与扩展之间的消息协议
// 此文件同时被扩展端和渲染端引用

export type ExtToWebviewMessage =
  | { type: 'stateUpdate'; payload: any }
  | { type: 'usageUpdate'; payload: any }
  | { type: 'systemUpdate'; payload: any }
  | { type: 'action'; payload: { action: string; message?: string } }
  | { type: 'notification'; payload: { title: string; message: string; action?: string } }
  | { type: 'evolve'; payload: { newLevel: number; newRealm: string } }
  | { type: 'achievementUnlock'; payload: { id: string; name: string; description: string } }
  | { type: 'checkInResult'; payload: { success: boolean; reward: number; streak: number } }
  | { type: 'shopItems'; payload: any[] }
  | { type: 'quests'; payload: any[] }
  | { type: 'stockQuotes'; payload: any[] };

export type WebviewToExtMessage =
  | { type: 'requestState' }
  | { type: 'click' }
  | { type: 'feed'; payload: { itemId: string } }
  | { type: 'petHead' }
  | { type: 'openShop' }
  | { type: 'openAchievements' }
  | { type: 'openQuests' }
  | { type: 'buyItem'; payload: { itemId: string } }
  | { type: 'claimQuest'; payload: { questId: string } }
  | { type: 'setName'; payload: { name: string } }
  | { type: 'checkIn' }
  | { type: 'refreshUsage' }
  | { type: 'logCodingMinute' };
