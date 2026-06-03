const CITY_ID = "66faae66cd18349215c90187";

const BASE_BIKES_URL = `https://logistic.gojet.app/api/v0/urent/bikes/?city_id=${CITY_ID}&page=1&limit=1000`;
const BASE_PARKING_URL = `https://logistic.gojet.app/api/v0/urent/parkings/?city_id=${CITY_ID}&page=1&limit=1000`;

// Memória para rastreamento suave
let activeBikeMarkers = {};
let activeParkingMarkers = {};

const map = L.map('map', {
  fadeAnimation: false,
  zoomAnimation: true,
  markerZoomAnimation: true,
  preferCanvas: true
}).setView([-9.6498, -35.7089], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
  updateWhenIdle: true,
  keepBuffer: 3
}).addTo(map);

const style = document.createElement('style');
style.innerHTML = `
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(0, 122, 255, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0); } }
  .leaflet-tile { filter: contrast(1.2) brightness(0.95) saturate(1.1) !important; }
`;
document.head.appendChild(style);

let bikeLayer = L.layerGroup().addTo(map);
let parkingLayer = L.layerGroup().addTo(map);
let userLocationLayer = L.layerGroup().addTo(map);

let showBikes = true;
let showParking = true;
let userLat = null;
let userLng = null;

function createVehicleIcon(isBike) {
  const text = isBike ? "B" : "S";
  return L.divIcon({
    className: 'vehicle-text-icon',
    html: `<div style="background-color: #f97316 !important; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4); color: white !important; font-weight: 900; font-size: 15px; font-family: Arial, sans-serif; line-height: 1;">${text}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
}

function createParkingDivIcon(color, size = 20) {
  return L.divIcon({
    className: 'parking-div-icon', 
    html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid white; color: white; font-weight: bold; font-size: ${size*0.7}px; box-shadow: 0 2px 6px rgba(0,0,0,0.35);">P</div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -size/2]
  });
}

const userIcon = L.divIcon({
  className: 'user-location-icon',
  html: `<div style="background-color: #007aff; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px #007aff; animation: pulse 2s infinite;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

function ativarGpsUsuario() {
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      (position) => {
        userLat = position.coords.latitude;
        userLng = position.coords.longitude;
        userLocationLayer.clearLayers();
        L.marker([userLat, userLng], { icon: userIcon }).addTo(userLocationLayer);
      },
      (error) => console.warn("Aguardando GPS..."),
      { enableHighAccuracy: true }
    );
  }
}

// =====================================================================
// SISTEMA BLINDADO: DUPLO PROXY COM CANCELAMENTO AUTOMÁTICO (TIMEOUT)
// =====================================================================
async function fetchComFallback(urlBase) {
  // Cria uma URL única para destruir o cache do celular
  const urlAlvo = `${urlBase}&_bot=${Date.now()}`;
  
  // Lista de proxies (Se o primeiro falhar, ele tenta o segundo na mesma hora)
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(urlAlvo)}`,
    `https://corsproxy.io/?${encodeURIComponent(urlAlvo)}`
  ];

  for (let proxy of proxies) {
    try {
      const controller = new AbortController();
      // Se o proxy demorar mais de 5 segundos, aborta a missão e tenta o próximo!
      const timeoutId = setTimeout(() => controller.abort(), 5000); 

      const response = await fetch(proxy, { 
        method: "GET", 
        signal: controller.signal,
        cache: "no-store" 
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const json = await response.json();
        if (json) return json; // Retorna os dados com sucesso
      }
    } catch (erro) {
      console.warn("Proxy falhou ou demorou muito, tentando o plano B...", proxy);
    }
  }
  return null; // Retorna nulo apenas se TODOS os proxies falharem
}

function extrairPontos(dados) {
  if (!dados) return [];
  let lista = Array.isArray(dados) ? dados : (dados && Array.isArray(dados.entries) ? dados.entries : []);
  let pontos = [];
  
  lista.forEach(item => {
    if (!item) return;
    let latRaw = item.location_lat !== undefined ? item.location_lat : item.latitude;
    let lngRaw = item.location_lng !== undefined ? item.location_lng : item.longitude;
    if (latRaw && lngRaw) {
      let lat = parseFloat(latRaw);
      let lng = parseFloat(lngRaw);
      if (!isNaN(lat) && !isNaN(lng)) {
        pontos.push({ lat: lat, lng: lng, info: item });
      }
    }
  });
  return pontos;
}

