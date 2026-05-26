/* ══════════════════════════════════════
   NutriTrack — App
══════════════════════════════════════ */

// ── Configuración ─────────────────────
const GAS_URL_KEY = 'nt_gas_url';
const PERFIL_KEY  = 'nt_perfil';

// ── Estado ────────────────────────────
let state = {
  page:        'dashboard',
  dashboard:   null,
  metricas:    [],
  progreso:    null,
  pendingFood: null,   // resultado análisis pendiente de confirmar
  charts:      {}
};

// ── Utilidades ────────────────────────
function gasUrl() { return localStorage.getItem(GAS_URL_KEY) || ''; }
function perfilLocal() {
  try { return JSON.parse(localStorage.getItem(PERFIL_KEY)) || {}; } catch { return {}; }
}
function savePerfilLocal(p) { localStorage.setItem(PERFIL_KEY, JSON.stringify(p)); }

function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function formatFecha(f) {
  if (!f) return '';
  const [y,m,d] = f.split('-');
  return `${d}/${m}/${y}`;
}
function formatHora() {
  const d = new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function pct(val, max) { return max > 0 ? Math.min(100, Math.round((val/max)*100)) : 0; }

// ── API ───────────────────────────────
async function api(action, data = {}) {
  const url = gasUrl();
  if (!url) throw new Error('URL del backend no configurada. Andá a Perfil → Configuración.');
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({ action, ...data })
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Error del servidor');
  return json.data;
}

// ── Cálculos ──────────────────────────
function calcMetas(perfil) {
  const { sexo, edad, altura, peso, actividad } = perfil;
  if (!peso || !altura || !edad) return null;
  // Mifflin-St Jeor
  let bmr = 10*+peso + 6.25*+altura - 5*+edad + (sexo === 'm' ? 5 : -161);
  let tdee = Math.round(bmr * (+actividad || 1.55));
  // Recomposición: ligero déficit
  const calorias_meta      = Math.round(tdee * 0.85);
  const proteina_meta      = Math.round(+peso * 1.8);
  const grasas_meta        = Math.round(calorias_meta * 0.25 / 9);
  const carbohidratos_meta = Math.round((calorias_meta - proteina_meta*4 - grasas_meta*9) / 4);
  return { tdee, calorias_meta, proteina_meta, grasas_meta, carbohidratos_meta };
}

// ── Carga / guardado ──────────────────
async function loadDashboard() {
  showLoading('Cargando...');
  state.dashboard = await api('getDashboard', { fecha: hoy() });
  hideLoading();
}
async function loadMetricas() {
  showLoading('Cargando métricas...');
  state.metricas = await api('getMetricas');
  hideLoading();
}
async function loadProgreso() {
  showLoading('Cargando progreso...');
  state.progreso = await api('getProgreso');
  hideLoading();
}

// ── Navegación ────────────────────────
function navigate(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const titles = { dashboard:'Inicio', registro:'Registrar comida', metricas:'Métricas', progreso:'Progreso', perfil:'Mi Perfil' };
  document.getElementById('page-title').textContent = titles[page] || page;
  renderPage(page);
}

async function renderPage(page) {
  const content = document.getElementById('content');
  content.innerHTML = '';
  // Destruir charts anteriores
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};

  try {
    switch(page) {
      case 'dashboard': await renderDashboard(content); break;
      case 'registro':  renderRegistro(content); break;
      case 'metricas':  await renderMetricas(content); break;
      case 'progreso':  await renderProgreso(content); break;
      case 'perfil':    renderPerfil(content); break;
    }
  } catch(err) {
    content.innerHTML = `<div class="card"><p style="color:var(--red)">⚠️ ${err.message}</p></div>`;
  }
}

