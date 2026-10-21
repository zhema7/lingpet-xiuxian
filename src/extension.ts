// 修仙灵兽 LingPet - VS Code 扩展入口（纯插件形态）
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { Storage } from './core/Storage';
import { PetStateManager } from './core/PetState';
import { Economy, SHOP_ITEMS } from './core/Economy';
import { AchievementSystem } from './core/AchievementSystem';
import { QuestSystem } from './core/QuestSystem';
import { TraeUsageMonitor } from './monitors/TraeUsageMonitor';
import { TraeCreditsMonitor } from './monitors/TraeCreditsMonitor';
import { SystemMonitor } from './monitors/SystemMonitor';
import { TaskMonitor } from './monitors/TaskMonitor';
import { ScheduleManager } from './monitors/ScheduleManager';
import { StockService } from './services/StockService';
import { WebviewManager } from './webview/WebviewManager';
import { PetType, PetState, levelToRealm, STAGE_NAMES } from './types';
import { FURNITURE_MAP } from './core/Furniture';

let petState: PetStateManager;
let economy: Economy;
let achievementSystem: AchievementSystem;
let questSystem: QuestSystem;
let traeMonitor: TraeUsageMonitor;
let traeCreditsMonitor: TraeCreditsMonitor;
let systemMonitor: SystemMonitor;
let taskMonitor: TaskMonitor;
let scheduleManager: ScheduleManager;
let stockService: StockService;
let wm: WebviewManager;
let storage: Storage;
let codingTimer: NodeJS.Timeout | null = null;
let statusBarItem: vscode.StatusBarItem;
let chatDetectTimer: NodeJS.Timeout | null = null;

/** TRAE Chat 视图标识关键词（URI scheme / viewType 包含即视为聊天） */
const TRAE_CHAT_KEYWORDS = ['chat', 'agent', 'trae', 'ai-chat', 'side-chat', 'solo_agent', 'icube-chat'];

