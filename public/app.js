const cities = {
  asuncion: { lat: -25.2969, lon: -57.6498, zoom: 13, name: "Asunción" },
  cde: { lat: -25.5085, lon: -54.6111, zoom: 13, name: "Ciudad del Este" },
  encarnacion: { lat: -27.3306, lon: -55.8667, zoom: 13, name: "Encarnación" },
  villarrica: { lat: -25.75, lon: -56.4333, zoom: 14, name: "Villarrica" }
};

let map;
let baseTileLayer;

// capas
let layers = {
  hospital: L.layerGroup(),
  police: L.layerGroup(),
  fire: L.layerGroup(),
  park: L.layerGroup(),
  supermarket: L.layerGroup(),
  school: L.layerGroup(),
  recycling: L.layerGroup(),
  heat: null
};

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  setupUI();
  setInitialActiveLayer();
  loadDataForCurrentView();
});

function initMap() {
  const initial = cities.asuncion;

  map = L.map("map", { zoomControl: true }).setView(
    [initial.lat, initial.lon],
    initial.zoom
  );

  baseTileLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  ).addTo(map);

  // Fix de tamaño para que no salga cortado ni se expanda raro
  setTimeout(() => {
    map.invalidateSize();
  }, 250);
}

function showLoader(show) {
  const loader = document.getElementById("loader");
  if (!loader) return;
  loader.classList.toggle("hidden", !show);
}

function buildOverpassQuery() {
  const b = map.getBounds();
  const south = b.getSouth();
  const west = b.getWest();
  const north = b.getNorth();
  const east = b.getEast();

  return `
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](${south},${west},${north},${east});
      node["amenity"="clinic"](${south},${west},${north},${east});
      node["amenity"="police"](${south},${west},${north},${east});
      node["amenity"="fire_station"](${south},${west},${north},${east});
      node["leisure"="park"](${south},${west},${north},${east});
      node["shop"="supermarket"](${south},${west},${north},${east});
      node["amenity"="school"](${south},${west},${north},${east});
      node["amenity"="kindergarten"](${south},${west},${north},${east});
      node["amenity"="college"](${south},${west},${north},${east});
      node["amenity"="university"](${south},${west},${north},${east});

      node["amenity"="recycling"](${south},${west},${north},${east});
      node["recycling:glass"="yes"](${south},${west},${north},${east});
      node["recycling:paper"="yes"](${south},${west},${north},${east});
      node["recycling:plastic"="yes"](${south},${west},${north},${east});
      node["recycling:metal"="yes"](${south},${west},${north},${east});
      node["recycling:batteries"="yes"](${south},${west},${north},${east});
      node["recycling:tyres"="yes"](${south},${west},${north},${east});
    );
    out body;
  `;
}

