// =====================================================================
// Franklin Mountains State Park -- trail use study
// Loads pre-aggregated JSON (built by the Python pipeline in /analysis)
// and wires up every chart / map on the page. No data processing happens
// client-side beyond formatting -- all the real work is in the JSON.
// =====================================================================

const COLORS = {
  rust: "#AE4726", rustSoft: "#D98B69",
  ochre: "#B9821B", ochreSoft: "#E3BE68",
  sage: "#3F5F3C", sageSoft: "#9AB78F",
  sky: "#315670", skySoft: "#8FB3C9",
  ink: "#241B10", inkSoft: "#5B4C30", inkFaint: "#8B7C57",
  line: "#C7B587", paper: "#F1E8D0",
};

function addBasemap(map) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, opacity: 0.95,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
  // light, neutral grayscale so the rust/ochre/sage/sky overlay colors read
  // clearly against the base map instead of competing with street-map color
  map.getPane("tilePane").style.filter = "grayscale(100%) brightness(1.28) contrast(0.85)";

  // click-to-scroll-zoom: keeps page scroll usable by default, but lets
  // anyone who mouses over the map actually zoom with the wheel
  map.scrollWheelZoom.disable();
  map.getContainer().addEventListener("mouseenter", () => map.scrollWheelZoom.enable());
  map.getContainer().addEventListener("mouseleave", () => map.scrollWheelZoom.disable());
}

// ---------------------------------------------------------------------
// Expand-to-fullscreen for any figure (map or chart). Moves the actual
// .figure element into an overlay on expand (not a clone), so Leaflet
// maps and Chart.js instances keep working -- just call invalidateSize()
// / chart.resize() after the move so they redraw at the new size.
// ---------------------------------------------------------------------
function makeExpandable(figureId, { onExpand, onCollapse } = {}) {
  const figure = document.getElementById(figureId);
  if (!figure) return;

  const btn = document.createElement("button");
  btn.className = "figure-expand-btn";
  btn.type = "button";
  btn.title = "Expand";
  btn.innerHTML = "&#10021;";
  figure.appendChild(btn);

  const placeholder = document.createComment(`expand-anchor-${figureId}`);
  figure.parentNode.insertBefore(placeholder, figure);

  let backdrop = null;

  function expand() {
    backdrop = document.createElement("div");
    backdrop.className = "figure-modal-backdrop";
    const closeBtn = document.createElement("button");
    closeBtn.className = "figure-modal-close";
    closeBtn.type = "button";
    closeBtn.innerHTML = "&times; Close";
    backdrop.appendChild(closeBtn);
    document.body.appendChild(backdrop);
    backdrop.appendChild(figure);
    figure.classList.add("figure--expanded");
    btn.title = "Collapse";
    document.body.style.overflow = "hidden";

    closeBtn.addEventListener("click", collapse);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) collapse(); });
    document.addEventListener("keydown", escHandler);

    setTimeout(() => onExpand && onExpand(), 60);
  }

  function collapse() {
    figure.classList.remove("figure--expanded");
    placeholder.parentNode.insertBefore(figure, placeholder);
    backdrop.remove();
    backdrop = null;
    btn.title = "Expand";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", escHandler);
    setTimeout(() => onCollapse && onCollapse(), 60);
  }

  function escHandler(e) { if (e.key === "Escape") collapse(); }

  btn.addEventListener("click", () => { backdrop ? collapse() : expand(); });
}

Chart.defaults.font.family = "'Space Mono', monospace";
Chart.defaults.font.size = 11;
Chart.defaults.color = COLORS.inkSoft;

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => n.toLocaleString("en-US");

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------
// short human names for the wordier polygon IDs, used in prose + lists
// ---------------------------------------------------------------------
function shortName(name) {
  return name.replace(/^FMSP\s+/, "").replace(/^FMPS\s+/, "");
}

const ZIP_AREAS = {
  "79912": "Westside", "79934": "Northeast / Vista del Sol", "79924": "Northeast",
  "79938": "Horizon City", "79936": "East / Lower Valley", "79932": "Westside (Upper)",
  "79928": "Horizon / Socorro", "79904": "Central / Dyer", "79911": "Westside (Anthony)",
  "79925": "East Central", "79835": "Santa Teresa, NM", "79902": "Central / UTEP",
  "79930": "Central / Five Points", "79908": "Canutillo", "79922": "West / Upper Valley",
};

