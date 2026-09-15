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

Chart.register(window["chartjs-plugin-annotation"]);

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

// ---------------------------------------------------------------------
// Hex-bin rendering. The Python side ships each cell as [lat, lon, count,
// ...] plus a shared set of 6 corner offsets in meters (identical for
// every cell at a given radius) -- offsetLatLon() converts those meter
// offsets to a lat/lon polygon at each cell's own center, and hexColor()
// maps count -> color on a LOG scale, because raw counts here are wildly
// skewed (a trailhead can be 100-1000x a quiet trail cell): a linear scale
// would make everything except the single hottest cell look identical.
// ---------------------------------------------------------------------
function offsetLatLon(lat, lon, dxMeters, dyMeters) {
  const dLat = dyMeters / 111320;
  const dLon = dxMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

// ---------------------------------------------------------------------
// A single shared floating tooltip element, reused by any hover-enabled
// grid/cell (currently the day-x-hour visitation grid). Cheaper and nicer
// than binding a native title="" per cell, which is slow to appear and
// can't be styled.
// ---------------------------------------------------------------------
const hoverTooltipEl = document.createElement("div");
hoverTooltipEl.className = "hover-tooltip";
document.body.appendChild(hoverTooltipEl);

function attachHoverTooltip(el, contentFn) {
  el.addEventListener("mouseenter", (e) => {
    hoverTooltipEl.innerHTML = contentFn(el);
    hoverTooltipEl.style.display = "block";
  });
  el.addEventListener("mousemove", (e) => {
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    const rect = hoverTooltipEl.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - pad;
    hoverTooltipEl.style.left = `${x}px`;
    hoverTooltipEl.style.top = `${y}px`;
  });
  el.addEventListener("mouseleave", () => { hoverTooltipEl.style.display = "none"; });
}

const HEX_RAMP_STOPS = [
  [0.00, [255, 224, 51]],   // vivid gold -- even lightly-used cells must pop against a grayscale basemap
  [0.30, [255, 163, 26]],   // orange
  [0.60, [230, 74, 25]],    // red-orange
  [1.00, [120, 0, 20]],     // deep red-black -- hottest cells
];

function hexColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < HEX_RAMP_STOPS.length - 1; i++) {
    const [t0, c0] = HEX_RAMP_STOPS[i], [t1, c1] = HEX_RAMP_STOPS[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
      return `rgb(${c.join(",")})`;
    }
  }
  return "rgb(80,26,17)";
}

/**
 * Renders a hex-bin dataset (as produced by hexbin_lib.py) onto a Leaflet
 * map using a single Canvas renderer (fast for thousands of cells).
 * countIndex is which position in each cell array holds the count to color
 * by (movement/hotspot cells are [lat, lon, devices, trailIndex]).
 */
function renderHexLayer(map, hexData, { countIndex = 2, minAlpha = 0.78, maxAlpha = 0.97 } = {}) {
  const { corner_offsets_m, cells } = hexData;
  if (!cells || !cells.length) {
    console.warn("renderHexLayer: no cells to render", hexData);
    return { maxCount: 0 };
  }
  const renderer = L.canvas({ padding: 0.4 }).addTo(map);
  const maxCount = Math.max(...cells.map((c) => c[countIndex]));
  const logMax = Math.log(maxCount + 1) || 1; // guard divide-by-zero if every cell has count 0

  const group = L.layerGroup();
  cells.forEach((cell) => {
    const [lat, lon] = cell;
    const count = cell[countIndex];
    const t = Math.log(count + 1) / logMax;
    const color = hexColor(t);
    const latlngs = corner_offsets_m.map(([dx, dy]) => offsetLatLon(lat, lon, dx, dy));
    L.polygon(latlngs, {
      renderer, stroke: false, fillColor: color, fill: true,
      fillOpacity: minAlpha + t * (maxAlpha - minAlpha),
    }).addTo(group);
  });
  group.addTo(map);
  return { maxCount };
}

