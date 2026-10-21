// 股市行情服务 - 默认使用新浪财经免费接口
import * as vscode from 'vscode';

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;       // 涨跌额
  changePercent: number; // 涨跌幅 %
  open: number;
  high: number;
  low: number;
  volume: number;
}

export class StockService {
  private timer: NodeJS.Timeout | null = null;
  private onQuote?: (quotes: StockQuote[]) => void;

  setOnQuote(cb: (quotes: StockQuote[]) => void): void {
    this.onQuote = cb;
  }

  getSymbols(): string[] {
    return vscode.workspace.getConfiguration('lingpet').get<string[]>('stockSymbols', []);
  }

  isEnabled(): boolean {
    return vscode.workspace.getConfiguration('lingpet').get<boolean>('stockEnabled', false);
  }

  /** 获取行情 - 新浪财经接口: https://hq.sinajs.cn/list=sh600519,sz000001 */
  async fetchQuotes(): Promise<StockQuote[]> {
    const symbols = this.getSymbols();
    if (symbols.length === 0) return [];

    const url = `https://hq.sinajs.cn/list=${symbols.join(',')}`;
    try {
      const resp = await fetch(url, {
        headers: { 'Referer': 'https://finance.sina.com.cn' }
      });
      if (!resp.ok) return [];
      const text = await resp.text();
      return this.parseSinaResponse(text);
    } catch {
      return [];
    }
  }

  private parseSinaResponse(text: string): StockQuote[] {
    const quotes: StockQuote[] = [];
    // 新浪返回格式: var hq_str_sh600519="贵州茅台,1680.00,...";
    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/var hq_str_(\w+)="([^"]*)"/);
      if (!match) continue;
      const symbol = match[1];
      const fields = match[2].split(',');
      if (fields.length < 10) continue;

      const name = fields[0];
      const open = parseFloat(fields[1]);
      const prevClose = parseFloat(fields[2]);
      const price = parseFloat(fields[3]);
      const high = parseFloat(fields[4]);
      const low = parseFloat(fields[5]);
      const volume = parseFloat(fields[8]);

      const change = price - prevClose;
      const changePercent = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;

      quotes.push({
        symbol,
        name,
        price,
        change,
        changePercent,
        open,
        high,
        low,
        volume
      });
    }
    return quotes;
  }

  start(intervalMinutes: number = 30): void {
    if (!this.isEnabled()) return;
    this.fetchQuotes().then(q => this.onQuote?.(q));
    this.timer = setInterval(() => {
      this.fetchQuotes().then(q => this.onQuote?.(q));
    }, intervalMinutes * 60 * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