async function main() {
  const paths = {
    hero: "data/hero_stats.json",
    trailStats: "data/trail_stats.json",
    flows: "data/flows.json",
    hotspots: "data/hotspots.json",
    homeOrigins: "data/home_origins.json",
    timePatterns: "data/time_patterns.json",
    parkBoundary: "data/park_boundary.geojson",
    trailBuffers: "data/trail_buffers.geojson",
  };
  const keys = Object.keys(paths);
  const results = await Promise.allSettled(keys.map((k) => loadJSON(paths[k])));

  const data = {};
  const failed = [];
  results.forEach((r, i) => {
    const key = keys[i];
    if (r.status === "fulfilled") {
      data[key] = r.value;
    } else {
      failed.push(`${paths[key]} (${r.reason.message})`);
    }
  });

  if (failed.length) {
    console.error("Failed to load:", failed);
    document.body.insertAdjacentHTML("afterbegin", `
      <div style="background:#AE4726;color:#fff;padding:12px 16px;font-family:monospace;font-size:12px;line-height:1.5;">
        Couldn't load ${failed.length} data file(s), so some sections below may be blank:<br>
        ${failed.map(f => `&middot; ${f}`).join("<br>")}<br>
        If you're viewing this locally, make sure you started a static server from inside <code>site/</code>
        (e.g. <code>python3 -m http.server</code>) rather than opening index.html directly, and that the
        <code>data/</code> folder was uploaded alongside index.html.
      </div>`);
  }

  const { hero, trailStats, flows, hotspots, homeOrigins, timePatterns, parkBoundary, trailBuffers } = data;

  if (hero && trailStats) buildHero(hero, trailStats);
  if (trailStats) buildTrailSection(trailStats);
  if (trailBuffers && flows && trailStats) buildMovementMap(parkBoundary, trailBuffers, flows, trailStats);
  if (flows && hero) buildMovementList(flows, hero);
  if (hotspots) buildHotspotMap(parkBoundary, hotspots);
  if (hotspots) buildHotspotList(hotspots);
  if (homeOrigins) buildHomeSection(homeOrigins, parkBoundary);
  if (timePatterns) buildTimeSection(timePatterns);
}

// ---------------------------------------------------------------------
// HERO
// ---------------------------------------------------------------------
function buildHero(hero, trailStats) {
  $("#hero-devices").textContent = fmt(hero.total_devices);
  $("#hero-sessions").textContent = fmt(hero.total_sessions);

  const stats = [
    { n: fmt(hero.total_devices), l: "ANONYMIZED DEVICES TRACKED" },
    { n: fmt(hero.total_sessions), l: "RECONSTRUCTED TRAIL VISITS" },
    { n: `${hero.el_paso_metro_pct}%`, l: "OF VISITORS LIVE IN EL PASO" },
    { n: `${hero.weekend_pct}%`, l: "OF VISITS FALL ON A WEEKEND" },
  ];
  $("#stat-strip").innerHTML = stats.map(s => `
    <div class="stat"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>
  `).join("");
}

// ---------------------------------------------------------------------
// 01 -- TRAIL POPULARITY
// ---------------------------------------------------------------------
function buildTrailSection(trailStats) {
  const families = trailStats.top_families.slice(0, 10);
  const totalAll = trailStats.total_visits_all_segments;
  const top = families[0];

  $("#p-top-trail-share").textContent =
    `${(top.visits / totalAll * 100).toFixed(0)}%`;

  const max = families[0].visits;
  $("#trail-rank-list").innerHTML = families.map((f, i) => `
    <li>
      <span class="rank">${String(i + 1).padStart(2, "0")}</span>
      <div class="name">${shortName(f.trail_family)}<div class="bar" style="width:${(f.visits / max * 100).toFixed(0)}%; background:${i === 0 ? COLORS.rust : COLORS.ochreSoft}"></div></div>
      <span class="val">${fmt(f.visits)}</span>
    </li>
  `).join("");

  const chartTrails = new Chart($("#chart-trails"), {
    type: "bar",
    data: {
      labels: families.map(f => shortName(f.trail_family)),
      datasets: [{
        data: families.map(f => f.visits),
        backgroundColor: families.map((f, i) => i === 0 ? COLORS.rust : COLORS.ochreSoft),
        borderRadius: 2,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { left: 4 } },
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: (ctx) => `${fmt(ctx.parsed.x)} visits` }
      } },
      scales: {
        x: { grid: { color: COLORS.line }, ticks: { color: COLORS.inkSoft } },
        y: { grid: { display: false }, ticks: { color: COLORS.ink, font: { family: "Spectral", size: 11 }, autoSkip: false, crossAlign: "far" } },
      },
    },
  });
  makeExpandable("fig-trails", { onExpand: () => chartTrails.resize(), onCollapse: () => chartTrails.resize() });
}

