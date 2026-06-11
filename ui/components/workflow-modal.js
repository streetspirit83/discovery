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
    title: 'Discovery',
    text: 'Adapter laufen lassen, Inbox sichten. „TV Daten" laden und nach Score / ▲1M sortieren.',
  },
  {
    n: 2,
    icon: '🏦',
    title: 'Broker check',
    text: 'Prüfen, ob der Wert im eigenen Broker handelbar ist.',
  },
  {
    n: 3,
    icon: '🤖',
    title: 'AI Research',
    text: 'Kandidaten per Checkbox markieren → „📋 Research-Prompt" kopieren → in AI-Suche einfügen und benchmarken.',
  },
  {
    n: 4,
    icon: '↗',
    title: 'Export nach Merkliste',
    text: 'Gewinner promoten / in den Export-Bucket schieben und als Merkliste-JSON exportieren.',
  },
  {
    n: 5,
    icon: '⏰',
    title: 'Alert festlegen & scharf schalten',
    text: 'Alert im Broker/TradingView auf das Entry-Level setzen und den Wert mit ✓ als „scharf" markieren.',
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
