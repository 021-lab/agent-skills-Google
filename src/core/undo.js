// undo.js: action/inverse stack. Every mutation pushes an inverse; N undo
// operations pop N actions and apply their inverses in LIFO order.

export class UndoStack {
  constructor() {
    this.stack = [];
  }

  // action: { mutation, inverse } where inverse is `() => void|Promise<void>`
  // that restores the prior state.
  push(action) {
    if (typeof action?.inverse !== 'function') {
      throw new Error('push() requires an action with an inverse function');
    }
    this.stack.push(action);
  }

  canUndo() {
    return this.stack.length > 0;
  }

  depth() {
    return this.stack.length;
  }

  async undo() {
    if (!this.canUndo()) return null;
    const action = this.stack.pop();
    await action.inverse();
    return action;
  }

  // Reverses up to n actions, LIFO. Stops early if the stack empties.
  async undoN(n) {
    const applied = [];
    for (let i = 0; i < n && this.canUndo(); i++) {
      applied.push(await this.undo());
    }
    return applied;
  }

  clear() {
    this.stack = [];
  }
}

// Builds a push()-able action for a LocalDB put, inverting to either a
// restore of the previous record or a delete if the record was new.
export function recordPutMutation({ db, storeName, id, previousValue, newValue }) {
  return {
    mutation: { type: 'put', storeName, id, newValue },
    inverse: async () => {
      if (previousValue === undefined || previousValue === null) {
        await db.delete(storeName, id);
      } else {
        await db.put(storeName, previousValue);
      }
    },
  };
}

// Builds a push()-able action for a LocalDB delete, inverting to a restore.
export function recordDeleteMutation({ db, storeName, id, previousValue }) {
  return {
    mutation: { type: 'delete', storeName, id },
    inverse: async () => {
      if (previousValue !== undefined && previousValue !== null) {
        await db.put(storeName, previousValue);
      }
    },
  };
}

export function createUndoStack() {
  return new UndoStack();
}
