// Webview 渲染入口
import type { Application } from 'pixi.js';
import { PetSprite } from './PetSprite';
import { PetState, PetAction, ShopItem, DailyQuest } from '../../types';

declare function acquireVsCodeApi(): {
  postMessage: (msg: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};

declare global {
  interface Window {
    __LINGPET_RESOURCES__?: string;
  }
}

const vscode = (window as any).__lpApi || acquireVsCodeApi();
(window as any).__lpApi = vscode;

let app: Application | null = null;
let pet: PetSprite | DomFallbackPet | null = null;
let currentState: PetState | null = null;
let speechTimer: number | null = null;

// 全局错误浮出（webview 内任何异常直接可见）
window.addEventListener('error', e => showToast(`⚠️ ${e.message}`, 'error'));
window.addEventListener('unhandledrejection', e => {
  const r = e.reason as Error | undefined;
  showToast(`⚠️ ${r?.message || String(e.reason)}`, 'error');
});

// ============ DOM 兜底灵兽（PixiJS 不可用时保证可见） ============
const PET_EMOJI: Record<string, string> = { tihun: '🐵', mojiao: '🐉', liuyi: '🦂' };

class DomFallbackPet {
  private el: HTMLDivElement;
  private emojiEl: HTMLSpanElement;
  private nameEl: HTMLDivElement;
  private action: PetAction = 'idle';

  constructor(parent: HTMLElement, petType: string) {
    DomFallbackPet.injectKeyframes();
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);text-align:center;z-index:5;cursor:pointer;';
    this.emojiEl = document.createElement('span');
    this.emojiEl.style.cssText = 'font-size:96px;display:inline-block;filter:drop-shadow(0 0 12px rgba(127,219,255,0.6));';
    this.emojiEl.textContent = PET_EMOJI[petType] || '🐵';
    this.nameEl = document.createElement('div');
    this.nameEl.style.cssText = 'margin-top:8px;color:#fff;font-weight:bold;text-shadow:0 1px 3px #000;';
    this.el.appendChild(this.emojiEl);
    this.el.appendChild(this.nameEl);
    parent.appendChild(this.el);
    this.applyAnim();
  }

  private static injectKeyframes(): void {
    if (document.getElementById('lp-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'lp-keyframes';
    style.textContent = `
      @keyframes lpFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
      @keyframes lpBounce { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-14px) scale(1.05)} }
      @keyframes lpShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
      @keyframes lpGlow { 0%,100%{filter:drop-shadow(0 0 8px rgba(255,215,0,0.5))} 50%{filter:drop-shadow(0 0 20px rgba(255,215,0,0.9))} }
    `;
    document.head.appendChild(style);
  }

  onClick(cb: () => void): void { this.el.addEventListener('click', cb); }
  setAction(action: PetAction): void { this.action = action; this.applyAnim(); }
  setLevel(_level: number): void { /* 简化形态不缩放 */ }
  setName(n: string): void { this.nameEl.textContent = n; }
  setPetType(t: string): void { this.emojiEl.textContent = PET_EMOJI[t] || '🐵'; }

  private applyAnim(): void {
    const anims: Record<string, string> = {
      idle: 'lpFloat 3s ease-in-out infinite',
      breathe: 'lpFloat 3s ease-in-out infinite',
      cultivate: 'lpFloat 4s ease-in-out infinite, lpGlow 2s ease-in-out infinite',
      eat: 'lpBounce 0.6s ease-in-out infinite',
      happy: 'lpBounce 0.5s ease-in-out infinite',
      sleep: 'lpFloat 5s ease-in-out infinite',
      panic: 'lpShake 0.4s ease-in-out infinite',
      evolve: 'lpBounce 0.5s ease-in-out infinite, lpGlow 1s ease-in-out infinite',
      fight: 'lpShake 0.3s ease-in-out infinite',
      talk: 'lpFloat 2s ease-in-out infinite',
      craft: 'lpBounce 0.8s ease-in-out infinite',
      breakthrough: 'lpBounce 0.5s ease-in-out infinite, lpGlow 1s ease-in-out infinite',
      look_around: 'lpFloat 2.5s ease-in-out infinite'
    };
    this.emojiEl.style.animation = anims[this.action] || anims.idle;
  }
}

// 初始化渲染（PixiJS 失败时自动降级 DOM 灵兽）
async function init(): Promise<void> {
  const canvas = document.getElementById('pixi-canvas') as HTMLCanvasElement;
  const petType = currentState?.petType || 'tihun';

  const onPetClick = (): void => {
    vscode.postMessage({ type: 'click' });
    pet?.setAction('happy');
    showSpeech(getRandomIdleSpeech());
  };

  let stage = '模块加载';
  try {
    // 动态导入：PixiJS 模块加载失败不拖垮整个 webview
    const { Application } = await import('pixi.js');
    app = new Application();
    stage = '渲染器初始化';
    // WebGL 预检：TRAE GPU 加速偶发被禁，提前探明给出精确原因
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
      throw new Error('环境无WebGL(GPU加速被禁用)');
    }
    const initOpts: any = {
      canvas,
      backgroundAlpha: 0,
      antialias: true,
      preference: 'webgl',
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: window  // 关键: 不传则默认 800x600，窄面板下宠物画在 x=400 出屏
    };
    try {
      await app.init(initOpts);
    } catch (webglErr) {
      console.warn('[LingPet] WebGL 初始化失败，尝试自动探测渲染器:', webglErr);
      stage = '渲染器重试';
      app = new Application();
      await app.init({ ...initOpts, preference: undefined, antialias: false });
    }

    const resize = (): void => {
      if (!app) return;
      app.renderer.resize(window.innerWidth, window.innerHeight);
      if (pet instanceof PetSprite) pet.resize();
    };
    window.addEventListener('resize', resize);

    stage = 'PetSprite构造';
    const resourcesUri = window.__LINGPET_RESOURCES__ || '';
    const spriteBaseUrl = resourcesUri ? `${resourcesUri}/sprites` : './resources/sprites';

    pet = new PetSprite(app, spriteBaseUrl, petType, 1);
    resize();
    canvas.addEventListener('click', onPetClick);
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); pet?.setAction('look_around'); });
    console.log('[LingPet] PixiJS 渲染器初始化成功');
    setRenderBadge('像素渲染中...');
    // 灵兽袋空间: 地面线 + 游走
    pet.setSpaceGround(app.screen.height / 2 + 20);
    pet.setFurniture(currentState?.furniture || ['futon']);
    // 虚空气旋背景
    startVoidBackground(app);
    let badgeBase = '';
    pet.onLoaded(() => {
      const mode = (pet as PetSprite).getRenderMode();
      const err = (pet as PetSprite).lastLoadError;
      badgeBase = mode === 'spritesheet' ? '✅ 像素精灵图'
        : `⚠️ 程序化像素（PNG失败: ${err ? err.slice(0, 50) : '未知'}）`;
    });
    // 实时几何诊断: 每秒刷新 画布尺寸/宠物坐标/帧序号
    setInterval(() => {
      const ps = pet as PetSprite;
      const furn = (currentState?.furniture || ['futon']).length;
      const fErr = ps.furnitureError ? ` ⚠️家具:${ps.furnitureError.slice(0, 30)}` : '';
      setRenderBadge(`${badgeBase || '加载中'} | ${ps.getDebugInfo ? ps.getDebugInfo() : '...'} 家具:${furn}${fErr}`);
    }, 1000);
  } catch (e: any) {
    const reason = `${stage}: ${e?.message || e}`;
    console.warn('[LingPet] PixiJS 初始化失败，启用 DOM 兜底灵兽:', reason);
    canvas.style.display = 'none';
    pet = new DomFallbackPet(document.getElementById('app')!, petType);
    pet.onClick(onPetClick);
    if (currentState) { pet.setName(currentState.name); pet.setRealm(currentState.level); }
    setRenderBadge(`⚠️ 简化形态: ${reason.slice(0, 60)}`);
    showToast(`灵兽简化形态 (${reason.slice(0, 60)})`, 'warning', 8000);
  }

  setupButtons();
  requestState();
}

