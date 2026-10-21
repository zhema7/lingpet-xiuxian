/**
 * TRAE 真实积分 API 监控
 * ✅ 2026-10-20 实测验证:
 *   POST https://api.trae.com.cn/trae/api/v1/pay/ide_user_ent_usage → 200
 *   Header: Authorization: Cloud-IDE-JWT <token>
 *   Body: { require_usage: true, req_source: 'IDE' }
 *   响应: user_entitlement_pack_list[].entitlement_base_info.product_extra
 *         .subscription_extra.quota.credits_limit = 额度
 *         usage.premium_model_fast_amount 等 = 各模型消耗（闪结模式延迟结算）
 */
import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface EntitlementPack {
  display_desc?: string;
  entitlement_base_info?: {
    product_type?: string;
    charge_amount?: number;
    entitlement_id?: string;
    quota?: {
      credits_limit?: number;
      basic_usage_limit?: number;
      no_bonus_quota?: boolean;
    };
    product_extra?: {
      package_extra?: {
        package_source_type?: number;
      };
      subscription_extra?: {
        quota?: {
          credits_limit?: number;
        };
      };
    };
  };
  usage?: {
    credits_amount?: number;              // v2 字段（累计消耗积分数）
    basic_usage?: number;
    is_flash_consuming?: boolean;         // 闪结模式: 消耗延迟结算
    // v1 字段: 各模型消耗积分数（amount）/ 请求次数（usage）
    premium_model_fast_amount?: number;
    premium_model_slow_amount?: number;
    basic_usage_amount?: number;
    bonus_usage_amount?: number;
    auto_completion_amount?: number;
    advanced_model_amount?: number;
  };
  status?: string;
  expire_time?: number;
}

export interface CreditsUsage {
  packList: EntitlementPack[];
  isDollarUsageBilling: boolean;
  totalCreditsAmount: number;   // 累计消耗（v1: 各模型 amount 汇总 + v2 credits_amount）
  quotaCredits: number;         // 权益总额度
  remainingCredits: number;     // 剩余额度
  basicQuota: number;
  basicUsage: number;
  basicRemaining: number;
  fetchedAt: number;
}

// 实测: v1 接口挂 api.trae.com.cn / www.trae.com.cn；
// mchost.guru 仅承载 /api/v1/commercial/*（会话级）；v2 路径已下线（404 TLB）。
const API_HOST_CANDIDATES = [
  'https://api.trae.com.cn',
  'https://www.trae.com.cn'
];
const API_PATHS = [
  '/trae/api/v1/pay/ide_user_ent_usage',
  '/trae/api/v2/pay/ide_user_ent_usage'  // 旧版兜底
];

const USER_AGENT = 'Trae-IDE/3.4.4';

export class TraeCreditsMonitor {
  private token: string | null = null;
  private configuredBaseUrl: string | null = null;
  private baseUrl: string = API_HOST_CANDIDATES[0];
  private pollTimer: NodeJS.Timeout | null = null;
  private lastCreditsAmount: number = 0;
  private hasBaseline: boolean = false;
  private onCreditsDelta?: (consumedCredits: number, info: CreditsUsage) => void;

  // 加密存储 token 的 key（固定 key，salt 用 user-specific 字符串）
  private static readonly TOKEN_KEY = 'lingpet.traeTokenEncrypted';
  private static readonly BASE_URL_KEY = 'lingpet.traeApiBaseUrl';

  constructor(private context: vscode.ExtensionContext) {
    this.loadConfig();
  }

  private loadConfig(): void {
    // 加载 base URL
    const savedBase = this.context.globalState.get<string>(TraeCreditsMonitor.BASE_URL_KEY);
    if (savedBase) this.configuredBaseUrl = savedBase;

    // 加载 token（加密存储）
    const enc = this.context.globalState.get<string>(TraeCreditsMonitor.TOKEN_KEY);
    if (enc) {
      try {
        this.token = this.decryptToken(enc);
      } catch {
        this.token = null;
      }
    }

    // 文件导入兜底：~/.lingpet/trae-token.txt（供自动配置写入，导入后删除）
    if (!this.token) this.importTokenFromFile();
  }

  private importTokenFromFile(): void {
    try {
      const tokenFile = path.join(os.homedir(), '.lingpet', 'trae-token.txt');
      if (!fs.existsSync(tokenFile)) return;
      const raw = fs.readFileSync(tokenFile, 'utf-8').trim();
      if (!raw) return;
      let clean = raw;
      const m = clean.match(/^Cloud-IDE-JWT\s+(.+)$/i);
      if (m && m[1]) clean = m[1];
      this.token = clean;
      const enc = this.encryptToken(clean);
      this.context.globalState.update(TraeCreditsMonitor.TOKEN_KEY, enc).then(() => {
        fs.unlink(tokenFile, () => { /* 导入后删除明文 */ });
        console.log('[LingPet] 已从文件导入 TRAE Token');
      });
    } catch (e) {
      console.warn('[LingPet] 文件导入 token 失败:', e);
    }
  }

  /** 用户设置 token */
  async setToken(token: string): Promise<void> {
    // 清理格式：用户可能粘贴了完整 "Cloud-IDE-JWT xxx"
    let clean = token.trim();
    const m = clean.match(/^Cloud-IDE-JWT\s+(.+)$/i);
    if (m && m[1]) clean = m[1];
    if (clean.startsWith('Bearer ')) clean = clean.slice(7);

    this.token = clean;
    const enc = this.encryptToken(clean);
    await this.context.globalState.update(TraeCreditsMonitor.TOKEN_KEY, enc);

    // 验证一下能不能用
    try {
      const usage = await this.fetchCreditsUsage();
      vscode.window.showInformationMessage(
        `🐾 灵兽连接成功！额度 ${usage.quotaCredits} 积分，已消耗 ${usage.totalCreditsAmount}，剩余 ${usage.remainingCredits}`
      );
    } catch (e: any) {
      vscode.window.showWarningMessage(`🐾 Token 可能无效: ${e?.message ?? e}`);
    }
  }

