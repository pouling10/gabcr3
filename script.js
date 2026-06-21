// ==============================
// CR3 DE GAB — ROULETTE VIRTUELLE (version finale intégrée)
// ==============================

// --- Outils mathématiques
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;
const norm360 = a => ((a % 360) + 360) % 360;
const shortestDeg = (a, b) => ((b - a + 540) % 360) - 180;
const EPS = 0.0001;

// --- Canvas setup (roulette)
const canvas = document.getElementById('roulette');
const ctx = canvas.getContext('2d');
const width = canvas.width;
const height = canvas.height;
const cx = width / 2;
const cy = height / 2;
const radius = Math.min(width, height) / 2 - 12;

// --- Inputs / outputs
const windDirInput = document.getElementById('windDir');
const windSpeedInput = document.getElementById('windSpeed');
const gustInput = document.getElementById('gust');
const declInput = document.getElementById('declination'); // manuel
const ewSelect = document.getElementById('eastWest'); // manuel
const runwayInput = document.getElementById('runway'); // manuel (degrés)
const icaoAutoInput = document.getElementById('icaoAuto'); // automatique

const windMagText = document.getElementById('windMagText');
const headEl = document.getElementById('headwind');
const crossEl = document.getElementById('crosswind');
const calcBtn = document.getElementById('calculateBtn');
const airportResult = document.getElementById('airportResult');

// Etat global pour dessiner flèches
let currentRotation = 0;
let targetRotation = 0;
let currentWindMag = 0;    // vent magnétique (manuel)
let currentRunway = 0;     // piste (manuel)
let autoWind = null;       // { runway: heading, wind: windMag } for auto arrow (bleue)
let manualWind = null;     // { runway, wind } for manual arrow (verte)

// ==============================
// ✈️ Limites de longueur / largeur selon modèle
// ==============================
const aircraftLimits = {
  "avion.png": { minLength: 6000, minWidth: 150 }, // Boeing 737
  "pc12.png": { minLength: 3000, minWidth: 80 },   // Pilatus PC-12
  "dhc8.png": { minLength: 3500, minWidth: 80 }    // De Havilland DHC-8
};

// ==============================
// FONCTIONS UTILITAIRES
// ==============================
function parseDeclinationString(s) {
  // s example: "16°W" or "16W" or "16°W " - returns {value:16, dir:'W'} or null
  if (!s) return null;
  const match = String(s).trim().match(/(\-?\d+(?:\.\d+)?)[^\d]*([EW])/i);
  if (!match) return null;
  return { value: parseFloat(match[1]), dir: match[2].toUpperCase() };
}

function convertTrueToMag(trueDeg, declString) {
  // User rule: West = add, East = subtract
  const d = parseDeclinationString(declString);
  if (!d) return norm360(trueDeg);
  if (d.dir === 'W') return norm360(trueDeg + d.value);
  return norm360(trueDeg - d.value);
}

function formatDirDegrees(v) {
  return `${norm360(Math.round(v))}°`;
}

// ==============================
// CALCULS ET LOGIQUE (MANUEL)
// ==============================
function calculate() {
  // Manuel : on ne calcule/rend les résultats que si piste ET vent renseignés
  const windTrue = parseFloat(windDirInput.value);
  const windSpeed = parseFloat(windSpeedInput.value);
  const gust = parseFloat(gustInput.value);
  const decl = parseFloat(declInput.value); // manuel input value (not used if using EW select parsing below)
  const ew = ewSelect.value;
  const runway = parseFloat(runwayInput.value);

  // Si un des champs manuels manquent -> efface sorties manuelles, affiche roulette neutre
  if (!runwayInput.value || !windDirInput.value || !windSpeedInput.value) {
    windMagText.textContent = "";
    headEl.textContent = "";
    crossEl.textContent = "";
    document.getElementById("crosswindAlert").style.display = "none";

    // Keep manualWind null so draw3D only shows auto arrow (if present)
    manualWind = null;
    draw3D();
    return;
  }

  // compute signed declination from manual decl inputs (EW select + numeric)
  const declSigned = (ew === 'E') ? -decl : decl;
  // convert wind TRUE -> MAG (for manual mode we apply conversion)
  const windMagManual = norm360(windTrue + declSigned);

  currentWindMag = windMagManual;
  currentRunway = norm360(runway);

  const diff = ((currentWindMag - currentRunway + 540) % 360) - 180;
  const diffRad = toRad(diff);
  const headwind = windSpeed * Math.cos(diffRad);
  const crosswind = ((!isNaN(gust) && gust > 0) ? gust : windSpeed) * Math.sin(diffRad);

  windMagText.textContent = `${currentWindMag.toFixed(0)}°`;
  headEl.textContent = `${headwind.toFixed(2)} kt`;

  let crossDir = "";
  if (crosswind < 0) crossDir = "gauche";
  else if (crosswind > 0) crossDir = "droite";
  crossEl.textContent = `${Math.abs(crosswind).toFixed(2)} kt ${crossDir}`;

  // Crosswind warnings (anglais professionnel)
 const alertBox = document.getElementById("crosswindAlert");
const selectedModel = document.getElementById("aircraftSelect").value;
let message = "";

// Boeing 737 et DHC-8 : limite 36 kt
if ((selectedModel === "avion.png" || selectedModel === "dhc8.png") && Math.abs(crosswind) > 36) {
  message = "⚠️ CROSSWIND COMPONENT EXCEEDS DEMONSTRATED LIMIT (36 KT)⚠️";
}
// PC-12 : limite 15 kt + recommandation volets
else if (selectedModel === "pc12.png" && Math.abs(crosswind) > 15) {
  message = "⚠️ CROSSWIND COMPONENT EXCEEDS DEMONSTRATED LIMIT (15 KT). SET FLAPS TO APPROPRIATE POSITION⚠️";
}

if (message) {
  alertBox.textContent = message;
  alertBox.style.display = "block";
} else {
  alertBox.style.display = "none";
}


  // store manual wind for drawing (green arrow)
  manualWind = { runway: currentRunway, wind: currentWindMag };

  // Met à jour la vue 3D / roulette (la roulette suit la piste manuelle)
  draw3D();
  targetRotation = norm360(-currentRunway);
  animate();
}