function setupButtons(): void {
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      handleAction(action!);
    });
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close')!;
      document.getElementById(modalId)?.classList.remove('show');
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });
  });
}

function handleAction(action: string): void {
  switch (action) {
    case 'feed':
      vscode.postMessage({ type: 'feed', payload: { itemId: 'food_spirit_fruit' } });
      break;
    case 'pet':
      vscode.postMessage({ type: 'petHead' });
      pet?.setAction('happy');
      break;
    case 'shop':
      vscode.postMessage({ type: 'openShop' });
      break;
    case 'quest':
      vscode.postMessage({ type: 'openQuests' });
      break;
    case 'achievement':
      vscode.postMessage({ type: 'openAchievements' });
      break;
    case 'checkin':
      vscode.postMessage({ type: 'checkIn' });
      break;
  }
}

function requestState(): void {
  vscode.postMessage({ type: 'requestState' });
}

// 监听来自扩展的消息
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'stateUpdate':
      updateState(msg.payload);
      break;
    case 'action':
      handleActionMessage(msg.payload.action as PetAction, msg.payload.message);
      break;
    case 'recalled':
      pet?.restoreFromAway?.();
      showToast('🐾 灵兽已归袋', 'success');
      break;
    case 'notification':
      handleNotification(msg.payload);
      break;
    case 'evolve':
      handleEvolve(msg.payload);
      break;
    case 'achievementUnlock':
      handleAchievement(msg.payload);
      break;
    case 'checkInResult':
      handleCheckInResult(msg.payload);
      break;
    case 'shopItems':
      renderShop(msg.payload as ShopItem[]);
      break;
    case 'quests':
      renderQuests(msg.payload as DailyQuest[]);
      break;
  }
});

