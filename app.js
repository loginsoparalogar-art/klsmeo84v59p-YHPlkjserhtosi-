// Configurações
const CITY_ID = "66faae66cd18349215c90187";
const BIKES_URL = `https://logistic.gojet.app/api/v0/urent/bikes/?city_id=${CITY_ID}&page=1&limit=1000`;
const PARKING_URL = `https://logistic.gojet.app/api/v0/urent/parkings/?city_id=${CITY_ID}&page=1&limit=1000`;

// Inicializa o mapa com animações nativas ativas
const map = L.map('map', {
  fadeAnimation: true,
  zoomAnimation: true,
  markerZoomAnimation: true
}).setView([-9.6498, -35.7089], 13);

// ALTERAÇÃO: Mudança para o OpenStreetMap Standard (Linhas fortes, nomes pretos e ruas coloridas)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 2
}).addTo(map);

// Grupos para ligar/desligar
let bikeLayer = L.layerGroup().addTo(map);
let parkingLayer = L.layerGroup().addTo(map);
let userLocationLayer = L.layerGroup().addTo(map);

let showBikes = true;
let showParking = true;

// Otimização de performance: Carrega os SVGs externos dentro do círculo CSS dinâmico
function createVehicleIcon(color, svgFile) {
  return L.divIcon({
    className: 'vehicle-div-icon',
    html: `<div style="background-color: ${color}; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"><img src="${svgFile}" style="width: 14px; height: 14px; display: block;" /></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
}

// Ponto azul dinâmico para a localização do usuário (GPS)
const userIcon = L.divIcon({
  className: 'user-location-icon',
  html: `<div style="background-color: #007aff; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px #007aff; animation: pulse 2s infinite;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

// REFORÇO VISUAL: CSS injetado para o efeito do GPS e para forçar o contraste das linhas do mapa
const style = document.createElement('style');
style.innerHTML = `
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(0, 122, 255, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0); } }
  
  /* Deixa os textos, calçadas e linhas de trânsito do mapa muito mais escuros, nítidos e fáceis de ler no sol */
  .leaflet-tile { 
    filter: contrast(1.22) brightness(0.92) saturate(1.1) !important; 
  }
`;
document.head.appendChild(style);

// Função para criar o ícone 'P' dos estacionamentos
function createParkingDivIcon(color, size = 20) {
  return L.divIcon({
    className: 'parking-div-icon', 
    html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid white; color: white; font-weight: bold; font-size: ${size*0.7}px; box-shadow: 0 2px 6px rgba(0,0,0,0.35);">P</div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -size/2]
  });
}

// --- FUNÇÃO DO GPS ---
function ativarGpsUsuario() {
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        userLocationLayer.clearLayers();
        L.marker([lat, lng], { icon: userIcon })
          .bindPopup("<b>Você está aqui</b>")
          .addTo(userLocationLayer);
      },
      (error) => console.warn("Permissão de GPS indisponível."),
      { enableHighAccuracy: true }
    );
  }
}

// --- FUNÇÕES DE DADOS ---
async function fetchData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

function extrairPontos(dados) {
  let lista = Array.isArray(dados) ? dados : (dados && Array.isArray(dados.entries) ? dados.entries : []);
  let pontos = [];
  lista.forEach(item => {
    let lat = item.location_lat !== undefined ? item.location_lat : item.latitude;
    let lng = item.location_lng !== undefined ? item.location_lng : item.longitude;
    if (lat && lng) {
      pontos.push({ lat: parseFloat(lat), lng: parseFloat(lng), info: item });
    }
  });
  return pontos;
}

async function carregarMapa() {
  const [rawBikes, rawParkings] = await Promise.all([
    fetchData(BIKES_URL),
    fetchData(PARKING_URL)
  ]);

  bikeLayer.clearLayers();
  parkingLayer.clearLayers();

  // 1. DESENHANDO VEÍCULOS (bike.svg e scooter.svg)
  if (rawBikes) {
    const bikes = extrairPontos(rawBikes);
    bikes.forEach(b => {
      const info = b.info || {};

      if (info.ordered === true || info.booked === true || info.is_rented === true) return;
      let statusText = String(info.status || info.status_name || info.state || '').toLowerCase();
      if (statusText.includes('uso') || statusText.includes('rid') || statusText.includes('rent') || statusText.includes('bus')) return;

      let isBike = info.type && info.type.toLowerCase().includes('bike');
      
      let corIcone = isBike ? "#10b981" : "#f97316"; 
      let fileToUse = isBike ? "bike.svg" : "scooter.svg";
      
      let iconToUse = createVehicleIcon(corIcone, fileToUse);

      let veiculoType = isBike ? "Bicicleta" : "Patinete";
      let bateriaRaw = info.battery_percent || 0;
      let bateriaFormatada = Math.round((bateriaRaw <= 1 && bateriaRaw > 0) ? (bateriaRaw * 100) : bateriaRaw);

      L.marker([b.lat, b.lng], { icon: iconToUse })
        .bindPopup(`<b>${veiculoType}:</b> ${info.identifier || 'N/A'}<br><b>Bateria:</b> ${bateriaFormatada}%`)
        .addTo(bikeLayer);
    });
  }

  // 2. DESENHANDO ESTACIONAMENTOS
  if (rawParkings) {
    const parkings = extrairPontos(rawParkings);
    parkings.forEach(p => {
      let cor = "#3b82f6";
      let tamanho = 20;
      let atual = p.info.bikes_count || 0;
      
      let capacidadeReal = p.info.target_bikes_count || p.info.capacity || p.info.expected_bikes_count || '?';
      let capacidadeCalculo = (capacidadeReal !== '?' && capacidadeReal > 0) ? capacidadeReal : 1;

      if (p.info.monitor === true) {
        tamanho = 26; 
        let proporcao = atual / capacidadeCalculo;
        if (proporcao >= 0.8) cor = "#22c55e";
        else if (proporcao >= 0.4) cor = "#eab308";
        else cor = "#ef4444";
      }

      L.marker([p.lat, p.lng], { icon: createParkingDivIcon(cor, tamanho) })
        .bindPopup(`
          <b>${p.info.name || 'Ponto de Estacionamento'}</b><br>
          <b>Veículos aqui:</b> ${atual} / ${capacidadeReal}<br>
          <b>Monitor:</b> ${p.info.monitor ? 'Sim' : 'Não'}
        `)
        .addTo(parkingLayer);
    });
  }
}

// --- CONTROLES ---
document.getElementById('toggleBikes').addEventListener('click', (e) => {
  showBikes = !showBikes;
  if (showBikes) { map.addLayer(bikeLayer); e.target.classList.remove('disabled'); e.target.innerText = "Veículos (ON)"; }
  else { map.removeLayer(bikeLayer); e.target.classList.add('disabled'); e.target.innerText = "Veículos (OFF)"; }
});

document.getElementById('toggleParking').addEventListener('click', (e) => {
  showParking = !showParking;
  if (showParking) { map.addLayer(parkingLayer); e.target.classList.remove('disabled'); e.target.innerText = "Estacionamentos (ON)"; }
  else { map.removeLayer(parkingLayer); e.target.classList.add('disabled'); e.target.innerText = "Estacionamentos (OFF)"; }
});

document.getElementById('refreshBtn').addEventListener('click', carregarMapa);

// Início
ativarGpsUsuario();
carregarMapa();
