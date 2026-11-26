/**
 * viewer-src/components/TaskModal.jsx
 *
 * 새 태스크 등록 및 기존 태스크 편집 모달.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';

export function TaskModal({ open, editingTask, copy, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('todo');
  const [purpose, setPurpose] = useState('');
  const [resultsText, setResultsText] = useState('');
  const [targetsText, setTargetsText] = useState('');
  const [owner, setOwner] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    setSaving(false);
    setTitle(editingTask ? editingTask.title || '' : '');
    setStatus(editingTask ? editingTask.status || 'todo' : 'todo');
    setPurpose(editingTask ? editingTask.purpose || '' : '');
    setResultsText(
      editingTask && Array.isArray(editingTask.results) ? editingTask.results.join('\n') : ''
    );
    setTargetsText(
      editingTask && Array.isArray(editingTask.targets) ? editingTask.targets.join('\n') : ''
    );
    setOwner(editingTask ? editingTask.owner || '' : '');
    setTimeout(() => {
      if (titleRef.current) titleRef.current.focus();
    }, 10);
  }, [open, editingTask]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      await onSave({
        idOrCode: editingTask ? editingTask.code : undefined,
        title: title.trim(),
        status,
        purpose: purpose.trim(),
        results: resultsText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        targets: targetsText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        owner: owner.trim(),
      });
    } catch (err) {
      setErrorMsg(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="taskModalTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form class="modal-card" onSubmit={handleSubmit}>
        <div class="modal-head">
          <h3 id="taskModalTitle">
            {editingTask ? copy.modalEditTitle : copy.modalCreateTitle}
          </h3>
          <button type="button" class="btn btn-icon btn-ghost" onClick={onClose} aria-label={copy.cancel}>
            <X size={16} class="icon" />
          </button>
        </div>

        <div class="modal-body">
          {errorMsg && <div class="status-banner err" style={{ margin: 0 }}>{errorMsg}</div>}

          <div class="field">
            <label for="fTitle">{copy.fieldTitle}</label>
            <input
              ref={titleRef}
              id="fTitle"
              type="text"
              value={title}
              onInput={(e) => setTitle(e.target.value)}
            />
          </div>

          <div class="field">
            <label for="fStatus">{copy.fieldStatus}</label>
            <select
              id="fStatus"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="todo">{copy.statusTodo}</option>
              <option value="in_progress">{copy.statusInProgress}</option>
              <option value="paused">{copy.statusPaused}</option>
              <option value="ready">{copy.statusReady}</option>
            </select>
          </div>

          <div class="field">
            <label for="fPurpose">{copy.fieldPurpose}</label>
            <textarea
              id="fPurpose"
              value={purpose}
              onInput={(e) => setPurpose(e.target.value)}
            />
          </div>

          <div class="field">
            <label for="fResults">{copy.fieldResults}</label>
            <textarea
              id="fResults"
              value={resultsText}
              onInput={(e) => setResultsText(e.target.value)}
            />
          </div>

          <div class="field">
            <label for="fTargets">{copy.fieldTargets}</label>
            <textarea
              id="fTargets"
              value={targetsText}
              onInput={(e) => setTargetsText(e.target.value)}
            />
          </div>

          <div class="field">
            <label for="fOwner">{copy.fieldOwner}</label>
            <input
              id="fOwner"
              type="text"
              value={owner}
              onInput={(e) => setOwner(e.target.value)}
            />
          </div>

          <div class="modal-hint">{copy.doneHint}</div>
        </div>

        <div class="modal-foot">
          <button type="button" class="btn" onClick={onClose} disabled={saving}>
            {copy.cancel}
          </button>
          <button type="submit" class="btn btn-primary" disabled={saving}>
            {copy.save}
          </button>
        </div>
      </form>
    </div>
  );
}
