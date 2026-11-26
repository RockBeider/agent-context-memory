/**
 * viewer-src/utils.js
 *
 * 뷰어 공용 포맷팅, 클립보드 복사 및 상태 그룹핑 헬퍼.
 */

export function fmtBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

export function fmt(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) =>
    vars && vars[k] !== undefined ? String(vars[k]) : ''
  );
}

export async function copyToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {
      // 클립보드 권한 제한 시 아래 폴백 실행
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

export function getStatusTone(status) {
  const s = String(status || 'todo').toLowerCase();
  if (s === 'in_progress') return 'info';
  if (s === 'ready') return 'warn';
  if (s === 'done' || s === 'active' || s === 'accepted') return 'success';
  return 'neutral';
}

export const TASK_GROUP_ORDER = ['in_progress', 'ready', 'todo', 'paused', 'done'];

export function getTaskGroupLabel(status, copy) {
  switch (status) {
    case 'in_progress':
      return copy.groupInProgress || 'In Progress';
    case 'ready':
      return copy.groupReady || 'Ready';
    case 'todo':
      return copy.groupTodo || 'Todo';
    case 'paused':
      return copy.groupPaused || 'Paused';
    case 'done':
      return copy.groupDone || 'Done';
    default:
      return status;
  }
}

/**
 * 태스크 목록을 상태 우선순위 순으로 그룹핑한다.
 */
export function groupTasksByStatus(items, copy) {
  const buckets = new Map();
  for (const status of TASK_GROUP_ORDER) {
    buckets.set(status, []);
  }

  for (const item of items) {
    const raw = String(item.status || 'todo').toLowerCase();
    const key = buckets.has(raw) ? raw : 'todo';
    buckets.get(key).push(item);
  }

  const groups = [];
  for (const [status, list] of buckets.entries()) {
    if (list.length > 0) {
      groups.push({
        status,
        label: getTaskGroupLabel(status, copy),
        items: list,
      });
    }
  }
  return groups;
}
