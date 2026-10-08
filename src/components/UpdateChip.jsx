import { useEffect, useState } from 'react';
import { getUpdateState, onUpdateState } from '../lib/updates.js';

// Shown only while an update is waiting AND a form has unsaved edits.
// It applies by itself the moment the form is left, so the chip is purely informational.
export default function UpdateChip() {
  const [state, setState] = useState(getUpdateState);
  useEffect(() => onUpdateState(() => setState(getUpdateState())), []);
  if (!state.updateReady || !state.dirty) return null;
  return (
    <div className="update-chip" role="status" data-testid="update-chip">
      Update ready · applies when you finish
    </div>
  );
}