// ==============================
// MODE AUTOMATIQUE OACI
// ==============================
async function handleAutoMode() {
  // Called when user clicks "calculate" (auto mode). It will compute best runway(s)
  const icaoAuto = icaoAutoInput.value.trim().toUpperCase();
  const pisteInput = parseFloat(runwayInput.value); // fallback visual
  const ventTrue = parseFloat(windDirInput.value);
  const ventSpeed = parseFloat(windSpeedInput.value) || 0;
  const gustValue = parseFloat(gustInput.value) || 0;
  const aircraftModel = document.getElementById("aircraftSelect").value;
  const limits = aircraftLimits[aircraftModel];


  airportResult.innerHTML = "";

  if (!icaoAuto) {
    // No ICAO given -> simply draw 3d from manual inputs
    draw3D(pisteInput || 0, (isFinite(ventTrue) ? ventTrue : 0));
    return;
  }

  try {
    const response = await fetch("./airports.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Fichier airports.json introuvable");
    const airports = await response.json();
    const airport = airports[icaoAuto];

    if (!airport) {
      airportResult.innerHTML = `<span style="color:#ff8080;">Aéroport ${icaoAuto} non trouvé.</span>`;
      // still draw manual if present
      draw3D(null, currentWindMag);
      return;
    }

    // parse declinaison string from JSON if present
    let declStr = airport.declinaison || "";
    // We'll use convertTrueToMag(true, declStr) to transform true -> magnetic
    // per user rule: West = add, East = subtract

    // iterate runways
    const resultats = [];
    const meilleures = [];
    let meilleurVentFace = -Infinity;

    for (const rw of airport.runways) {
      // rw.heading1 and rw.heading2 are already magnetic (user said pistes are magnetic)
      const orientations = [
        { nom: rw.id.split("/")[0], heading: rw.heading1 },
        { nom: rw.id.split("/")[1], heading: rw.heading2 }
      ];

      for (const o of orientations) {
        // convert wind TRUE -> MAG using airport declination
        const windMagAuto = convertTrueToMag(ventTrue, declStr);
        // compute difference (windMagAuto - runwayHeading) normalized to [-180,180]
        const diff = ((windMagAuto - o.heading + 540) % 360) - 180;
        const diffRad = toRad(diff);

      // Vent de face = vent moyen
const ventFace = ventSpeed * Math.cos(diffRad);

// Vent travers = rafale si disponible, sinon vent moyen
const ventTravers = (gustValue > 0 ? gustValue : ventSpeed) * Math.sin(diffRad);

const ventTraversGust = ventTravers;
        const traversDir = ventTravers > 0 ? "droite" : ventTravers < 0 ? "gauche" : "";

        const tropCourt = (rw.length_ft < limits.minLength || rw.width_ft < limits.minWidth);

        const entry = {
          pisteId: rw.id,
          sens: o.nom,
          heading: o.heading,
          length: rw.length_ft,
          width: rw.width_ft,
          surface: rw.surface,
          ventFace,
          ventTravers: ventTraversGust,
          traversDir,
          tropCourt
        };
        resultats.push(entry);

        // choose best by maximum ventFace among runways that are not too short
        if (!tropCourt) {
          // use ventFace (descending) -- higher is better (more headwind)
          if (ventFace > meilleurVentFace + EPS) {
            meilleurVentFace = ventFace;
          }
        }
      }
    }

    // collect meilleures pistes (could be multiple with same ventFace approximatively)
    for (const r of resultats) {
      if (!r.tropCourt && Math.abs(r.ventFace - meilleurVentFace) <= 0.01) {
        meilleures.push(r);
      }
    }

    // Render HTML block
    let html = `<strong>${airport.airport}</strong><br><em>${airport.province}</em><br>`;
    html += airport.declinaison ? `<small>Déclinaison magnétique : ${airport.declinaison}</small><br><br>` : `<br>`;
    html += `<div style="display:flex;flex-direction:column;gap:6px;">`;

    for (const rw of airport.runways) {
      const r1 = resultats.find(r => r.pisteId === rw.id && r.sens === rw.id.split("/")[0]);
      const r2 = resultats.find(r => r.pisteId === rw.id && r.sens === rw.id.split("/")[1]);
      const isBest1 = meilleures.some(mp => mp.pisteId === rw.id && mp.sens === (r1 && r1.sens));
      const isBest2 = meilleures.some(mp => mp.pisteId === rw.id && mp.sens === (r2 && r2.sens));

      function runwayBox(r, isBest) {
        if (!r) return "";
        const style = `
          background:${isBest ? 'rgba(0,255,200,0.12)' : 'transparent'};
          border:${isBest ? '2px solid #00ffcc' : '1px solid rgba(255,255,255,0.06)'};
          border-radius:6px;
          padding:6px;
        `;
        const warn = r.tropCourt
          ? `<span style="color:#ff4d4d;font-weight:bold;">⚠️ The runway dimensions are inadequate for safe operations</span>`
          : "";
        return `
          <div style="${style}">
            <strong style="color:${isBest ? '#00ffcc' : '#fff'};">${r.sens}</strong> —
            Vent face: ${r.ventFace.toFixed(2)} kt,
            Vent travers: ${Math.abs(r.ventTravers).toFixed(2)} kt ${r.traversDir}
            <br>${warn}
          </div>`;
      }

      html += `
        <div style="background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 8px;
                    padding: 8px;">
          <strong>Piste ${rw.id}</strong><br>
          Longueur: ${rw.length_ft} ft | Largeur: ${rw.width_ft} ft | Surface: ${rw.surface}<br><br>
          ${runwayBox(r1, isBest1)}
          ${runwayBox(r2, isBest2)}
        </div>`;
    }

    html += `</div>`;
airportResult.innerHTML = html;

// Prepare autoWind for drawing: if multiple meilleures, draw first but keep array for logic
if (meilleures.length > 0) {
  // For visualization we can set autoWind to an array but draw3D will pick first for rotation
  autoWind = {
    meilleures: meilleures,
    windMag: convertTrueToMag(ventTrue, airport.declinaison || "")
  };

  // === Alerte crosswind si limite dépassée ===
  const alertBox = document.getElementById("crosswindAlert");
  const selectedModel = document.getElementById("aircraftSelect").value;
  let message = "";

  if (meilleures.length > 0) {
    const best = meilleures[0]; // On prend la meilleure piste (même si plusieurs égales)
    const cross = Math.abs(best.ventTravers);

    if ((selectedModel === "avion.png" || selectedModel === "dhc8.png") && cross > 36) {
      message = "⚠️ CROSSWIND COMPONENT EXCEEDS DEMONSTRATED LIMIT (36 KT) ⚠️";
    }
    else if (selectedModel === "pc12.png" && cross > 15) {
      message = "⚠️ CROSSWIND COMPONENT EXCEEDS DEMONSTRATED LIMIT (15 KT). SET FLAPS TO APPROPRIATE POSITION ⚠️";
    }
  }

  if (message) {
    alertBox.textContent = message;
    alertBox.style.display = "block";
  } else {
    alertBox.style.display = "none";
  }

  // rotate roulette to the first best runway heading
  currentRunway = meilleures[0].heading; // rotate to best runway
  targetRotation = norm360(-currentRunway);
  animate();
  draw3D(); // will draw both arrows (auto + manual if present)
} else {
  autoWind = null;
  draw3D();
}

} catch (err) {
  console.error(err);
  airportResult.innerHTML = `<span style="color:#ff8080;">Erreur chargement base OACI.</span>`;
  autoWind = null;
  draw3D();
}
}
// ==============================
// MODE TAF (AWC) - data fetch + worst-case selection
// ==============================

