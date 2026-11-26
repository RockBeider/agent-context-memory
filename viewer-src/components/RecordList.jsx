/**
 * viewer-src/components/RecordList.jsx
 *
 * 2줄 구조 스캔 카드 리스트 및 Tasks 상태별 그룹핑 뷰.
 */

import { fmt, getStatusTone, groupTasksByStatus } from '../utils.js';

function RecordRow({ item, isSelected, onSelect }) {
  const tone = getStatusTone(item.status);
  return (
    <div
      class={`record-card tone-${tone} ${isSelected ? 'selected' : ''}`}
      data-uid={item.uid}
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      onClick={() => onSelect(item.uid)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item.uid);
        }
      }}
    >
      <div class="record-line-1">
        <span class={`status-dot tone-${tone}`} />
        <span class="record-title">{item.title}</span>
      </div>
      <div class="record-line-2">
        <div class="record-line-2-left">
          <span class="code-chip">{item.code}</span>
          <span class={`status-pill tone-${tone}`}>
            <span class={`status-dot tone-${tone}`} />
            <span>{item.statusLabel || item.status}</span>
          </span>
        </div>
        {item.meta && <span class="record-meta">{item.meta}</span>}
      </div>
    </div>
  );
}

export function RecordList({
  items,
  selectedUid,
  tab,
  statusFilter,
  query,
  copy,
  listScrollRef,
  onSelect,
}) {
  const shouldGroup =
    tab === 'tasks' &&
    !String(query || '').trim() &&
    (statusFilter === 'all' || statusFilter === 'active');

  const groups = shouldGroup ? groupTasksByStatus(items, copy) : null;

  return (
    <section class="list-pane" aria-label="Record List">
      <div class="list-meta-bar">
        <span>{fmt(copy.itemsShown, { count: items.length })}</span>
        <span>{copy.keyboardHint || ''}</span>
      </div>

      <div class="list-scroll" ref={listScrollRef} role="listbox">
        {items.length === 0 ? (
          <div class="empty-state">{copy.noItems}</div>
        ) : groups ? (
          groups.map((grp) => (
            <div key={grp.status}>
              <div class="group-header">
                <span>{grp.label}</span>
                <span>{grp.items.length}</span>
              </div>
              {grp.items.map((item) => (
                <RecordRow
                  key={item.uid}
                  item={item}
                  isSelected={item.uid === selectedUid}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))
        ) : (
          items.map((item) => (
            <RecordRow
              key={item.uid}
              item={item}
              isSelected={item.uid === selectedUid}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </section>
  );
}