// ---------------------------------------------------------------------
// 02 -- MOVEMENT MAP + LIST
// ---------------------------------------------------------------------
function buildMovementMap(parkBoundary, trailBuffers, flows, trailStats) {
  const map = L.map("map-flow", { scrollWheelZoom: false, attributionControl: false }).setView([31.9, -106.5], 12);
  addBasemap(map);

  const visitsByTrail = {};
  trailStats.top_segments.forEach(s => visitsByTrail[s.polygon] = s.visits);
  // fall back: read every segment from a full lookup built off flows/trailBuffers
  const allSegVisits = {};
  trailStats.top_segments.forEach(s => allSegVisits[s.polygon] = s.visits);

  const maxVisits = Math.max(...trailStats.top_segments.map(s => s.visits));

  function colorFor(name) {
    const v = allSegVisits[name];
    if (!v) return "#CBB98A";
    const t = Math.min(v / maxVisits, 1);
    return shadeColor(t);
  }
  function shadeColor(t) {
    // interpolate paper-deep -> ochre -> rust
    const stops = [
      [0, [219, 206, 159]],
      [0.5, [227, 190, 104]],
      [1, [174, 71, 38]],
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0);
        const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
        return `rgb(${c.join(",")})`;
      }
    }
    return "#AE4726";
  }

  if (parkBoundary) {
    L.geoJSON(parkBoundary, {
      style: { color: COLORS.ink, weight: 1.5, fill: false, dashArray: "4,3" },
    }).addTo(map);
  }

  const trailLayer = L.geoJSON(trailBuffers, {
    style: (feat) => ({
      color: colorFor(feat.properties.name),
      weight: 1,
      fillColor: colorFor(feat.properties.name),
      fillOpacity: 0.75,
    }),
    onEachFeature: (feat, layer) => {
      const v = allSegVisits[feat.properties.name] || 0;
      layer.bindTooltip(`${shortName(feat.properties.name)}${v ? ` — ${fmt(v)} visits` : ""}`);
    },
  }).addTo(map);

  map.fitBounds(trailLayer.getBounds(), { padding: [10, 10] });

  // flow arrows: curved polylines weighted by count, top 15
  const topFlows = flows.flows.slice(0, 15);
  const maxCount = Math.max(...topFlows.map(f => f.count));
  topFlows.forEach(f => {
    const from = f.from_pt, to = f.to_pt;
    const weight = 1 + (f.count / maxCount) * 5;
    const line = L.polyline([from, to], {
      color: COLORS.sky, weight, opacity: 0.55, lineCap: "round",
    }).addTo(map);
    line.bindTooltip(`${shortName(f.from)} → ${shortName(f.to)}: ${fmt(f.count)}×`);
  });

  makeExpandable("fig-flow", { onExpand: () => map.invalidateSize(), onCollapse: () => map.invalidateSize() });
}

function buildMovementList(flows, hero) {
  $("#p-multitrail-inline").textContent = `${hero.pct_multi_trail_sessions}%`;
  const top = flows.flows.slice(0, 8);
  const max = top[0].count;
  $("#flow-list").innerHTML = top.map((f, i) => `
    <li>
      <span class="rank">${String(i + 1).padStart(2, "0")}</span>
      <div class="name">${shortName(f.from)} <span style="color:${COLORS.inkFaint}">&rarr;</span> ${shortName(f.to)}
        <div class="bar" style="width:${(f.count / max * 100).toFixed(0)}%; background:${COLORS.skySoft}"></div>
      </div>
      <span class="val">${fmt(f.count)}&times;</span>
    </li>
  `).join("");
}