async function main() {
  const paths = {
    hero: "data/hero_stats.json",
    trailStats: "data/trail_stats.json",
    flows: "data/flows.json",
    movementHex: "data/movement_hexbin.json",
    hotspotHex: "data/hotspot_hexbin.json",
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

  const { hero, trailStats, flows, movementHex, hotspotHex, homeOrigins, timePatterns, parkBoundary, trailBuffers } = data;

  if (hero && trailStats) buildHero(hero, trailStats);
  if (trailStats) buildTrailSection(trailStats);
  if (movementHex) buildMovementMap(parkBoundary, trailBuffers, flows, movementHex);
  if (flows && hero) buildMovementList(flows, hero);
  if (hotspotHex) buildHotspotMap(parkBoundary, hotspotHex);
  if (hotspotHex) buildHotspotList(hotspotHex);
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
      <span class="val">${fmt(f.visits)}<br>${f.share}%</span>
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
function buildMovementMap(parkBoundary, trailBuffers, flows, movementHex) {
  const map = L.map("map-flow", { scrollWheelZoom: false, attributionControl: false }).setView([31.9, -106.5], 13);
  addBasemap(map);

  if (parkBoundary) {
    L.geoJSON(parkBoundary, {
      style: { color: COLORS.ink, weight: 1.5, fill: false, dashArray: "4,3" },
    }).addTo(map);
  }

  // full trail network as a faint gray context line -- lets you see WHERE
  // trails exist even where the hexbin below shows little or no traffic
  let trailLayer = null;
  if (trailBuffers) {
    trailLayer = L.geoJSON(trailBuffers, {
      style: { color: "#A99B76", weight: 1, fillColor: "#A99B76", fillOpacity: 0.18 },
    }).addTo(map);
  }

  // the actual point: small hexagons tracing literal device density along
  // the path network, not a per-trail average
  renderHexLayer(map, movementHex, { countIndex: 2 });

  if (trailLayer) {
    map.fitBounds(trailLayer.getBounds(), { padding: [10, 10], animate: false });
  } else {
    map.setView([31.9, -106.5], 12);
  }

  // flow arrows: reduced to the top 12 and pushed to a thin, subdued blue
  // so they read as a secondary "what happens next" layer on top of the
  // primary hex density, not competing with it
  const topFlows = flows.flows.slice(0, 12);
  const maxCount = Math.max(...topFlows.map(f => f.count));
  topFlows.forEach(f => {
    const from = f.from_pt, to = f.to_pt;
    const weight = 1 + (f.count / maxCount) * 3.5;
    const line = L.polyline([from, to], {
      color: COLORS.sky, weight, opacity: 0.6, lineCap: "round", dashArray: "1,6",
    }).addTo(map);
    line.bindTooltip(`${shortName(f.from)} → ${shortName(f.to)}: ${fmt(f.count)}×`);
  });

  map.whenReady(() => setTimeout(() => map.invalidateSize(), 50));
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
      <span class="val">${fmt(f.count)}&times;<br>${f.share}%</span>
    </li>
  `).join("");
}

// ---------------------------------------------------------------------
// 03 -- HOTSPOTS
// ---------------------------------------------------------------------
function buildHotspotMap(parkBoundary, hotspotHex) {
  const map = L.map("map-hotspot", { scrollWheelZoom: false, attributionControl: false }).setView([31.9, -106.5], 12);
  addBasemap(map);

  let boundaryLayer = null;
  if (parkBoundary) {
    boundaryLayer = L.geoJSON(parkBoundary, {
      style: { color: COLORS.ink, weight: 1.5, fill: false, dashArray: "4,3" },
    }).addTo(map);
  }

  // hex layer must be added BEFORE fitBounds -- adding a canvas-rendered
  // layer while/after an animated pan-zoom is in flight can leave it
  // un-rendered with no console error. Order matters here.
  renderHexLayer(map, hotspotHex, { countIndex: 2 });

  if (boundaryLayer) {
    map.fitBounds(boundaryLayer.getBounds(), { padding: [10, 10], animate: false });
  }

  // numbered markers on the annotated top spots, with a popup carrying the
  // "likely reason" text -- click to read, rather than crowding permanent
  // labels onto the map
  hotspotHex.annotations.forEach((a, i) => {
    const icon = L.divIcon({
      className: "", html: `<div class="hex-annotation-pin">${i + 1}</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
    L.marker([a.lat, a.lon], { icon })
      .bindPopup(`<b>${i + 1}. ${shortName(a.trail)} — ${fmt(a.devices)} devices${a.share != null ? ` (${a.share.toFixed(1)}% of all park visitors)` : ""}</b>${a.reason}`)
      .addTo(map);
  });

  map.whenReady(() => setTimeout(() => map.invalidateSize(), 50));
  makeExpandable("fig-hotspot", { onExpand: () => map.invalidateSize(), onCollapse: () => map.invalidateSize() });
}