export function activate(context: vscode.ExtensionContext): void {
  storage = new Storage(context);

  // 一次性回档：旧的成就发奖递归 bug 会把灵石刷到百万级，破坏经济平衡
  const ROLLBACK_TARGET = 2000;
  const savedState = storage.getPetState() as PetState | undefined;
  let stonesRolledBack = false;
  if (savedState && (savedState.spiritStones || 0) > 100000 && !storage.get<boolean>('stonesRollback.v1')) {
    savedState.spiritStones = ROLLBACK_TARGET;
    storage.savePetState(savedState);
    storage.set('stonesRollback.v1', true);
    stonesRolledBack = true;
  }

  const petType = vscode.workspace.getConfiguration('lingpet').get<PetType>('petType', 'tihun');
  petState = new PetStateManager(storage, petType);
  economy = new Economy(petState);
  achievementSystem = new AchievementSystem(petState);
  questSystem = new QuestSystem(petState, storage);
  extContext = context;
  petAwayFlag = !!context.globalState.get('lingpet.petAway');
  syncDesktopState();
  setInterval(syncDesktopState, 10000);

  const config = vscode.workspace.getConfiguration('lingpet');
  traeMonitor = new TraeUsageMonitor();
  systemMonitor = new SystemMonitor(
    config.get<number>('cpuAlertThreshold', 90),
    config.get<number>('memoryAlertThreshold', 90)
  );
  taskMonitor = new TaskMonitor();
  scheduleManager = new ScheduleManager(storage);
  stockService = new StockService();

  wm = new WebviewManager(context);
  if (stonesRolledBack) {
    vscode.window.showInformationMessage(`🐾 灵石已回档至 ${ROLLBACK_TARGET}（修复成就奖励重复发放导致的数值异常）`);
  }
  traeCreditsMonitor = new TraeCreditsMonitor(context);
  // 全自动配置: 扫描 TRAE 日志中的 JWT（无需用户手动导出）
  if (!traeCreditsMonitor.hasToken()) {
    autoDetectToken().then(tok => {
      if (tok) {
        traeCreditsMonitor.setToken(tok).then(() => {
          traeCreditsMonitor.stop();
          traeCreditsMonitor.start(config.get<number>('creditsPollInterval', 5));
          vscode.window.showInformationMessage('🐾 已自动捕获 TRAE 凭证，真实灵气采集上线！');
        }).catch(() => { /* 静默 */ });
      }
    });
  }

  // 注册 Activity Bar 的 WebviewViewProvider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lingpet.petView', wm)
  );

  // 状态栏
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'lingpet.showPet';
  statusBarItem.show();
  updateStatusBar();

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('lingpet.showPet', () => showPet()),
    vscode.commands.registerCommand('lingpet.refreshUsage', () => {
      const stats = traeMonitor.fetchUsage();
      vscode.window.showInformationMessage(
        `LingPet: 灵气采集 · 编辑 ${stats.textChanges} / 保存 ${stats.saves} / 切换 ${stats.switches}`
      );
    }),
    vscode.commands.registerCommand('lingpet.toggleAutoPanel', () => toggleAutoPanel()),
    vscode.commands.registerCommand('lingpet.openShop', () => sendShopItems()),
    vscode.commands.registerCommand('lingpet.openAchievements', () => sendAchievements()),
    vscode.commands.registerCommand('lingpet.openQuests', () => openQuests()),
    vscode.commands.registerCommand('lingpet.feedPet', () => feedDefault()),
    vscode.commands.registerCommand('lingpet.refinePill', () => refinePill()),
    vscode.commands.registerCommand('lingpet.manualBoost', () => manualBoost()),
    vscode.commands.registerCommand('lingpet.setTraeToken', () => promptSetTraeToken()),
    vscode.commands.registerCommand('lingpet.queryTraeCredits', () => queryTraeCredits()),
    vscode.commands.registerCommand('lingpet.showDesktopPet', () => showDesktopPet()),
    vscode.commands.registerCommand('lingpet.hideDesktopPet', () => hideDesktopPet())
  );

  // 宠物状态变化 -> 推送到 webview
  petState.subscribe(state => {
    wm.postMessage({ type: 'stateUpdate', payload: enrichState(state) });
    updateStatusBar();
    const unlocked = achievementSystem.checkAndUnlock();
    for (const ach of unlocked) {
      wm.postMessage({
        type: 'achievementUnlock',
        payload: { id: ach.id, name: ach.name, description: ach.description }
      });
    }
  });

  // Webview 消息统一处理
  wm.setMessageHandler(handleWebviewMessage);

  // 灵气采集（编辑器事件 + 打坐时间）
  traeMonitor.setOnDelta((delta) => {
    const bonus = economy.getTechniqueBonus();
    const energy = Math.floor(delta.credits * bonus);
    const result = petState.addSpiritEnergy(energy);
    if (delta.source === 'idle_gain') {
      if (energy > 50) {
        wm.postMessage({
          type: 'action',
          payload: { action: 'cultivate', message: `打坐修炼，吸收 ${energy} 点灵气` }
        });
      }
    } else if (delta.source === 'save') {
      wm.postMessage({
        type: 'action',
        payload: { action: 'cultivate', message: `悟道笔记·灵气+${energy}` }
      });
    }
    if (result.leveledUp) handleLevelUp(result.newLevel!);
    questSystem.updateProgress('dq_code_30', delta.credits);
  });

  // 系统监控告警
  systemMonitor.setOnAlert((type, value) => {
    if (type === 'cpu') {
      wm.postMessage({
        type: 'notification',
        payload: { title: 'CPU 过载', message: `灵气紊乱！CPU 使用率 ${value}%`, action: 'panic' }
      });
    } else {
      wm.postMessage({
        type: 'notification',
        payload: { title: '内存不足', message: `丹田将满！内存使用率 ${value}%`, action: 'panic' }
      });
    }
  });

  // 任务监控
  taskMonitor.setOnTaskEnd(event => {
    if (event.success) {
      petState.incrementStat('totalTasksCompleted');
      const result = petState.addSpiritEnergy(50);
      petState.addSpiritStones(10);
      wm.postMessage({
        type: 'notification',
        payload: { title: '历练成功', message: `「${event.taskName}」历练成功！灵气+50，灵石+10`, action: 'happy' }
      });
      if (result.leveledUp) handleLevelUp(result.newLevel!);
      questSystem.updateProgress('dq_task_2', 1);
    } else {
      wm.postMessage({
        type: 'notification',
        payload: { title: '走火入魔', message: `「${event.taskName}」历练失败，心魔作祟！`, action: 'fight' }
      });
    }
  });

  // 定时任务
  scheduleManager.setOnTaskTrigger(task => {
    petState.addSpiritEnergy(15);
    wm.postMessage({
      type: 'notification',
      payload: { title: '历练时刻', message: `定时任务「${task.name}」已完成，灵气+15`, action: 'happy' }
    });
  });

  // 股市行情
  stockService.setOnQuote(quotes => {
    if (quotes.length === 0) return;
    const top = quotes[0];
    const direction = top.changePercent >= 0 ? '涨' : '跌';
    wm.postMessage({
      type: 'notification',
      payload: {
        title: '凡尘股事',
        message: `${top.name} ${direction} ${Math.abs(top.changePercent)}%，现价 ${top.price}`,
        action: 'talk'
      }
    });
  });

  // 启动监控
  traeMonitor.start();
  if (config.get<boolean>('systemMonitorEnabled', true)) {
    startSystemMonitor();
  }
  context.subscriptions.push(...taskMonitor.activate());
  scheduleManager.startAll();
  stockService.start();

  // TRAE 真实积分 API 监控（如果用户配置了 token）
  traeCreditsMonitor.setOnCreditsDelta((consumed, info) => {
    // 消耗的积分数 → 灵气增长（比例：1 积分消耗 = 2 灵气点 基础换算）
    const bonus = economy.getTechniqueBonus();
    const energy = Math.floor(consumed * 2 * bonus);
    petState.addSpiritEnergy(energy);
    // 累计积分消耗（高境界破境门槛）
    const tot = (info as any).totalCreditsAmount;
    petState.setTraeCreditsTotal(typeof tot === 'number'
      ? Math.round(tot)
      : (petState.getState().traeCreditsTotal || 0) + consumed);
    // 消耗越多，奖励越多灵石（单轮封顶，防止结算异常导致灵石数值失控膨胀）
    const stones = Math.max(1, Math.min(200, Math.floor(consumed / 10)));
    petState.addSpiritStones(stones);
    
    const topPack = info.packList[0];
    const product = topPack?.entitlement_base_info?.product_type || '权益包';
    wm.postMessage({
      type: 'notification',
      payload: {
        title: '🧿 真实灵气采集',
        message: `${product} 消耗 ${consumed.toFixed(2)} 积分 → 灵气+${energy}，灵石+${stones}`,
        action: 'cultivate'
      }
    });
  });
  const pollMin = config.get<number>('creditsPollInterval', 5);
  traeCreditsMonitor.start(pollMin);

  // 编码时长统计
  codingTimer = setInterval(() => {
    petState.incrementStat('totalCodingMinutes', 10);
    const result = petState.addSpiritEnergy(10);
    questSystem.updateProgress('dq_code_30', 10);
    if (result.leveledUp) handleLevelUp(result.newLevel!);
  }, 10 * 60 * 1000);

  // 每日签到
  const checkInResult = petState.dailyCheckIn();
  if (checkInResult.success) {
    setTimeout(() => {
      wm.postMessage({ type: 'checkInResult', payload: checkInResult });
    }, 2000);
  }

  // ===== 自动弹出：TRAE Chat 检测 =====
  setupAutoPanel(context);

  // 监听配置变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('lingpet')) {
        // TODO: 重新加载监控配置
      }
    })
  );

  console.log('LingPet 修仙灵兽已激活');
}