// ---------------------------------------------------------------------
// 03 -- HOTSPOTS
// ---------------------------------------------------------------------
function buildHotspotMap(parkBoundary, hotspots) {
  const map = L.map("map-hotspot", { scrollWheelZoom: false, attributionControl: false }).setView([31.9, -106.5], 12);
  addBasemap(map);

  if (parkBoundary) {
    L.geoJSON(parkBoundary, {
      style: { color: COLORS.ink, weight: 1.5, fill: false, dashArray: "4,3" },
    }).addTo(map);
    map.fitBounds(L.geoJSON(parkBoundary).getBounds(), { padding: [10, 10] });
  }

  hotspots.trailhead.forEach(h => {
    L.circleMarker([h.lat, h.lon], {
      radius: 5 + Math.sqrt(h.devices) / 8, color: COLORS.rust, weight: 1,
      fillColor: COLORS.rust, fillOpacity: 0.55,
    }).bindTooltip(`${shortName(h.trail)} — ${fmt(h.devices)} devices`).addTo(map);
  });
  hotspots.interior.forEach(h => {
    L.circleMarker([h.lat, h.lon], {
      radius: 4 + Math.sqrt(h.devices) / 6, color: COLORS.ochre, weight: 1,
      fillColor: COLORS.ochre, fillOpacity: 0.6,
    }).bindTooltip(`${shortName(h.trail)} — ${fmt(h.devices)} devices`).addTo(map);
  });

  makeExpandable("fig-hotspot", { onExpand: () => map.invalidateSize(), onCollapse: () => map.invalidateSize() });
}

function buildHotspotList(hotspots) {
  const top = hotspots.interior.slice(0, 8);
  const max = top[0].devices;
  $("#interior-hotspot-list").innerHTML = top.map((h, i) => `
    <li>
      <span class="rank">${String(i + 1).padStart(2, "0")}</span>
      <div class="name">${shortName(h.trail)}
        <div class="bar" style="width:${(h.devices / max * 100).toFixed(0)}%; background:${COLORS.ochreSoft}"></div>
      </div>
      <span class="val">${fmt(h.devices)} dev.</span>
    </li>
  `).join("");
}

// ---------------------------------------------------------------------
// 04 -- VISITOR HOMES
// ---------------------------------------------------------------------
function buildHomeSection(homeOrigins, parkBoundary) {
  const s = homeOrigins.summary;
  $("#p-local-inline").textContent = `${s.el_paso_metro_pct.toFixed(0)}%`;
  $("#p-local-dist").textContent = `${s.median_dist_miles_local.toFixed(1)} miles`;
  $("#p-mexico-inline").textContent = `${s.mexico_pct.toFixed(1)}%`;

  $("#zip-table tbody").innerHTML = homeOrigins.top_zips.slice(0, 10).map(z => `
    <tr><td>${z.postal}</td><td>${ZIP_AREAS[z.postal] || "El Paso area"}</td><td class="num">${fmt(z.devices)}</td></tr>
  `).join("");

  $("#metro-table tbody").innerHTML = homeOrigins.top_metros.slice(0, 10).map(m => `
    <tr><td>${m.metro}</td><td class="num">${fmt(m.devices)}</td></tr>
  `).join("");

  const map = L.map("map-home", { scrollWheelZoom: false, attributionControl: false }).setView([31.85, -106.45], 10);
  addBasemap(map);
  if (parkBoundary) {
    L.geoJSON(parkBoundary, {
      style: { color: COLORS.rust, weight: 2, fill: true, fillColor: COLORS.rust, fillOpacity: 0.25 },
    }).addTo(map);
  }

  const isElPasoArea = ([lat, lon]) => lat > 31.45 && lat < 32.05 && lon > -106.75 && lon < -106.05;

  const cells = homeOrigins.home_grid;
  const maxDev = Math.max(...cells.map(c => c[2]));
  const bounds = [];
  cells.forEach(([lat, lon, n]) => {
    const local = isElPasoArea([lat, lon]);
    const color = local ? COLORS.sage : COLORS.sky;
    const r = 2 + Math.sqrt(n) * 1.1;
    L.circleMarker([lat, lon], {
      radius: r, color: color, weight: 0.5, fillColor: color,
      fillOpacity: 0.25 + Math.min(n / maxDev, 1) * 0.5,
    }).bindTooltip(`${fmt(n)} devices`).addTo(map);
    bounds.push([lat, lon]);
  });
  // center on El Paso region primarily -- most homes are local
  map.fitBounds([[31.55, -106.68], [32.02, -106.15]]);

  makeExpandable("fig-home", { onExpand: () => map.invalidateSize(), onCollapse: () => map.invalidateSize() });
}

