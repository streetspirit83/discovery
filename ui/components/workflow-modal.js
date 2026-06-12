/**
 * Workflow Modal – opens on the Home nav icon.
 *
 * Visual reminder of the personal discovery workflow:
 * Discovery → Broker-Check → AI Research → Export → Alert scharf.
 */

const STEPS = [
  {
    n: 1,
    icon: '🔎',
    title: 'Inbox screenen & promoten',
    text: 'Inbox schnell screenen, Auswahl nach Metrik & Branche. Broker-Check: bei <a href="https://traderepublic.com" target="_blank" rel="noopener">Trade Republic</a> handelbar? Dann promoten.',
  },
  {
    n: 2,
    icon: '🤖',
    title: 'Watchlist → Longlist → AI-Scoring',
    text: 'Watchlist screenen, ~10 Werte als Longlist filtern. „📋 Research-Prompt" generieren (AI-Scoring: Wahrscheinlichkeit für +20 % im nächsten Monat), beste Ergebnisse nach Export schieben, dann <a href="https://merkliste-app.netlify.app/" target="_blank" rel="noopener">Merkliste öffnen</a>.',
  },
  {
    n: 3,
    icon: '⏰',
    title: 'Merkliste: Watchlist & Alert',
    text: 'In der Merkliste auf Watchlist setzen und Alert für den Entry-Preis anlegen. Zurück in Discovery: ✓ setzen und exportierte Ticker in den Watch-Bucket schieben (weiteres Benchmark).',
  },
  {
    n: 4,
    icon: '💰',
    title: 'Alert triggert → Kauf',
    text: 'Kauf ausführen, in der Merkliste den Kauf eintragen und den Wert nach Portfolio verschieben.',
  },
  {
    n: 5,
    icon: '📈',
    title: 'Portfolio-Tracking',
    text: 'Portfolio in der Merkliste tracken — insbesondere, ob der Wert rollierend über 1 Monat performt.',
  },
];

export function renderWorkflowModal() {
  // Avoid stacking multiple instances
  if (document.getElementById('workflow-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'workflow-modal-overlay';
  overlay.innerHTML = `
    <div class="modal workflow-modal" role="dialog" aria-modal="true" aria-label="Workflow">
      <div class="modal-header">
        <h2>Mein Workflow</h2>
        <button class="modal-close" id="workflow-close" aria-label="Schließen">✕</button>
      </div>
      <div class="modal-body">
        <ol class="workflow-steps">
          ${STEPS.map((s) => `
            <li class="workflow-step">
              <span class="workflow-step__badge">${s.n}</span>
              <div class="workflow-step__body">
                <div class="workflow-step__title">${s.icon} ${s.title}</div>
                <div class="workflow-step__text">${s.text}</div>
              </div>
            </li>`).join('')}
        </ol>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#workflow-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
}