// ===== 自动弹出逻辑 =====

function setupAutoPanel(context: vscode.ExtensionContext): void {
  const autoShow = vscode.workspace.getConfiguration('lingpet').get<boolean>('autoShowOnChat', true);
  if (!autoShow) return;

  // 仅跟随 TRAE Chat 编辑器出现，不再定时/延迟自动弹面板：
  // 旧逻辑会在每次激活/面板被回收时新建浮动页，导致「崩溃后不停冒出新页面」
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isTraeChatEditor(editor)) {
        if (!wm.isAnyActive()) {
          showPet();
        }
      }
    })
  );
}

/** 判断一个 TextEditor 是否是 TRAE Chat 相关的 */
function isTraeChatEditor(editor: vscode.TextEditor): boolean {
  try {
    const uri = editor.document?.uri;
    const viewType = (editor as any).viewType || '';
    if (!uri && !viewType) return false;
    const uriStr = uri?.toString() || '';
    const lower = (uriStr + ' ' + viewType).toLowerCase();
    // 检测 URI scheme 或路径包含 chat 相关关键词
    for (const kw of TRAE_CHAT_KEYWORDS) {
      if (lower.includes(kw)) return true;
    }
    return false;
  } catch { return false; }
}

function toggleAutoPanel(): void {
  const config = vscode.workspace.getConfiguration('lingpet');
  const current = config.get<boolean>('autoShowOnChat', true);
  config.update('autoShowOnChat', !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    `LingPet: Chat 自动弹出 ${!current ? '已开启' : '已关闭'}`
  );
}

