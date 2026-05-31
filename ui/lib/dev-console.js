/**
 * Mobile debug console
 * Intercepts console.log/warn/error/debug and displays them in an in-app panel.
 * Load this module before app.js so all output is captured from the start.
 */

const MAX_ENTRIES = 300;
const entries = [];
let listEl = null;
let badgeEl = null;
let unseenCount = 0;
let isOpen = false;
let indentLevel = 0;

// Preserve originals before overriding
const orig = {
  log:   console.log.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
  info:  console.info.bind(console),
  debug: console.debug.bind(console),
};

function formatArgs(args) {
  return args.map((a) => {
    if (a === null) return 'null';
    if (a === undefined) return 'undefined';
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

function appendRow(entry) {
  if (!listEl) return;
  const row = document.createElement('div');
  row.className = `dc-row dc-${entry.level}`;
  row.style.paddingLeft = `${entry.indent * 10 + 6}px`;
  row.innerHTML = `<span class="dc-time">${entry.time}</span><span class="dc-msg">${escHtml(entry.msg)}</span>`;
  listEl.appendChild(row);
  if (isOpen) listEl.scrollTop = listEl.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addEntry(level, args) {
  const msg  = formatArgs(args);
  const time = new Date().toLocaleTimeString('de-DE', { hour12: false });
  const entry = { level, msg, time, indent: indentLevel };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  appendRow(entry);
  if (!isOpen) {
    unseenCount++;
    if (badgeEl) badgeEl.textContent = unseenCount > 99 ? '99+' : String(unseenCount);
    if (badgeEl) badgeEl.hidden = false;
  }
}

// Override console methods
['log', 'warn', 'error', 'info', 'debug'].forEach((lvl) => {
  console[lvl] = (...args) => {
    orig[lvl]?.(...args);
    addEntry(lvl, args);
  };
});

// group / groupCollapsed / groupEnd — keep indent tracking
const origGroup = console.group.bind(console);
const origGroupC = console.groupCollapsed.bind(console);
const origGroupE = console.groupEnd.bind(console);

console.group = (...args) => {
  origGroup(...args);
  if (args.length) addEntry('debug', args);
  indentLevel++;
};
console.groupCollapsed = (...args) => {
  origGroupC(...args);
  if (args.length) addEntry('debug', args);
  indentLevel++;
};
console.groupEnd = () => {
  origGroupE();
  indentLevel = Math.max(0, indentLevel - 1);
};

// Catch unhandled errors
window.addEventListener('error', (e) => {
  addEntry('error', [`Unhandled: ${e.message} (${e.filename}:${e.lineno})`]);
});
window.addEventListener('unhandledrejection', (e) => {
  addEntry('error', [`UnhandledPromise: ${e.reason}`]);
});

// ─── Build UI after DOM is ready ──────────────────────────────────────────────

function buildPanel() {
  const style = document.createElement('style');
  style.textContent = `
    #dc-toggle {
      position: fixed; bottom: 16px; right: 16px; z-index: 9999;
      width: 44px; height: 44px; border-radius: 50%;
      background: #1e293b; border: 2px solid #475569;
      color: #94a3b8; font-size: 18px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,.4);
      touch-action: manipulation;
    }
    #dc-toggle:active { transform: scale(.93); }
    #dc-badge {
      position: absolute; top: -4px; right: -4px;
      background: #dc2626; color: #fff; font-size: 9px; font-weight: 700;
      min-width: 16px; height: 16px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center; padding: 0 3px;
    }
    #dc-panel {
      position: fixed; inset: 0; z-index: 9998;
      background: #0f172a; display: flex; flex-direction: column;
      font-family: ui-monospace, 'Cascadia Code', monospace; font-size: 11px;
    }
    #dc-panel[hidden] { display: none; }
    #dc-toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; background: #1e293b;
      border-bottom: 1px solid #334155; flex-shrink: 0;
    }
    #dc-toolbar span { color: #94a3b8; font-size: 12px; font-weight: 600; flex: 1; }
    #dc-toolbar button {
      background: #334155; border: none; color: #94a3b8;
      padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;
    }
    #dc-toolbar button:active { background: #475569; }
    #dc-list {
      flex: 1; overflow-y: auto; padding: 4px 0;
      -webkit-overflow-scrolling: touch;
    }
    .dc-row {
      padding: 2px 6px; border-bottom: 1px solid #1e293b;
      display: flex; gap: 6px; align-items: baseline;
      word-break: break-all; line-height: 1.4;
    }
    .dc-time { color: #475569; flex-shrink: 0; font-size: 10px; }
    .dc-msg  { color: #cbd5e1; white-space: pre-wrap; }
    .dc-warn  .dc-msg { color: #fbbf24; }
    .dc-error .dc-msg { color: #f87171; }
    .dc-debug .dc-msg { color: #818cf8; }
    .dc-info  .dc-msg { color: #67e8f9; }
  `;
  document.head.appendChild(style);

  // Toggle button
  const btn = document.createElement('button');
  btn.id = 'dc-toggle';
  btn.title = 'Debug Console';
  btn.innerHTML = '⌨';
  const badge = document.createElement('span');
  badge.id = 'dc-badge';
  badge.hidden = true;
  btn.appendChild(badge);
  badgeEl = badge;
  document.body.appendChild(btn);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'dc-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div id="dc-toolbar">
      <span>Debug Console</span>
      <button id="dc-copy">Copy</button>
      <button id="dc-clear">Clear</button>
      <button id="dc-close">✕</button>
    </div>
    <div id="dc-list"></div>
  `;
  document.body.appendChild(panel);

  listEl = panel.querySelector('#dc-list');

  // Re-render existing entries (captured before DOM was ready)
  for (const e of entries) appendRow(e);
  listEl.scrollTop = listEl.scrollHeight;

  // Toggle
  btn.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.hidden = !isOpen;
    if (isOpen) {
      unseenCount = 0;
      badge.hidden = true;
      badge.textContent = '';
      listEl.scrollTop = listEl.scrollHeight;
    }
  });

  // Close
  panel.querySelector('#dc-close').addEventListener('click', () => {
    isOpen = false;
    panel.hidden = true;
  });

  // Clear
  panel.querySelector('#dc-clear').addEventListener('click', () => {
    entries.length = 0;
    listEl.innerHTML = '';
  });

  // Copy all to clipboard
  panel.querySelector('#dc-copy').addEventListener('click', () => {
    const text = entries.map((e) => `[${e.time}][${e.level.toUpperCase()}] ${e.msg}`).join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildPanel);
} else {
  buildPanel();
}
