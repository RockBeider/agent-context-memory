/**
 * viewer-src/markdown.js
 *
 * marked 기반 XSS 안전 마크다운 렌더러.
 * 원문 HTML 태그는 실행하지 않고 이스케이프 처리하며 위험 URL 스킴과 외부 이미지를 차단한다.
 */

import { Marked } from 'marked';

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(href) {
  const cleaned = String(href || '')
    .replace(/[\u0000-\u0020]+/g, '')
    .trim();
  if (!cleaned) return false;
  if (cleaned.startsWith('#')) return true;
  if (cleaned.startsWith('/') && !cleaned.startsWith('//')) return true;
  return /^(https?:|mailto:)/i.test(cleaned);
}

const safeMarked = new Marked({
  gfm: true,
  breaks: true,
});

const renderer = new safeMarked.Renderer();

renderer.html = function ({ text, raw }) {
  return escapeHtml(raw !== undefined ? raw : text);
};

renderer.link = function ({ href, title, tokens }) {
  const inner = this.parser.parseInline(tokens || []);
  if (!isSafeUrl(href)) {
    return `<span class="md-blocked-link">${inner}</span>`;
  }
  const safeHref = escapeHtml(href);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const isExternal = /^https?:/i.test(String(href || '').trim());
  const relAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${safeHref}"${titleAttr}${relAttr}>${inner}</a>`;
};

renderer.image = function ({ href, title, text }) {
  const label = text || title || href || 'image';
  return `<span class="md-img-badge">[${escapeHtml(label)}]</span>`;
};

renderer.code = function ({ text, lang }) {
  const cleanLang = String(lang || '')
    .trim()
    .replace(/[^a-zA-Z0-9_+-]/g, '');
  const langTag = cleanLang ? `<div class="md-code-lang">${escapeHtml(cleanLang)}</div>` : '';
  return `<div class="md-code-wrap">${langTag}<pre class="md-pre"><code>${escapeHtml(text)}</code></pre></div>`;
};

renderer.codespan = function ({ text }) {
  return `<code class="md-inline-code">${escapeHtml(text)}</code>`;
};

safeMarked.use({ renderer });

export function renderSafeMarkdown(source) {
  const text = String(source || '').trim();
  if (!text) return '';
  return safeMarked.parse(text);
}

export function renderSafeInlineMarkdown(source) {
  const text = String(source || '').trim();
  if (!text) return '';
  return safeMarked.parseInline(text);
}
