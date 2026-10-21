// 灵兽精灵 - PixiJS Spritesheet 帧动画（序列帧）
// 从 resources/sprites/{petType}_sprite.png + .json 加载
// 备用：如果精灵图不可用，回退到 Graphics 程序化绘制

import { Assets, Spritesheet, AnimatedSprite, Container, Graphics, Text, TextStyle, Texture } from 'pixi.js';

const PET_TYPES: Array<'tihun' | 'mojiao' | 'liuyi'> = ['tihun', 'mojiao', 'liuyi'];

// 程序化绘制的颜色（fallback 用）
const FALLBACK_CONFIGS: Record<string, { bodyColor: number; accentColor: number; eyeColor: number; auraColor: number }> = {
  tihun:  { bodyColor: 0x4caf50, accentColor: 0x81c784, eyeColor: 0xffeb3b, auraColor: 0x66bb6a },
  mojiao: { bodyColor: 0x1565c0, accentColor: 0x42a5f5, eyeColor: 0xffeb3b, auraColor: 0x29b6f6 },
  liuyi:  { bodyColor: 0x00838f, accentColor: 0x4dd0e1, eyeColor: 0xffeb3b, auraColor: 0x80deea }
};

// 动作 → 动画名映射（atlas JSON 里的 animations key）
const ACTION_TO_ANIM: Record<string, string> = {
  idle: 'idle',
  look_around: 'breathe',
  cultivate: 'cultivate',
  eat: 'eat',
  happy: 'happy',
  fight: 'fight',
  sleep: 'sleep',
  evolve: 'evolve',
  // talk/panic/bored/drag 等没有专属动画，用 idle 替代
  talk: 'idle',
  panic: 'fight',
  bored: 'idle',
  drag: 'idle'
};

// 粒子类型
interface Particle {
  obj: Text | Graphics;
  vx: number; vy: number;
  life: number; maxLife: number;
  gravity: number;
  spin: number;
}

export class PetSprite {
  private container: Container;
  private petContainer: Container;
  private particleContainer: Container;
  private particles: Particle[] = [];
  private animatedSprite: AnimatedSprite | null = null;
  private spritesheet: Spritesheet | null = null;
  private fallbackBody: Graphics | null = null;
  private fallbackAura: Graphics | null = null;
  private nameText: Text;
  private levelText: Text;
  private currentAction: string = 'idle';
  private actionTimer: number = 0;
  private level: number = 1;
  private petType: string = 'tihun';
  private useSpritesheet: boolean = false;
  private fallbackConfig: typeof FALLBACK_CONFIGS.tihun;
  private onLoadedCallbacks: Array<() => void> = [];

  constructor(
    private app: any,
    private spriteBaseUrl: string,
    petType: string = 'tihun',
    level: number = 1
  ) {
    this.container = new Container();
    this.app.stage.addChild(this.container);

    this.petContainer = new Container();
    this.container.addChild(this.petContainer);

    // 粒子层（在宠物之上）
    this.particleContainer = new Container();
    this.container.addChild(this.particleContainer);

    this.level = level;
    this.petType = petType;
    this.fallbackConfig = FALLBACK_CONFIGS[petType] || FALLBACK_CONFIGS.tihun;

    // 名称/等级文字
    const nameStyle = new TextStyle({ fontSize: 14, fill: 0xffd700, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3 });
    this.nameText = new Text({ text: '', style: nameStyle });
    this.nameText.anchor.set(0.5);
    this.petContainer.addChild(this.nameText);

    const levelStyle = new TextStyle({ fontSize: 11, fill: 0xff851b, stroke: 0x000000, strokeThickness: 2 });
    this.levelText = new Text({ text: '', style: levelStyle });
    this.levelText.anchor.set(0.5);
    this.petContainer.addChild(this.levelText);

    this.resize();

    // 立即绘制程序化像素兜底（不等异步精灵图加载，保证任何时刻都有像素可见）
    this.setupFallbackGraphics();

    // 再异步加载精灵图，成功后替换掉程序化像素
    this.tryLoadSpritesheet();

    this.app.ticker.add(this.update, this);
  }