// ===== 基础功能 =====

function showPet(): void {
  wm.showAsPanel();
  wm.postMessage({ type: 'stateUpdate', payload: enrichState(petState.getState()) });
}

function handleLevelUp(newLevel: number): void {
  const realm = levelToRealm(newLevel);
  const stage = petState.getState().stage;
  const realmName = `${realm}·${STAGE_NAMES[stage]}`;
  wm.postMessage({
    type: 'evolve',
    payload: { newLevel, newRealm: realmName }
  });
  achievementSystem.checkAndUnlock();
}

let petAwayFlag = false;

/** 给前端状态补充派生字段（外出态 / 破境门槛） */
function enrichState(state: any): any {
  return {
    ...state,
    petAway: petAwayFlag,
    gateNeed: (petState as any).gateNeed || 0,
    traeCreditsTotal: state.traeCreditsTotal || 0
  };
}

function handleWebviewMessage(msg: any): void {
  if (msg.type === '__webviewReady') {
    wm.postMessage({ type: 'stateUpdate', payload: enrichState(petState.getState()) });
    return;
  }

  switch (msg.type) {
    case 'requestState':
      wm.postMessage({ type: 'stateUpdate', payload: enrichState(petState.getState()) });
      break;
    case 'click':
      petState.addAffinity(1);
      wm.postMessage({ type: 'action', payload: { action: 'happy' } });
      break;
    case 'petHead':
      petState.addAffinity(2);
      wm.postMessage({
        type: 'action',
        payload: { action: 'happy', message: '道友的抚摸令我倍感亲切~' }
      });
      questSystem.updateProgress('dq_pet_5', 1);
      break;
    case 'feed': {
      const feedResult = economy.feed(msg.payload?.itemId || 'food_spirit_fruit');
      wm.postMessage({
        type: 'action',
        payload: { action: 'eat', message: feedResult.message }
      });
      if (feedResult.success) questSystem.updateProgress('dq_feed_1', 1);
      break;
    }
    case 'buyFurniture': {
      const fid = msg.id || msg.payload?.id;
      const item = FURNITURE_MAP[fid];
      if (!item) break;
      const st = petState.getState();
      const owned = new Set(st.furniture || ['futon']);
      if (owned.has(fid)) {
        wm.postMessage({ type: 'notification', payload: { title: '提示', message: '已布置过该家具', kind: 'warning' } });
        break;
      }
      if (!petState.spendSpiritStones(item.price)) {
        wm.postMessage({ type: 'notification', payload: { title: '灵石不足', message: `需 ${item.price} 灵石`, kind: 'error' } });
        break;
      }
      owned.add(fid);
      petState.setFurniture(Array.from(owned));
      // 显式回推一次完整状态，保证画布立刻重建家具（不依赖订阅链）
      wm.postMessage({ type: 'stateUpdate', payload: enrichState(petState.getState()) });
      wm.postMessage({ type: 'furnitureBought', payload: { id: fid, furniture: Array.from(owned) } });
      wm.postMessage({ type: 'notification', payload: { title: '布置成功', message: `${item.emoji} ${item.name} 已入灵兽袋`, kind: 'success', action: 'happy' } });
      break;
    }
    case 'summonDesktop': {
      const ok = showDesktopPet();
      if (ok) {
        petAwayFlag = true;
        extContext?.globalState.update('lingpet.petAway', true);
        wm.postMessage({ type: 'notification', payload: { title: '召唤', message: '灵兽已降临桌面', kind: 'success' } });
      } else {
        wm.postMessage({ type: 'notification', payload: { title: '召唤失败', message: '桌面灵兽未能启动，请查看日志', kind: 'error' } });
      }
      break;
    }
    case 'recallDesktop':
      hideDesktopPet();
      petAwayFlag = false;
      extContext?.globalState.update('lingpet.petAway', false);
      wm.postMessage({ type: 'recalled' });
      wm.postMessage({ type: 'stateUpdate', payload: enrichState(petState.getState()) });
      break;
    case 'openShop':
      sendShopItems();
      break;
    case 'openAchievements':
      sendAchievements();
      break;
    case 'openQuests':
      openQuests();
      break;
    case 'buyItem': {
      const buyResult = economy.buyItem(msg.payload.itemId);
      if (buyResult.success) {
        wm.postMessage({
          type: 'notification',
          payload: { title: '购买成功', message: buyResult.message, action: 'happy' }
        });
        sendShopItems();
      } else {
        wm.postMessage({
          type: 'notification',
          payload: { title: '购买失败', message: buyResult.message, action: 'bored' }
        });
      }
      break;
    }
    case 'claimQuest': {
      const claimResult = questSystem.claimQuest(msg.payload.questId);
      if (claimResult.success) {
        wm.postMessage({
          type: 'notification',
          payload: { title: '领取成功', message: claimResult.message, action: 'happy' }
        });
        wm.postMessage({ type: 'quests', payload: questSystem.getQuests() });
      }
      break;
    }
    case 'setName':
      petState.setName(msg.payload.name);
      break;
    case 'checkIn': {
      const result = petState.dailyCheckIn();
      wm.postMessage({ type: 'checkInResult', payload: result });
      break;
    }
    case 'refreshUsage':
      traeMonitor.fetchUsage();
      break;
    case 'logCodingMinute':
      petState.incrementStat('totalCodingMinutes', 1);
      break;
  }
}