function updateState(state: PetState): void {
  currentState = state;
  pet?.setPetType(state.petType);
  pet?.setLevel(state.level);
  pet?.setName(state.name);
  pet?.setRealm(state.level);
  // 同步给内联工具栏脚本（家具商店展示灵石/已布置状态）
  (window as any).__lpUI?.setState?.(state);
  pet?.setFurniture(state.furniture || ['futon']);
  // 外出遮罩仅由本地召唤动画控制，避免残留状态锁死界面
  if (!(state as any).petAway) {
    const awayEl = document.getElementById('away-overlay');
    if (awayEl) awayEl.style.display = 'none';
  }
  const gateEl = document.getElementById('gate-hint');
  if (gateEl) {
    const need = (state as any).gateNeed || 0;
    gateEl.style.display = need > 0 ? 'block' : 'none';
    if (need > 0) gateEl.textContent = `🔒 破境需 TRAE 累计消耗 ${need} 积分（当前 ${Math.floor((state as any).traeCreditsTotal || 0)}）`;
  }

  (document.getElementById('pet-name') as HTMLElement).textContent = state.name;
  (document.getElementById('pet-level') as HTMLElement).textContent = String(state.level);
  (document.getElementById('pet-realm') as HTMLElement).textContent = getRealmName(state.level, state.stage);
  (document.getElementById('spirit-stones') as HTMLElement).textContent = String(state.spiritStones);
  (document.getElementById('affinity') as HTMLElement).textContent = String(state.affinity);

  const energyPct = Math.min(100, (state.spiritEnergy / state.energyToNext) * 100);
  (document.getElementById('energy-fill') as HTMLElement).style.width = energyPct + '%';
  (document.getElementById('energy-text') as HTMLElement).textContent =
    `${state.spiritEnergy} / ${state.energyToNext}`;
}

function getRealmName(level: number, stage: string): string {
  const realms = ['炼气期', '筑基期', '结丹期', '元婴期', '化神期', '炼虚期', '合体期', '大乘期', '真仙', '金仙', '太乙', '大罗', '道祖'];
  const stageNames: Record<string, string> = { initial: '初阶', middle: '中阶', upper: '上阶' };
  let realmIdx: number;
  if (level <= 1) realmIdx = 0;
  else if (level <= 4) realmIdx = 1;
  else if (level <= 7) realmIdx = 2;
  else if (level <= 10) realmIdx = 3;
  else if (level <= 11) realmIdx = 4;
  else if (level <= 12) realmIdx = 5;
  else if (level <= 13) realmIdx = 6;
  else if (level <= 14) realmIdx = 7;
  else realmIdx = Math.min(12, 7 + (level - 14));
  return `${realms[realmIdx]}·${stageNames[stage] || '初阶'}`;
}

function handleActionMessage(action: PetAction, message?: string): void {
  pet?.setAction(action);
  if (message) showSpeech(message);
}