async function loadDataForCurrentView() {
  showLoader(true);

  // limpiar capas
  Object.keys(layers).forEach((key) => {
    const layer = layers[key];
    if (!layer) return;
    if (key === "heat") {
      if (layers.heat && map.hasLayer(layers.heat)) {
        map.removeLayer(layers.heat);
      }
      layers.heat = null;
    } else {
      layer.clearLayers();
    }
  });

  const query = buildOverpassQuery();
  const url =
    "https://overpass-api.de/api/interpreter?data=" +
    encodeURIComponent(query);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Overpass error " + res.status);
    const data = await res.json();
    const elements = data.elements || [];

    const countEl = document.getElementById("pointsCount");
    countEl.textContent = elements.length;

    const securityPoints = [];
    const maxWeights = [];

    const seenIds = new Set();

    elements.forEach((e) => {
      if (!e.lat || !e.lon) return;
      if (seenIds.has(e.id)) return;
      seenIds.add(e.id);

      const tags = e.tags || {};
      const name = tags.name || "Sin nombre";
      const typeAmenity = tags.amenity || tags.leisure || "";
      const shopType = tags.shop || "";

      let layerKey = null;
      let color = "";
      let symbol = "";
      let isEmoji = false;
      let securityWeight = 0;

      // Clasificación por tipo
      if (typeAmenity === "hospital" || typeAmenity === "clinic") {
        layerKey = "hospital";
        color = "#ef4444";
        symbol = "H";
        securityWeight = 0.4;
      } else if (typeAmenity === "police") {
        layerKey = "police";
        color = "#3b82f6";
        symbol = "P";
        securityWeight = 1.0;
      } else if (typeAmenity === "fire_station") {
        layerKey = "fire";
        color = "#f97316";
        symbol = "B";
        securityWeight = 0.8;
      } else if (typeAmenity === "park") {
        layerKey = "park";
        color = "#22c55e";
        symbol = "🌳";
        isEmoji = true;
        securityWeight = 0.2;
      } else if (shopType === "supermarket") {
        layerKey = "supermarket";
        color = "#eab308";
        symbol = "S";
        securityWeight = 0.2;
      } else if (
        typeAmenity === "school" ||
        typeAmenity === "kindergarten" ||
        typeAmenity === "college" ||
        typeAmenity === "university"
      ) {
        layerKey = "school";
        color = "#38bdf8";
        symbol = "🏫";
        isEmoji = true;
        securityWeight = 0.3;
      } else if (
        typeAmenity === "recycling" ||
        hasRecycleTag(tags)
      ) {
        layerKey = "recycling";
        color = "#22c55e";
        symbol = "♻️";
        isEmoji = true;
        securityWeight = 0.25;
      }

      if (securityWeight > 0) {
        securityPoints.push([e.lat, e.lon, securityWeight]);
        maxWeights.push(securityWeight);
      }

      if (!layerKey) return;

      const icon = L.divIcon({
        className: "custom-marker",
        html: svgMarker(symbol, color, isEmoji),
        iconSize: [24, 24],
        iconAnchor: [12, 24]
      });

      const marker = L.marker([e.lat, e.lon], { icon });

      const typeLabel = (() => {
        if (layerKey === "hospital") return "Hospital / Clínica";
        if (layerKey === "police") return "Policía";
        if (layerKey === "fire") return "Bomberos";
        if (layerKey === "park") return "Parque / plaza";
        if (layerKey === "supermarket") return "Supermercado";
        if (layerKey === "school") return "Centro educativo";
        if (layerKey === "recycling") return "Centro de reciclaje";
        return "";
      })();

      const materials = buildRecycleDescription(tags);

      const popupHtml = `
        <strong>${name}</strong><br/>
        <small>${typeLabel}</small>
        ${materials ? `<br/><small>${materials}</small>` : ""}
        ${
          tags.operator
            ? `<br/><small>Operador: ${tags.operator}</small>`
            : ""
        }
      `;

      marker.bindPopup(popupHtml);
      marker.addTo(layers[layerKey]);
    });

    // Seguridad de zonas: heatmap directo
    if (securityPoints.length > 0) {
      const max = Math.max(...maxWeights, 1);
      const normalized = securityPoints.map(([lat, lon, w]) => [
        lat,
        lon,
        Math.min(w / max, 1)
      ]);

      layers.heat = L.heatLayer(normalized, {
        radius: 30,
        blur: 20,
        maxZoom: 18,
        minOpacity: 0.25,
        gradient: {
          0.1: "#22c55e",
          0.4: "#facc15",
          0.7: "#f97316",
          1.0: "#ef4444"
        }
      });
    } else {
      layers.heat = null;
    }

    applyLayerVisibilityFromUI();
  } catch (err) {
    console.error(err);
    alert(
      "No se pudieron cargar los datos ciudadanos. Probá de nuevo en unos segundos."
    );
  } finally {
    showLoader(false);
  }
}

function hasRecycleTag(tags) {
  return (
    tags["recycling:glass"] === "yes" ||
    tags["recycling:paper"] === "yes" ||
    tags["recycling:plastic"] === "yes" ||
    tags["recycling:metal"] === "yes" ||
    tags["recycling:batteries"] === "yes" ||
    tags["recycling:tyres"] === "yes"
  );
}

function buildRecycleDescription(tags) {
  const materials = [];
  if (tags["recycling:glass"] === "yes") materials.push("vidrio");
  if (tags["recycling:paper"] === "yes") materials.push("papel/cartón");
  if (tags["recycling:plastic"] === "yes") materials.push("plástico");
  if (tags["recycling:metal"] === "yes") materials.push("metales/latas");
  if (tags["recycling:batteries"] === "yes") materials.push("pilas/baterías");
  if (tags["recycling:tyres"] === "yes") materials.push("neumáticos");

  if (!materials.length) return "";
  return "Reciclaje de: " + materials.join(", ");
}