/**
 * Helper: parse a wind token like "14010KT", "14010G25KT" or "VRB03KT"
 * returns {dir:trueDegOrNaN, speed:number, gust:number|null}
 */
function parseWindToken(token) {
  const m = token.match(/^(VRB|\d{3})(\d{2})(G(\d{2}))?KT$/);
  if (!m) return null;
  const dir = m[1] === 'VRB' ? NaN : parseInt(m[1], 10);
  const speed = parseInt(m[2], 10);
  const gust = m[4] ? parseInt(m[4], 10) : null;
  return { dir, speed, gust };
}
// ==============================
// FETCH TAF VIA PROXY RENDER (CORS COMPATIBLE)
// ==============================
async function fetchTafRaw(icao) {
  const url = `https://checkwx-proxy.onrender.com/taf/${icao}`;

  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error("CheckWX TAF fetch failed");
  }

  const data = await resp.json();

  // 🔍 DEBUG (désactive si tu veux)
  console.log("TAF RAW PROXY RESPONSE =", data);

  // 🟦 CAS 1 : Format standard CheckWX → { data: [{ raw_text: "TAF ..." }] }
  if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
    const tafObj = data.data[0];

    if (tafObj.raw_text && typeof tafObj.raw_text === "string") {
      return tafObj.raw_text; // ✔️ OK
    }
  }

  // 🟧 CAS 2 : format text direct
  if (typeof data === "string") {
    return data;
  }

  // 🟥 CAS 3 : CheckWX renvoie "No TAF" ou format avec "errors"
  if (data && data.error) {
    throw new Error("No TAF available");
  }

  if (data && data.message && data.message.includes("No TAF")) {
    throw new Error("No TAF available");
  }

  // 🟥 CAS 4 : Aucun TAF dans la station (ex: petits aéroports)
  if (data && data.results === 0) {
    throw new Error("No TAF available");
  }

  // 🟥 CAS 5 : Format inconnu
  throw new Error("Invalid TAF format from proxy");
}