// =====================================================================
// MOTOR DE SINCRONIZAÇÃO AO VIVO
// =====================================================================
async function sincronizarDadosAoVivo() {
  try {
    const statusText = document.getElementById('lastUpdate');
    
    const [rawBikes, rawParkings] = await Promise.all([
      fetchComFallback(BASE_BIKES_URL),
      fetchComFallback(BASE_PARKING_URL)
    ]);

    // Se ambos os proxies falharem (internet caiu ou proxies congestionados)
    if (!rawBikes && !rawParkings) {
      statusText.innerText = "⚠️ Proxies congestionados. Tentando novamente...";
      return; 
    }

    // --- 1. VEÍCULOS ---
    if (rawBikes) {
      const bikes = extrairPontos(rawBikes);
      let IDsEncontradosAgora = new Set();

      bikes.forEach(b => {
        const info = b.info || {};
        let st = String(info.status || info.status_name || info.state || '').toLowerCase();
        let isEmUso = st.includes('uso') || st.includes('rid') || st.includes('rent') || st.includes('bus');
        
        if (info.ordered === true || info.booked === true || info.is_rented === true || isEmUso) return; 

        let idUnico = info.id || info.identifier || `${b.lat}_${b.lng}`;
        IDsEncontradosAgora.add(idUnico);

        let isBike = info.type && String(info.type).toLowerCase().includes('bike');
        let bateriaRaw = info.battery_percent || 0;
        let bateriaFormatada = Math.round((bateriaRaw <= 1 && bateriaRaw > 0) ? (bateriaRaw * 100) : bateriaRaw);
        let txtPopup = `<b>${isBike ? "Bicicleta" : "Patinete"}:</b> ${info.identifier || 'N/A'}<br><b>Bateria:</b> ${bateriaFormatada}%`;

        if (activeBikeMarkers[idUnico]) {
          activeBikeMarkers[idUnico].setLatLng([b.lat, b.lng]);
          activeBikeMarkers[idUnico].setPopupContent(txtPopup);
        } else {
          let marcador = L.marker([b.lat, b.lng], { icon: createVehicleIcon(isBike) }).bindPopup(txtPopup);
          if (showBikes) marcador.addTo(bikeLayer);
          activeBikeMarkers[idUnico] = marcador;
        }
      });

      for (let id in activeBikeMarkers) {
        if (!IDsEncontradosAgora.has(id)) {
          bikeLayer.removeLayer(activeBikeMarkers[id]);
          delete activeBikeMarkers[id];
        }
      }
    }

    // --- 2. ESTACIONAMENTOS ---
    if (rawParkings) {
      const parkings = extrairPontos(rawParkings);
      let IDsEstacionamentosAgora = new Set();

      parkings.forEach(p => {
        let idUnico = p.info.id || p.info.name || `${p.lat}_${p.lng}`;
        IDsEstacionamentosAgora.add(idUnico);

        let col = "#3b82f6";
        let tamanho = 20;
        let atual = p.info.bikes_count || 0;
        let elevacao = 0; 
        let capReal = p.info.target_bikes_count || p.info.capacity || p.info.expected_bikes_count || '?';
        let capCalc = (capReal !== '?' && capReal > 0) ? capReal : 1;

        if (p.info.monitor === true) {
          tamanho = 26; elevacao = 1000; 
          let proporcao = atual / capCalc;
          if (proporcao >= 0.8) col = "#22c55e";
          else if (proporcao >= 0.4) col = "#eab308";
          else col = "#ef4444";
        }

        let txtPopup = `<b>${p.info.name || 'Ponto'}</b><br>Veículos: ${atual} / ${capReal}<br>Monitor: ${p.info.monitor ? 'Sim' : 'Não'}`;

        if (activeParkingMarkers[idUnico]) {
          activeParkingMarkers[idUnico].setLatLng([p.lat, p.lng]);
          activeParkingMarkers[idUnico].setIcon(createParkingDivIcon(col, tamanho));
          activeParkingMarkers[idUnico].setPopupContent(txtPopup);
        } else {
          let marcador = L.marker([p.lat, p.lng], { icon: createParkingDivIcon(col, tamanho), zIndexOffset: elevacao }).bindPopup(txtPopup);
          if (showParking) marcador.addTo(parkingLayer);
          activeParkingMarkers[idUnico] = marcador;
        }
      });

      for (let id in activeParkingMarkers) {
        if (!IDsEstacionamentosAgora.has(id)) {
          parkingLayer.removeLayer(activeParkingMarkers[id]);
          delete activeParkingMarkers[id];
        }
      }
    }

    const agora = new Date();
    statusText.innerText = `⚡ BOT TEMPO REAL • Sincronizado às ${agora.toLocaleTimeString('pt-BR')}`;

  } catch (erroGeral) {
    document.getElementById('lastUpdate').innerText = "❌ Erro no script: " + erroGeral.message;
  }
}

// --- CONTROLES DA INTERFACE ---
document.getElementById('toggleBikes').addEventListener('click', (e) => {
  showBikes = !showBikes;
  if (showBikes) {
    for (let id in activeBikeMarkers) activeBikeMarkers[id].addTo(bikeLayer);
    e.target.classList.remove('disabled'); e.target.innerText = "Veículos (ON)";
  } else {
    for (let id in activeBikeMarkers) bikeLayer.removeLayer(activeBikeMarkers[id]);
    e.target.classList.add('disabled'); e.target.innerText = "Veículos (OFF)";
  }
});

document.getElementById('toggleParking').addEventListener('click', (e) => {
  showParking = !showParking;
  if (showParking) {
    for (let id in activeParkingMarkers) activeParkingMarkers[id].addTo(parkingLayer);
    e.target.classList.remove('disabled'); e.target.innerText = "Pontos (ON)";
  } else {
    for (let id in activeParkingMarkers) parkingLayer.removeLayer(activeParkingMarkers[id]);
    e.target.classList.add('disabled'); e.target.innerText = "Pontos (OFF)";
  }
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  const btn = document.getElementById('refreshBtn');
  btn.innerText = "Sincronizando...";
  sincronizarDadosAoVivo().then(() => btn.innerText = "Atualizar Agora 🔄");
});

document.getElementById('btnMeuLocal').addEventListener('click', () => {
  if (userLat !== null && userLng !== null) {
    map.flyTo([userLat, userLng], 16, { animate: true, duration: 1.0 });
  } else {
    alert("Buscando sinal do GPS do Android...");
  }
});

// Inicialização e Loop
ativarGpsUsuario();
sincronizarDadosAoVivo();
setInterval(sincronizarDadosAoVivo, 10000);