function svgMarker(symbol, color, isEmoji = false) {
  const text = isEmoji
    ? `<text x="12" y="15" font-size="12" text-anchor="middle">${symbol}</text>`
    : `<text x="12" y="15" font-size="11" text-anchor="middle" fill="#0b1120" font-weight="700">${symbol}</text>`;

  return `
    <svg width="24" height="24" viewBox="0 0 24 24">
      <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(15,23,42,0.7)" />
        </filter>
      </defs>
      <g filter="url(#shadow)">
        <path d="M12 1.5C7.86 1.5 4.5 4.86 4.5 9c0 4.86 6 9.75 7.02 10.54.29.22.68.22.97 0C13.5 18.75 19.5 13.86 19.5 9c0-4.14-3.36-7.5-7.5-7.5z" fill="${color}" stroke="#0b1120" stroke-width="1"/>
        ${text}
      </g>
    </svg>
  `;
}

function setupUI() {
  const themeToggle = document.getElementById("themeToggle");
  themeToggle.addEventListener("click", () => {
    const body = document.body;
    const iconSpan = themeToggle.querySelector(".theme-icon");
    const isDark = body.classList.contains("theme-dark");
    if (isDark) {
      body.classList.remove("theme-dark");
      body.classList.add("theme-light");
      iconSpan.textContent = "☀️";
    } else {
      body.classList.remove("theme-light");
      body.classList.add("theme-dark");
      iconSpan.textContent = "🌙";
    }
  });

  document
    .getElementById("btnIrCiudad")
    .addEventListener("click", () => goToSelectedCity());

  document
    .getElementById("btnBuscarDireccion")
    .addEventListener("click", () => searchAddress());

  document
    .getElementById("searchInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") searchAddress();
    });

  document
    .getElementById("btnActualizarMapa")
    .addEventListener("click", () => loadDataForCurrentView());

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      applyLayerVisibilityFromUI();
    });
  });

  // modal info
  const infoButton = document.getElementById("infoButton");
  const infoModal = document.getElementById("infoModal");
  const modalClose = document.getElementById("modalClose");
  const modalBackdrop = infoModal.querySelector(".modal-backdrop");

  infoButton.addEventListener("click", () => {
    infoModal.classList.remove("hidden");
  });

  modalClose.addEventListener("click", () => {
    infoModal.classList.add("hidden");
  });

  modalBackdrop.addEventListener("click", () => {
    infoModal.classList.add("hidden");
  });
}

// solo una capa activa al inicio (policías)
function setInitialActiveLayer() {
  const chips = document.querySelectorAll(".chip");
  chips.forEach((chip) => chip.classList.remove("active"));
  const defaultChip = document.querySelector('.chip[data-layer="police"]');
  if (defaultChip) defaultChip.classList.add("active");
  applyLayerVisibilityFromUI();
}

function goToSelectedCity() {
  const select = document.getElementById("citySelect");
  const key = select.value;
  const city = cities[key];
  if (!city) return;
  map.setView([city.lat, city.lon], city.zoom);
}

async function searchAddress() {
  const input = document.getElementById("searchInput");
  const q = input.value.trim();
  if (!q) return;

  showLoader(true);
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(q + ", Paraguay");
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "es"
      }
    });
    const data = await res.json();
    if (!data || data.length === 0) {
      alert("No se encontró esa dirección. Probá ser más específico.");
      return;
    }
    const loc = data[0];
    const lat = parseFloat(loc.lat);
    const lon = parseFloat(loc.lon);
    map.setView([lat, lon], 15);
  } catch (err) {
    console.error(err);
    alert("Error buscando dirección. Intentá de nuevo.");
  } finally {
    showLoader(false);
  }
}

function applyLayerVisibilityFromUI() {
  const chips = document.querySelectorAll(".chip");
  const activeNames = [];

  chips.forEach((chip) => {
    const key = chip.getAttribute("data-layer");
    const isActive = chip.classList.contains("active");

    if (key === "heat") {
      if (layers.heat) {
        if (isActive) {
          if (!map.hasLayer(layers.heat)) layers.heat.addTo(map);
          activeNames.push("Seguridad de zonas");
        } else {
          if (map.hasLayer(layers.heat)) map.removeLayer(layers.heat);
        }
      }
      return;
    }

    const layer = layers[key];
    if (!layer) return;

    if (isActive) {
      if (!map.hasLayer(layer)) layer.addTo(map);
      if (key === "police") activeNames.push("Policías");
      if (key === "hospital") activeNames.push("Hospitales");
      if (key === "fire") activeNames.push("Bomberos");
      if (key === "supermarket") activeNames.push("Supermercados");
      if (key === "park") activeNames.push("Plazas");
      if (key === "school") activeNames.push("Colegios");
      if (key === "recycling") activeNames.push("Reciclaje");
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  });

  const label =
    activeNames.length === 0 ? "Ninguna" : activeNames.join(" • ");
  const el = document.getElementById("layersActive");
  if (el) el.textContent = label;
}