// ══════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════
async function renderDashboard(el) {
  await loadDashboard();
  const { totales, metas, comidas } = state.dashboard;
  const perfil  = perfilLocal();
  const nombre  = perfil.nombre || 'amigo';
  const restante = metas.calorias - totales.calorias;

  el.innerHTML = `
    <div class="greeting">Hola, ${nombre} 👋</div>
    <div class="greeting-sub">${formatFecha(hoy())} · Objetivo: ${metas.calorias} kcal</div>

    <!-- Calorías -->
    <div class="card">
      <div class="card-title">Calorías del día</div>
      <div class="calorie-ring-container">
        <div class="ring-wrap">
          <canvas id="ring-cal"></canvas>
          <div class="ring-center">
            <span class="ring-calories">${totales.calorias}</span>
            <span class="ring-label">kcal</span>
          </div>
        </div>
        <div class="calorie-details">
          <div class="cal-meta">Meta: <strong>${metas.calorias} kcal</strong></div>
          <div class="cal-meta">Comidas: <strong>${comidas.length}</strong></div>
          ${restante >= 0
            ? `<span class="cal-remaining">✓ ${restante} kcal disponibles</span>`
            : `<span class="cal-over">↑ ${Math.abs(restante)} kcal sobre meta</span>`}
        </div>
      </div>
    </div>

    <!-- Macros -->
    <div class="card">
      <div class="card-title">Macronutrientes</div>
      <div class="macros-grid">
        <div class="macro-item macro-p">
          <div class="macro-label">Proteína</div>
          <div class="macro-val">${totales.proteinas.toFixed(0)}g</div>
          <div class="macro-bar-bg"><div class="macro-bar-fill" style="width:${pct(totales.proteinas, metas.proteinas)}%"></div></div>
          <div style="font-size:.7rem;color:var(--text-3);margin-top:2px">/ ${metas.proteinas}g</div>
        </div>
        <div class="macro-item macro-c">
          <div class="macro-label">Carbos</div>
          <div class="macro-val">${totales.carbohidratos.toFixed(0)}g</div>
          <div class="macro-bar-bg"><div class="macro-bar-fill" style="width:${pct(totales.carbohidratos, metas.carbohidratos)}%"></div></div>
          <div style="font-size:.7rem;color:var(--text-3);margin-top:2px">/ ${metas.carbohidratos}g</div>
        </div>
        <div class="macro-item macro-g">
          <div class="macro-label">Grasas</div>
          <div class="macro-val">${totales.grasas.toFixed(0)}g</div>
          <div class="macro-bar-bg"><div class="macro-bar-fill" style="width:${pct(totales.grasas, metas.grasas)}%"></div></div>
          <div style="font-size:.7rem;color:var(--text-3);margin-top:2px">/ ${metas.grasas}g</div>
        </div>
      </div>
    </div>

    <!-- Comidas del día -->
    <div class="card">
      <div class="section-header">
        <div class="card-title" style="margin:0">Comidas de hoy</div>
        <button class="btn btn-primary" style="padding:6px 14px;font-size:.8rem" onclick="openManualForm()">+ Agregar</button>
      </div>
      ${renderMealList(comidas)}
    </div>
  `;

  // Donut ring
  const pctCal = pct(totales.calorias, metas.calorias);
  const ctx = document.getElementById('ring-cal').getContext('2d');
  state.charts['ring'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [Math.min(pctCal,100), Math.max(0,100-pctCal)],
        backgroundColor: [pctCal > 100 ? '#ef4444' : '#16a34a', '#e2e8f0'],
        borderWidth: 0,
        hoverOffset: 0
      }]
    },
    options: {
      cutout: '72%', responsive: false,
      plugins: { tooltip: { enabled: false }, legend: { display: false } },
      animation: { duration: 600 }
    }
  });
}

function renderMealList(comidas) {
  if (!comidas.length) return `
    <div class="empty-state">
      <div class="empty-icon">🍽️</div>
      <p>Todavía no registraste comidas hoy</p>
    </div>`;
  return `<div class="meals-list">${comidas.map(c => `
    <div class="meal-item">
      <span class="meal-tipo-badge badge-${c.tipo||'snack'}">${c.tipo||'snack'}</span>
      <div class="meal-info">
        <div class="meal-name">${c.nombre}</div>
        <div class="meal-macros">${c.proteinas||0}g P · ${c.carbohidratos||0}g C · ${c.grasas||0}g G · ${c.hora||''}</div>
      </div>
      <span class="meal-cal">${c.calorias} kcal</span>
      <button class="meal-del" onclick="deleteComida('${c.id}')">✕</button>
    </div>`).join('')}</div>`;
}

async function deleteComida(id) {
  try {
    showLoading('Eliminando...');
    await api('deleteComida', { id });
    hideLoading();
    toast('Comida eliminada', 'success');
    await renderDashboard(document.getElementById('content'));
  } catch(e) {
    hideLoading();
    toast(e.message, 'error');
  }
}

