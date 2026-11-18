/**
 * SplitTag results dashboard (vanilla ES module).
 */

const picker = document.getElementById('experiment-picker');
const statusMessage = document.getElementById('status-message');
const decisionCard = document.getElementById('decision-card');
const decisionBadge = document.getElementById('decision-badge');
const decisionReason = document.getElementById('decision-reason');
const progressPanel = document.getElementById('progress-panel');
const progressFill = document.getElementById('progress-fill');
const progressTrack = document.getElementById('progress-track');
const progressLabel = document.getElementById('progress-label');
const progressNote = document.getElementById('progress-note');
const chartPanel = document.getElementById('chart-panel');
const chart = document.getElementById('chart');
const tablePanel = document.getElementById('table-panel');
const variantRows = document.getElementById('variant-rows');
const visitorTotal = document.getElementById('visitor-total');
const goalsPanel = document.getElementById('goals-panel');
const goalRows = document.getElementById('goal-rows');

init();

async function init() {
  try {
    const response = await fetch('/api/experiments');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const experiments = await response.json();
    if (!Array.isArray(experiments) || experiments.length === 0) {
      statusMessage.textContent = 'No experiments yet. Create one in the visual editor.';
      return;
    }
    experiments.forEach((experiment) => {
      const option = document.createElement('option');
      option.value = experiment.id;
      option.textContent = `${experiment.name} (${experiment.status})`;
      picker.appendChild(option);
    });
    const requested = new URLSearchParams(location.search).get('experiment');
    const initial = experiments.find((experiment) => experiment.id === requested) ||
      experiments.find((experiment) => experiment.status === 'running') ||
      experiments[0];
    picker.value = initial.id;
    picker.addEventListener('change', () => load(picker.value));
    await load(initial.id);
  } catch (err) {
    statusMessage.textContent = `Could not load results: ${err.message}`;
    statusMessage.classList.add('error');
  }
}

