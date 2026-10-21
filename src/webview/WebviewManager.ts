// Webview 管理器 - 统一处理 Activity Bar WebviewView + 浮动 WebviewPanel
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class WebviewManager {
  private view: vscode.WebviewView | null = null;       // Activity Bar view
  private panel: vscode.WebviewPanel | null = null;      // 浮动 panel
  private messageHandler?: (msg: any) => void;

  constructor(private context: vscode.ExtensionContext) {}

  // ===== WebviewViewProvider 实现 =====

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    this.configureWebview(webviewView.webview);
    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.attachMessageHandler(webviewView.webview);

    webviewView.onDidDispose(() => {
      this.view = null;
    });

    // 激活时推一次最新状态
    setTimeout(() => this.notifyState(), 100);
  }

  // ===== 浮动 Panel 命令 =====

  showAsPanel(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'lingpet',
      '修仙灵兽',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.getWebviewRoot(), this.getResourcesRoot()]
      }
    );

    this.configureWebview(this.panel.webview);
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.attachMessageHandler(this.panel.webview);

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    setTimeout(() => this.notifyState(), 100);
  }

  // ===== 公共工具 =====

  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.getWebviewRoot(), this.getResourcesRoot()]
    };
  }

  private getWebviewRoot(): vscode.Uri {
    return vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview'));
  }

  private getResourcesRoot(): vscode.Uri {
    return vscode.Uri.file(path.join(this.context.extensionPath, 'resources'));
  }

  private attachMessageHandler(webview: vscode.Webview): void {
    webview.onDidReceiveMessage((msg) => {
      this.messageHandler?.(msg);
    });
  }

  /** 设置统一的消息处理回调 */
  setMessageHandler(handler: (msg: any) => void): void {
    this.messageHandler = handler;
  }

  /** 统一的 postMessage：发给所有活跃 webview */
  postMessage(message: any): void {
    this.view?.webview.postMessage(message);
    this.panel?.webview.postMessage(message);
  }

  /** 通知外部推状态 */
  private notifyState(): void {
    this.messageHandler?.({ type: '__webviewReady' });
  }

  /** 判断是否有活跃的 webview */
  isAnyActive(): boolean {
    return this.view !== null || this.panel !== null;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
    this.view = null;
  }

  // ===== HTML 生成 =====

  private getHtml(webview: vscode.Webview): string {
    const distRoot = this.getWebviewRoot();
    const resourcesRoot = this.getResourcesRoot();
    const distUri = webview.asWebviewUri(distRoot);
    const resourcesUri = webview.asWebviewUri(resourcesRoot);

    const indexPath = path.join(this.context.extensionPath, 'dist', 'webview', 'index.html');
    let html: string;
    try {
      html = fs.readFileSync(indexPath, 'utf-8');
    } catch {
      html = this.getFallbackHtml();
    }

    // 关键替换：把占位符替换为完整 webview URI
    html = html.replace(/(src|href)="\/assets\//g, `$1="${distUri.toString()}/assets/`);
    html = html.replace(/{{CSP_SOURCE}}/g, webview.cspSource);
    html = html.replace(/{{RESOURCES_URI}}/g, resourcesUri.toString());

    // 注入全局资源 URI，让 main.ts 可以读取
    html = html.replace(
      '</head>',
      `<script>window.__LINGPET_RESOURCES__='${resourcesUri.toString()}';</script>\n</head>`
    );

    // 确保 CSP 允许 pixi.js workers 等
    html = html.replace(
      /(script-src 'unsafe-inline' \{\{CSP_SOURCE\}\};)/g,
      `$1 blob: 'unsafe-eval';`
    );

    // 如果 CSP 里还没 blob:，补上（esbuild 内联后 CSP 占位符可能没被正确识别）
    if (!html.includes('blob:') && html.includes('script-src')) {
      html = html.replace(
        /script-src [^;]+;/,
        (m) => m.replace(';', " blob: 'unsafe-eval';")
      );
    }

    return html;
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>LingPet</title></head>
<body style="padding:20px;font-family:sans-serif;">
  <h2>🐾 修仙灵兽</h2>
  <p style="color:#888;">Webview 资源未找到。请确保已执行 <code>npm run build</code> 并重新加载扩展。</p>
  <button onclick="acquireVsCodeApi().postMessage({type:'requestState'})">重新请求状态</button>
</body>
</html>`;
  }
}
