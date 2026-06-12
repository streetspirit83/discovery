/**
 * Settings Modal – first-run setup and configuration
 */

const KEYS = {
  backendUrl: 'discovery_backend_url',
  secret: 'discovery_secret',
  claudeKey: 'discovery_claude_key',
  githubPat: 'discovery_github_pat',
  twelveDataKey: 'discovery_twelvedata_key',
  fxEurUsd: 'discovery_fx_eurusd',
};

export function loadSettings() {
  return {
    backendUrl: localStorage.getItem(KEYS.backendUrl) ?? '',
    secret: localStorage.getItem(KEYS.secret) ?? '',
    claudeKey: localStorage.getItem(KEYS.claudeKey) ?? '',
    githubPat: localStorage.getItem(KEYS.githubPat) ?? '',
    twelveDataKey: localStorage.getItem(KEYS.twelveDataKey) ?? '',
    fxEurUsd: localStorage.getItem(KEYS.fxEurUsd) ?? '',
  };
}

export function saveSettings(settings) {
  for (const [key, lsKey] of Object.entries(KEYS)) {
    if (settings[key] !== undefined) {
      localStorage.setItem(lsKey, settings[key]);
    }
  }
}

export function isConfigured() {
  const s = loadSettings();
  return !!(s.backendUrl && s.secret);
}

export function renderSettingsModal(onSave) {
  const settings = loadSettings();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal settings-modal">
      <div class="modal-header">
        <h2>⚙️ Discovery Workspace – Setup</h2>
      </div>
      <div class="modal-body">
        <div class="warning-banner">
          ⚠️ Diese Werte werden nur lokal in deinem Browser gespeichert (localStorage).
        </div>

        <div class="form-group">
          <label for="set-backend-url">Backend URL <span class="required">*</span></label>
          <input type="url" id="set-backend-url" placeholder="https://your-site.netlify.app"
            value="${settings.backendUrl}" autocomplete="off">
          <small>URL des Netlify-Sites (netlify-backend/)</small>
        </div>

        <div class="form-group">
          <label for="set-secret">Shared Secret <span class="required">*</span></label>
          <input type="password" id="set-secret" placeholder="DISCOVERY_SECRET Wert"
            value="${settings.secret}" autocomplete="off">
          <small>Gleicher Wert wie DISCOVERY_SECRET auf Netlify</small>
        </div>

        <div class="form-group">
          <label for="set-claude-key">Claude API Key</label>
          <input type="password" id="set-claude-key" placeholder="sk-ant-..."
            value="${settings.claudeKey}" autocomplete="off">
          <small>Für AI-Enrichment (api.anthropic.com, direkt vom Browser)</small>
        </div>

        <div class="form-group">
          <label for="set-github-pat">GitHub PAT <small>(optional)</small></label>
          <input type="password" id="set-github-pat" placeholder="ghp_..."
            value="${settings.githubPat}" autocomplete="off">
          <small>Für manuellen Adapter-Trigger aus dem UI (Scope: workflow)</small>
        </div>

        <div class="form-group">
          <label for="set-twelvedata-key">Twelve Data Key <small>(optional)</small></label>
          <input type="password" id="set-twelvedata-key" placeholder="twelvedata.com/account/api-keys"
            value="${settings.twelveDataKey}" autocomplete="off">
          <small>Für Symbol-Suche im Import. Ohne Key funktioniert die Suche, mit Key 800 Anfragen/Tag.</small>
        </div>

        <div class="form-group">
          <label for="set-fx-eurusd">EUR/USD Kurs <small>(optional, manuell)</small></label>
          <input type="text" inputmode="decimal" id="set-fx-eurusd" placeholder="z.B. 1.16"
            value="${settings.fxEurUsd}" autocomplete="off">
          <small>USD je 1 EUR – Fallback für die €/$-Umschaltung. Wird automatisch überschrieben, sobald der Live-Kurs von TradingView geladen werden kann.</small>
        </div>

        <div class="form-group">
          <label>
            <input type="checkbox" id="set-use-mock"> Mock-Daten verwenden (kein Backend nötig)
          </label>
          <small>Nützlich für UI-Entwicklung ohne Backend</small>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="set-cancel">Abbrechen</button>
        <button class="btn btn-primary" id="set-save">Speichern</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#set-save').addEventListener('pointerup', () => {
    const newSettings = {
      backendUrl: overlay.querySelector('#set-backend-url').value.trim(),
      secret: overlay.querySelector('#set-secret').value.trim(),
      claudeKey: overlay.querySelector('#set-claude-key').value.trim(),
      githubPat: overlay.querySelector('#set-github-pat').value.trim(),
      twelveDataKey: overlay.querySelector('#set-twelvedata-key').value.trim(),
      fxEurUsd: overlay.querySelector('#set-fx-eurusd').value.trim(),
    };
    saveSettings(newSettings);
    overlay.remove();
    onSave?.(newSettings);
  });

  overlay.querySelector('#set-cancel').addEventListener('pointerup', () => {
    overlay.remove();
  });

  overlay.addEventListener('pointerup', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