function sendShopItems(): void {
  wm.postMessage({ type: 'shopItems', payload: SHOP_ITEMS });
}

function sendAchievements(): void {
  const all = achievementSystem.getAllAchievements();
  const unlocked = new Set(petState.getState().achievements);
  wm.postMessage({
    type: 'notification',
    payload: {
      title: '🏆 成就',
      message: `已解锁 ${unlocked.size}/${all.length} 个成就`,
      action: 'happy'
    }
  });
}

function openQuests(): void {
  wm.postMessage({ type: 'quests', payload: questSystem.getQuests() });
}

function feedDefault(): void {
  const result = economy.feed('food_spirit_fruit');
  wm.postMessage({
    type: 'notification',
    payload: { title: '喂食', message: result.message, action: 'eat' }
  });
}

function refinePill(): void {
  const state = petState.getState();
  if (state.spiritStones < 20) {
    wm.postMessage({
      type: 'notification',
      payload: { title: '炼丹失败', message: '灵石不足，炼丹需 20 灵石', action: 'bored' }
    });
    return;
  }
  petState.addSpiritStones(-20);
  const energyResult = petState.addSpiritEnergy(50);
  const items = ['pill_calm_spirit', 'pill_blood_replenish', 'pill_breakthrough'];
  const itemId = items[Math.floor(Math.random() * items.length)];
  petState.addItem(itemId, 1);
  wm.postMessage({
    type: 'notification',
    payload: {
      title: '炼丹成功',
      message: `消耗 20 灵石，获灵气+50 和一枚丹药「${itemId}」！`,
      action: 'happy'
    }
  });
  if (energyResult.leveledUp) handleLevelUp(energyResult.newLevel!);
}