function handleNotification(payload: { title: string; message: string; action?: string }): void {
  if (payload.action) pet?.setAction(payload.action as PetAction);
  showSpeech(payload.message);
  showToast(payload.title, 'success');
}

function handleEvolve(payload: { newLevel: number; newRealm: string }): void {
  pet?.setAction('evolve');
  const overlay = document.getElementById('evolve-overlay');
  const text = document.getElementById('evolve-text');
  if (text) text.textContent = `突破！${payload.newRealm}`;
  overlay?.classList.add('show');
  setTimeout(() => overlay?.classList.remove('show'), 2000);
  showSpeech(`修为大进！突破至 ${payload.newRealm}！`);
}

function handleAchievement(payload: { id: string; name: string; description: string }): void {
  showToast(`🏆 成就解锁：${payload.name}`, 'success');
  showSpeech(`天道酬勤！解锁成就：${payload.name}`);
}

function handleCheckInResult(payload: { success: boolean; reward: number; streak: number }): void {
  if (payload.success) {
    showToast(`签到成功！灵气+${payload.reward}，连续${payload.streak}天`, 'success');
    showSpeech(`每日签到！灵气+${payload.reward}，已连续修行${payload.streak}天`);
  } else {
    showToast('今日已签到', 'warning');
  }
}

function showSpeech(text: string): void {
  const bubble = document.getElementById('speech-bubble');
  if (!bubble) return;
  bubble.textContent = text;
  bubble.classList.add('show');
  bubble.style.left = '50%';
  bubble.style.transform = 'translateX(-50%)';
  bubble.style.top = '80px';

  if (speechTimer) clearTimeout(speechTimer);
  speechTimer = window.setTimeout(() => {
    bubble.classList.remove('show');
  }, 3000);
}

function showToast(message: string, type: 'success' | 'error' | 'warning' = 'success', duration = 2500): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), duration);
}

// 常驻渲染模式徽标（左下角，诊断用）
function setRenderBadge(text: string): void {
  let badge = document.getElementById('render-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'render-badge';
    badge.style.cssText = 'position:absolute;left:8px;bottom:48px;font-size:11px;font-weight:600;color:#fff;'
      + 'background:rgba(10,10,14,0.85);border-left:3px solid #f55;padding:4px 10px;border-radius:6px;'
      + 'z-index:9999;max-width:92%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,0.6);';
    document.getElementById('app')?.appendChild(badge);
  }
  badge.textContent = `🐾 ${text}`;
}

function getRandomIdleSpeech(): string {
  const affinity = currentState?.affinity ?? 0;
  // 好感度分层：低好感冷淡，高好感亲昵
  const low = [
    '道友，今日修炼几何？',
    '此处天地灵气甚浓...',
    '我饿了，有灵果吗？',
    '(打了个哈欠) 有些乏了...'
  ];
  const mid = [
    '灵气充沛，正是修行好时节。',
    '道友可愿与我一同悟道？',
    '方才我感应到一丝灵气波动！',
    '勤修不辍，大道可期！'
  ];
  const high = [
    '与道友相伴，修行亦不孤单~',
    '道友的境界，我定会全力守护！',
    '今日也要一起努力呀！',
    '(蹭了蹭你) 最喜欢道友了~',
    '我感觉快要突破了，道友助我！'
  ];
  const pool = affinity >= 100 ? [...high, ...mid] : affinity >= 30 ? [...mid, ...low] : low;
  return pool[Math.floor(Math.random() * pool.length)];
}

// 待机随机自语：每 45-90 秒一句（好感越高越健谈）
let idleTalkTimer: number | null = null;
function scheduleIdleTalk(): void {
  if (idleTalkTimer) clearTimeout(idleTalkTimer);
  const affinity = currentState?.affinity ?? 0;
  const base = affinity >= 100 ? 40000 : affinity >= 30 ? 60000 : 90000;
  const delay = base + Math.random() * 30000;
  idleTalkTimer = window.setTimeout(() => {
    // 仅在空闲状态自语，避免打扰动作演出
    if (currentState && pet) {
      showSpeech(getRandomIdleSpeech());
      pet?.setAction('talk');
      setTimeout(() => pet?.setAction('idle'), 3000);
    }
    scheduleIdleTalk();
  }, delay);
}
scheduleIdleTalk();