// ══════════════════════════════════════
// REGISTRO
// ══════════════════════════════════════
function renderRegistro(el) {
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Foto de la comida</div>
      <div class="photo-actions">
        <button class="photo-btn" onclick="document.getElementById('cam-input').click()">
          <span class="btn-icon-big">📷</span>
          <span>Tomar foto</span>
        </button>
        <button class="photo-btn" onclick="document.getElementById('gallery-input').click()">
          <span class="btn-icon-big">🖼️</span>
          <span>Galería</span>
        </button>
      </div>
      <input id="cam-input" type="file" accept="image/*" capture="environment" class="hidden" onchange="handlePhoto(this)">
      <input id="gallery-input" type="file" accept="image/*" class="hidden" onchange="handlePhoto(this)">
    </div>
    <div class="card">
      <div class="card-title">Entrada manual</div>
      <button class="btn-manual" onclick="openManualForm()">✏️ Registrar sin foto</button>
    </div>
    <div class="card">
      <div class="section-header">
        <div class="card-title" style="margin:0">Comidas de hoy</div>
      </div>
      <div id="registro-list">Cargando...</div>
    </div>
  `;
  // Cargar lista
  api('getComidas', { fecha: hoy() })
    .then(comidas => {
      document.getElementById('registro-list').innerHTML = renderMealList(comidas);
    })
    .catch(e => {
      document.getElementById('registro-list').innerHTML = `<p style="color:var(--red);font-size:.85rem">${e.message}</p>`;
    });
}

async function handlePhoto(input) {
  if (!input.files[0]) return;
  const file = input.files[0];
  input.value = '';

  // Comprimir imagen
  const compressed = await compressImage(file);
  const base64 = compressed.base64;
  const mimeType = compressed.mimeType;

  // Mostrar overlay analizando
  const overlay = document.createElement('div');
  overlay.className = 'analyzing-overlay';
  overlay.innerHTML = '<div class="spinner"></div><p>Analizando con IA...</p>';
  document.body.appendChild(overlay);

  try {
    const result = await api('analyzeFood', { imageBase64: base64, mimeType });
    document.body.removeChild(overlay);

    // Abrir modal con resultado
    state.pendingFood = { ...result, _photoUrl: URL.createObjectURL(file) };
    openFoodModal(result, state.pendingFood._photoUrl);
  } catch(e) {
    document.body.removeChild(overlay);
    toast('Error al analizar: ' + e.message, 'error');
    openManualForm();
  }
}

function compressImage(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 800;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(url);
      resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
    };
    img.src = url;
  });
}

// ══════════════════════════════════════
// MODAL COMIDA
// ══════════════════════════════════════
function openFoodModal(prefill, photoUrl) {
  const modal = document.getElementById('food-modal');
  document.getElementById('modal-title').textContent = photoUrl ? 'Resultado del análisis' : 'Agregar comida';

  // Foto preview
  const resultDiv = document.getElementById('modal-analysis-result');
  const img       = document.getElementById('modal-preview-img');
  const conf      = document.getElementById('modal-confianza');
  if (photoUrl && prefill) {
    resultDiv.classList.remove('hidden');
    img.src = photoUrl;
    const lvl = prefill.confianza || 'media';
    conf.className = `analysis-badge badge-${lvl}`;
    conf.textContent = `Confianza: ${lvl}`;
    if (prefill.descripcion) {
      conf.textContent += ` · ${prefill.descripcion}`;
    }
  } else {
    resultDiv.classList.add('hidden');
    img.src = '';
  }

  // Rellenar form
  if (prefill) {
    setValue('f-nombre',         prefill.nombre         || '');
    setValue('f-calorias',       Math.round(prefill.calorias)    || '');
    setValue('f-proteinas',      (prefill.proteinas     || 0).toFixed(1));
    setValue('f-carbohidratos',  (prefill.carbohidratos || 0).toFixed(1));
    setValue('f-grasas',         (prefill.grasas        || 0).toFixed(1));
  }

  // Tipo por hora
  const h = new Date().getHours();
  const tipo = h < 10 ? 'desayuno' : h < 13 ? 'almuerzo' : h < 17 ? 'merienda' : h < 21 ? 'cena' : 'snack';
  setValue('f-tipo', tipo);
  setValue('f-notas', '');

  modal.classList.remove('hidden');
}

function openManualForm() {
  state.pendingFood = null;
  openFoodModal(null, null);
}

function closeModal() {
  document.getElementById('food-modal').classList.add('hidden');
  state.pendingFood = null;
}

async function submitFood(e) {
  e.preventDefault();
  const comida = {
    nombre:         document.getElementById('f-nombre').value,
    calorias:       +document.getElementById('f-calorias').value,
    proteinas:      +document.getElementById('f-proteinas').value || 0,
    carbohidratos:  +document.getElementById('f-carbohidratos').value || 0,
    grasas:         +document.getElementById('f-grasas').value || 0,
    tipo:           document.getElementById('f-tipo').value,
    notas:          document.getElementById('f-notas').value,
    fecha:          hoy(),
    hora:           formatHora()
  };
  try {
    showLoading('Guardando...');
    await api('addComida', { comida });
    hideLoading();
    closeModal();
    toast('✓ Comida guardada', 'success');
    // Si estamos en dashboard, recargar
    if (state.page === 'dashboard') await renderDashboard(document.getElementById('content'));
    if (state.page === 'registro')  renderRegistro(document.getElementById('content'));
  } catch(err) {
    hideLoading();
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════
// MÉTRICAS
// ══════════════════════════════════════
async function renderMetricas(el) {
  await loadMetricas();
  const latest  = state.metricas[0] || {};

  el.innerHTML = `
    <!-- Últimas métricas -->
    <div class="card">
      <div class="card-title">Última medición ${latest.fecha ? '— ' + formatFecha(latest.fecha) : ''}</div>
      <div class="metrics-latest">
        <div class="metric-chip">
          <div class="chip-val">${latest.peso_kg || '—'}</div>
          <div class="chip-lbl">kg · Peso</div>
        </div>
        <div class="metric-chip">
          <div class="chip-val">${latest.grasa_pct ? latest.grasa_pct + '%' : '—'}</div>
          <div class="chip-lbl">% Grasa</div>
        </div>
        <div class="metric-chip">
          <div class="chip-val">${latest.musculo_pct ? latest.musculo_pct + '%' : '—'}</div>
          <div class="chip-lbl">% Músculo</div>
        </div>
        <div class="metric-chip">
          <div class="chip-val">${latest.cintura_cm || '—'}</div>
          <div class="chip-lbl">cm · Cintura</div>
        </div>
      </div>
    </div>

    <!-- Nueva medición -->
    <div class="card">
      <div class="card-title">Registrar nueva medición</div>
      <form id="metrica-form" onsubmit="submitMetrica(event)">
        <div class="form-row">
          <div class="form-group">
            <label>Peso (kg)</label>
            <input type="number" id="m-peso" step="0.1" min="30" max="300" placeholder="${latest.peso_kg || '75'}">
          </div>
          <div class="form-group">
            <label>% Grasa</label>
            <input type="number" id="m-grasa" step="0.1" min="3" max="60" placeholder="${latest.grasa_pct || ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>% Músculo</label>
            <input type="number" id="m-musculo" step="0.1" min="20" max="80" placeholder="${latest.musculo_pct || ''}">
          </div>
          <div class="form-group">
            <label>Cintura (cm)</label>
            <input type="number" id="m-cintura" step="0.5" min="50" max="200" placeholder="${latest.cintura_cm || ''}">
          </div>
        </div>
        <div class="form-group">
          <label>Cadera (cm)</label>
          <input type="number" id="m-cadera" step="0.5" min="50" max="200" placeholder="${latest.cadera_cm || ''}">
        </div>
        <div class="form-group">
          <label>Notas</label>
          <input type="text" id="m-notas" placeholder="Ej: en ayunas, después de entrenar...">
        </div>
        <button type="submit" class="btn btn-primary btn-full">Guardar medición</button>
      </form>
    </div>

    <!-- Historial -->
    ${state.metricas.length > 1 ? `
    <div class="card">
      <div class="card-title">Historial</div>
      <div class="metrics-history">
        ${state.metricas.slice(0,20).map(m => `
          <div class="metric-row">
            <span class="mr-date">${formatFecha(m.fecha)}</span>
            <div class="mr-vals">
              ${m.peso_kg    ? `<span class="mr-val">${m.peso_kg} kg</span>` : ''}
              ${m.grasa_pct  ? `<span class="mr-val" style="color:var(--orange)">${m.grasa_pct}% G</span>` : ''}
              ${m.musculo_pct? `<span class="mr-val" style="color:var(--blue)">${m.musculo_pct}% M</span>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>` : ''}
  `;
}

async function submitMetrica(e) {
  e.preventDefault();
  const metrica = {
    peso_kg:    document.getElementById('m-peso').value,
    grasa_pct:  document.getElementById('m-grasa').value,
    musculo_pct:document.getElementById('m-musculo').value,
    cintura_cm: document.getElementById('m-cintura').value,
    cadera_cm:  document.getElementById('m-cadera').value,
    notas:      document.getElementById('m-notas').value,
    fecha:      hoy()
  };
  try {
    showLoading('Guardando...');
    await api('addMetrica', { metrica });
    hideLoading();
    toast('✓ Métricas guardadas', 'success');
    await renderMetricas(document.getElementById('content'));
  } catch(err) {
    hideLoading();
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════
// PROGRESO
// ══════════════════════════════════════
async function renderProgreso(el) {
  await loadProgreso();
  const { metricas, calorias_hist } = state.progreso;
  const pesos = metricas.filter(m => m.peso_kg).slice(-30);
  const grasas = metricas.filter(m => m.grasa_pct).slice(-20);

  el.innerHTML = `
    <!-- Peso -->
    <div class="card chart-card">
      <div class="card-title">Evolución del peso</div>
      ${pesos.length > 1
        ? `<div class="chart-wrap"><canvas id="chart-peso"></canvas></div>`
        : `<div class="empty-state"><div class="empty-icon">⚖️</div><p>Registrá al menos 2 mediciones de peso</p></div>`}
    </div>

    <!-- Composición corporal -->
    <div class="card chart-card">
      <div class="card-title">Composición corporal</div>
      ${grasas.length > 1
        ? `<div class="chart-wrap"><canvas id="chart-comp"></canvas></div>`
        : `<div class="empty-state"><div class="empty-icon">💪</div><p>Registrá % grasa y músculo en Métricas</p></div>`}
    </div>

    <!-- Calorías últimos 14 días -->
    <div class="card chart-card">
      <div class="card-title">Calorías — últimos 14 días</div>
      <div class="chart-wrap"><canvas id="chart-cal"></canvas></div>
    </div>
  `;

  // Chart peso
  if (pesos.length > 1) {
    state.charts['peso'] = new Chart(document.getElementById('chart-peso').getContext('2d'), {
      type: 'line',
      data: {
        labels: pesos.map(m => formatFecha(m.fecha)),
        datasets: [{
          label: 'Peso (kg)',
          data: pesos.map(m => +m.peso_kg),
          borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.08)',
          borderWidth: 2, pointRadius: 4, fill: true, tension: .3
        }]
      },
      options: chartOpts('kg')
    });
  }

  // Chart composición
  if (grasas.length > 1) {
    const musculos = metricas.filter(m => m.musculo_pct).slice(-20);
    state.charts['comp'] = new Chart(document.getElementById('chart-comp').getContext('2d'), {
      type: 'line',
      data: {
        labels: grasas.map(m => formatFecha(m.fecha)),
        datasets: [
          {
            label: '% Grasa',
            data: grasas.map(m => +m.grasa_pct),
            borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,.08)',
            borderWidth: 2, pointRadius: 4, fill: true, tension: .3
          },
          {
            label: '% Músculo',
            data: musculos.map(m => +m.musculo_pct),
            borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)',
            borderWidth: 2, pointRadius: 4, fill: true, tension: .3
          }
        ]
      },
      options: chartOpts('%')
    });
  }

  // Chart calorías
  const perfil = perfilLocal();
  const metaCal = +perfil.calorias_meta || 2000;
  state.charts['cal'] = new Chart(document.getElementById('chart-cal').getContext('2d'), {
    type: 'bar',
    data: {
      labels: calorias_hist.map(d => d.fecha.slice(5).replace('-','/')),
      datasets: [
        {
          label: 'Calorías',
          data: calorias_hist.map(d => d.calorias),
          backgroundColor: calorias_hist.map(d => d.calorias > metaCal ? 'rgba(239,68,68,.7)' : 'rgba(22,163,74,.7)'),
          borderRadius: 4
        }
      ]
    },
    options: {
      ...chartOpts('kcal'),
      plugins: {
        ...chartOpts('kcal').plugins,
        annotation: {
          annotations: {
            meta: {
              type: 'line', yMin: metaCal, yMax: metaCal,
              borderColor: '#16a34a', borderWidth: 1.5, borderDash: [4,4]
            }
          }
        }
      }
    }
  });
}

function chartOpts(unit) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw} ${unit}` } } },
    scales: {
      x: { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { display: false } },
      y: { ticks: { font: { size: 11 } }, grid: { color: '#e2e8f0' } }
    }
  };
}