/**
 * Parse a TAF raw text into an ordered array of tokens with their time markers.
 * This is a tolerant parser designed to support FROM/FM/BECMG/TEMPO/PROB and wind groups.
 * Returns an array of objects like:
 *  {type: 'FM'|'BECMG'|'TEMPO'|'PROB'|'BASE', time: 'hhmm' or null, token: '...'}
 */
function tokenizeTaf(tafRaw) {
  const txt = tafRaw.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = txt.split(' ');

  const tokens = [];
  let lastMarker = { type: 'BASE' };

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];

    // FM151230
    if (/^FM\d{6}$/i.test(p)) {
      lastMarker = {
        type: 'FM',
        full: p.slice(2)
      };

      tokens.push({ marker: lastMarker, text: p });
      continue;
    }

    // BECMG
    if (/^BECMG$/i.test(p)) {
      lastMarker = { type: 'BECMG' };

      // regarder si le prochain token est une période
      if (parts[i + 1] && /^\d{4}\/\d{4}$/.test(parts[i + 1])) {
        lastMarker.period = parts[i + 1];
      }

      tokens.push({ marker: lastMarker, text: p });
      continue;
    }

    // TEMPO
    if (/^TEMPO$/i.test(p)) {
      lastMarker = { type: 'TEMPO' };

      if (parts[i + 1] && /^\d{4}\/\d{4}$/.test(parts[i + 1])) {
        lastMarker.period = parts[i + 1];
      }

      tokens.push({ marker: lastMarker, text: p });
      continue;
    }

    // PROB30 / PROB40
    if (/^PROB(?:30|40)?$/i.test(p)) {
      lastMarker = {
        type: p.toUpperCase()
      };

      if (parts[i + 1] && /^\d{4}\/\d{4}$/.test(parts[i + 1])) {
        lastMarker.period = parts[i + 1];
      }

      tokens.push({ marker: lastMarker, text: p });
      continue;
    }

    // période
    if (/^\d{4}\/\d{4}$/.test(p)) {
      tokens.push({
        marker: lastMarker,
        type: 'PERIOD',
        text: p
      });
      continue;
    }

    // vent
    if (/^(VRB|\d{3})\d{2}(G\d{2})?KT$/i.test(p)) {
      tokens.push({
        marker: lastMarker,
        type: 'WIND',
        text: p
      });
      continue;
    }

    tokens.push({
      marker: lastMarker,
      type: 'OTHER',
      text: p
    });
  }

  return tokens;
}

/**
 * Sélectionne les vents actifs à une heure donnée (dayHHMM)
 * - ne garde que le dernier bloc FM ≤ target
 * - inclut les BECMG/TEMPO/PROB dont la période englobe target
 * - retourne { baseWinds: [...] }
 */
function selectTafWindsForHour(tokens, dayHHMM) {
  const target = parseInt(dayHHMM, 10); // JJHHMM

  // --- trouver tous les FMxxhhmm valides
  const fmBlocks = tokens
    .filter(t => t.marker?.type === 'FM' && /^\d{6}$/.test(t.marker.full))
    .map(t => ({ index: tokens.indexOf(t), time: parseInt(t.marker.full, 10) }));

  // --- identifier le FM actif = dernier FM <= target
  let baseIdx = -1;
  let activeFmTime = null;
  for (let f of fmBlocks) {
    if (f.time <= target) {
      baseIdx = f.index;
      activeFmTime = f.time;
    }
  }

  const baseWinds = [];
  let currentMarker = { type: 'BASE', period: null };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // mise à jour du marker
    if (t.marker) currentMarker = t.marker;

    // ignorer tout avant le FM actif
    if (currentMarker.type === 'FM' && parseInt(currentMarker.full, 10) !== activeFmTime) {
      continue;
    }

    if (t.type === 'WIND') {
      if (currentMarker.type === 'FM') {
        // tout FM après le FM actif est ajouté
        if (parseInt(currentMarker.full, 10) === activeFmTime) {
          baseWinds.push({ token: t.text, marker: currentMarker });
        }
      } 
      else if (currentMarker.period) {
        // BECMG/TEMPO/PROB → vérifier si période englobe target
        const [startStr, endStr] = currentMarker.period.split('/');
        if (startStr && endStr) {
          const start = parseInt(startStr.padEnd(6,'0'), 10);
          const end = parseInt(endStr.padEnd(6,'0'), 10);
          if (target >= start && target <= end) {
            baseWinds.push({ token: t.text, marker: currentMarker });
          }
        }
      }
    }
  }

  // fallback : si aucun vent trouvé, utiliser premier WIND du header
  if (baseWinds.length === 0) {
    for (let t of tokens) {
      if (t.type === 'WIND') {
        baseWinds.push({ token: t.text, marker: { type: 'BASE' } });
        break;
      }
    }
  }

  return { baseWinds };
}