function buildHotspotList(hotspotHex) {
  const top = hotspotHex.annotations;
  const max = top[0].devices;
  $("#interior-hotspot-list").innerHTML = top.map((h, i) => `
    <li>
      <span class="rank">${String(i + 1).padStart(2, "0")}</span>
      <div class="name">${shortName(h.trail)}
        <div class="bar" style="width:${(h.devices / max * 100).toFixed(0)}%; background:${COLORS.ochreSoft}"></div>
        <div style="font-family:var(--mono); font-size:0.7rem; color:var(--ink-faint); margin-top:3px; line-height:1.4;">${h.reason}</div>
      </div>
      <span class="val">${fmt(h.devices)} dev.${h.share != null ? `<br>${h.share.toFixed(1)}%` : ""}</span>
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
    <tr><td>${z.postal}</td><td>${ZIP_AREAS[z.postal] || "El Paso area"}</td><td class="num">${z.share}%</td><td class="num">${fmt(z.devices)}</td></tr>
  `).join("");

  $("#metro-table tbody").innerHTML = homeOrigins.top_metros.slice(0, 10).map(m => `
    <tr><td>${m.metro}</td><td class="num">${m.share}%</td><td class="num">${fmt(m.devices)}</td></tr>
  `).join("");

  const map = L.map("map-home", { scrollWheelZoom: false, attributionControl: false }).setView([31.85, -106.45], 10);
  addBasemap(map);
  if (parkBoundary) {
    L.geoJSON(parkBoundary, {
      style: { color: COLORS.rust, weight: 2, fill: true, fillColor: COLORS.rust, fillOpacity: 0.15 },
    }).addTo(map);
  }

  renderHexLayer(map, { corner_offsets_m: homeOrigins.home_hex.corner_offsets_m, cells: homeOrigins.home_hex.cells }, { countIndex: 2 });

  // center on El Paso region primarily -- most homes are local
  map.fitBounds([[31.55, -106.68], [32.02, -106.15]], { animate: false });

  map.whenReady(() => setTimeout(() => map.invalidateSize(), 50));
  makeExpandable("fig-home", { onExpand: () => map.invalidateSize(), onCollapse: () => map.invalidateSize() });
}