function manualBoost(): void {
  const result = petState.addSpiritEnergy(20);
  wm.postMessage({
    type: 'action',
    payload: { action: 'cultivate', message: `主动打坐，灵气+20` }
  });
  if (result.leveledUp) handleLevelUp(result.newLevel!);
}

function startSystemMonitor(): void {
  const interval = vscode.workspace.getConfiguration('lingpet').get<number>('systemMonitorInterval', 5);
  setInterval(async () => {
    const status = await systemMonitor.getStatus();
    wm.postMessage({ type: 'systemUpdate', payload: status });
  }, interval * 1000);
}

function updateStatusBar(): void {
  const state = petState.getState();
  const realm = levelToRealm(state.level);
  statusBarItem.text = `🐾 ${state.name} Lv.${state.level} ${realm} | 💎${state.spiritStones}`;
  statusBarItem.tooltip = `修仙灵兽\n境界：${realm}·${STAGE_NAMES[state.stage]}\n灵气：${state.spiritEnergy}/${state.energyToNext}\n灵石：${state.spiritStones}\n好感度：${state.affinity}`;
}

export function deactivate(): void {
  traeMonitor?.stop();
  traeCreditsMonitor?.stop();
  scheduleManager?.stopAll();
  stockService?.stop();
  if (codingTimer) clearInterval(codingTimer);
  if (chatDetectTimer) clearInterval(chatDetectTimer);
  statusBarItem?.dispose();
  wm?.dispose();
}

// ===== TRAE 真实积分 API 相关 =====

async function promptSetTraeToken(): Promise<void> {
  const steps = [
    '1. 在 TRAE 里按 Ctrl+Shift+I 打开 DevTools',
    '2. 切到 Network 面板',
    '3. 在 TRAE 里发一次智能体消息（让它调一次 API）',
    '4. 在 Network 里搜索 "ide_user_ent_usage" 或 "pay"',
    '5. 点开 POST /trae/api/v2/pay/ide_user_ent_usage 请求',
    '6. Headers 里找到 Authorization: Cloud-IDE-JWT xxxxxxx',
    '7. 复制 JWT 部分（不要复制 "Cloud-IDE-JWT" 前缀）',
    '',
    '或者：直接粘贴完整的 "Cloud-IDE-JWT xxxx" 也行'
  ].join('\n');
  
  const input = await vscode.window.showInputBox({
    prompt: '粘贴 TRAE Cloud-IDE-JWT Token',
    placeHolder: '粘贴从 DevTools Network 里复制的 JWT token...',
    password: true,
    validateInput: (v) => v && v.length > 10 ? null : 'Token 太短'
  });
  if (!input) return;
  
  await traeCreditsMonitor.setToken(input);
  // 重启轮询
  traeCreditsMonitor.stop();
  traeCreditsMonitor.start(
    vscode.workspace.getConfiguration('lingpet').get<number>('creditsPollInterval', 5)
  );
}

async function queryTraeCredits(): Promise<void> {
  if (!traeCreditsMonitor.hasToken()) {
    const choice = await vscode.window.showWarningMessage(
      '还没配置 TRAE JWT Token，要现在设置吗？',
      '立即设置', '稍后再说'
    );
    if (choice === '立即设置') promptSetTraeToken();
    return;
  }
  
  const usage = await traeCreditsMonitor.fetchCreditsUsage();
  vscode.window.showInformationMessage(
    `🐾 TRAE 积分: 已消耗 ${usage.totalCreditsAmount} / 额度 ${usage.quotaCredits}（剩余 ${usage.remainingCredits}）· ${usage.packList.length} 个权益包${usage.isDollarUsageBilling ? ' · 美元计费' : ''}`
  );
}