  private async tryLoadSpritesheet(): Promise<void> {
    try {
      const jsonUrl = `${this.spriteBaseUrl}/${this.petType}_sprite.json`;
      const pngUrl = `${this.spriteBaseUrl}/${this.petType}_sprite.png`;

      // 加载 atlas JSON
      const resp = await fetch(jsonUrl);
      if (!resp.ok) throw new Error(`atlas json not found: ${jsonUrl}`);
      const atlasData = await resp.json();

      // 加载 PNG
      const tex = await Assets.load(pngUrl) as Texture;
      // PixiJS v8: 构造参数改为 { texture, data } 对象（v7 双参签名已废弃，
      // 误用会导致 parse() 抛错而静默走程序化兜底）
      this.spritesheet = new Spritesheet({ texture: tex, data: atlasData } as any);
      await this.spritesheet.parse();

      // 创建初始动画（idle）
      const animName = ACTION_TO_ANIM['idle'] || 'idle';
      const frames = this.spritesheet.animations[animName]
        || this.spritesheet.animations['idle']
        || Object.values(this.spritesheet.animations)[0]
        || [];

      if (frames.length > 0) {
        this.animatedSprite = new AnimatedSprite(frames);
        this.animatedSprite.anchor.set(0.5, 0.5);
        this.animatedSprite.scale.set(1.5 * this.facing, 1.5);
        this.animatedSprite.animationSpeed = 0.15;
        this.animatedSprite.loop = true;
        // 精灵图接管: 移除构造时画的程序化兜底（不移除会压在动画之上）
        if (this.fallbackBody) {
          this.petContainer.removeChild(this.fallbackBody);
          this.fallbackBody.destroy();
          this.fallbackBody = null;
        }
        if (this.fallbackAura) {
          this.petContainer.removeChild(this.fallbackAura);
          this.fallbackAura.destroy();
          this.fallbackAura = null;
        }
        this.petContainer.addChildAt(this.animatedSprite, 0);
        this.useSpritesheet = true;
        this.animatedSprite.play();
        this.nameText.y = -55;
        this.levelText.y = 38;
        console.log(`[LingPet] ${this.petType} sprite sheet 加载成功，帧动画启用 (${Object.keys(this.spritesheet.animations).length} 个动画)`);
      }
    } catch (e) {
      this.lastLoadError = (e as Error)?.message || String(e);
      console.warn(`[LingPet] 精灵图加载失败 (${this.petType})，回退到程序化绘制: ${e}`);
      this.useSpritesheet = false;
      this.setupFallbackGraphics();
    }

    for (const cb of this.onLoadedCallbacks) cb();
  }

  private setupFallbackGraphics(): void {
    this.fallbackAura = new Graphics();
    this.fallbackBody = new Graphics();
    this.petContainer.addChildAt(this.fallbackAura, 0);
    this.petContainer.addChildAt(this.fallbackBody, 1);
    this.nameText.y = -70;
    this.levelText.y = 60;
  }

  onLoaded(cb: () => void): void { this.onLoadedCallbacks.push(cb); }

  private realmAura: any = null;
  private realmLevel: number = -1;      // 已绘制光环对应的等级
  private furnitureLayer: any = null;   // 家具层
  private lastFurniture: string[] = []; // 最近一次家具清单
  private furnitureSig: string = '';    // 家具布置签名（内容/尺寸/地面），用于避免重复重建
  public furnitureError: string = '';   // 最近一次家具渲染异常
  private groundY: number = 0;          // 地面线（世界坐标）
  private baseX: number = 0;            // 灵兽当前站立 x（唯一权威，游走只改它）
  private bobX: number = 0;             // 动画水平偏移（不写回 baseX）
  private bobY: number = 0;             // 动画垂直偏移
  private facing: number = 1;           // 朝向
  private levelScale: number = 0.89;    // 等级体型
  private wanderTargetX: number = 0;    // 游走目标
  private wanderWait: number = 60;      // 游走间隔帧
  private behavior: 'idle' | 'walk' | 'interact' = 'idle';
  private interactAction: string = '';
  private awayMode: boolean = false;    // 召唤外出

  /** 当前渲染模式: 'spritesheet' | 'fallback'（供状态徽标显示） */
  /** 最近一次精灵图加载失败原因（供徽标显示） */
  public lastLoadError: string = '';

