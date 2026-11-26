/**
 * viewer-src/components/DetailPane.jsx
 *
 * 문서형 상세 패널: Sticky 액션 바, 인라인 상태 변경, 프로퍼티 그리드,
 * XSS 안전 마크다운 본문 및 1줄 1파일 대상 목록.
 */

import { useState } from 'preact/hooks';
import { ArrowLeft, Copy, Check, Pencil, ExternalLink } from 'lucide-preact';
import { copyToClipboard, getStatusTone } from '../utils.js';
import { renderSafeMarkdown, renderSafeInlineMarkdown } from '../markdown.js';

function MarkdownSection({ title, content }) {
  if (!content) return null;
  return (
    <section class="doc-section">
      <div class="doc-section-title">{title}</div>
      <div
        class="md-content"
        dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(content) }}
      />
    </section>
  );
}

export function DetailPane({
  item,
  config,
  rootDir,
  copy,
  statusUpdating,
  onBack,
  onEditTask,
  onQuickStatusChange,
  onOpenWorkspaceFile,
}) {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedFile, setCopiedFile] = useState('');

  if (!item) {
    return (
      <section class="detail-pane">
        <div class="detail-scroll">
          <div class="empty-state">{copy.selectHint}</div>
        </div>
      </section>
    );
  }

  const canEdit =
    !config.readOnly && item.kind === 'task' && item.status !== 'done' && !item.archivedAt;
  const tone = getStatusTone(item.status);
  const canOpenFile = config.mode === 'mcp-app' && Boolean(rootDir);

  async function handleCopyId() {
    const ok = await copyToClipboard(item.code);
    if (ok) {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1200);
    }
  }

  async function handleCopyPath(filePath) {
    const ok = await copyToClipboard(filePath);
    if (ok) {
      setCopiedFile(filePath);
      setTimeout(() => setCopiedFile((prev) => (prev === filePath ? '' : prev)), 1200);
    }
  }

  const props = [];
  if (item.commitSha) props.push({ k: copy.commitSha, v: item.commitSha.slice(0, 7) });
  if (item.owner) props.push({ k: copy.owner, v: item.owner });
  if (item.author) props.push({ k: copy.author, v: item.author });
  if (item.category) props.push({ k: copy.category || 'Category', v: item.category });
  if (item.kind === 'pattern') props.push({ k: copy.accessCount, v: String(item.accessCount || 0) });
  if (item.relatedTaskCode) props.push({ k: copy.relatedTask || 'Related Task', v: item.relatedTaskCode });
  if (item.branch) props.push({ k: copy.branch || 'Branch', v: item.branch });
  if (item.date) props.push({ k: copy.date || 'Date', v: item.date });
  if (item.archivedAt) props.push({ k: copy.archivedAt, v: String(item.archivedAt).slice(0, 10) });
  if (item.updatedAt) props.push({ k: copy.updatedAt, v: String(item.updatedAt).slice(0, 10) });

  const fileList = item.kind === 'task' ? item.targets : item.relatedFiles;
  const fileSectionTitle = item.kind === 'task' ? copy.targets : copy.relatedFiles;

  return (
    <section class="detail-pane" aria-label="Record Detail">
      <div class="detail-topbar">
        <div class="detail-topbar-left">
          <button type="button" class="btn btn-sm back-btn" onClick={onBack}>
            <ArrowLeft size={13} class="icon" />
            <span>{copy.backToList || 'Back'}</span>
          </button>
          <span class="code-chip">{item.code}</span>
          <button type="button" class="btn btn-sm btn-ghost" onClick={handleCopyId}>
            {copiedId ? <Check size={12} class="icon" /> : <Copy size={12} class="icon" />}
            <span>{copiedId ? copy.copied : copy.copyId}</span>
          </button>
        </div>

        <div class="detail-topbar-right">
          {canEdit ? (
            <>
              <select
                class="inline-status-select"
                aria-label={copy.fieldStatus}
                value={item.status}
                disabled={statusUpdating}
                onChange={(e) => onQuickStatusChange(item, e.target.value)}
              >
                <option value="todo">{copy.statusTodo}</option>
                <option value="in_progress">{copy.statusInProgress}</option>
                <option value="paused">{copy.statusPaused}</option>
                <option value="ready">{copy.statusReady}</option>
              </select>
              <button type="button" class="btn btn-sm" onClick={() => onEditTask(item)}>
                <Pencil size={12} class="icon" />
                <span>{copy.editTask}</span>
              </button>
            </>
          ) : (
            <span class={`status-pill tone-${tone}`}>
              <span class={`status-dot tone-${tone}`} />
              <span>{item.statusLabel || item.status}</span>
            </span>
          )}
        </div>
      </div>

      <div class="detail-scroll">
        <article class="detail-doc">
          <h2 class="doc-title">{item.title}</h2>

          <div class="prop-grid">
            <div class="prop-row">
              <span class="prop-key">{copy.statusChange || 'Status'}</span>
              <span class={`status-pill tone-${tone}`}>
                <span class={`status-dot tone-${tone}`} />
                <span>{item.statusLabel || item.status}</span>
              </span>
            </div>
            {props.map((p, idx) => (
              <div class="prop-row" key={idx}>
                <span class="prop-key">{p.k}</span>
                <span class="prop-val">{p.v}</span>
              </div>
            ))}
          </div>

          {item.kind === 'task' && (
            <>
              <MarkdownSection title={copy.purpose} content={item.purpose} />
              {item.results && item.results.length > 0 && (
                <section class="doc-section">
                  <div class="doc-section-title">{copy.results}</div>
                  <ul class="result-bullets">
                    {item.results.map((r, i) => (
                      <li
                        key={i}
                        class="md-content"
                        dangerouslySetInnerHTML={{ __html: renderSafeInlineMarkdown(r) }}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {item.kind === 'pattern' && (
            <>
              <MarkdownSection title={copy.summary} content={item.summary} />
              <MarkdownSection title={copy.symptom} content={item.symptom} />
              <MarkdownSection title={copy.solution} content={item.solution} />
              {item.tags && item.tags.length > 0 && (
                <section class="doc-section">
                  <div class="doc-section-title">{copy.tags}</div>
                  <div class="tag-list">
                    {item.tags.map((tg, i) => (
                      <span class="tag-chip" key={i}>{tg}</span>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {item.kind === 'adr' && (
            <>
              <MarkdownSection title={copy.summary} content={item.summary} />
              <MarkdownSection title={copy.relatedArea} content={item.relatedArea} />
              <MarkdownSection title={copy.context} content={item.context} />
              <MarkdownSection title={copy.decision} content={item.decision} />
              <MarkdownSection title={copy.impact} content={item.impact} />
            </>
          )}

          {fileList && fileList.length > 0 && (
            <section class="doc-section">
              <div class="doc-section-title">{fileSectionTitle}</div>
              <div class="file-list">
                {fileList.map((filePath, i) => (
                  <div class="file-row" key={i}>
                    <span class="file-path" title={filePath}>{filePath}</span>
                    <div class="file-actions">
                      <button
                        type="button"
                        class="btn btn-sm"
                        onClick={() => handleCopyPath(filePath)}
                      >
                        {copiedFile === filePath ? (
                          <Check size={11} class="icon" />
                        ) : (
                          <Copy size={11} class="icon" />
                        )}
                        <span>{copiedFile === filePath ? copy.copied : copy.copyPath}</span>
                      </button>
                      {canOpenFile && (
                        <button
                          type="button"
                          class="btn btn-sm"
                          onClick={() => onOpenWorkspaceFile(filePath)}
                        >
                          <ExternalLink size={11} class="icon" />
                          <span>{copy.openFile}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </article>
      </div>
    </section>
  );
}
