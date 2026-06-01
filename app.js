// Configurações
const CITY_ID = "66faae66cd18349215c90187";
const BIKES_URL = `https://logistic.gojet.app/api/v0/urent/bikes/?city_id=${CITY_ID}&page=1&limit=1000`;
const PARKING_URL = `https://logistic.gojet.app/api/v0/urent/parkings/?city_id=${CITY_ID}&page=1&limit=1000`;

// Inicializa o mapa focado em Maceió
const map = L.map('map').setView([-9.6498, -35.7089], 13);

// Camada de fundo (mapa escuro)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Grupos para ligar/desligar
let bikeLayer = L.layerGroup().addTo(map);
let parkingLayer = L.layerGroup().addTo(map);
let userLocationLayer = L.layerGroup().addTo(map); // NOVA CAMADA: GPS do Usuário

let showBikes = true;
let showParking = true;

// --- DEFINIÇÃO DOS ÍCONES ---
const scooterIcon = L.icon({
  iconUrl: 'scooter_icon.png', 
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14] 
});

const bikeIcon = L.icon({
  iconUrl: 'bike_icon.png', 
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14]
});

// Ponto azul dinâmico para a sua localização atual
const userIcon = L.divIcon({
  className: 'user-location-icon',
  html: `<div style="background-color: #007aff; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px #007aff; animation: pulse 2s infinite;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

// Adiciona o efeito pulsante do seu ponto azul na tela
const style = document.createElement('style');
style.innerHTML = `@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(0, 122, 255, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0); } }`;
document.head.appendChild(style);

// Função para criar o ícone 'P' colorido (HTML)
function createParkingDivIcon(color, size = 20) {
  return L.divIcon({
    className: 'parking-div-icon', 
    html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid white; color: white; font-weight: bold; font-size: ${size*0.7}px;">P</div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -size/2]
  });
}

// --- FUNÇÃO DO GPS (LOCAL ATUAL) ---
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
      (error) => console.warn("Permissão de GPS negada ou indisponível."),
      { enableHighAccuracy: true }
    );
  }
}

// --- FUNÇÕES DE DADOS E DESENHO ---
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

  // 1. DESENHANDO VEÍCULOS 
  if (rawBikes) {
    const bikes = extrairPontos(rawBikes);
    bikes.forEach(b => {
      let isBike = b.info.type && b.info.type.toLowerCase().includes('bike');
      let iconToUse = isBike ? bikeIcon : scooterIcon; 
      let veiculoType = isBike ? "Bicicleta" : "Patinete";

      let bateriaRaw = b.info.battery_percent || 0;
      let bateriaFormatada = Math.round((bateriaRaw <= 1 && bateriaRaw > 0) ? (bateriaRaw * 100) : bateriaRaw);

      L.marker([b.lat, b.lng], { icon: iconToUse })
        .bindPopup(`<b>${veiculoType}:</b> ${b.info.identifier || 'N/A'}<br><b>Bateria:</b> ${bateriaFormatada}%`)
        .addTo(bikeLayer);
    });
  }

  // 2. DESENHANDO ESTACIONAMENTOS 
  if (rawParkings) {
    const parkings = extrairPontos(rawParkings);
    parkings.forEach(p => {
      let cor = "#3b82f6"; // Azul padrão
      let tamanho = 20;
      let atual = p.info.bikes_count || 0;
      
      let capacidadeReal = p.info.target_bikes_count || p.info.capacity || p.info.expected_bikes_count || '?';
      let capacidadeCalculo = (capacidadeReal !== '?' && capacidadeReal > 0) ? capacidadeReal : 1;

      if (p.info.monitor === true) {
        tamanho = 26; 
        let proporcao = atual / capacidadeCalculo;

        if (proporcao >= 0.8) cor = "#22c55e"; // Verde
        else if (proporcao >= 0.4) cor = "#eab308"; // Amarelo
        else cor = "#ef4444"; // Vermelho
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

// Inicia
ativarGpsUsuario();
carregarMapa();