  /** 实时几何诊断（徽标显示用） */
  getDebugInfo(): string {
    const sp = this.animatedSprite;
    return `${this.app.screen.width}x${this.app.screen.height}`
      + ` @${Math.round(this.container.x)},${Math.round(this.container.y)}`
      + ` s=${this.petContainer.scale.x.toFixed(2)}`
      + (sp ? ` f=${sp.currentFrame}/${sp.textures.length} a=${sp.alpha} v=${sp.visible}` : ' no-sprite');
  }

  /** 境界光环: 炼气(白微光)→筑基(青环)→结丹(金核)→元婴(紫晕)→化神+(橙辉) */
  setRealm(level: number): void {
    // 状态每秒推送多次，境界没变就不重建光环（反复销毁 Graphics 会让渲染进程不稳定）
    if (this.realmLevel === level) return;
    this.realmLevel = level;
    const tiers = [
      { max: 1,  color: 0xffffff, alpha: 0.10, r: 30 },
      { max: 4,  color: 0x4fd8ff, alpha: 0.15, r: 33 },
      { max: 7,  color: 0xffd54f, alpha: 0.19, r: 36 },
      { max: 10, color: 0xb388ff, alpha: 0.23, r: 39 },
      { max: 99, color: 0xff9e40, alpha: 0.27, r: 42 }
    ];
    const t = tiers.find(x => level <= x.max) || tiers[tiers.length - 1];
    if (this.realmAura) {
      this.petContainer.removeChild(this.realmAura);
      this.realmAura.destroy();
      this.realmAura = null;
    }
    const g = new Graphics();
    g.ellipse(0, -4, t.r, t.r * 0.6).fill({ color: t.color, alpha: t.alpha * 0.45 });
    g.ellipse(0, -4, t.r * 0.7, t.r * 0.42).fill({ color: t.color, alpha: t.alpha });
    this.realmAura = g;
    this.petContainer.addChildAt(g, 0);
  }

  /** 灵兽袋空间: 设定地面线并初始化游走 */
  setSpaceGround(y: number): void {
    this.groundY = y;
    this.baseX = this.container.x;
    this.container.y = y;
    this.wanderTargetX = this.baseX;
    // 地面线变了，家具需要重新贴地（否则会停在上一次的旧坐标）
    if (this.lastFurniture.length) this.setFurniture(this.lastFurniture);
  }

  /** 渲染家具（程序化像素物件，沿地面排开） */
  setFurniture(items: string[]): void {
    const list = (Array.isArray(items) && items.length ? items : ['futon']).filter(Boolean);
    this.lastFurniture = list;
    // 内容/尺寸/地面都没变就不重建：状态每秒推送多次，重建会造成闪烁并拖垮渲染进程
    const sig = list.join(',') + '|' + Math.round(this.app.screen.width) + '|' + Math.round(this.groundY);
    if (this.furnitureLayer && sig === this.furnitureSig) return;
    this.furnitureSig = sig;

    try {
      if (!this.furnitureLayer) {
        this.furnitureLayer = new Container();
        this.furnitureLayer.label = 'furniture';
        // 插到虚空背景之后、灵兽之前，确保家具可见且不遮挡灵兽
        const bgIdx = this.app.stage.children.findIndex((c: any) => c?.label === 'void-bg');
        this.app.stage.addChildAt(this.furnitureLayer, bgIdx >= 0 ? bgIdx + 1 : 0);
      }
      this.furnitureLayer.removeChildren().forEach((c: any) => c.destroy());

      const n = list.length;
      const span = Math.min(Math.max(this.app.screen.width - 100, 90), n * 96);
      const slot = span / Math.max(n, 1);
      const startX = (this.app.screen.width - span) / 2 + slot / 2;
      list.forEach((id, i) => {
        const g = this.buildFurniture(id);
        g.x = startX + i * slot;
        g.y = this.groundY + 22;
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.on('pointerdown', () => this.interactWith(g.x, id));
        this.furnitureLayer.addChild(g);
      });
      this.furnitureError = '';
      console.log(`[LingPet] 家具布置: ${list.join('/')} y=${Math.round(this.groundY + 22)}`);
    } catch (e: any) {
      this.furnitureError = String(e?.message || e);
      console.error('[LingPet] 家具渲染失败:', e);
    }
  }

