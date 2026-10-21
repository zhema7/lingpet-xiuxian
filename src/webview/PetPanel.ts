// Webview 面板管理 - 负责创建面板、消息通信
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtToWebviewMessage, WebviewToExtMessage } from './messageProtocol';

export class PetPanel {
  private panel: vscode.WebviewPanel | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) {}

  show(): void {
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
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview')),
          vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
        ]
      }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.disposables.forEach(d => d.dispose());
      this.disposables = [];
    }, null, this.disposables);
  }

  isVisible(): boolean {
    return this.panel?.visible ?? false;
  }

  /** 发送消息到 Webview */
  postMessage(message: ExtToWebviewMessage): void {
    if (this.panel) {
      this.panel.webview.postMessage(message);
    }
  }

  /** 监听来自 Webview 的消息 */
  onMessage(callback: (msg: WebviewToExtMessage) => void): void {
    if (this.panel) {
      this.panel.webview.onDidReceiveMessage(callback, null, this.disposables);
    }
  }

  private getHtml(): string {
    const webview = this.panel!.webview;
    const webviewDist = vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview'));
    const resourcesUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'resources')));

    // 读取打包后的 webview 文件
    const indexPath = path.join(this.context.extensionPath, 'dist', 'webview', 'index.html');
    let html: string;
    try {
      html = fs.readFileSync(indexPath, 'utf-8');
    } catch {
      // 开发模式 fallback
      html = this.getFallbackHtml();
    }

    // 替换资源路径
    html = html.replace(/\/assets\//g, webview.asWebviewUri(webviewDist).toString() + '/assets/');
    html = html.replace('{{RESOURCES_URI}}', resourcesUri.toString());
    html = html.replace('{{CSP_SOURCE}}', webview.cspSource);

    return html;
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>LingPet</title></head>
<body>
<div id="app">
  <div style="text-align:center;padding:40px;color:#666;">
    <h2>修仙灵兽 LingPet</h2>
    <p>Webview 资源未找到，请先运行 <code>npm run build</code></p>
  </div>
</div>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
