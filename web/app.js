// ==========================================================================
// JobHunt AI Dashboard — Application Logic (Vanilla JS)
// ==========================================================================

let appState = {
  isRunning: false,
  currentStage: 'idle',
  companies: [],
  config: {},
  tracker: [],
  pollTimer: null,
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  fetchStatus();
  loadDigest();
  loadCompanies();
  loadConfig();
  loadTracker();

  // Poll status regularly
  appState.pollTimer = setInterval(fetchStatus, 2500);

  // Setup console drawer header click to toggle
  const consoleHeader = document.querySelector('.console-header');
  if (consoleHeader) {
    consoleHeader.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('label')) {
        toggleConsole();
      }
    });
  }
}

// --------------------------------------------------------------------------
// Status & Polling
// --------------------------------------------------------------------------
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    appState.isRunning = data.is_running;
    appState.currentStage = data.current_stage || 'idle';

    updateStatusUI(data);
    updateLogsUI(data.logs || []);
  } catch (err) {
    console.error('Error fetching status:', err);
  }
}

function updateStatusUI(data) {
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  const stageMetric = document.getElementById('metric-stage');
  const companiesMetric = document.getElementById('metric-companies');
  const seenMetric = document.getElementById('metric-seen');
  const lastRunBadge = document.getElementById('last-run-badge');
  const btnSpinner = document.getElementById('btn-spinner');
  const btnRunText = document.getElementById('btn-run-text');
  const consoleBadge = document.getElementById('console-status-badge');

  companiesMetric.textContent = data.total_companies || '0';
  seenMetric.textContent = data.total_seen || '0';

  if (data.last_run) {
    lastRunBadge.textContent = `Last run: ${data.last_run}`;
  } else {
    lastRunBadge.textContent = 'Not run yet today';
  }

  if (data.is_running) {
    pill.className = 'status-pill running';
    text.textContent = data.current_stage || 'Scanning...';
    stageMetric.textContent = data.current_stage || 'Active';
    consoleBadge.textContent = data.current_stage || 'Running';
    consoleBadge.style.color = '#818cf8';

    btnSpinner.style.display = 'inline-block';
    btnRunText.textContent = 'Scanning Boards...';
    document.getElementById('btn-run-action').disabled = true;
    document.getElementById('btn-quick-run').disabled = true;
    document.getElementById('btn-quick-send').disabled = true;
  } else {
    pill.className = 'status-pill idle';
    text.textContent = 'Ready';
    stageMetric.textContent = 'Idle';
    consoleBadge.textContent = 'Idle';
    consoleBadge.style.color = '#8b949e';

    btnSpinner.style.display = 'none';
    btnRunText.textContent = '⚡ Launch Job Hunt';
    document.getElementById('btn-run-action').disabled = false;
    document.getElementById('btn-quick-run').disabled = false;
    document.getElementById('btn-quick-send').disabled = false;
  }
}

function updateLogsUI(logs) {
  const body = document.getElementById('console-body');
  if (!body) return;

  const autoscroll = document.getElementById('console-autoscroll').checked;
  body.innerHTML = '';

  if (logs.length === 0) {
    body.innerHTML = '<div class="log-line text-muted">[System] Ready. Click Launch Job Hunt to begin.</div>';
    return;
  }

  logs.forEach(line => {
    const div = document.createElement('div');
    div.className = 'log-line';
    if (line.includes('completed successfully')) {
      div.style.color = '#34d399';
    } else if (line.includes('error') || line.includes('HTTP 503') || line.includes('HTTP 429')) {
      div.style.color = '#f87171';
    } else if (line.includes('[1/5]') || line.includes('[2/5]') || line.includes('[3/5]') || line.includes('[4/5]') || line.includes('[5/5]')) {
      div.style.color = '#818cf8';
      div.style.fontWeight = 'bold';
    }
    div.textContent = line;
    body.appendChild(div);
  });

  if (autoscroll) {
    body.scrollTop = body.scrollHeight;
  }
}