  private buildFurniture(id: string): any {
    const g = new Graphics();
    const y0 = 0;
    // 地面投影：让家具即使配色接近背景也能被看见
    g.ellipse(0, y0, 26, 6).fill({ color: 0x000000, alpha: 0.3 });
    switch (id) {
      case 'futon':  g.ellipse(0, y0, 22, 8).fill(0x8d6e63).ellipse(0, y0 - 3, 18, 6).fill(0xa1887f); break;
      case 'desk':   g.rect(-20, y0 - 14, 40, 5).fill(0x795548).rect(-18, y0 - 9, 4, 12).fill(0x5d4037).rect(14, y0 - 9, 4, 12).fill(0x5d4037).rect(-6, y0 - 20, 12, 6).fill(0xd7ccc8); break;
      case 'lamp':   g.rect(-1, y0 - 22, 2, 22).fill(0x5d4037).ellipse(0, y0 - 26, 7, 8).fill(0xffd54f).ellipse(0, y0 - 26, 10, 11).fill({ color: 0xffd54f, alpha: 0.25 }); break;
      case 'bed':    g.rect(-24, y0 - 8, 48, 8).fill(0x90caf9).rect(-24, y0 - 14, 12, 6).fill(0xffffff).rect(-24, y0, 4, 4).fill(0x5d4037).rect(20, y0, 4, 4).fill(0x5d4037); break;
      case 'furnace': g.ellipse(0, y0 - 8, 14, 10).fill(0x8d6e63).rect(-3, y0 - 24, 6, 8).fill(0x6d4c41).ellipse(0, y0 - 2, 6, 4).fill(0xff8f00); break;
      case 'tree':   g.rect(-2, y0 - 16, 4, 16).fill(0x5d4037).ellipse(0, y0 - 24, 14, 10).fill(0x66bb6a).ellipse(-3, y0 - 26, 2.5, 2.5).fill(0xef5350).ellipse(5, y0 - 22, 2.5, 2.5).fill(0xef5350); break;
      default: g.rect(-8, y0 - 8, 16, 8).fill(0x9e9e9e);
    }
    return g;
  }

  /** 点击家具: 走过去并做对应动作 */
  interactWith(x: number, furnitureId: string): void {
    if (this.awayMode) return;
    const actMap: Record<string, string> = {
      futon: 'cultivate', desk: 'cultivate', lamp: 'happy',
      bed: 'sleep', furnace: 'eat', tree: 'look_around'
    };
    this.wanderTargetX = x;
    this.behavior = 'walk';
    this.interactAction = actMap[furnitureId] || 'happy';
  }

  /** 只翻转精灵，不翻转容器（否则名字/等级文字会镜像） */
  private applyFacing(): void {
    if (this.animatedSprite) {
      this.animatedSprite.scale.set(1.5 * this.facing, 1.5);
    }
  }

  private setWalkSpeed(on: boolean): void {
    if (this.animatedSprite) this.animatedSprite.animationSpeed = on ? 0.3 : 0.15;
  }

  /** 游走状态机: idle → 随机选点 walk → 到位停 */
  private updateWander(delta: number): void {
    if (this.awayMode || !this.groundY) return;
    if (this.currentAction !== 'idle' && this.currentAction !== 'breathe' && this.behavior !== 'walk') return;

    if (this.behavior === 'walk') {
      const dx = this.wanderTargetX - this.baseX;
      const step = 1.6 * delta;
      if (Math.abs(dx) <= step) {
        this.baseX = this.wanderTargetX;
        this.behavior = 'idle';
        this.setWalkSpeed(false);
        if (this.interactAction) {
          this.setAction(this.interactAction);
          this.interactAction = '';
          this.wanderWait = 240;
        } else {
          this.setAction('idle');
          this.wanderWait = 120 + Math.random() * 240;
        }
      } else {
        this.baseX += Math.sign(dx) * step;
        const dir = Math.sign(dx);
        if (dir !== this.facing) { this.facing = dir; this.applyFacing(); }
        // 走路复用 idle 帧并提速，绝不每帧 setAction（那会重置帧序 → 抖动）
        if (this.currentAction !== 'idle') this.setAction('idle');
        this.setWalkSpeed(true);
      }
    } else {
      this.wanderWait -= delta;
      if (this.wanderWait <= 0) {
        const margin = 40;
        this.wanderTargetX = margin + Math.random() * (this.app.screen.width - margin * 2);
        this.behavior = 'walk';
        this.interactAction = '';
      }
    }
  }

