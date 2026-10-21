// 家具目录：灵兽袋空间可购买布置的物件
export interface FurnitureItem {
  id: string;
  name: string;
  emoji: string;
  price: number;          // 灵石
  action: string;         // 交互时灵兽动作
  desc: string;
}

export const FURNITURE: FurnitureItem[] = [
  { id: 'futon',   name: '蒲团',   emoji: '🟤', price: 0,    action: 'cultivate', desc: '初始蒲团，打坐吐纳' },
  { id: 'desk',    name: '木桌',   emoji: '🪑', price: 200,  action: 'cultivate', desc: '伏案研读功法' },
  { id: 'lamp',    name: '灵灯',   emoji: '🏮', price: 300,  action: 'happy',     desc: '暖光一盏，心情愉悦' },
  { id: 'bed',     name: '云床',   emoji: '🛏️', price: 500,  action: 'sleep',     desc: '云朵织成，安眠养神' },
  { id: 'furnace', name: '丹炉',   emoji: '⚗️', price: 800,  action: 'eat',       desc: '炼丹开炉，灵气四溢' },
  { id: 'tree',    name: '灵果树', emoji: '🌳', price: 1000, action: 'look_around', desc: '结出灵果的灵树' }
];

export const FURNITURE_MAP: Record<string, FurnitureItem> =
  Object.fromEntries(FURNITURE.map(f => [f.id, f]));