// ══════════════════════════════════════
// PERFIL
// ══════════════════════════════════════
function renderPerfil(el) {
  const p    = perfilLocal();
  const metas = calcMetas(p) || {};

  el.innerHTML = `
    <!-- Cabecera -->
    <div class="card">
      <div class="profile-header">
        <div class="avatar">🏃</div>
        <div>
          <div class="profile-name">${p.nombre || 'Mi perfil'}</div>
          <div class="profile-sub">
            ${p.sexo === 'm' ? 'Masculino' : p.sexo === 'f' ? 'Femenino' : ''}
            ${p.edad ? '· ' + p.edad + ' años' : ''}
            ${p.altura ? '· ' + p.altura + ' cm' : ''}
          </div>
        </div>
      </div>
      <div class="stats-row">
        <div class="stat-box">
          <div class="sb-val">${p.peso || '—'}</div>
          <div class="sb-lbl">kg actual</div>
        </div>
        <div class="stat-box">
          <div class="sb-val">${p.peso_obj || '—'}</div>
          <div class="sb-lbl">kg objetivo</div>
        </div>
        <div class="stat-box">
          <div class="sb-val">${metas.calorias_meta || p.calorias_meta || '—'}</div>
          <div class="sb-lbl">kcal/día</div>
        </div>
      </div>
    </div>

    <!-- Metas calculadas -->
    ${metas.tdee ? `
    <div class="card">
      <div class="card-title">Tus metas diarias (recomposición)</div>
      <div class="macros-grid">
        <div class="macro-item macro-p">
          <div class="macro-label">Proteína</div>
          <div class="macro-val">${metas.proteina_meta}g</div>
        </div>
        <div class="macro-item macro-c">
          <div class="macro-label">Carbos</div>
          <div class="macro-val">${metas.carbohidratos_meta}g</div>
        </div>
        <div class="macro-item macro-g">
          <div class="macro-label">Grasas</div>
          <div class="macro-val">${metas.grasas_meta}g</div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:.8rem;color:var(--text-2)">
        TDEE estimado: ${metas.tdee} kcal · Déficit ~15% para recomposición
      </div>
    </div>` : ''}

    <!-- Editar datos -->
    <div class="card">
      <div class="card-title">Editar datos personales</div>
      <form id="perfil-form" onsubmit="submitPerfil(event)">
        <div class="form-row">
          <div class="form-group">
            <label>Nombre</label>
            <input type="text" id="p-nombre" value="${p.nombre||''}" placeholder="Tu nombre">
          </div>
          <div class="form-group">
            <label>Sexo</label>
            <select id="p-sexo">
              <option value="m" ${p.sexo==='m'?'selected':''}>Masculino</option>
              <option value="f" ${p.sexo==='f'?'selected':''}>Femenino</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Edad</label>
            <input type="number" id="p-edad" value="${p.edad||''}" placeholder="Años" min="10" max="100">
          </div>
          <div class="form-group">
            <label>Altura (cm)</label>
            <input type="number" id="p-altura" value="${p.altura||''}" placeholder="170">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Peso actual (kg)</label>
            <input type="number" id="p-peso" value="${p.peso||''}" step="0.1" placeholder="75">
          </div>
          <div class="form-group">
            <label>Peso objetivo (kg)</label>
            <input type="number" id="p-peso-obj" value="${p.peso_obj||''}" step="0.1" placeholder="70">
          </div>
        </div>
        <div class="form-group">
          <label>Nivel de actividad</label>
          <select id="p-actividad">
            <option value="1.2"   ${p.actividad==='1.2'?'selected':''}>Sedentario</option>
            <option value="1.375" ${p.actividad==='1.375'?'selected':''}>Ligeramente activo</option>
            <option value="1.55"  ${(!p.actividad||p.actividad==='1.55')?'selected':''}>Moderadamente activo</option>
            <option value="1.725" ${p.actividad==='1.725'?'selected':''}>Muy activo</option>
            <option value="1.9"   ${p.actividad==='1.9'?'selected':''}>Extremadamente activo</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-full">Guardar perfil</button>
      </form>
    </div>

    <!-- Config backend -->
    <div class="card">
      <div class="card-title">Configuración</div>
      <div class="form-group">
        <label>URL del Apps Script</label>
        <input type="url" id="p-gas-url" value="${gasUrl()}" placeholder="https://script.google.com/macros/s/...">
      </div>
      <button class="btn btn-ghost btn-full" onclick="saveGasUrl()">Guardar URL</button>
    </div>
  `;
}