  /** 召唤外出: 灵兽化为光球向上飞走 */
  playSummonAway(onDone: () => void): void {
    this.awayMode = true;
    this.behavior = 'idle';
    const startY = this.container.y;
    let t = 0;
    const orb = new Graphics();
    orb.ellipse(0, 0, 14, 14).fill({ color: 0xfff6c8, alpha: 0.95 });
    orb.ellipse(0, 0, 22, 22).fill({ color: 0xffd54f, alpha: 0.35 });
    orb.x = this.container.x;
    orb.y = startY - 20;
    orb.alpha = 0;
    this.app.stage.addChild(orb);

    const anim = (tk: any) => {
      const d = typeof tk === 'number' ? tk : (tk?.deltaTime ?? 1);
      t += d;
      // 前 30 帧: 灵兽收缩淡出
      if (t < 30) {
        const k = 1 - t / 30;
        this.petContainer.alpha = Math.max(0, k);
        this.petContainer.scale.set(this.levelScale * k, this.levelScale * k);
      } else if (t === 30 || (t > 30 && orb.alpha === 0)) {
        this.container.visible = false;
        orb.alpha = 1;
      }
      // 光球上升
      if (t >= 30) {
        orb.y -= 2.2 * d;
        orb.scale.set(1 + Math.sin(t * 0.3) * 0.1);
        if (orb.y < -40) {
          this.app.ticker.remove(anim);
          orb.destroy();
          onDone();
        }
      }
    };
    this.app.ticker.add(anim);
  }

  /** 召回: 恢复显示 */
  restoreFromAway(): void {
    this.awayMode = false;
    this.container.visible = true;
    this.petContainer.alpha = 1;
    this.petContainer.scale.set(this.levelScale, this.levelScale);
    this.applyFacing();
    this.setAction('happy');
  }

  isAway(): boolean { return this.awayMode; }

  getRenderMode(): string {
    return this.useSpritesheet ? 'spritesheet' : 'fallback';
  }

  resize(): void {
    if (!this.groundY) {
      this.baseX = this.app.screen.width / 2;
      this.groundY = this.app.screen.height / 2 + 20;
    }
    this.container.x = this.baseX;
    this.container.y = this.groundY;
  }

  setPetType(type: string): void {
    if (!PET_TYPES.includes(type as any)) return;
    if (this.petType === type) return;
    this.petType = type;
    this.fallbackConfig = FALLBACK_CONFIGS[type];

    // 如果用了 spritesheet，需要重新加载
    if (this.animatedSprite) {
      this.petContainer.removeChild(this.animatedSprite);
      this.animatedSprite.destroy();
      this.animatedSprite = null;
      this.spritesheet = null;
    }
    if (this.fallbackBody) {
      this.petContainer.removeChild(this.fallbackBody);
      this.petContainer.removeChild(this.fallbackAura!);
      this.fallbackBody.destroy();
      this.fallbackAura!.destroy();
      this.fallbackBody = null;
      this.fallbackAura = null;
    }
    this.useSpritesheet = false;
    this.tryLoadSpritesheet();
  }

  setLevel(level: number): void {
    this.level = level;
    // 等级成长：体型随等级增大（1 级 0.85x → 15 级 ~1.4x，封顶）
    const scale = Math.min(1.4, 0.85 + level * 0.04);
    this.levelScale = scale;
    this.petContainer.scale.set(scale, scale);
    this.applyFacing();
  }

  setName(name: string): void {
    this.nameText.text = name;
  }

  setLevelDisplay(level: number): void {
    this.levelText.text = `Lv.${level}`;
  }