  /** 用户设置 base URL（可选） */
  async setBaseUrl(url: string): Promise<void> {
    this.configuredBaseUrl = url.trim().replace(/\/+$/, '');
    this.baseUrl = this.configuredBaseUrl;
    await this.context.globalState.update(TraeCreditsMonitor.BASE_URL_KEY, this.configuredBaseUrl);
  }

  hasToken(): boolean { return !!this.token; }

  setOnCreditsDelta(cb: (consumedCredits: number, info: CreditsUsage) => void): void {
    this.onCreditsDelta = cb;
  }

  /** 启动定期轮询（默认每 5 分钟） */
  start(pollIntervalMin: number = 5): void {
    if (!this.token) {
      vscode.window.showInformationMessage(
        '🐾 未配置 TRAE Token，灵兽改用本地灵气采集模式。' +
        '配置方式: 命令面板执行「LingPet: 设置 TRAE JWT Token」'
      );
      return;
    }
    this.stop();
    const interval = pollIntervalMin * 60 * 1000;
    // 立即试一次
    this.pollOnce().catch(() => {});
    this.pollTimer = setInterval(() => this.pollOnce().catch(() => {}), interval);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 手动触发一次查询 */
  async pollOnce(): Promise<CreditsUsage | null> {
    if (!this.token) return null;
    try {
      const usage = await this.fetchCreditsUsage();

      // 计算本次消耗（累计值差值；首轮只建立基线不触发）
      const currentTotal = usage.totalCreditsAmount;
      const delta = currentTotal - this.lastCreditsAmount;
      if (this.hasBaseline && delta > 0) {
        this.onCreditsDelta?.(delta, usage);
      }
      this.lastCreditsAmount = currentTotal;
      this.hasBaseline = true;
      return usage;
    } catch (e) {
      console.warn('[LingPet] TRAE credits poll failed:', e);
      return null;
    }
  }

  /** 实际调 API（host × path 组合轮询，成功即记住） */
  async fetchCreditsUsage(): Promise<CreditsUsage> {
    const hosts = this.configuredBaseUrl ? [this.configuredBaseUrl] : API_HOST_CANDIDATES;
    const body = { require_usage: true, req_source: 'IDE' };

    let lastErr: Error | null = null;
    for (const base of hosts) {
      for (const apiPath of API_PATHS) {
        try {
          const result = await this.postJson(`${base}${apiPath}`, body);

          const packs: EntitlementPack[] = result.user_entitlement_pack_list || [];
          const isDollar = !!result.is_dollar_usage_billing;

          // 汇总: v1 = 各模型消耗 amount 之和; v2 = credits_amount
          let totalCredits = 0, quotaCredits = 0, basicQuota = 0, basicUsage = 0;
          for (const p of packs) {
            const u = p.usage || {};
            totalCredits +=
              (u.credits_amount ?? 0) +
              (u.premium_model_fast_amount ?? 0) +
              (u.premium_model_slow_amount ?? 0) +
              (u.basic_usage_amount ?? 0) +
              (u.bonus_usage_amount ?? 0) +
              (u.auto_completion_amount ?? 0) +
              (u.advanced_model_amount ?? 0);
            basicUsage += u.basic_usage ?? 0;
            const bi = p.entitlement_base_info || {};
            quotaCredits +=
              bi.quota?.credits_limit ??
              bi.product_extra?.subscription_extra?.quota?.credits_limit ?? 0;
            basicQuota += bi.quota?.basic_usage_limit ?? 0;
          }

          const usage: CreditsUsage = {
            packList: packs,
            isDollarUsageBilling: isDollar,
            totalCreditsAmount: totalCredits,
            quotaCredits,
            remainingCredits: Math.max(0, quotaCredits - totalCredits),
            basicQuota, basicUsage,
            basicRemaining: Math.max(0, basicQuota - basicUsage),
            fetchedAt: Date.now()
          };

          // 成功的 host/path 记住，下次优先
          if (!this.configuredBaseUrl) this.baseUrl = base;
          return usage;
        } catch (e: any) {
          lastErr = e;
        }
      }
    }
    throw lastErr ?? new Error('所有 API 端点均不可用');
  }

  // ===== HTTP 工具 =====
  private postJson(url: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const bodyStr = JSON.stringify(body);
      const lib = u.protocol === 'https:' ? https : http;

      const req = lib.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          'Authorization': `Cloud-IDE-JWT ${this.token}`,
          'User-Agent': USER_AGENT,
          'Origin': 'https://www.trae.com.cn',
          'Referer': 'https://www.trae.com.cn/'
        },
        timeout: 15000
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`JSON 解析失败: ${data.slice(0,100)}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.write(bodyStr);
      req.end();
    });
  }

  // ===== Token 加解密（AES-256-GCM，密钥用机器信息 + salt 派生）=====
  private encryptToken(plain: string): string {
    const salt = Buffer.from('lingpet-trae-salt-v1', 'utf-8');
    const info = (this.context.globalState.get<string>('machineId') || 'default-machine');
    const key = crypto.pbkdf2Sync(info, salt, 10000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  private decryptToken(encB64: string): string {
    const buf = Buffer.from(encB64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const salt = Buffer.from('lingpet-trae-salt-v1', 'utf-8');
    const info = (this.context.globalState.get<string>('machineId') || 'default-machine');
    const key = crypto.pbkdf2Sync(info, salt, 10000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf-8');
  }
}