async function submitPerfil(e) {
  e.preventDefault();
  const p = {
    nombre:           document.getElementById('p-nombre').value,
    sexo:             document.getElementById('p-sexo').value,
    edad:             document.getElementById('p-edad').value,
    altura:           document.getElementById('p-altura').value,
    peso:             document.getElementById('p-peso').value,
    peso_obj:         document.getElementById('p-peso-obj').value,
    actividad:        document.getElementById('p-actividad').value,
  };
  // Calcular metas
  const metas = calcMetas(p);
  if (metas) {
    p.calorias_meta      = metas.calorias_meta;
    p.proteina_meta      = metas.proteina_meta;
    p.carbohidratos_meta = metas.carbohidratos_meta;
    p.grasas_meta        = metas.grasas_meta;
  }
  savePerfilLocal(p);
  try {
    showLoading('Guardando...');
    await api('savePerfil', { perfil: p });
    hideLoading();
    toast('✓ Perfil actualizado', 'success');
    renderPerfil(document.getElementById('content'));
  } catch(err) {
    hideLoading();
    toast(err.message, 'error');
  }
}

function saveGasUrl() {
  const url = document.getElementById('p-gas-url').value.trim();
  localStorage.setItem(GAS_URL_KEY, url);
  toast('URL guardada', 'success');
}