// ---------------------------------------------------------------------
// 05 -- TIME PATTERNS
// ---------------------------------------------------------------------
function buildTimeSection(tp) {
  // monthly chart -- primary temporal view. ~28 points reads as an actual
  // trend; the old weekly line (125 noisy points) didn't.
  const monthLabels = tp.monthly.map(m => m.year_month);
  const monthMax = Math.max(...tp.monthly.map(m => m.visits));
  const chartWeekly = new Chart($("#chart-weekly"), {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [{
        data: tp.monthly.map(m => m.visits),
        backgroundColor: monthLabels.map(ym => {
          const year = ym.slice(0, 4);
          return year === "2021" ? COLORS.ochreSoft : year === "2022" ? COLORS.rustSoft : COLORS.sky;
        }),
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const [y, m] = items[0].label.split("-");
              return new Date(+y, +m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
            },
          },
        },
        annotation: {
          annotations: tp.seasonal_dip ? {
            dipBox: {
              type: "box", xMin: "2022-01", xMax: "2022-05",
              backgroundColor: "rgba(174,71,38,0.08)", borderColor: "rgba(174,71,38,0.35)", borderWidth: 1,
            },
            dipLabel: {
              type: "label", xValue: "2022-03", yValue: monthMax * 0.97,
              content: [`Jan–May 2022: ${tp.seasonal_dip.drop_pct_2021_to_2022}% below`, "the same window in 2021"],
              font: { family: "Space Mono", size: 10 }, color: COLORS.rust,
              backgroundColor: "rgba(241,232,208,0.92)", padding: 4, borderRadius: 3,
            },
            reboundBox: {
              type: "box", xMin: "2023-01", xMax: "2023-04",
              backgroundColor: "rgba(49,86,112,0.08)", borderColor: "rgba(49,86,112,0.35)", borderWidth: 1,
            },
            reboundLabel: {
              type: "label", xValue: "2023-02", yValue: monthMax * 0.97,
              xAdjust: -35,
              content: [`${tp.seasonal_dip.rebound_pct_2023_of_2021}% of 2021's`, "Jan–May level"],
              font: { family: "Space Mono", size: 10 }, color: COLORS.sky,
              backgroundColor: "rgba(241,232,208,0.92)", padding: 4, borderRadius: 3,
            },
          } : {},
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: true, maxTicksLimit: 9, maxRotation: 0, color: COLORS.inkFaint,
            callback: function (val) {
              const label = this.getLabelForValue(val);
              const [y, m] = label.split("-");
              return new Date(+y, +m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
            },
          },
        },
        y: { grid: { color: COLORS.line }, ticks: { color: COLORS.inkSoft } },
      },
    },
  });
  makeExpandable("fig-weekly", { onExpand: () => chartWeekly.resize(), onCollapse: () => chartWeekly.resize() });

  if (tp.seasonal_dip) {
    $("#p-weekly-narrative").innerHTML =
      `Comparing the same Jan&ndash;May window each year (to stay season-neutral, shaded on the chart), ` +
      `<span class="hl hl-rust">visits fell about ${tp.seasonal_dip.drop_pct_2021_to_2022}%</span> from 2021 to 2022, ` +
      `then rebounded to roughly ${tp.seasonal_dip.rebound_pct_2023_of_2021}% of the 2021 level by early 2023. ` +
      `Because this is passive device-panel data rather than a gate count, some of that swing may reflect ` +
      `changes in the data provider's panel coverage rather than real-world attendance alone.`;
  }

  // seasonality bar chart, with peak/trough annotated directly
  const seasonMax = Math.max(...tp.seasonality.map(m => m.avg_visits));
  const chartSeason = new Chart($("#chart-season"), {
    type: "bar",
    data: {
      labels: tp.seasonality.map(m => m.month),
      datasets: [{
        data: tp.seasonality.map(m => m.avg_visits),
        backgroundColor: tp.seasonality.map(m => m.avg_visits === seasonMax ? COLORS.rust : COLORS.ochreSoft),
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: tp.seasonality_annotation ? {
          annotations: {
            peakLabel: {
              type: "label", xValue: tp.seasonality_annotation.peak_month, yValue: tp.seasonality_annotation.peak_visits,
              yAdjust: -16,
              content: [`${tp.seasonality_annotation.ratio}× the trough month`],
              font: { family: "Space Mono", size: 10 }, color: COLORS.rust,
              backgroundColor: "rgba(241,232,208,0.92)", padding: 4, borderRadius: 3,
            },
          },
        } : {},
      },
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

  buildHourGrid(tp.dow_hour_grid, tp.busiest_cell);
  if (tp.hour_curves) buildHourCurveChart(tp.hour_curves);
}

function buildHourCurveChart(curves) {
  const hourLabels = Array.from({ length: 24 }, (_, h) => formatHour12(h));
  const chart = new Chart($("#chart-hourcurve"), {
    type: "line",
    data: {
      labels: hourLabels,
      datasets: [
        { label: "Weekday (Mon–Fri)", data: curves.weekday, borderColor: COLORS.sky, backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: "Saturday", data: curves.saturday, borderColor: COLORS.rust, backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: "Sunday", data: curves.sunday, borderColor: COLORS.ochre, backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.3, borderDash: [4, 3] },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 12, color: COLORS.inkSoft, font: { family: "Space Mono", size: 10 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% of that day-type's visits` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.inkFaint, maxTicksLimit: 8 } },
        y: { grid: { color: COLORS.line }, ticks: { color: COLORS.inkSoft, callback: (v) => `${v}%` } },
      },
    },
  });
  makeExpandable("fig-hourcurve", { onExpand: () => chart.resize(), onCollapse: () => chart.resize() });

  const weekdayPeak = curves.weekday.indexOf(Math.max(...curves.weekday));
  const satPeak = curves.saturday.indexOf(Math.max(...curves.saturday));
  const sunPeak = curves.sunday.indexOf(Math.max(...curves.sunday));
  $("#p-hourcurve-narrative").innerHTML =
    `The grid above shows <em>how much</em> traffic each hour gets, but not the <em>shape</em> of the day — this is where weekday and weekend visits genuinely diverge. ` +
    `<span class="hl hl-sky">Weekdays peak in the evening</span>, around ${formatHour12(weekdayPeak)}, consistent with an after-work crowd. ` +
    `<span class="hl hl-rust">Saturdays peak mid-morning</span> around ${formatHour12(satPeak)}, and Sunday follows the same ` +
    `${satPeak === sunPeak ? "hour" : `${formatHour12(sunPeak)} pattern`} — a classic weekend-hiker schedule, not an after-work one.`;
}

function formatHour12(h) {
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

function buildHourGrid(grid, busiestCell) {
  const allVals = grid.flatMap(d => d.hours);
  const max = Math.max(...allVals);
  const grandTotal = allVals.reduce((a, b) => a + b, 0);
  let html = `<div class="hourgrid">`;
  html += `<div></div>`;
  for (let h = 0; h < 24; h++) {
    html += `<div class="hg-hour">${h % 3 === 0 ? formatHour12(h) : ""}</div>`;
  }
  grid.forEach(d => {
    html += `<div class="hg-label">${d.day}</div>`;
    d.hours.forEach((v, h) => {
      const t = v / max;
      const alpha = 0.06 + t * 0.9;
      const isBusiest = busiestCell && d.day === busiestCell.day && h === busiestCell.hour;
      html += `<div class="hg-cell" data-day="${d.day}" data-hour="${h}" data-visits="${v}" style="background:rgba(174,71,38,${alpha.toFixed(2)});${isBusiest ? "outline:2px solid " + COLORS.ink + ";outline-offset:-2px;" : ""}"></div>`;
    });
  });
  html += `</div>`;
  $("#hourgrid-wrap").innerHTML = html;

  document.querySelectorAll("#hourgrid-wrap .hg-cell").forEach(cell => {
    attachHoverTooltip(cell, (el) => {
      const day = el.dataset.day, hour = +el.dataset.hour, v = +el.dataset.visits;
      const share = grandTotal ? (v / grandTotal * 100) : 0;
      return `<b style="color:${COLORS.ochreSoft}">${day} ${formatHour12(hour)}</b><br>${fmt(v)} visits &middot; ${share.toFixed(2)}% of all visits`;
    });
  });

  if (busiestCell) {
    $("#hourgrid-hint").textContent =
      `Busiest single hour of the week: ${busiestCell.day} ${formatHour12(busiestCell.hour)} (${fmt(busiestCell.visits)} visits, outlined above). Hover any cell for its exact share.`;
  } else if (window.innerWidth < 580) {
    $("#hourgrid-hint").textContent = "Scroll sideways to see the full day →";
  }
  makeExpandable("fig-hourgrid");
}

main().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML("afterbegin",
    `<div style="background:#AE4726;color:#fff;padding:12px;font-family:monospace;font-size:13px;">Failed to load data: ${err.message}. If you're viewing this file directly, run a local server (e.g. <code>python3 -m http.server</code>) instead of opening index.html straight from disk.</div>`);
});