function renderShop(items: ShopItem[]): void {
  const list = document.getElementById('shop-list');
  if (!list) return;
  list.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">${item.name} <span style="color:#ff851b;font-size:11px;">💎${item.price}</span></div>
        <div class="item-desc">${item.description}</div>
      </div>
      <button class="buy-btn" data-item="${item.id}">购买</button>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.getAttribute('data-item')!;
      vscode.postMessage({ type: 'buyItem', payload: { itemId } });
    });
  });
  document.getElementById('shop-modal')?.classList.add('show');
}

function renderQuests(quests: DailyQuest[]): void {
  const list = document.getElementById('quest-list');
  if (!list) return;
  list.innerHTML = '';
  for (const q of quests) {
    const pct = Math.min(100, (q.progress / q.target) * 100);
    const item = document.createElement('div');
    item.className = 'quest-item';
    item.innerHTML = `
      <div class="quest-name">${q.name} ${q.completed ? '✅' : ''}</div>
      <div style="font-size:11px;color:#999;">${q.description}</div>
      <div class="quest-progress"><div class="fill" style="width:${pct}%"></div></div>
      <div style="font-size:11px;color:#888;">奖励：💎${q.reward.spiritStones} 灵气+${q.reward.spiritEnergy} | ${q.progress}/${q.target}</div>
      <button class="claim-btn" data-quest="${q.id}" ${!q.completed || q.claimed ? 'disabled' : ''}>
        ${q.claimed ? '已领取' : '领取'}
      </button>
    `;
    list.appendChild(item);
  }
  list.querySelectorAll('.claim-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const questId = btn.getAttribute('data-quest')!;
      vscode.postMessage({ type: 'claimQuest', payload: { questId } });
    });
  });
  document.getElementById('quest-modal')?.classList.add('show');
}

// 启动
init().catch(err => console.error('LingPet renderer init failed:', err));


// ===== 灵兽袋空间扩展 =====
import { Graphics as PxGraphics, Container as PxContainer } from 'pixi.js';

/** 虚空气旋背景: 旋转弧光 + 漂浮灵尘 */
function startVoidBackground(app: any): void {
  const bg = new PxContainer();
  (bg as any).label = 'void-bg';
  app.stage.addChildAt(bg, 0);
  const cx = () => app.screen.width / 2, cy = () => app.screen.height / 2;
  const rings: any[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new PxGraphics();
    g.arc(0, 0, 90 + i * 55, 0, Math.PI * 1.2).stroke({ width: 2 + i, color: [0x4fd8ff, 0xb388ff, 0xffd54f][i], alpha: 0.16 - i * 0.03 });
    bg.addChild(g);
    rings.push(g);
  }
  const dust: any[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new PxGraphics();
    d.ellipse(0, 0, 1.5 + Math.random() * 2, 1.5 + Math.random() * 2).fill({ color: 0xaad4ff, alpha: 0.3 + Math.random() * 0.4 });
    (d as any).__orbit = { r: 60 + Math.random() * 260, a: Math.random() * Math.PI * 2, v: 0.002 + Math.random() * 0.006 };
    bg.addChild(d);
    dust.push(d);
  }
  app.ticker.add((tk: any) => {
    const d = typeof tk === 'number' ? tk : (tk?.deltaTime ?? 1);
    rings.forEach((r, i) => { r.rotation += (i % 2 ? -1 : 1) * 0.003 * d; r.x = cx(); r.y = cy(); });
    dust.forEach(dd => {
      const o = (dd as any).__orbit;
      o.a += o.v * d;
      dd.x = cx() + Math.cos(o.a) * o.r;
      dd.y = cy() + Math.sin(o.a) * o.r * 0.6;
    });
  });
}

// 工具栏由 HTML 内联脚本(window.__lpUI)驱动；这里只提供宠物动画桥接
(window as any).__lpPetSummon = (done: () => void) => {
  const ps = pet as any;
  if (ps?.playSummonAway) ps.playSummonAway(done);
  else done();
};
(window as any).__lpPetRecall = () => {
  (pet as any)?.restoreFromAway?.();
};

// 家具商店的 DOM 与购买逻辑已迁移到 index.html 内联脚本（不依赖打包）