function periodContains(targetDayHHMM, periodStr) {
  if (!periodStr) return false;

  const [start, end] = periodStr.split('/');

  const startVal = parseInt(start.padEnd(6, '0'));
  const endVal = parseInt(end.padEnd(6, '0'));
  const targetVal = parseInt(targetDayHHMM);

  return targetVal >= startVal && targetVal <= endVal;
}

/**
 * Calcul du pire cas pour une piste donnée
 * - exclut vent arrière
 * - pire cas = plus petit headwind ou plus grand crosswind
 */
function computeWorstWindForRunway(runwayHeading, windObjs, convFunc) {
  let worstHead = -Infinity;
  let worstCross = 0;
  let worstWind = null;

  for (const w of windObjs) {
    const parsed = parseWindToken(w.token);
    if (!parsed) continue;
    const trueDir = parsed.dir;
    const windMagDir = isNaN(trueDir) ? NaN : convFunc(trueDir);
    const speed = (parsed.gust && parsed.gust > 0) ? parsed.gust : parsed.speed;
    const comps = componentsFromWind({ dir: windMagDir, speed }, runwayHeading);
    if (!comps) continue;

    // exclure vent arrière
    if (comps.head < 0) continue;

    // déterminer pire
    if (comps.head < worstHead || Math.abs(comps.cross) > Math.abs(worstCross)) {
      worstHead = comps.head;
      worstCross = comps.cross;
      worstWind = { parsed, comps, source: w };
    }
  }

  return { worstHead, worstCross, worstWind };
}


/**
 * Given wind token object (dir true or NaN, speed, gust) and runway heading (mag),
 * compute headwind and crosswind components (uses windDir as MAG).
 * Returns {head, cross}
 */
/**
 * Compute headwind & crosswind components
 * - windObj.speed = vent moyen
 * - windObj.gust = rafale (optionnel)
 * - runwayHeading = heading magnétique de la piste
 * - Headwind = vent moyen, Crosswind = rafale si disponible
 */
function componentsFromWind(windObj, runwayHeading) {
  if (!windObj) return null;

  const speed = windObj.speed || 0;
  const gust = windObj.gust || null;

  if (isNaN(windObj.dir)) {
    // VRB → sample toutes directions pour pire crosswind
    let worst = { head: -Infinity, cross: 0, dir: null };
    for (let d = 0; d < 360; d += 15) {
      const diff = ((d - runwayHeading + 540) % 360) - 180;
      const rad = diff * Math.PI / 180;

      const head = speed * Math.cos(rad);             // vent moyen
      const cross = (gust || speed) * Math.sin(rad); // rafale si dispo

      if (Math.abs(cross) > Math.abs(worst.cross)) {
        worst = { head, cross, dir: d };
      }
    }
    return worst;
  } else {
    const diff = ((windObj.dir - runwayHeading + 540) % 360) - 180;
    const rad = diff * Math.PI / 180;

    const head = speed * Math.cos(rad);             // vent moyen
    const cross = (gust || speed) * Math.sin(rad); // rafale si dispo

    return { head, cross, dir: windObj.dir };
  }
}

/**
 * Main TAF processing function
 */
async function loadAndComputeTaf(icao, dayHHMM, airport) {
  const tafRaw = await fetchTafRaw(icao);
  const tokens = tokenizeTaf(tafRaw);
  const { baseWinds } = selectTafWindsForHour(tokens, dayHHMM);

  const windObjs = baseWinds
  .map(b => {
    const parsed = parseWindToken(b.token);
    if (!parsed) return null;

    return {
      ...parsed,
      sourceMarker: b.marker,
      sourceToken: b.token
    };
  })
  .filter(Boolean);

  const declStr = airport?.declinaison || "";
  const conv = (trueDir) => isNaN(trueDir) ? NaN : convertTrueToMag(trueDir, declStr);

  const runwayResults = [];

  for (const rw of airport.runways) {
    for (const head of [rw.heading1, rw.heading2]) {
      let worstHead = -Infinity;
      let worstCross = 0;
      let worstSource = null;

      for (const w of windObjs) {
        const trueDir = w.dir;
        const windMagDir = isNaN(trueDir) ? NaN : conv(trueDir);
        const comps = componentsFromWind({ dir: windMagDir, speed: w.speed, gust: w.gust }, head);

        if (!comps) continue;

        // exclure vent arrière
        if (comps.head < 0) continue;

        const isWorse = (comps.head < worstHead) || (Math.abs(comps.cross) > Math.abs(worstCross));
        const severity =
        Math.abs(comps.cross) * 100 - comps.head;

        const currentSeverity =
        Math.abs(worstCross) * 100 - worstHead;

        if (
          worstHead === -Infinity ||
          severity > currentSeverity
          ) {
          worstHead = comps.head;
          worstCross = comps.cross;

          worstSource = {
          token: w.sourceToken,
          marker: w.sourceMarker,
          comps,
          windDirMag: comps.dir ?? windMagDir,
          sp: w.speed,
          gust: w.gust
          };
         }
      }

      // si tous vents sont arrière → ignore
      if (worstHead >= 0) {
  runwayResults.push({
    runwayId: rw.id,
    sens: head === rw.heading1 ? rw.id.split("/")[0] : rw.id.split("/")[1], // <-- sens précis
    heading: head,
    length: rw.length_ft,
    width: rw.width_ft,
    surface: rw.surface,
    bestHead: worstHead,
    worstCross: worstCross,
    worstSource
        });
      }
    }
  }

  // choisir meilleure piste
  let bestHeadVal = -Infinity;
  for (const r of runwayResults) if (r.bestHead > bestHeadVal) bestHeadVal = r.bestHead;

  const bestRunways = runwayResults.filter(r => Math.abs(r.bestHead - bestHeadVal) <= 0.01);

  // pour affichage / alerting
  let tafWorst = null;
  for (const r of bestRunways) {
    if (!r.worstSource) continue;
    if (!tafWorst || Math.abs(r.worstSource.comps.cross) > Math.abs(tafWorst.comps.cross)) tafWorst = r.worstSource;
  }

  return { tafRaw, windObjs, runwayResults, bestRunways, tafWorst };
}
/**
 * Public handler tied to the "Load TAF" UI:
 * - reads ICAO from input, hour from #tafHour input (HHMM),
 * - loads airport from airports.json (same source as auto mode), then calls loadAndComputeTaf,
 * - fills UI (airportResult) with summaries and sets autoWind to be drawn as yellow arrow(s).
 */
