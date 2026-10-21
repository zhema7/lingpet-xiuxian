// Webview 打包配置 - 用 esbuild 直接打包为单文件（内联 HTML + JS）
// 避免 Vite 的复杂路径问题

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const watch = process.argv.includes('--watch');

const webviewRoot = path.resolve(__dirname, 'src', 'webview', 'renderer');
const outDir = path.resolve(__dirname, 'dist', 'webview');

function build() {
  // 每次构建前清理旧产物（特别是 Vite 遗留的 assets 目录）
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 1. 用 esbuild 打包 renderer main.ts
  esbuild.buildSync({
    entryPoints: [path.join(webviewRoot, 'main.ts')],
    bundle: true,
    outfile: path.join(outDir, 'main.js'),
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    logLevel: 'info',
    loader: {
      '.html': 'text'
    }
  });

  // 2. 构建 PixiJS 为独立 chunk（可选）
  // 用 external + 预打包的 pixi.min.js 也行，但 bundle 进去最简单

  // 3. 读 HTML 模板，替换 script 引用为内联/正确路径
  let html = fs.readFileSync(path.join(webviewRoot, 'index.html'), 'utf-8');

  // 把 <script type="module" src="./main.ts"> 替换为 <script> + 内联 main.js
  // ⚠️ 必须用函数形式：字符串形式会展开 mainJs 里的 $&/$'/$` 等特殊替换模式，损坏 bundle
  const mainJs = fs.readFileSync(path.join(outDir, 'main.js'), 'utf-8');
  html = html.replace(
    /<script type="module"\s+src="\.\/main\.ts"><\/script>/,
    () => `<script type="module">\n${mainJs}\n</script>`
  );

  // 写入最终 HTML
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log('Webview bundled:', path.join(outDir, 'index.html'));

  // 删除中间产物
  fs.unlinkSync(path.join(outDir, 'main.js'));
}

if (watch) {
  console.log('Watching webview...');
  const chokidar = require('chokidar');
  chokidar.watch(webviewRoot).on('change', () => {
    console.log('[webview] changed, rebuilding...');
    try { build(); } catch (e) { console.error(e.message); }
  });
  build(); // 初始构建
} else {
  build();
}
