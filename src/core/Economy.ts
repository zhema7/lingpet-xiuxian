// 经济系统 - 灵石、商店、炼丹
import { ShopItem, PetState } from '../types';
import { PetStateManager } from './PetState';

/** 商店物品定义 */
export const SHOP_ITEMS: ShopItem[] = [
  // 破境丹（各等级）
  { id: 'pill_break_1', name: '一品破境丹', description: '助灵兽突破炼气期', price: 100, type: 'pill' },
  { id: 'pill_break_2', name: '二品破境丹', description: '助灵兽突破筑基期', price: 300, type: 'pill' },
  { id: 'pill_break_3', name: '三品破境丹', description: '助灵兽突破结丹期', price: 800, type: 'pill' },
  { id: 'pill_break_4', name: '四品破境丹', description: '助灵兽突破元婴期', price: 2000, type: 'pill' },
  { id: 'pill_break_5', name: '五品破境丹', description: '助灵兽突破化神期', price: 5000, type: 'pill' },
  // 食物
  { id: 'food_spirit_fruit', name: '灵果', description: '食用+20灵气，+5好感', price: 30, type: 'food' },
  { id: 'food_elixir', name: '灵液', description: '食用+50灵气', price: 80, type: 'food' },
  { id: 'food_ginseng', name: '千年灵参', description: '食用+200灵气，+10好感', price: 300, type: 'food' },
  // 功法（被动加成）
  { id: 'tech_basic', name: '基础吐纳术', description: '灵气获取+10%', price: 500, type: 'technique' },
  { id: 'tech_intermediate', name: '混元功', description: '灵气获取+25%', price: 2000, type: 'technique' },
  { id: 'tech_advanced', name: '太虚心经', description: '灵气获取+50%', price: 8000, type: 'technique' },
  // 材料
  { id: 'mat_spirit_grass', name: '灵草', description: '炼丹材料', price: 20, type: 'material' },
  { id: 'mat_demon_core', name: '妖丹碎片', description: '炼丹材料', price: 150, type: 'material' }
];

/** 灵兽食物效果 */
const FOOD_EFFECTS: Record<string, { energy: number; affinity: number }> = {
  food_spirit_fruit: { energy: 20, affinity: 5 },
  food_elixir: { energy: 50, affinity: 0 },
  food_ginseng: { energy: 200, affinity: 10 }
};

export class Economy {
  constructor(private petState: PetStateManager) {}

  getShopItems(): ShopItem[] {
    return SHOP_ITEMS;
  }

  buyItem(itemId: string): { success: boolean; message: string } {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return { success: false, message: '物品不存在' };

    if (!this.petState.spendSpiritStones(item.price)) {
      return { success: false, message: '灵石不足！' };
    }

    this.petState.addItem(itemId, 1);
    return { success: true, message: `购得 ${item.name}` };
  }

  /** 喂食 */
  feed(itemId: string): { success: boolean; message: string } {
    const effect = FOOD_EFFECTS[itemId];
    if (!effect) return { success: false, message: '该物品不可食用' };

    if (!this.petState.removeItem(itemId, 1)) {
      return { success: false, message: '背包中没有此食物' };
    }

    this.petState.addSpiritEnergy(effect.energy);
    if (effect.affinity > 0) this.petState.addAffinity(effect.affinity);
    return { success: true, message: `食用 ${itemId}，灵气+${effect.energy}` };
  }

  /** 炼丹：消耗材料+灵石，随机产出丹药 */
  refinePill(): { success: boolean; message: string; result?: string } {
    const state = this.petState.getState();
    if ((state.inventory['mat_spirit_grass'] || 0) < 3) {
      return { success: false, message: '灵草不足（需3株）' };
    }
    if (!this.petState.spendSpiritStones(50)) {
      return { success: false, message: '灵石不足（需50）' };
    }
    this.petState.removeItem('mat_spirit_grass', 3);

    // 随机产出
    const roll = Math.random();
    let result: string;
    if (roll < 0.1) {
      result = 'pill_break_1';
      this.petState.addItem(result, 1);
      return { success: true, message: '丹成！炼出一品破境丹！', result };
    } else if (roll < 0.4) {
      result = 'food_spirit_fruit';
      this.petState.addItem(result, 2);
      return { success: true, message: '丹成！炼出2颗灵果', result };
    } else if (roll < 0.7) {
      result = 'food_elixir';
      this.petState.addItem(result, 1);
      return { success: true, message: '丹成！炼出一瓶灵液', result };
    } else {
      return { success: true, message: '丹炉炸了...材料损失' };
    }
  }

  /** 获取功法加成系数 */
  getTechniqueBonus(): number {
    const state = this.petState.getState();
    let bonus = 1;
    if (state.inventory['tech_basic']) bonus += 0.1;
    if (state.inventory['tech_intermediate']) bonus += 0.25;
    if (state.inventory['tech_advanced']) bonus += 0.5;
    return bonus;
  }
}
