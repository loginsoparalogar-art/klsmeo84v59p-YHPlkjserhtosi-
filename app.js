const CITY_ID = "66faae66cd18349215c90187";

const BASE_BIKES_URL = `https://logistic.gojet.app/api/v0/urent/bikes/?city_id=${CITY_ID}&page=1&limit=1000`;
const BASE_PARKING_URL = `https://logistic.gojet.app/api/v0/urent/parkings/?city_id=${CITY_ID}&page=1&limit=1000`;

// Dicionários na memória para rastreamento em tempo real (Evita o efeito pisca-pisca)
let activeBikeMarkers = {};
let activeParkingMarkers = {};

// Inicializa o mapa Leaflet com configurações de alta performance
const map = L.map('map', {
  fadeAnimation: false,      // Desativado para atualizações instantâneas
  zoomAnimation: true,
  markerZoomAnimation: true,
  preferCanvas: true         // Força o Android a renderizar usando aceleração de hardware
}).setView([-9.6498, -35.7089], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
  updateWhenIdle: true,
  keepBuffer: 3
}).addTo(map);

// Filtro de contraste otimizado para o dia a dia na rua
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

// Geradores de Ícones
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

// GPS do Usuário
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

// Fetch com destruição agressiva de cache e Timeout de segurança de 4 segundos
async function fetchDataBotStyle(urlBase) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // Cancela se a rede travar

  try {
    const urlDestroiCache = `${urlBase}&_bot=${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const urlComProxy = `https://corsproxy.io/?${urlDestroiCache}`;

    const response = await fetch(urlComProxy, { 
      method: "GET",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Link lento ou bloqueado, pulando ciclo.");
    return null;
  }
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

// Sistema de Sincronização Inteligente (Igual ao Bot do Telegram)
async function sincronizarDadosAoVivo() {
  const [rawBikes, rawParkings] = await Promise.all([
    fetchDataBotStyle(BASE_BIKES_URL),
    fetchDataBotStyle(BASE_PARKING_URL)
  ]);

  if (!rawBikes && !rawParkings) {
    document.getElementById('lastUpdate').innerText = "⚡ Mantendo dados anteriores (Sinal oscilando)...";
    return; // Não limpa nada, mantém o mapa com os últimos dados válidos
  }

  // --- 1. ATUALIZAR VEÍCULOS ---
  if (rawBikes) {
    const bikes = extrairPontos(rawBikes);
    let IDsEncontradosAgora = new Set();

    bikes.forEach(b => {
      const info = b.info || {};
      let statusText = String(info.status || info.status_name || info.state || '').toLowerCase();
      let isEmUso = statusText.includes('uso') || statusText.includes('rid') || statusText.includes('rent') || statusText.includes('bus');
      
      // Filtros de segurança solicitados
      if (info.ordered === true || info.booked === true || info.is_rented === true || isEmUso) {
        return; 
      }

      let idUnico = info.id || info.identifier || `${b.lat}_${b.lng}`;
      IDsEncontradosAgora.add(idUnico);

      let isBike = info.type && String(info.type).toLowerCase().includes('bike');
      let bateriaRaw = info.battery_percent || 0;
      let bateriaFormatada = Math.round((bateriaRaw <= 1 && bateriaRaw > 0) ? (bateriaRaw * 100) : bateriaRaw);
      let textoPopup = `<b>${isBike ? "Bicicleta" : "Patinete"}:</b> ${info.identifier || 'N/A'}<br><b>Bateria:</b> ${bateriaFormatada}%`;

      // Se o marcador já existe na tela, só atualiza a posição e o texto (Sem recriar!)
      if (activeBikeMarkers[idUnico]) {
        activeBikeMarkers[idUnico].setLatLng([b.lat, b.lng]);
        activeBikeMarkers[idUnico].setPopupContent(textoPopup);
      } else {
        // Se for novo, adiciona
        let novoMarcador = L.marker([b.lat, b.lng], { icon: createVehicleIcon(isBike) })
          .bindPopup(textoPopup);
        
        if (showBikes) novoMarcador.addTo(bikeLayer);
        activeBikeMarkers[idUnico] = novoMarcador;
      }
    });

    // Remove do mapa os patinetes que sumiram da API (Foram alugados ou sumiram)
    for (let id in activeBikeMarkers) {
      if (!IDsEncontradosAgora.has(id)) {
        bikeLayer.removeLayer(activeBikeMarkers[id]);
        delete activeBikeMarkers[id];
      }
    }
  }

  // --- 2. ATUALIZAR ESTACIONALMENTOS ---
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
      
      let capacidadeReal = p.info.target_bikes_count || p.info.capacity || p.info.expected_bikes_count || '?';
      let capacidadeCalculo = (capacidadeReal !== '?' && capacidadeReal > 0) ? capacidadeReal : 1;

      if (p.info.monitor === true) {
        tamanho = 26; 
        elevacao = 1000; 
        let proporcao = atual / capacidadeCalculo;
        if (proporcao >= 0.8) col = "#22c55e";
        else if (proporcao >= 0.4) col = "#eab308";
        else col = "#ef4444";
      }

      let textoPopup = `<b>${p.info.name || 'Ponto'}</b><br>Veículos: ${atual} / ${capacidadeReal}<br>Monitor: ${p.info.monitor ? 'Sim' : 'Não'}`;

      if (activeParkingMarkers[idUnico]) {
        activeParkingMarkers[idUnico].setLatLng([p.lat, p.lng]);
        activeParkingMarkers[idUnico].setIcon(createParkingDivIcon(col, tamanho));
        activeParkingMarkers[idUnico].setPopupContent(textoPopup);
      } else {
        let novoMarcador = L.marker([p.lat, p.lng], { 
          icon: createParkingDivIcon(col, tamanho),
          zIndexOffset: elevacao
        }).bindPopup(textoPopup);

        if (showParking) novoMarcador.addTo(parkingLayer);
        activeParkingMarkers[idUnico] = novoMarcador;
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
  document.getElementById('lastUpdate').innerText = `⚡ BOT TEMPO REAL • Sincronizado às ${agora.toLocaleTimeString('pt-BR')}`;
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
  btn.innerText = "Forçando Sincronia...";
  sincronizarDadosAoVivo().then(() => btn.innerText = "Atualizar Mapa 🔄");
});

document.getElementById('btnMeuLocal').addEventListener('click', () => {
  if (userLat !== null && userLng !== null) {
    map.flyTo([userLat, userLng], 16, { animate: true, duration: 1.0 });
  } else {
    alert("Buscando sinal do GPS do Android...");
  }
});

// Inicialização imediata e Loop ultra veloz de 10 segundos (Ritmo de Bot)
ativarGpsUsuario();
sincronizarDadosAoVivo();
setInterval(sincronizarDadosAoVivo, 10000);
