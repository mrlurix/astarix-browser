// ─────────────────────────────────────────────────────────────
// Tiny reactive store — RN/Redux-style single source of truth.
// Zero deps. Batched notifications (one render per tick) so a burst
// of state changes costs a single DOM pass — important for weak CPUs.
// ─────────────────────────────────────────────────────────────

window.Astarix = window.Astarix || {};

(function (A) {
  function createStore(initialState) {
    let state = Object.assign({}, initialState);
    const listeners = new Set();
    let queued = false;

    function notify() {
      if (queued) return;
      queued = true;
      // Coalesce same-tick changes into one notification.
      Promise.resolve().then(() => {
        queued = false;
        for (const fn of listeners) {
          try { fn(state); } catch (e) { console.error('[store]', e); }
        }
      });
    }

    return {
      get() { return state; },
      set(partial) {
        state = Object.assign({}, state, partial);
        notify();
        return state;
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      destroy() { listeners.clear(); },
    };
  }

  function createEmitter() {
    const map = new Map();
    return {
      on(evt, fn) {
        if (!map.has(evt)) map.set(evt, new Set());
        map.get(evt).add(fn);
        return () => { const s = map.get(evt); if (s) s.delete(fn); };
      },
      emit(evt, payload) {
        const set = map.get(evt);
        if (!set) return;
        for (const fn of set) {
          try { fn(payload); } catch (e) { console.error('[emitter]', e); }
        }
      },
      clear() { map.clear(); },
    };
  }

  A.store = { createStore, createEmitter };
})(window.Astarix);