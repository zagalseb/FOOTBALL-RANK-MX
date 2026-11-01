// qbmap_hotkeys.js — QB Map's action table for shared/hotkeys.js.
// Only the definition lives here; the engine, storage, and the settings UI are
// shared (shared/hotkeys.js, shared/settings-hotkeys.js). `storageKey` and the
// stored shape are unchanged, so a previously saved table keeps working.
//
// `repeat: true` = holding the key keeps firing the action (seeking).
// The first combo listed is the default; an action may carry several.

export const QBMAP_HOTKEYS = {
  storageKey: 'qbmap_hotkeys',
  actions: [
    { id: 'play_pause',  label: 'Play / pausa',            keys: ['Space'],            repeat: false },
    { id: 'seek_back_1', label: 'Retroceder 1 s',          keys: ['ArrowLeft'],        repeat: true  },
    { id: 'seek_fwd_1',  label: 'Avanzar 1 s',             keys: ['ArrowRight'],       repeat: true  },
    { id: 'seek_back_5', label: 'Retroceder 5 s',          keys: ['Shift+ArrowLeft'],  repeat: true  },
    { id: 'seek_fwd_5',  label: 'Avanzar 5 s',             keys: ['Shift+ArrowRight'], repeat: true  },
    { id: 'use_time',    label: 'Usar tiempo actual',      keys: ['q'],                repeat: false },
    { id: 'mark_launch', label: 'Marcar Launch',           keys: ['1'],                repeat: false },
    { id: 'mark_target', label: 'Marcar Target',           keys: ['2'],                repeat: false },
    { id: 'save',        label: 'Guardar jugada',          keys: ['Enter', 'Shift+s'], repeat: false },
    { id: 'skip',        label: 'Omitir jugada',           keys: ['Shift+p'],          repeat: false },
    { id: 'slow_toggle', label: 'Velocidad 0.25×',         keys: ['x'],                repeat: false },
  ],
}
