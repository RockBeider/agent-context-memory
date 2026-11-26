/**
 * viewer-src/components/CompactModal.jsx
 *
 * DB 보존 정책(Compact) Dry-Run 미리보기 및 실행 모달.
 */

import { X } from 'lucide-preact';
import { fmt, fmtBytes } from '../utils.js';

export function CompactModal({ open, loading, preview, errorMsg, copy, onClose, onConfirm }) {
  if (!open) return null;

  let bodyText = copy.compactLoading;
  let canConfirm = false;

  if (errorMsg) {
    bodyText = errorMsg;
  } else if (!loading && preview) {
    if (preview.skipped) {
      bodyText = copy.compactSkipped;
    } else {
      bodyText = fmt(copy.compactSummary, {
        tasks: preview.archivedTasksCount || 0,
        logs: preview.prunedSyncLogs || 0,
        size: fmtBytes(preview.sizeBeforeBytes || 0),
      });
      canConfirm = true;
    }
  }

  return (
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compactModalTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal-card">
        <div class="modal-head">
          <h3 id="compactModalTitle">{copy.compactTitle}</h3>
          <button type="button" class="btn btn-icon btn-ghost" onClick={onClose} aria-label={copy.cancel}>
            <X size={16} class="icon" />
          </button>
        </div>

        <div class="modal-body">
          <div class={`status-banner ${errorMsg ? 'err' : ''}`} style={{ margin: 0 }}>
            {bodyText}
          </div>
        </div>

        <div class="modal-foot">
          <button type="button" class="btn" onClick={onClose}>
            {copy.cancel}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!canConfirm || loading}
            onClick={onConfirm}
          >
            {copy.compactConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