  /** 设置动作 */
  setAction(action: string): void {
    if (this.currentAction === action) return;
    this.currentAction = action;
    this.actionTimer = 0;

    // 切换帧动画
    if (this.useSpritesheet && this.animatedSprite && this.spritesheet) {
      const animName = ACTION_TO_ANIM[action];
      if (animName && this.spritesheet.animations[animName]) {
        const frames = this.spritesheet.animations[animName];
        this.animatedSprite.textures = frames;
        // 动作差异：happy/fight 快，sleep 慢，cultivate 中速
        const speedMap: Record<string, number> = {
          idle: 0.15, breathe: 0.2, cultivate: 0.12, eat: 0.18,
          happy: 0.2, fight: 0.35, sleep: 0.08, evolve: 0.1
        };
        this.animatedSprite.animationSpeed = speedMap[animName] ?? 0.15;
        this.animatedSprite.loop = (animName !== 'eat' && animName !== 'happy' && animName !== 'evolve');
        this.animatedSprite.gotoAndPlay(0);
      }
    }
  }

  private update(tickerOrDelta: any): void {
    // PixiJS v8 破坏性变更: ticker 回调参数是 Ticker 实例（v7 是 number delta）。
    // 直接 += 会得到 NaN → actionTimer 污染 → container.y=NaN → 宠物隐身。
    const delta = typeof tickerOrDelta === 'number'
      ? tickerOrDelta
      : (tickerOrDelta?.deltaTime ?? 0);
    this.actionTimer += delta;

    // 容器位置/旋转动画（浮动/摇晃/抖动）
    this.updateContainerAnimation(delta);
    this.updateWander(delta);

    // 粒子发射 + 更新
    this.emitParticles();
    this.updateParticles(delta);

    // 程序化 fallback 绘制
    if (!this.useSpritesheet) this.drawFallback();
  }

  // ===== 粒子系统 =====

  private emitParticles(): void {
    const t = this.actionTimer;
    switch (this.currentAction) {
      case 'sleep':
        // 每 ~50 tick 冒一个 Z
        if (t % 50 < 1) this.spawnTextParticle('Z', 0x90caf9, 18, -0.3, -0.8, 10, -40);
        break;
      case 'happy':
        if (t % 12 < 1) this.spawnHeartParticle();
        break;
      case 'cultivate':
        // 灵气光点上浮
        if (t % 8 < 1) {
          this.spawnDotParticle(this.fallbackConfig.auraColor,
            (Math.random() - 0.5) * 30, 20, (Math.random() - 0.5) * 0.3, -0.7 - Math.random() * 0.5);
        }
        break;
      case 'evolve':
        if (t % 4 < 1) {
          this.spawnDotParticle(0xffd700,
            (Math.random() - 0.5) * 50, 10, (Math.random() - 0.5) * 0.6, -1 - Math.random());
        }
        break;
      case 'panic':
        if (t % 20 < 1) this.spawnTextParticle('💦', 0x4fc3f7, 14, 0.5, -1, 14, -34);
        break;
      case 'eat':
        if (t % 15 < 1) {
          this.spawnDotParticle(0xffb74d, (Math.random() - 0.5) * 12, -10, (Math.random() - 0.5) * 0.4, 0.5);
        }
        break;
    }
  }

  private spawnTextParticle(char: string, color: number, size: number, vx: number, vy: number, ox: number, oy: number): void {
    const style = new TextStyle({ fontSize: size, fill: color, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 2 });
    const t = new Text({ text: char, style });
    t.anchor.set(0.5);
    t.x = ox; t.y = oy;
    this.particleContainer.addChild(t);
    this.particles.push({ obj: t, vx, vy, life: 0, maxLife: 90, gravity: -0.005, spin: 0.01 });
  }

  private spawnHeartParticle(): void {
    const g = new Graphics();
    // 手绘小爱心：两圆 + 三角
    const c = 0xff6b81;
    g.circle(-3, -2, 4).fill({ color: c });
    g.circle(3, -2, 4).fill({ color: c });
    g.moveTo(-6.5, 0).lineTo(0, 8).lineTo(6.5, 0).closePath().fill({ color: c });
    g.x = (Math.random() - 0.5) * 30;
    g.y = -30;
    this.particleContainer.addChild(g);
    this.particles.push({
      obj: g, vx: (Math.random() - 0.5) * 0.5, vy: -0.8 - Math.random() * 0.6,
      life: 0, maxLife: 70, gravity: -0.008, spin: 0.02
    });
  }