// ---------------------------------------------------------------------
// 05 -- TIME PATTERNS
// ---------------------------------------------------------------------
function buildTimeSection(tp) {
  // weekly line chart
  const chartWeekly = new Chart($("#chart-weekly"), {
    type: "line",
    data: {
      labels: tp.weekly.map(w => w.week),
      datasets: [{
        data: tp.weekly.map(w => w.visits),
        borderColor: COLORS.rust, backgroundColor: "rgba(174,71,38,0.12)",
        fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { title: (items) => fmtDate(items[0].label) } } },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: true, maxTicksLimit: 7, maxRotation: 0, color: COLORS.inkFaint,
            callback: function (val) {
              const label = this.getLabelForValue(val);
              const d = new Date(label + "T00:00:00");
              return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
            },
          },
        },
        y: { grid: { color: COLORS.line }, ticks: { color: COLORS.inkSoft } },
      },
    },
  });
  makeExpandable("fig-weekly", { onExpand: () => chartWeekly.resize(), onCollapse: () => chartWeekly.resize() });

  // like-for-like Jan-May comparison narrative (computed from weekly array)
  const byYearJanMay = {};
  tp.weekly.forEach(w => {
    const d = new Date(w.week + "T00:00:00");
    const y = d.getFullYear(), m = d.getMonth() + 1;
    if (m <= 5) { (byYearJanMay[y] ||= []).push(w.visits); }
  });
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const y21 = avg(byYearJanMay[2021] || [0]);
  const y22 = avg(byYearJanMay[2022] || [0]);
  const y23 = avg(byYearJanMay[2023] || [0]);
  const dropPct = Math.round((1 - y22 / y21) * 100);
  const reboundPct = Math.round((y23 / y21) * 100);
  $("#p-weekly-narrative").innerHTML =
    `Comparing the same Jan&ndash;May window each year (to stay season-neutral), ` +
    `<span class="hl hl-rust">weekly visits fell about ${dropPct}%</span> from 2021 to 2022, ` +
    `then rebounded to roughly ${reboundPct}% of the 2021 level by early 2023. ` +
    `Because this is passive device-panel data rather than a gate count, some of that swing may reflect ` +
    `changes in the data provider's panel coverage rather than real-world attendance alone.`;

  // seasonality bar chart
  const chartSeason = new Chart($("#chart-season"), {
    type: "bar",
    data: {
      labels: tp.seasonality.map(m => m.month),
      datasets: [{
        data: tp.seasonality.map(m => m.avg_visits),
        backgroundColor: tp.seasonality.map(m => m.avg_visits === Math.max(...tp.seasonality.map(x => x.avg_visits)) ? COLORS.rust : COLORS.ochreSoft),
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.inkSoft } },
        y: { grid: { color: COLORS.line }, ticks: { color: COLORS.inkSoft } },
      },
    },
  });
  makeExpandable("fig-season", { onExpand: () => chartSeason.resize(), onCollapse: () => chartSeason.resize() });

  const coolMonths = tp.seasonality.slice().sort((a, b) => b.avg_visits - a.avg_visits).slice(0, 3).map(m => m.month);
  $("#p-season-inline").textContent =
    `${coolMonths.join(", ")} draw roughly twice the weekly traffic of the peak summer months`;

  const weekendPct = tp.dow_pct.filter(d => d.day === "Sat" || d.day === "Sun").reduce((a, d) => a + d.pct, 0);
  $("#p-weekend-inline").textContent = `${weekendPct.toFixed(0)}%`;
  const hourLabel = tp.peak_hour === 0 ? "12am" : tp.peak_hour < 12 ? `${tp.peak_hour}am` : tp.peak_hour === 12 ? "12pm" : `${tp.peak_hour - 12}pm`;
  $("#p-peak-hour").textContent = hourLabel;

  buildHourGrid(tp.dow_hour_grid);
}

function buildHourGrid(grid) {
  const allVals = grid.flatMap(d => d.hours);
  const max = Math.max(...allVals);
  let html = `<div class="hourgrid">`;
  html += `<div></div>`;
  for (let h = 0; h < 24; h++) {
    html += `<div class="hg-hour">${h % 3 === 0 ? h : ""}</div>`;
  }
  grid.forEach(d => {
    html += `<div class="hg-label">${d.day}</div>`;
    d.hours.forEach(v => {
      const t = v / max;
      const alpha = 0.08 + t * 0.85;
      html += `<div class="hg-cell" style="background:rgba(174,71,38,${alpha.toFixed(2)})" title="${d.day} ${v}"></div>`;
    });
  });
  html += `</div>`;
  $("#hourgrid-wrap").innerHTML = html;
  if (window.innerWidth < 580) {
    $("#hourgrid-hint").textContent = "Scroll sideways to see the full day →";
  }
  makeExpandable("fig-hourgrid");
}

main().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML("afterbegin",
    `<div style="background:#AE4726;color:#fff;padding:12px;font-family:monospace;font-size:13px;">Failed to load data: ${err.message}. If you're viewing this file directly, run a local server (e.g. <code>python3 -m http.server</code>) instead of opening index.html straight from disk.</div>`);
});
