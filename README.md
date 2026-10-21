# 修仙灵兽 LingPet

> 一只住在 TRAE / VS Code 里的修仙灵兽：跟着你的 AI 积分消耗修炼进阶，还能化作光团降临桌面陪你写代码。

当前版本：**v0.3.1**（纯插件形态，无 Electron 依赖）

---

## 一、它能做什么

### 1. 灵兽袋空间（编辑器内）
Activity Bar 里的「修仙灵兽」视图就是灵兽袋：

- **序列帧灵兽**：PixiJS 渲染的 16 帧精灵动画，三种灵兽各有独立造型（啼魂 / 墨蛟 / 六翼霜蜈）
- **虚空背景**：旋转气旋 + 漂浮灵尘，随境界变化的光环配色
- **自由游走**：灵兽在地面线上来回走动、停留、发呆，头部上下浮动
- **家具布置**：桌椅床灯丹炉灵果树，用灵石购买后常驻空间，灵兽会走过去互动
- **召唤 / 召回**：点「召唤桌面」后灵兽收缩成一枚金色光球向上飞出灵兽袋

### 2. 桌面灵兽（独立进程）
召唤后由 Python（tkinter）拉起一个透明置顶窗口，不占用编辑器空间：

- **登场动画**：10 个光点螺旋汇聚 → 白光迸发 → 灵兽由小变大
- **自由游走 / 为我护法**：右键菜单可切换，护法状态下原地不动
- **互动**：左键抚摸、右键喂食 / 打坐 / 退出
- **状态同步**：与扩展共享等级、灵兽种类、境界光环
- 纯标准库实现，无需额外安装依赖（依赖系统 Python）

### 3. 成长与数值
- **境界**：炼气 → 筑基 → 结丹 → 元婴 → 化神 → 炼虚 → 合体 → 大乘 → 真仙 → 金仙 → 太乙 → 大罗 → 道祖，每级分初 / 中 / 上三阶
- **升级曲线**：`1-4 级 = 40 × lv^1.3`（快速上手），`5 级起 = 100 × lv^1.8`（长期养成）
- **破境门槛**：升到 5 级后，除灵气外还需 TRAE 累计积分消耗达标（5→30、8→260、11→900、15→3200 …）
- **破境丹**：每级突破需对应丹药，由灵石购买 / 炼丹获得

### 4. 真实积分接入
- 直接调用 TRAE 积分接口：`POST https://api.trae.com.cn/trae/api/v1/pay/ide_user_ent_usage`
- 启动时自动扫描 TRAE 日志捕获 JWT（`Authorization: Cloud-IDE-JWT <token>`），无需手工复制
- Token 以 AES-256-GCM 加密落盘，不保存明文
- 每 5 分钟轮询一次：积分消耗 → 灵气（`消耗 × 2 × 功法加成`）与灵石（`消耗 / 10`，单轮上限 200）

### 5. 其他系统
商店、炼丹、日常任务、成就、签到、好感度、系统资源监控、VS Code 任务监控、定时历练、股市行情。

---

## 二、界面速览

| 区域 | 元素 |
|------|------|
| 顶部状态栏 | 灵兽名 · 境界 · 等级 · 灵石 · 好感 |
| 灵气条 | 当前灵气 / 升级所需 |
| 中部画布 | 虚空气旋、地面线、家具、游走中的灵兽 |
| 空间工具栏（整行三等分） | 🪑 家具布置 / 🌟 召唤桌面 / 🌙 召回袋中 |
| 底部操作栏 | 🍖 喂食 · 🖐️ 摸头 · 🛒 商店 · 📜 任务 · 🏆 成就 · 📅 签到 |
| 诊断徽标 | 渲染模式、画布尺寸、坐标、帧号、家具数量、渲染异常原因 |

家具价目：蒲团 0（自带）、木桌 200、灵灯 300、云床 500、丹炉 800、灵果树 1000 灵石。

---

## 三、安装

```bash
npm install
npm run build
npx vsce package --no-dependencies
```

然后在 TRAE / VS Code 中：`Ctrl+Shift+P` → `Extensions: Install from VSIX...` → 选择生成的 `lingpet-xiuxian-0.3.1.vsix`。

首次启动会自动尝试抓取 TRAE 凭证；若未成功，可执行命令 `LingPet: 设置 TRAE JWT Token` 手动填入，或把 Token 写到 `~/.lingpet/trae-token.txt`（读取后自动删除）。

---

## 四、命令

| 命令 | 说明 |
|------|------|
| `LingPet: 召唤灵兽` | 打开灵兽袋面板 |
| `LingPet: 召唤桌面灵兽` | 在桌面拉起独立灵宠 |
| `LingPet: 收回桌面灵兽` | 关闭桌面灵宠 |
| `LingPet: 主动打坐` | 立即获得 20 灵气 |
| `LingPet: 炼丹` | 消耗 20 灵石炼制丹药 |
| `LingPet: 灵石商店` / `查看成就` / `日常任务` | 对应面板 |
| `LingPet: 喂食灵兽` | 投喂灵果 |
| `LingPet: 设置 TRAE JWT Token` | 手动配置凭证 |
| `LingPet: 查询 TRAE 真实积分消耗` | 立即拉取一次积分 |
| `LingPet: 查看灵气采集统计` | 编辑器行为统计 |
| `LingPet: 切换 Chat 自动弹出` | 是否跟随 TRAE Chat 自动开面板 |