// ══════════════════════════════════════
// SETUP WIZARD
// ══════════════════════════════════════
function wizardNext(step) {
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.add('hidden'));
  document.getElementById('step-' + step).classList.remove('hidden');
}

async function wizardFinish() {
  const gasUrlVal = document.getElementById('w-gas-url').value.trim();
  if (!gasUrlVal) { toast('Ingresá la URL del Apps Script', 'error'); return; }

  const p = {
    nombre:   document.getElementById('w-nombre').value.trim(),
    sexo:     document.getElementById('w-sexo').value,
    edad:     document.getElementById('w-edad').value,
    altura:   document.getElementById('w-altura').value,
    peso:     document.getElementById('w-peso').value,
    peso_obj: document.getElementById('w-peso-obj').value,
    actividad:document.getElementById('w-actividad').value,
  };

  const metas = calcMetas(p);
  if (metas) {
    p.calorias_meta      = metas.calorias_meta;
    p.proteina_meta      = metas.proteina_meta;
    p.carbohidratos_meta = metas.carbohidratos_meta;
    p.grasas_meta        = metas.grasas_meta;
  }

  localStorage.setItem(GAS_URL_KEY, gasUrlVal);
  savePerfilLocal(p);

  try {
    showLoading('Configurando...');
    await api('savePerfil', { perfil: p });
    hideLoading();
    launchApp();
  } catch(err) {
    hideLoading();
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════
// LOADING + TOAST + HELPERS
// ══════════════════════════════════════
function showLoading(text = 'Cargando...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

function toast(msg, type = '') {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  document.getElementById('toast-container').appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// Cerrar modal al hacer click fuera
document.getElementById('food-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ══════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════
function launchApp() {
  document.getElementById('setup-wizard').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  // Fecha en header
  const dias  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const now   = new Date();
  document.getElementById('fecha-hoy').textContent = `${dias[now.getDay()]} ${now.getDate()} ${meses[now.getMonth()]}`;
  navigate('dashboard');
}

function init() {
  const url    = gasUrl();
  const perfil = perfilLocal();
  if (url && perfil.nombre) {
    launchApp();
  } else {
    document.getElementById('setup-wizard').classList.remove('hidden');
    // Pre-rellenar nombre si existe
    if (perfil.nombre) setValue('w-nombre', perfil.nombre);
    if (url) setValue('w-gas-url', url);
  }
}

init();