document.getElementById('loadTafBtn').addEventListener('click', async () => {
  const icao = (document.getElementById('icaoAuto').value || '').trim().toUpperCase();
  const hour = (document.getElementById('tafHour').value || '').trim();
  const day = (document.getElementById('tafDay').value || '').trim();
  const status = document.getElementById('tafStatus');
  const airportResult = document.getElementById('airportResult');

  if (!icao || !/^\d{4}$/.test(hour)) {
    status.textContent = 'Enter ICAO and hour HHMM';
    return;
  }

  if (!/^\d{1,2}$/.test(day)) {
    status.textContent = 'Enter TAF day (JJ)';
    return;
  }

  const dayHHMM = `${day.padStart(2,'0')}${hour.padStart(4,'0')}`;
  status.textContent = 'Loading TAF...';

  try {
    const resp = await fetch('./airports.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error('airports.json not found');
    const airports = await resp.json();
    const airport = airports[icao];
    if (!airport) {
      status.textContent = `Airport ${icao} not found in DB`;
      return;
    }

    // Charger le TAF via ta fonction existante
    const tafRes = await loadAndComputeTaf(icao, dayHHMM, airport);
    console.log("VENTS RETENUS :", JSON.stringify(tafRes.windObjs, null, 2));
    console.log("PISTES :", JSON.stringify(tafRes.runwayResults, null, 2));
    console.log("MEILLEURES :", JSON.stringify(tafRes.bestRunways, null, 2));
    console.log("PIRE CAS :", JSON.stringify(tafRes.tafWorst, null, 2));
    status.textContent = "TAF Loaded";

   const tafRaw = tafRes.tafRaw;

// On récupère le groupe de vent retenu
const activeWindToken =
  tafRes.tafWorst?.token ||
  tafRes.windObjs?.[0]?.sourceToken ||
  null;

let highlightedTaf = tafRaw;

if (activeWindToken) {

  highlightedTaf = tafRaw.replace(
    activeWindToken,
    `<span style="
      background:#ffff00;
      color:#000;
      font-weight:bold;
      padding:2px 4px;
      border-radius:3px;
    ">${activeWindToken}</span>`
  );

  // Highlight TEMPO/BECMG/PROB associé
  const marker = tafRes.tafWorst?.marker;

  if (marker?.type === "TEMPO" && marker.period) {
    highlightedTaf = highlightedTaf.replace(
      `TEMPO ${marker.period}`,
      `<span style="background:#ffd54f;color:#000;font-weight:bold;">TEMPO ${marker.period}</span>`
    );
  }

  if (marker?.type === "BECMG" && marker.period) {
    highlightedTaf = highlightedTaf.replace(
      `BECMG ${marker.period}`,
      `<span style="background:#81d4fa;color:#000;font-weight:bold;">BECMG ${marker.period}</span>`
    );
  }

  if (
    marker?.type &&
    marker.type.startsWith("PROB") &&
    marker.period
  ) {
    highlightedTaf = highlightedTaf.replace(
      `${marker.type} ${marker.period}`,
      `<span style="background:#ef9a9a;color:#000;font-weight:bold;">${marker.type} ${marker.period}</span>`
    );
  }
}

airportResult.innerHTML = `
<div style="
  background:rgba(0,0,0,0.25);
  padding:8px;
  border-radius:8px;
  margin-top:8px;
">
  <strong>TAF BRUT</strong><br><br>
  <div style="
    white-space:pre-wrap;
    font-family:monospace;
    font-size:12px;
    line-height:1.5;
  ">
    ${highlightedTaf}
  </div>
</div>
`;

  } catch (err) {
    console.error(err);
    status.textContent = 'TAF load error';
    airportResult.innerHTML = `<span style="color:#ff8080;">TAF load error: ${err.message}</span>`;
  }
});
// ==============================
// DESSIN DE LA ROULETTE & VUE 3D
// ==============================
function drawFixedBackground() {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#f4f1e8";
  ctx.fill();

  ctx.strokeStyle = "#e8e5de";
  ctx.lineWidth = 0.8;
  for (let r = 20; r <= radius; r += 20) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = "#efece6";
  ctx.lineWidth = 0.8;
  for (let d = 0; d < 360; d += 10) {
    const a = toRad(d - 90);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
    ctx.stroke();
  }

  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-radius, 0);
  ctx.lineTo(radius, 0);
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, radius);
  ctx.stroke();

  ctx.restore();
}