async function load(id) {
  statusMessage.hidden = false;
  statusMessage.classList.remove('error');
  statusMessage.textContent = 'Loading results…';
  try {
    const response = await fetch(`/api/results/${encodeURIComponent(id)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    render(payload);
    history.replaceState(null, '', `?experiment=${encodeURIComponent(id)}`);
  } catch (err) {
    statusMessage.textContent = `Could not load experiment "${id}": ${err.message}`;
    statusMessage.classList.add('error');
    decisionCard.hidden = true;
    progressPanel.hidden = true;
    chartPanel.hidden = true;
    tablePanel.hidden = true;
    goalsPanel.hidden = true;
  }
}

function render(result) {
  statusMessage.hidden = true;
  decisionCard.hidden = false;
  progressPanel.hidden = false;
  chartPanel.hidden = false;
  tablePanel.hidden = false;
  goalsPanel.hidden = false;

  const control = result.variants.find((variant) => variant.isControl) || result.variants[0];
  const treatment = result.variants.find((variant) => !variant.isControl) || result.variants[1];

  decisionCard.className = `decision-card decision-${slug(result.decision)}`;
  decisionBadge.className = `decision-badge ${slug(result.decision)}`;
  decisionBadge.textContent = result.decision;
  decisionReason.textContent = result.reason;

  document.getElementById('stat-control').textContent = control ? formatPct(control.conversionRate) : '—';
  document.getElementById('stat-variant').textContent = treatment ? formatPct(treatment.conversionRate) : '—';
  document.getElementById('stat-lift').textContent = result.test && Number.isFinite(result.test.lift)
    ? formatSignedPct(result.test.lift)
    : '—';
  document.getElementById('stat-p').textContent = formatPValue(result.test && result.test.pValue);

  renderProgress(result, control, treatment);
  renderChart(result);
  renderTable(result, control);
  renderGoals(result);
}

function renderProgress(result, control, treatment) {
  const perArm = control && treatment ? Math.min(control.visitors, treatment.visitors) : control ? control.visitors : 0;
  const required = Number.isFinite(result.requiredSampleSize) ? result.requiredSampleSize : null;
  const progress = required ? Math.min(100, (perArm / required) * 100) : 0;
  progressFill.style.width = `${progress.toFixed(1)}%`;
  progressTrack.setAttribute('aria-valuenow', String(Math.round(progress)));
  progressLabel.textContent = `${perArm.toLocaleString('en-US')} / ${required ? required.toLocaleString('en-US') : '—'} per arm`;
  progressNote.textContent = required
    ? `${progress.toFixed(1)}% of the planned sample. Required sample is based on the observed absolute lift (${formatPct(result.minimumDetectableEffect)}), 80% power, and α=${result.alpha}.`
    : 'No sample-size target is available yet.';
}

function renderChart(result) {
  const variants = result.variants;
  const maxRate = Math.max(0.0001, ...variants.map((variant) => variant.rateCI95 ? variant.rateCI95[1] : 0));
  const scale = Math.max(maxRate, ...variants.map((variant) => variant.conversionRate)) * 1.1;
  chart.innerHTML = variants.map((variant) => {
    const rate = variant.conversionRate;
    const height = Math.max(0.8, (rate / scale) * 100);
    const ci = variant.rateCI95 || [0, 0];
    const lo = Math.max(0, (ci[0] / scale) * 100);
    const hi = Math.min(100, (ci[1] / scale) * 100);
    return `
      <div class="chart-col">
        <div class="chart-plot">
          <div class="chart-bar ${variant.isControl ? 'control' : ''}" style="height:${height.toFixed(2)}%" title="${escapeAttr(variant.name)}: ${formatPct(rate)}"></div>
          <div class="chart-whisker" style="bottom:${lo.toFixed(2)}%;height:${Math.max(0.5, hi - lo).toFixed(2)}%" title="95% CI ${formatPct(ci[0])}–${formatPct(ci[1])}"></div>
        </div>
        <div class="chart-rate">${formatPct(rate)}</div>
        <div class="chart-label"><strong>${escapeHtml(variant.name)}</strong>${formatCount(variant.conversions)} / ${formatCount(variant.visitors)}</div>
      </div>
    `;
  }).join('');
  chart.setAttribute('aria-label',
    `Conversion rates: ${variants.map((variant) => `${variant.name} ${formatPct(variant.conversionRate)}`).join(', ')}`);
}

function renderTable(result, control) {
  visitorTotal.textContent = `${formatCount(result.totalVisitors)} exposed visitors total`;
  variantRows.innerHTML = result.variants.map((variant) => {
    const liftClass = variant.isControl ? '' : (variant.lift >= 0 ? 'positive' : 'negative');
    return `
      <tr class="${variant.isControl ? 'control-row' : ''}">
        <td>
          <span class="variant-name">${escapeHtml(variant.name)}</span>
          ${variant.isControl ? '<span class="control-tag">Control</span>' : ''}
        </td>
        <td class="num">${formatCount(variant.visitors)}</td>
        <td class="num">${formatCount(variant.conversions)}</td>
        <td class="num">${formatPct(variant.conversionRate)}</td>
        <td class="num ${liftClass}">${variant.isControl ? '—' : formatSignedPct(variant.lift)}</td>
        <td class="num">${variant.isControl || !variant.liftCI95 ? '—' : `${formatSignedPct(variant.liftCI95[0])} to ${formatSignedPct(variant.liftCI95[1])}`}</td>
        <td class="num">${variant.isControl ? '—' : formatPValue(variant.pValue)}</td>
      </tr>
    `;
  }).join('');
}

function renderGoals(result) {
  if (!result.goals || result.goals.length === 0) {
    goalsPanel.hidden = true;
    return;
  }
  const control = result.variants.find((variant) => variant.isControl) || result.variants[0];
  const treatment = result.variants.find((variant) => !variant.isControl);
  goalRows.innerHTML = result.goals.map((goal) => {
    const controlStat = goal.variants.find((variant) => variant.variantId === (control && control.id));
    const treatmentStat = goal.variants.find((variant) => variant.variantId === (treatment && treatment.id));
    return `
      <tr>
        <td>${escapeHtml(goal.name)}</td>
        <td><code>${escapeHtml(goal.type)}</code></td>
        <td class="num">${controlStat ? `${formatCount(controlStat.conversions)} (${formatPct(controlStat.conversionRate)})` : '—'}</td>
        <td class="num">${treatmentStat ? `${formatCount(treatmentStat.conversions)} (${formatPct(treatmentStat.conversionRate)})` : '—'}</td>
      </tr>
    `;
  }).join('');
}

function formatPct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatSignedPct(value) {
  const number = Number(value || 0) * 100;
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function formatPValue(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 0.0001) return '<0.0001';
  return value.toFixed(4);
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