// ===== 桌面宠物（tkinter 侧车，单向状态同步） =====
let extContext: vscode.ExtensionContext | null = null;

function syncDesktopState(): void {
  try {
    const st = petState.getState();
    const dir = path.join(os.homedir(), '.lingpet');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'desktop-state.json'),
      JSON.stringify({ petType: st.petType, level: st.level, name: st.name }));
  } catch { /* 静默 */ }
}

function showDesktopPet(): boolean {
  const dir = path.join(os.homedir(), '.lingpet');
  const pidFile = path.join(dir, 'desktop-pet.pid');
  if (fs.existsSync(pidFile)) {
    // 校验 PID 是否存活，清理陈旧记录
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      process.kill(pid, 0); // 存活探测（不真杀）
      vscode.window.showInformationMessage('🐾 桌面灵兽已在洞府外候着了');
      return true;
    } catch {
      try { fs.unlinkSync(pidFile); } catch { /* 忽略 */ }
    }
  }
  syncDesktopState();
  const script = extContext!.asAbsolutePath('resources/desktop-pet/desktop_pet.py');
  const framesDir = extContext!.asAbsolutePath('resources/sprites/frames');
  const logFile = path.join(dir, 'desktop-pet.log');
  fs.mkdirSync(dir, { recursive: true });
  //  stderr 落盘，失败可诊断；pythonw 不存在时回退 python
  const trySpawn = (exe: string): boolean => {
    try {
      const out = fs.openSync(logFile, 'a');
      const child = spawn(exe, [script, framesDir], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
      child.on('error', () => { /* 由返回值兜底 */ });
      child.unref();
      return true;
    } catch {
      return false;
    }
  };
  const ok = trySpawn('pythonw') || trySpawn('python');
  setTimeout(() => {
    if (fs.existsSync(pidFile)) {
      vscode.window.showInformationMessage('🐾 桌面灵兽已降临！拖拽移动 · 左键抚摸 · 右键菜单');
    } else {
      vscode.window.showErrorMessage(`🐾 桌面灵兽启动失败${ok ? '' : '（未找到 Python）'}，日志: ${logFile}`);
    }
  }, 2500);
  return ok;
}

function hideDesktopPet(): void {
  const pidFile = path.join(os.homedir(), '.lingpet', 'desktop-pet.pid');
  try {
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      try { process.kill(pid); } catch { /* 已退出 */ }
      fs.unlinkSync(pidFile);
    }
    vscode.window.showInformationMessage('🐾 桌面灵兽已归洞府');
  } catch { /* 静默 */ }
}


// ===== 全自动凭证捕获: 扫描 TRAE 日志里的 JWT =====
async function autoDetectToken(): Promise<string | null> {
  try {
    const logsRoot = path.join(process.env.APPDATA || '', 'Trae CN', 'logs');
    if (!fs.existsSync(logsRoot)) return null;
    const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/;
    // 最近 3 个会话目录的 window/renderer 日志
    const sessions = fs.readdirSync(logsRoot).sort().reverse().slice(0, 3);
    for (const sess of sessions) {
      const dir = path.join(logsRoot, sess);
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir, { recursive: true } as any)
          .map(String).filter(f => /renderer.*\.log$|window\d+.*\.log$/i.test(f));
      } catch { continue; }
      for (const f of files.slice(0, 10)) {
        try {
          const tail = fs.readFileSync(path.join(dir, f), 'utf-8').slice(-200000);
          const m = tail.match(jwtRe);
          if (m && m[0].length > 100) return m[0];
        } catch { /* 静默 */ }
      }
    }
  } catch { /* 静默 */ }
  return null;
}