## 五、配置项

| 配置 | 默认 | 说明 |
|------|------|------|
| `lingpet.petType` | `tihun` | 灵兽种类：tihun / mojiao / liuyi |
| `lingpet.autoShowOnChat` | `true` | TRAE Chat 激活时自动弹出面板 |
| `lingpet.creditsPollInterval` | `5` | 真实积分轮询间隔（分钟） |
| `lingpet.usagePollInterval` | `10` | 打坐灵气增长间隔（分钟） |
| `lingpet.systemMonitorEnabled` | `true` | CPU / 内存监控 |
| `lingpet.cpuAlertThreshold` / `memoryAlertThreshold` | `90` | 告警阈值（%） |
| `lingpet.stockEnabled` / `stockSymbols` | `false` / `[]` | 股市行情订阅 |

---

## 六、目录结构

```
src/
├── extension.ts              # 扩展入口：命令、消息路由、积分同步、召唤桌面灵兽
├── types.ts                  # 共享类型、境界映射
├── core/
│   ├── PetState.ts           # 状态、升级曲线、积分门槛、持久化广播
│   ├── Economy.ts            # 商店、炼丹、功法加成
│   ├── Furniture.ts          # 家具目录（前后端共用）
│   ├── AchievementSystem.ts  # 成就判定与发奖
│   ├── QuestSystem.ts        # 日常任务
│   └── Storage.ts            # globalState 封装
├── monitors/
│   ├── TraeCreditsMonitor.ts # TRAE 积分接口、JWT 加密存储、自动扫描
│   ├── TraeUsageMonitor.ts   # 编辑器行为采集
│   ├── SystemMonitor.ts      # CPU / 内存
│   ├── TaskMonitor.ts        # 构建 / 测试任务
│   └── ScheduleManager.ts    # 定时历练
├── services/StockService.ts  # 股市行情
└── webview/
    ├── WebviewManager.ts     # 视图 / 面板、HTML 注入、消息通道
    ├── renderer/index.html   # 面板 DOM、CSP、工具栏（内联脚本解耦交互）
    ├── renderer/main.ts      # PixiJS 初始化、虚空背景、状态同步
    └── renderer/PetSprite.ts # 精灵动画、游走状态机、家具、召唤飞升

resources/
├── sprites/                  # 三种灵兽的 4×4 atlas + 16 帧 PNG
├── desktop-pet/desktop_pet.py# 桌面灵兽（tkinter，透明置顶）
└── icons/paw.svg
```

## 七、开发

```bash
npm run lint           # tsc --noEmit
npm run build          # 扩展 + webview 打包
npm run watch          # 监听扩展
npm run watch:webview  # 监听 webview
node scripts/generate-sprites.mjs   # 重新生成序列帧精灵图
```

---

## 八、实现要点（踩过的坑）

1. **PixiJS v8 三处破坏性变更**：`new Spritesheet({ texture, data })` 单参构造；Ticker 回调参数是 Ticker 实例（用 `deltaTime`，直接当数字相加会得到 `NaN` 导致灵兽隐身）；`app.init()` 必须传 `resizeTo: window`，否则默认 800×600 会把灵兽画到面板外。
2. **CSP**：PixiJS 启动自检会执行 `new Function`，`script-src` 必须包含 `'unsafe-eval' 'wasm-unsafe-eval'`；资源域需同时出现在 `img-src` / `style-src` / `script-src` / `connect-src`。
3. **esbuild 单文件打包**：`String.replace` 必须使用函数形式 `() => replacement`，否则 PixiJS 源码里的 `$&` 会被当成替换模式，把 bundle 写坏。
4. **交互与画布分层**：canvas 固定 `z-index:0`，工具栏 9000、遮罩 8000、商店 9500；工具栏逻辑放在纯内联脚本（`window.__lpUI`）中，不依赖 2.6MB 打包产物，避免按钮被画布接管或事件绑定失效。
5. **状态广播防重入**：成就发奖会再次触发状态广播，曾形成 `notify → checkAndUnlock → addSpiritStones → notify` 的无限递归，最终栈溢出打挂扩展主机。现在 `notify()` 重入只标记 pending、最多补发 5 轮，且成就先标记后发奖。
6. **坐标单一权威**：游走只写 `baseX / groundY`，动画只写 `bobX / bobY` 偏移，避免两套坐标互抢造成疯狂抖动。
7. **家具重建节流**：仅当「清单 / 面板宽度 / 地面线」变化时才重建家具层，避免高频率状态推送造成闪烁与渲染进程不稳。

## 九、已知限制

- 桌面灵兽依赖系统 Python（`pythonw` / `python`），未安装时召唤会失败并写入 `~/.lingpet/desktop-pet.log`
- 积分接口依赖已登录的 TRAE 客户端凭证，凭证过期后需重新捕获
- 积分结算为延迟结算，单轮可能为 0，需多次轮询累计

## 十、许可

MIT，详见 [LICENSE](./LICENSE)。
