/**
 * viewer-src/main.jsx
 *
 * Preact 뷰어 엔트리포인트. window.__ACM_CONFIG__를 읽어 #app에 마운트한다.
 */

import { render } from 'preact';
import { App } from './App.jsx';

const rootEl = document.getElementById('app');
const cfg = window.__ACM_CONFIG__ || {
  mode: 'http',
  lang: 'en',
  readOnly: true,
  copy: {},
};

if (rootEl) {
  render(<App initialConfig={cfg} />, rootEl);
}