  private spawnDotParticle(color: number, x: number, y: number, vx: number, vy: number): void {
    const g = new Graphics();
    g.circle(0, 0, 2 + Math.random() * 2).fill({ color, alpha: 0.9 });
    g.circle(0, 0, 1).fill({ color: 0xffffff, alpha: 0.9 });
    g.x = x; g.y = y;
    this.particleContainer.addChild(g);
    this.particles.push({ obj: g, vx, vy, life: 0, maxLife: 60, gravity: 0, spin: 0 });
  }

  private updateParticles(delta: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += delta;
      p.obj.x += p.vx * delta;
      p.obj.y += p.vy * delta;
      p.vy += p.gravity * delta;
      p.obj.rotation += p.spin * delta;
      // 淡出
      const ratio = p.life / p.maxLife;
      p.obj.alpha = ratio < 0.7 ? 1 : 1 - (ratio - 0.7) / 0.3;
      if (p.life >= p.maxLife) {
        this.particleContainer.removeChild(p.obj);
        p.obj.destroy();
        this.particles.splice(i, 1);
      }
    }
  }

  private updateContainerAnimation(_delta: number): void {
    const t = this.actionTimer;
    let bobX = 0, bobY = 0, rot = 0;
    switch (this.currentAction) {
      case 'happy':
        bobY = -Math.abs(Math.sin(t * 0.2)) * 25;
        break;
      case 'panic':
        bobX = Math.sin(t * 0.5) * 40;
        break;
      case 'fight':
        // 仅战斗时轻微抖动；走路不再使用 fight，避免随机位移打架
        if (this.behavior !== 'walk') bobX = (Math.random() - 0.5) * 3;
        break;
      case 'evolve':
        if (this.animatedSprite) {
          this.animatedSprite.scale.set(1.5 * this.facing * (1 + Math.sin(t * 0.1) * 0.3), 1.5);
          this.animatedSprite.rotation = t * 0.05;
        }
        if (this.actionTimer > 120) {
          if (this.animatedSprite) { this.animatedSprite.scale.set(1.5 * this.facing, 1.5); this.animatedSprite.rotation = 0; }
          this.setAction('idle');
        }
        break;
      case 'sleep':
        rot = Math.sin(t * 0.02) * 0.08;
        break;
      case 'eat':
      case 'cultivate':
        bobY = Math.sin(t * 0.1) * 3;
        break;
      default:
        bobY = Math.sin(t * 0.05) * 4;
    }
    this.bobX = bobX;
    this.bobY = bobY;
    // 唯一写坐标的地方: baseX/groundY + 动画偏移
    this.container.x = this.baseX + bobX;
    this.container.y = this.groundY + bobY;
    this.container.rotation = rot;
  }

  private drawFallback(): void {
    const body = this.fallbackBody;
    const aura = this.fallbackAura;
    if (!body || !aura) return;
    body.clear(); aura.clear();

    const cfg = this.fallbackConfig;
    const size = 30 + this.level * 4;

    if (this.level >= 5) {
      const pulse = 0.5 + Math.sin(this.actionTimer * 0.08) * 0.3;
      aura.circle(0, 0, size + 10);
      aura.fill({ color: cfg.auraColor, alpha: 0.15 * pulse });
    }

    // 通用：身体/头/眼睛
    body.ellipse(0, 10, size * 0.6, size * 0.7);
    body.fill({ color: cfg.bodyColor });
    body.ellipse(0, 14, size * 0.3, size * 0.4);
    body.fill({ color: cfg.accentColor });
    body.circle(0, -size * 0.35, size * 0.5);
    body.fill({ color: cfg.bodyColor });
    body.circle(-size * 0.18, -size * 0.48, size * 0.08);
    body.fill({ color: cfg.eyeColor });
    body.circle(size * 0.18, -size * 0.48, size * 0.08);
    body.fill({ color: cfg.eyeColor });
  }

  destroy(): void {
    this.app.ticker.remove(this.update, this);
    for (const p of this.particles) p.obj.destroy();
    this.particles = [];
    this.container.destroy();
  }
}