function drawRotatingRing(rotationDeg) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(toRad(rotationDeg));
  for (let deg = 0; deg < 360; deg++) {
    const a = toRad(deg - 90);
    let inner = radius - 8;
    let lw = 0.9;
    let col = "#555";

    if (deg % 10 === 0) {
      inner = radius - 18;
      lw = 1.8;
      col = "#000";
    } else if (deg % 5 === 0) {
      inner = radius - 12;
      lw = 1.3;
      col = "#222";
    }

    ctx.beginPath();
    ctx.moveTo(inner * Math.cos(a), inner * Math.sin(a));
    ctx.lineTo(radius * Math.cos(a), radius * Math.sin(a));
    ctx.lineWidth = lw;
    ctx.strokeStyle = col;
    ctx.stroke();

    if (deg % 10 === 0) {
      ctx.save();
      const tx = (radius - 34) * Math.cos(a);
      const ty = (radius - 34) * Math.sin(a);
      ctx.translate(tx, ty);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = "#000";
      ctx.font = "11px Orbitron, Arial";
      ctx.textAlign = "center";
      ctx.fillText(String(deg).padStart(3, '0'), 0, 4);
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawAll() {
  ctx.clearRect(0, 0, width, height);
  drawFixedBackground();
  drawRotatingRing(currentRotation);

  // Piste centrale (red)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "red";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -radius + 6);
  ctx.stroke();
  ctx.restore();

  // Vent (blue/green) — but roulette's small arrow is only the manual wind arrow to mirror previous behavior
  // We'll draw blue only if manualWind is null and autoWind present (compat), otherwise draw manual as green on roulette.
  if (manualWind && manualWind.runway && manualWind.wind) {
  // draw the manual wind (small arrow) in blue on roulette
  const a = toRad(norm360(manualWind.wind - manualWind.runway - 90));
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const tip = radius - 10;
  const xTip = cx + ux * tip;
  const yTip = cy + uy * tip;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(xTip, yTip);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#007bff"; // blue
  ctx.stroke();
} else if (autoWind && autoWind.windMag && autoWind.meilleures) {
  // if only auto present, draw small green arrow using first meilleure heading
  const heading = autoWind.meilleures[0].heading;
  const windMag = autoWind.windMag;
  const a = toRad(norm360(windMag - heading - 90));
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const tip = radius - 10;
  const xTip = cx + ux * tip;
  const yTip = cy + uy * tip;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(xTip, yTip);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#00c853"; // green
  ctx.stroke();
 }
}

function animate() {
  const diff = shortestDeg(currentRotation, targetRotation);
  currentRotation += diff * 0.06;
  currentRotation = norm360(currentRotation);
  drawAll();
  if (Math.abs(diff) > 0.25) requestAnimationFrame(animate);
}

drawAll();

// ==============================
// === VUE 3D / HORIZON ARTIFICIEL ===
// ==============================
const view3d = document.getElementById("view3d");
const vtx = view3d.getContext("2d");

const planeImg = new Image();
planeImg.src = "avion.png";
let planeLoaded = false;
planeImg.onload = () => {
  planeLoaded = true;
  draw3D();
};

// helper to draw transparent plane (remove white background)
function drawPlaneWithTransparency(vtx, img, size, rotation) {
  // create temporary canvas to strip white -> transparent
  const temp = document.createElement('canvas');
  temp.width = img.width;
  temp.height = img.height;
  const tctx = temp.getContext('2d');
  tctx.drawImage(img, 0, 0);
  const imgData = tctx.getImageData(0, 0, temp.width, temp.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // threshold to cut near-white
    if (r > 245 && g > 245 && b > 245) data[i + 3] = 0;
  }
  tctx.putImageData(imgData, 0, 0);
  vtx.save();
  vtx.rotate(rotation * Math.PI / 180);
  vtx.drawImage(temp, -size / 2, -size / 2, size, size);
  vtx.restore();
}

function draw3D(runwayOverride, windOverride) {
  // runwayOverride, windOverride are optional; if absent we use manualWind / autoWind
  const w = view3d.width;
  const h = view3d.height;
  vtx.clearRect(0, 0, w, h);

  // --- Ciel / sol ---
  const grad = vtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#87CEEB");
  grad.addColorStop(0.55, "#a0a0a0");
  grad.addColorStop(1, "#3a3a3a");
  vtx.fillStyle = grad;
  vtx.fillRect(0, 0, w, h);

  // --- Piste visuelle (fixed) ---
  vtx.save();
  vtx.translate(w / 2, h / 2);
  vtx.fillStyle = "#333";
  vtx.fillRect(-40, -h * 0.45, 80, h * 0.9);

  vtx.strokeStyle = "#fff";
  vtx.lineWidth = 2;
  vtx.setLineDash([20, 20]);
  vtx.beginPath();
  vtx.moveTo(0, -h * 0.45);
  vtx.lineTo(0, h * 0.45);
  vtx.stroke();
  vtx.restore();

  // --- Avion --- (centered)
  const planeX = w / 2;
  const planeY = h / 2 + 140;
  const planeSize = 90;

  vtx.save();
  vtx.translate(planeX, planeY);

  if (planeLoaded) {
    const selected = document.getElementById("aircraftSelect").value;
    let rotation = 0;
    if (selected.includes("avion.png")) rotation = 90;
    if (selected.includes("pc12")) rotation = 90;
    if (selected.includes("dhc8")) rotation = 180;

    // rotate such that the nose points up along the visual runway
    // previous code used vtx.rotate((rotation + 270) * Math.PI / 180)
    // We'll keep same mapping
    vtx.rotate((rotation + 270) * Math.PI / 180);

    // draw plane with transparency removal
    drawPlaneWithTransparency(vtx, planeImg, planeSize, 0);
  }

  vtx.restore();

  // --- Flèches du vent (PELO) ---
  // We want to draw both: auto (blue) and manual (green) simultaneously when available
  // For arrow geometry we compute relative angle: relAngle = (windMag - runway - 90) in radians

  function drawArrow(runwayDeg, windMagDeg, color, label) {
    if (!isFinite(runwayDeg) || !isFinite(windMagDeg)) return;
    const relAngle = ((windMagDeg - runwayDeg - 90 + 360) % 360) * Math.PI / 180;
    const cx = w / 2;
    let offsetY = 0;
    const selected = document.getElementById("aircraftSelect").value;
    if (selected.includes("avion.png")) offsetY = 100;
    if (selected.includes("pc12")) offsetY = 105;
    if (selected.includes("dhc8")) offsetY = 95;
    const cy = h / 2 + offsetY;
    const len = 160;

    const xStart = cx + Math.cos(relAngle) * len;
    const yStart = cy + Math.sin(relAngle) * len;
    const xEnd = cx;
    const yEnd = cy;

    // shaft
    vtx.strokeStyle = color;
    vtx.lineWidth = 4;
    vtx.beginPath();
    vtx.moveTo(xStart, yStart);
    vtx.lineTo(xEnd, yEnd);
    vtx.stroke();

    // head
    const headAngle = Math.atan2(yEnd - yStart, xEnd - xStart);
    vtx.beginPath();
    vtx.moveTo(xEnd, yEnd);
    vtx.lineTo(xEnd - 14 * Math.cos(headAngle - Math.PI / 6), yEnd - 14 * Math.sin(headAngle - Math.PI / 6));
    vtx.lineTo(xEnd - 14 * Math.cos(headAngle + Math.PI / 6), yEnd - 14 * Math.sin(headAngle + Math.PI / 6));
    vtx.closePath();
    vtx.fillStyle = color;
    vtx.fill();

    // label text
    vtx.fillStyle = "white";
    vtx.font = "14px Orbitron";
    vtx.fillText(`${label} ${windMagDeg.toFixed(0)}°`, 15, 25 + (label === "AUTO" ? 0 : 20));
    vtx.fillText(`Piste ${runwayDeg.toFixed(0)}° (magn.)`, 15, 45 + (label === "AUTO" ? 50 : 70));
  }

  // decide what to draw:
  // - if autoWind present, pick the main best runway heading(s) to draw blue arrow.
  //   we'll draw blue arrow using the first meilleure, but indicate that multiple pistes may be best (they are highlighted in the UI)
  if (autoWind && autoWind.meilleures && autoWind.meilleures.length > 0) {
    const firstBest = autoWind.meilleures[0];
    drawArrow(firstBest.heading, autoWind.windMag, "#00c853", "AUTO");
  }

  // - draw manual arrow if present (blue)
  if (manualWind && isFinite(manualWind.runway) && isFinite(manualWind.wind)) {
    drawArrow(manualWind.runway, manualWind.wind, "#007bff", "MANUAL");
  }
}

// === Sélecteur d’avion (reload image and redraw) ===
document.getElementById("aircraftSelect").addEventListener("change", e => {
  let newSrc = e.target.value;
  planeLoaded = false;
  planeImg.src = `${newSrc}?t=${Date.now()}`;
  planeImg.onload = () => {
    planeLoaded = true;
    draw3D();
  };
});

// ==============================
// ÉVÉNEMENTS
// ==============================
calcBtn.addEventListener('click', async () => {
  // When clicking calculate, run both:
  // 1) handle manual calculation (to update manualWind & UI)
  // 2) handle automatic mode (if ICAO present)
  calculate();
  await handleAutoMode();
});

[windDirInput, windSpeedInput, gustInput, declInput, ewSelect, runwayInput, icaoAutoInput].forEach(el => {
  el.addEventListener('input', () => {
    // realtime: update manual calculation (if all manual fields present)
    calculate();
    // don't automatically call handleAutoMode on every keystroke (user triggers with calculate button)
  });
});

// ensure roulette draws initially
drawAll();