// --------------------------------------------------------------------------
// Run Job Hunt Action
// --------------------------------------------------------------------------
function triggerRunFromControl() {
  const email = document.getElementById('run-email').checked;
  const limit = document.getElementById('run-limit').value;
  const scorer = document.getElementById('run-scorer').value;
  executeRun({ send: email, limit: limit, scorer: scorer });
}

function triggerRun(sendEmail) {
  const limit = document.getElementById('run-limit').value;
  const scorer = document.getElementById('run-scorer').value;
  executeRun({ send: sendEmail, limit: limit, scorer: scorer });
}

async function executeRun(options) {
  try {
    openConsole();
    showToast('Starting Job Hunt pipeline...', 'info');

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to start run', 'error');
      return;
    }

    showToast('Job Hunt is running in the background! ⚡', 'success');
    fetchStatus();

    // Poll until completed, then refresh digest and tracker
    const checkInterval = setInterval(async () => {
      const sres = await fetch('/api/status');
      if (sres.ok) {
        const sdata = await sres.json();
        if (!sdata.is_running) {
          clearInterval(checkInterval);
          showToast('Job Hunt scan finished! Digest updated.', 'success');
          loadDigest();
          loadTracker();
          fetchStatus();
        }
      }
    }, 2000);

  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// --------------------------------------------------------------------------
// Digest
// --------------------------------------------------------------------------
async function loadDigest() {
  const container = document.getElementById('digest-container');
  try {
    const res = await fetch('/api/digest');
    const data = await res.json();

    if (!data.found || !data.html) {
      container.innerHTML = `
        <div style="background:#161b22;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:40px 20px;text-align:center;">
          <div style="font-size:36px;margin-bottom:12px;">📬</div>
          <h3 style="font-size:18px;font-weight:700;color:#ffffff;margin-bottom:6px;">No Digest Generated Yet</h3>
          <p style="color:#8b949e;font-size:14px;max-width:440px;margin:0 auto 20px;">
            Click <strong>Launch Job Hunt</strong> to scan company boards, filter jobs, and let Gemini AI generate custom application kits!
          </p>
          <button class="btn btn-primary" onclick="triggerRunFromControl()">⚡ Run Job Hunt Now</button>
        </div>
      `;
      return;
    }

    // Embed the clean digest HTML with enhanced copy buttons
    container.innerHTML = enhanceDigestHtml(data.html);
  } catch (err) {
    container.innerHTML = `<div class="log-line text-danger">Failed to load digest: ${err.message}</div>`;
  }
}

function enhanceDigestHtml(rawHtml) {
  // Extract body contents from the generated digest HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  const bodyContent = doc.body.innerHTML;

  // Wrap with a clean styled container
  return `
    <div class="embedded-digest" style="max-width:800px;margin:0 auto;">
      ${bodyContent}
    </div>
  `;
}

// --------------------------------------------------------------------------
// Companies Management
// --------------------------------------------------------------------------
async function loadCompanies() {
  try {
    const res = await fetch('/api/companies');
    const data = await res.json();
    appState.companies = data.companies || [];

    document.getElementById('companies-count-tab').textContent = appState.companies.length;
    renderCompaniesGrid();
  } catch (err) {
    console.error('Error loading companies:', err);
  }
}

function renderCompaniesGrid() {
  const grid = document.getElementById('companies-grid');
  grid.innerHTML = '';

  appState.companies.forEach((comp, idx) => {
    const card = document.createElement('div');
    card.className = 'company-item-card';

    let atsClass = 'greenhouse';
    if (comp.ats === 'lever') atsClass = 'lever';
    if (comp.ats === 'ashby') atsClass = 'ashby';

    card.innerHTML = `
      <div class="company-top">
        <span class="company-name">${escapeHtml(comp.name)}</span>
        <span class="ats-badge ${atsClass}">${escapeHtml(comp.ats)}</span>
      </div>
      <div class="company-slug-row">
        <span>Slug: <code>${escapeHtml(comp.slug)}</code></span>
      </div>
      <div class="company-actions">
        <a href="${getBoardUrl(comp.ats, comp.slug)}" target="_blank" rel="noopener noreferrer" class="btn-icon" title="Open public careers page">↗ View Board</a>
        <button class="btn-icon" onclick="removeCompany(${idx})" title="Remove company">🗑️</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function getBoardUrl(ats, slug) {
  if (ats === 'greenhouse') return `https://boards.greenhouse.io/${slug}`;
  if (ats === 'lever') return `https://jobs.lever.co/${slug}`;
  if (ats === 'ashby') return `https://jobs.ashbyhq.com/${slug}`;
  return '#';
}

function removeCompany(index) {
  const comp = appState.companies[index];
  if (confirm(`Remove ${comp.name} from target companies?`)) {
    appState.companies.splice(index, 1);
    document.getElementById('companies-count-tab').textContent = appState.companies.length;
    renderCompaniesGrid();
    showToast(`Removed ${comp.name}. Click "Save Changes" to apply.`, 'info');
  }
}

async function saveCompanies() {
  try {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies: appState.companies }),
    });
    if (res.ok) {
      showToast('Companies saved to companies.yaml! 💾', 'success');
      fetchStatus();
    } else {
      showToast('Failed to save companies.', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function openAddCompanyModal() {
  document.getElementById('new-comp-name').value = '';
  document.getElementById('new-comp-slug').value = '';
  document.getElementById('modal-add-company').classList.add('open');
}

function closeAddCompanyModal() {
  document.getElementById('modal-add-company').classList.remove('open');
}

function submitAddCompany() {
  const name = document.getElementById('new-comp-name').value.trim();
  const ats = document.getElementById('new-comp-ats').value;
  const slug = document.getElementById('new-comp-slug').value.trim();

  if (!name || !slug) {
    showToast('Please enter both Company Name and ATS Slug.', 'error');
    return;
  }

  appState.companies.push({ ats, slug, name });
  document.getElementById('companies-count-tab').textContent = appState.companies.length;
  renderCompaniesGrid();
  closeAddCompanyModal();
  saveCompanies();
  showToast(`Added ${name}!`, 'success');
}

// --------------------------------------------------------------------------
// Config & Filters
// --------------------------------------------------------------------------
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    appState.config = data.config || {};

    const filters = appState.config.filters || {};
    document.getElementById('filter-include-titles').value = (filters.include_titles || []).join('\n');
    document.getElementById('filter-exclude-titles').value = (filters.exclude_titles || []).join('\n');
    document.getElementById('filter-locations').value = (filters.locations || []).join('\n');
    document.getElementById('filter-allow-remote').checked = Boolean(filters.allow_remote);

    const threshold = appState.config.score_threshold || 7.0;
    document.getElementById('filter-score-threshold').value = threshold;
    document.getElementById('score-threshold-val').textContent = Number(threshold).toFixed(1);

    document.getElementById('filter-max-digest').value = appState.config.max_per_digest || 5;
    document.getElementById('filter-max-age').value = filters.max_age_days || 30;
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

function updateScoreVal(val) {
  document.getElementById('score-threshold-val').textContent = Number(val).toFixed(1);
}

async function saveConfig() {
  try {
    const include = document.getElementById('filter-include-titles').value.split('\n').map(s => s.trim()).filter(Boolean);
    const exclude = document.getElementById('filter-exclude-titles').value.split('\n').map(s => s.trim()).filter(Boolean);
    const locs = document.getElementById('filter-locations').value.split('\n').map(s => s.trim()).filter(Boolean);
    const allowRemote = document.getElementById('filter-allow-remote').checked;
    const threshold = parseFloat(document.getElementById('filter-score-threshold').value);
    const maxDigest = parseInt(document.getElementById('filter-max-digest').value, 10);
    const maxAge = parseInt(document.getElementById('filter-max-age').value, 10);

    const newCfg = {
      ...appState.config,
      filters: {
        include_titles: include,
        exclude_titles: exclude,
        locations: locs,
        allow_remote: allowRemote,
        max_age_days: maxAge,
      },
      score_threshold: threshold,
      max_per_digest: maxDigest,
    };

    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: newCfg }),
    });

    if (res.ok) {
      appState.config = newCfg;
      showToast('Filters saved to config.yaml! 💾', 'success');
    } else {
      showToast('Failed to save config.', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// --------------------------------------------------------------------------
// Tracker
// --------------------------------------------------------------------------
async function loadTracker() {
  try {
    const res = await fetch('/api/tracker');
    const data = await res.json();
    appState.tracker = data.items || [];
    renderTrackerTable();
  } catch (err) {
    console.error('Error loading tracker:', err);
  }
}

function renderTrackerTable() {
  const tbody = document.getElementById('tracker-tbody');
  tbody.innerHTML = '';

  if (appState.tracker.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#8b949e;">No tracked jobs found yet. Run your first search!</td></tr>`;
    return;
  }

  let totalApplied = 0;
  let totalEmailed = 0;

  appState.tracker.forEach(item => {
    if (item.applied) totalApplied++;
    if (item.emailed) totalEmailed++;

    const tr = document.createElement('tr');
    const score = item.score !== null ? Number(item.score).toFixed(1) : '-';
    let scoreClass = 'score-low';
    if (item.score >= 7.0) scoreClass = 'score-high';
    else if (item.score >= 4.0) scoreClass = 'score-mid';

    const isApplied = Boolean(item.applied);

    tr.innerHTML = `
      <td>
        <span class="status-pill" style="font-size:11px;padding:2px 8px;border-color:${isApplied ? '#34d399' : '#8b949e'};color:${isApplied ? '#34d399' : '#8b949e'}">
          ${isApplied ? 'Applied ✓' : (item.emailed ? 'In Digest' : 'Seen')}
        </span>
      </td>
      <td><span class="score-cell ${scoreClass}">${score}</span></td>
      <td><strong>${escapeHtml(item.company || '-')}</strong></td>
      <td>${escapeHtml(item.title || '-')}</td>
      <td>${escapeHtml(item.location || '-')}</td>
      <td style="color:#8b949e;font-size:12px;">${(item.first_seen || '').slice(0, 10)}</td>
      <td>
        <div style="display:flex;gap:8px;">
          ${item.url ? `<a href="${item.url}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline" style="padding:3px 8px;font-size:12px;">View</a>` : ''}
          <button class="btn btn-sm ${isApplied ? 'btn-secondary' : 'btn-primary'}" style="padding:3px 8px;font-size:12px;" onclick="toggleApplied('${item.job_id}', ${!isApplied})">
            ${isApplied ? 'Unmark' : 'Mark Applied'}
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('metric-emailed').textContent = totalEmailed;
}

async function toggleApplied(jobId, applied) {
  try {
    const res = await fetch('/api/tracker/applied', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, applied }),
    });
    if (res.ok) {
      showToast(applied ? 'Marked as Applied! 🎯' : 'Unmarked applied status.', 'info');
      loadTracker();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function confirmResetSeen() {
  if (confirm('Reset seen jobs history? This lets all postings be re-screened as fresh on your next run.')) {
    try {
      const res = await fetch('/api/reset-seen', { method: 'POST' });
      if (res.ok) {
        showToast('Seen history reset to fresh! 🔄', 'success');
        loadTracker();
        fetchStatus();
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }
}

// --------------------------------------------------------------------------
// Tabs & UI Helpers
// --------------------------------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const btn = document.getElementById(`tab-btn-${tabId}`);
  const content = document.getElementById(`tab-${tabId}`);
  if (btn && content) {
    btn.classList.add('active');
    content.classList.add('active');
  }
}

function toggleConsole() {
  document.getElementById('console-drawer').classList.toggle('open');
}

function openConsole() {
  document.getElementById('console-drawer').classList.add('open');
}

function clearLogs() {
  document.getElementById('console-body').innerHTML = '<div class="log-line text-muted">[System] Logs cleared.</div>';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️'}</span>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function copyText(text, label = 'Content') {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label} copied to clipboard! 📋`, 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
