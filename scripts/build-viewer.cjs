#!/usr/bin/env node
/**
 * scripts/build-viewer.cjs
 *
 * viewer-src/ 의 Preact + Lucide + Marked UI 소스를 단일 오프라인 번들
 * (scripts/acm/viewer/ui-bundle.cjs)로 컴파일한다.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'viewer-src');
const OUT_FILE = path.join(ROOT_DIR, 'scripts', 'acm', 'viewer', 'ui-bundle.cjs');

/**
 * 인라인 HTML 태그 탈출을 막기 위해 닫는 태그 시퀀스를 안전하게 이스케이프한다.
 */
function sanitizeInlineScript(code) {
  return String(code).replace(/<\/(script)/gi, '<\\/$1');
}

function sanitizeInlineStyle(css) {
  return String(css).replace(/<\/(style)/gi, '<\\/$1');
}

async function buildViewer() {
  const jsEntry = path.join(SRC_DIR, 'main.jsx');
  const cssEntry = path.join(SRC_DIR, 'styles.css');

  if (!fs.existsSync(jsEntry)) {
    throw new Error(`엔트리 파일을 찾을 수 없습니다: ${jsEntry}`);
  }
  if (!fs.existsSync(cssEntry)) {
    throw new Error(`스타일 파일을 찾을 수 없습니다: ${cssEntry}`);
  }

  const [jsResult, cssResult] = await Promise.all([
    esbuild.build({
      entryPoints: [jsEntry],
      bundle: true,
      write: false,
      format: 'iife',
      minify: true,
      jsx: 'automatic',
      jsxImportSource: 'preact',
      target: ['es2020'],
      charset: 'utf8',
      legalComments: 'none',
    }),
    esbuild.build({
      entryPoints: [cssEntry],
      bundle: true,
      write: false,
      minify: true,
      target: ['chrome105', 'safari16', 'firefox110'],
      charset: 'utf8',
      legalComments: 'none',
    }),
  ]);

  const rawJs = jsResult.outputFiles[0].text;
  const rawCss = cssResult.outputFiles[0].text;

  const bundleJs = sanitizeInlineScript(rawJs);
  const bundleCss = sanitizeInlineStyle(rawCss);

  // 인라인 스크립트가 단일 <script> 내에서 파싱 가능한지 사전 검증
  new vm.Script(bundleJs);

  const output =
    '/**\n' +
    ' * scripts/acm/viewer/ui-bundle.cjs\n' +
    ' *\n' +
    ' * 자동 생성된 오프라인 뷰어 번들 (직접 수정 금지 — `npm run build:viewer` 사용).\n' +
    ' */\n\n' +
    `const BUNDLE_CSS = ${JSON.stringify(bundleCss)};\n` +
    `const BUNDLE_JS = ${JSON.stringify(bundleJs)};\n\n` +
    'module.exports = {\n' +
    '  BUNDLE_CSS,\n' +
    '  BUNDLE_JS,\n' +
    '};\n';

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, output, 'utf-8');

  const jsKb = (Buffer.byteLength(bundleJs, 'utf-8') / 1024).toFixed(2);
  const cssKb = (Buffer.byteLength(bundleCss, 'utf-8') / 1024).toFixed(2);
  const totalKb = (Buffer.byteLength(output, 'utf-8') / 1024).toFixed(2);
  console.log(`[build:viewer] 생성 완료: ${path.relative(ROOT_DIR, OUT_FILE)} (JS ${jsKb} KB, CSS ${cssKb} KB, 총 ${totalKb} KB)`);
}

buildViewer().catch((err) => {
  console.error('[build:viewer] 실패:', err);
  process.exit(1);
});
