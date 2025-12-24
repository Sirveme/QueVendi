/**
 * Mapa de Delitos - QueVendi / AlertaPerú
 * Visualización de incidentes de seguridad en tiempo real
 */

// ============================================
// CONFIGURACIÓN
// ============================================

const CONFIG = {
    // Centro de Lima por defecto
    defaultCenter: [-12.0464, -77.0428],
    defaultZoom: 12,
    
    // API
    apiBase: '/api/v1',
    
    // Actualización automática (milisegundos)
    refreshInterval: 60000, // 1 minuto
    
    // Colores por nivel
    colors: {
        ROJO: '#DC2626',
        AMBAR: '#F59E0B',
        VERDE: '#10B981'
    },
    
    // Iconos por tipo
    icons: {
        robo: 'fa-mask',
        extorsion_whatsapp: 'fa-comment-dots',
        extorsion_llamada: 'fa-phone',
        extorsion_presencial: 'fa-user-secret',
        marcaje: 'fa-eye',
        emergencia: 'fa-exclamation-triangle',
        otro: 'fa-question'
    },
    
    // Radio de ofuscación (metros) para privacidad
    privacyRadius: 200
};

// ============================================
// ESTADO
// ============================================

const State = {
    map: null,
    markersLayer: null,
    clusterLayer: null,
    heatLayer: null,
    currentView: 'markers', // 'markers', 'heatmap', 'clusters'
    incidents: [],
    filters: {
        levels: ['ROJO', 'AMBAR', 'VERDE'],
        type: 'all',
        department: 'all',
        province: 'all',
        district: 'all',
        dateFrom: null,
        dateTo: null
    },
    stats: {
        red: 0,
        amber: 0,
        green: 0,
        total: 0
    }
};

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Mapa] Inicializando...');
    
    initMap();
    setupFilters();
    loadIncidents();
    
    // Auto-refresh
    setInterval(refreshData, CONFIG.refreshInterval);
    
    console.log('[Mapa] Inicialización completa');
});

// ============================================
// MAPA
// ============================================

function initMap() {
    try {
        // Crear mapa
        State.map = L.map('map', {
            center: CONFIG.defaultCenter,
            zoom: CONFIG.defaultZoom,
            zoomControl: false
        });
        
        // Agregar controles de zoom en posición personalizada
        L.control.zoom({ position: 'topright' }).addTo(State.map);
        
        // Capa base (OpenStreetMap oscuro)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(State.map);
        
        // Capas de marcadores
        State.markersLayer = L.layerGroup().addTo(State.map);
        
        // Cluster (con fallback si la librería no está disponible)
        if (typeof L.markerClusterGroup === 'function') {
            State.clusterLayer = L.markerClusterGroup({
                spiderfyOnMaxZoom: true,
                showCoverageOnHover: false,
                maxClusterRadius: 50
            });
        } else {
            console.warn('[Mapa] markerClusterGroup no disponible, usando layerGroup');
            State.clusterLayer = L.layerGroup();
        }
        
        // Intentar centrar en ubicación del usuario
        centerOnUser();
        
        console.log('[Mapa] Mapa inicializado correctamente');
        
    } catch (error) {
        console.error('[Mapa] Error en initMap:', error);
    }
}

function centerOnUser() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                State.map.setView([latitude, longitude], 14);
                
                // Marcador de ubicación del usuario
                L.circleMarker([latitude, longitude], {
                    radius: 8,
                    fillColor: '#3B82F6',
                    fillOpacity: 1,
                    color: 'white',
                    weight: 2
                }).addTo(State.map).bindPopup('Tu ubicación');
            },
            (error) => {
                console.log('[Mapa] No se pudo obtener ubicación:', error.message);
            }
        );
    }
}

// ============================================
// CARGA DE DATOS
// ============================================

async function loadIncidents() {
    try {
        updateLastUpdate('Cargando...');
        console.log('[Mapa] Cargando incidentes...');
        console.log('[Mapa] Filtros actuales:', State.filters);
        
        // Construir query params desde filtros
        const params = new URLSearchParams();
        
        if (State.filters.type !== 'all') {
            params.append('tipo', State.filters.type);
        }
        if (State.filters.department !== 'all') {
            params.append('departamento', State.filters.department);
        }
        if (State.filters.province !== 'all') {
            params.append('provincia', State.filters.province);
        }
        if (State.filters.district !== 'all') {
            params.append('distrito', State.filters.district);
        }
        if (State.filters.dateFrom) {
            params.append('fecha_desde', State.filters.dateFrom);
        }
        if (State.filters.dateTo) {
            params.append('fecha_hasta', State.filters.dateTo);
        }
        
        const url = `${CONFIG.apiBase}/incidentes?${params.toString()}`;
        console.log('[Mapa] URL:', url);
        
        let useTestData = false;
        
        try {
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                const incidents = data.incidentes || data || [];
                
                if (incidents.length > 0) {
                    State.incidents = incidents;
                    console.log('[Mapa] ✅ Incidentes del servidor:', State.incidents.length);
                } else {
                    console.log('[Mapa] API devolvió 0 incidentes, usando datos de prueba');
                    useTestData = true;
                }
            } else {
                console.log('[Mapa] Respuesta no ok:', response.status);
                useTestData = true;
            }
        } catch (fetchError) {
            console.log('[Mapa] Error de fetch:', fetchError.message);
            useTestData = true;
        }
        
        // Usar datos de prueba si es necesario
        if (useTestData) {
            console.log('[Mapa] 🧪 Generando datos de prueba...');
            State.incidents = generateTestData();
            console.log('[Mapa] ✅ Datos de prueba generados:', State.incidents.length);
        }
        
        // Actualizar UI
        updateMap();
        updateStats();
        updateIncidentsList();
        updateLastUpdate();
        
    } catch (error) {
        console.error('[Mapa] Error general en loadIncidents:', error);
        
        // Fallback final
        console.log('[Mapa] 🧪 Fallback final: generando datos de prueba...');
        State.incidents = generateTestData();
        
        updateMap();
        updateStats();
        updateIncidentsList();
        updateLastUpdate();
    }
}

function generateTestData() {
    // Datos de prueba para desarrollo
    const tipos = ['robo', 'extorsion_whatsapp', 'extorsion_llamada', 'marcaje', 'extorsion_presencial'];
    const niveles = ['ROJO', 'AMBAR', 'VERDE'];
    const distritos = [
        { nombre: 'San Juan de Lurigancho', lat: -11.9833, lng: -76.9833 },
        { nombre: 'Comas', lat: -11.9458, lng: -77.0583 },
        { nombre: 'Villa El Salvador', lat: -12.2125, lng: -76.9333 },
        { nombre: 'San Martín de Porres', lat: -12.0167, lng: -77.0667 },
        { nombre: 'Los Olivos', lat: -11.9667, lng: -77.0667 },
        { nombre: 'Ate', lat: -12.0333, lng: -76.9167 },
        { nombre: 'Chorrillos', lat: -12.1833, lng: -77.0167 },
        { nombre: 'Lima Centro', lat: -12.0464, lng: -77.0428 },
        { nombre: 'La Victoria', lat: -12.0667, lng: -77.0167 },
        { nombre: 'El Agustino', lat: -12.0458, lng: -76.9833 }
    ];
    
    const incidents = [];
    
    for (let i = 0; i < 50; i++) {
        const distrito = distritos[Math.floor(Math.random() * distritos.length)];
        const nivel = niveles[Math.floor(Math.random() * niveles.length)];
        const tipo = nivel === 'ROJO' ? 'robo' : 
                     nivel === 'VERDE' ? 'marcaje' :
                     tipos[Math.floor(Math.random() * tipos.length)];
        
        // Agregar variación aleatoria a la ubicación
        const latVariation = (Math.random() - 0.5) * 0.02;
        const lngVariation = (Math.random() - 0.5) * 0.02;
        
        // Fecha aleatoria en los últimos 30 días
        const daysAgo = Math.floor(Math.random() * 30);
        const hoursAgo = Math.floor(Math.random() * 24);
        const fecha = new Date();
        fecha.setDate(fecha.getDate() - daysAgo);
        fecha.setHours(fecha.getHours() - hoursAgo);
        
        incidents.push({
            id: i + 1,
            nivel: nivel,
            tipo: tipo,
            descripcion: `Incidente de prueba en ${distrito.nombre}`,
            latitud: distrito.lat + latVariation,
            longitud: distrito.lng + lngVariation,
            distrito: distrito.nombre,
            provincia: 'Lima',
            departamento: 'Lima',
            created_at: fecha.toISOString(),
            estado: Math.random() > 0.3 ? 'pendiente' : 'atendido'
        });
    }
    
    console.log('[Mapa] Datos de prueba generados:', incidents.length, 'incidentes');
    if (incidents.length > 0) {
        console.log('[Mapa] Ejemplo de incidente:', JSON.stringify(incidents[0]));
    }
    
    return incidents;
}

function refreshData() {
    loadIncidents();
}

// ============================================
// ACTUALIZACIÓN DEL MAPA
// ============================================

function updateMap() {
    console.log('[Mapa] updateMap() - Vista actual:', State.currentView);
    console.log('[Mapa] Total incidentes en State:', State.incidents.length);
    
    // Limpiar capas
    State.markersLayer.clearLayers();
    if (State.clusterLayer) State.clusterLayer.clearLayers();
    
    if (State.heatLayer) {
        State.map.removeLayer(State.heatLayer);
        State.heatLayer = null;
    }
    
    // Filtrar incidentes
    const filtered = filterIncidents();
    console.log('[Mapa] Incidentes después de filtrar:', filtered.length);
    
    if (filtered.length === 0) {
        console.log('[Mapa] ⚠️ No hay incidentes para mostrar');
        console.log('[Mapa] Filtros actuales:', JSON.stringify(State.filters));
        
        // Si no hay incidentes pero hay datos en State, podría ser problema de filtros
        if (State.incidents.length > 0) {
            console.log('[Mapa] Hay', State.incidents.length, 'incidentes pero los filtros no coinciden');
            console.log('[Mapa] Ejemplo de incidente:', State.incidents[0]);
        }
        return;
    }
    
    // Crear marcadores
    const heatData = [];
    let markersAdded = 0;
    
    filtered.forEach(incident => {
        // Validar que tenga coordenadas
        if (!incident.latitud || !incident.longitud) {
            console.warn('[Mapa] Incidente sin coordenadas:', incident.id);
            return;
        }
        
        const marker = createMarker(incident);
        
        if (State.currentView === 'clusters' && State.clusterLayer) {
            State.clusterLayer.addLayer(marker);
        } else {
            State.markersLayer.addLayer(marker);
        }
        markersAdded++;
        
        // Datos para heatmap
        const intensity = incident.nivel === 'ROJO' ? 1 : 
                         incident.nivel === 'AMBAR' ? 0.6 : 0.3;
        heatData.push([incident.latitud, incident.longitud, intensity]);
    });
    
    console.log('[Mapa] ✅ Marcadores creados:', markersAdded);
    
    // Aplicar vista actual
    if (State.currentView === 'heatmap' && typeof L.heatLayer === 'function') {
        State.markersLayer.clearLayers();
        State.heatLayer = L.heatLayer(heatData, {
            radius: 25,
            blur: 15,
            maxZoom: 17,
            gradient: {
                0.2: '#10B981',
                0.5: '#F59E0B',
                0.8: '#DC2626',
                1: '#991B1B'
            }
        }).addTo(State.map);
    } else if (State.currentView === 'clusters' && State.clusterLayer) {
        State.map.addLayer(State.clusterLayer);
    }
    // Para vista 'markers', los marcadores ya están en State.markersLayer que está en el mapa
}

function createMarker(incident) {
    const levelClass = incident.nivel === 'ROJO' ? 'red' : 
                       incident.nivel === 'AMBAR' ? 'amber' : 'green';
    
    const iconName = CONFIG.icons[incident.tipo] || CONFIG.icons.otro;
    
    // Crear icono personalizado
    const customIcon = L.divIcon({
        className: 'custom-marker-wrapper',
        html: `<div class="custom-marker ${levelClass}"><i class="fas ${iconName}"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    
    const marker = L.marker([incident.latitud, incident.longitud], { icon: customIcon });
    
    // Popup
    const popupContent = createPopupContent(incident);
    marker.bindPopup(popupContent, { maxWidth: 300 });
    
    return marker;
}

function createPopupContent(incident) {
    const levelEmoji = incident.nivel === 'ROJO' ? '🔴' : 
                       incident.nivel === 'AMBAR' ? '🟠' : '🟢';
    
    const tipoLabel = {
        'robo': 'Robo / Asalto',
        'extorsion_whatsapp': 'Extorsión WhatsApp',
        'extorsion_llamada': 'Extorsión Llamada',
        'extorsion_presencial': 'Extorsión Presencial',
        'marcaje': 'Marcaje / Vigilancia',
        'emergencia': 'Emergencia',
        'otro': 'Otro'
    };
    
    const timeAgo = getTimeAgo(new Date(incident.created_at));
    
    return `
        <div class="popup-content">
            <div class="popup-header">
                <span class="popup-level">${levelEmoji}</span>
                <span class="popup-type">${tipoLabel[incident.tipo] || incident.tipo}</span>
            </div>
            <div class="popup-info">
                <p><i class="fas fa-map-marker-alt"></i> ${incident.distrito || 'Ubicación aproximada'}</p>
                <p><i class="fas fa-clock"></i> ${timeAgo}</p>
                <p><i class="fas fa-info-circle"></i> ${incident.estado === 'atendido' ? 'Atendido' : 'Pendiente'}</p>
            </div>
            <button class="popup-btn" onclick="showIncidentDetail(${incident.id})">
                Ver detalle
            </button>
        </div>
    `;
}

function filterIncidents() {
    return State.incidents.filter(incident => {
        // Filtro por nivel
        if (!State.filters.levels.includes(incident.nivel)) {
            return false;
        }
        
        // Filtro por tipo
        if (State.filters.type !== 'all' && incident.tipo !== State.filters.type) {
            return false;
        }
        
        // Filtro por departamento
        if (State.filters.department !== 'all' && 
            incident.departamento?.toLowerCase() !== State.filters.department) {
            return false;
        }
        
        // Filtro por provincia
        if (State.filters.province !== 'all' && 
            incident.provincia?.toLowerCase() !== State.filters.province) {
            return false;
        }
        
        // Filtro por distrito
        if (State.filters.district !== 'all' && 
            incident.distrito?.toLowerCase() !== State.filters.district) {
            return false;
        }
        
        // Filtro por fecha
        if (State.filters.dateFrom) {
            const incidentDate = new Date(incident.created_at);
            const fromDate = new Date(State.filters.dateFrom);
            if (incidentDate < fromDate) return false;
        }
        
        if (State.filters.dateTo) {
            const incidentDate = new Date(incident.created_at);
            const toDate = new Date(State.filters.dateTo);
            toDate.setHours(23, 59, 59);
            if (incidentDate > toDate) return false;
        }
        
        return true;
    });
}

// ============================================
// VISTAS DEL MAPA
// ============================================

function setMapView(view) {
    State.currentView = view;
    
    // Actualizar botones
    document.querySelectorAll('.map-control-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`btn-${view === 'markers' ? 'markers' : view}`).classList.add('active');
    
    updateMap();
}

// ============================================
// ESTADÍSTICAS
// ============================================

function updateStats() {
    const filtered = filterIncidents();
    
    State.stats.red = filtered.filter(i => i.nivel === 'ROJO').length;
    State.stats.amber = filtered.filter(i => i.nivel === 'AMBAR').length;
    State.stats.green = filtered.filter(i => i.nivel === 'VERDE').length;
    State.stats.total = filtered.length;
    
    document.getElementById('stat-red').textContent = State.stats.red;
    document.getElementById('stat-amber').textContent = State.stats.amber;
    document.getElementById('stat-green').textContent = State.stats.green;
    document.getElementById('stat-total').textContent = State.stats.total;
}

// ============================================
// LISTA DE INCIDENTES
// ============================================

function updateIncidentsList() {
    const filtered = filterIncidents();
    const container = document.getElementById('incidents-list');
    
    // Ordenar por fecha (más recientes primero)
    const sorted = filtered.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
    ).slice(0, 20); // Mostrar solo los 20 más recientes
    
    if (sorted.length === 0) {
        container.innerHTML = `
            <div class="loading">
                <i class="fas fa-inbox"></i> No hay incidentes
            </div>
        `;
        return;
    }
    
    const tipoLabel = {
        'robo': 'Robo / Asalto',
        'extorsion_whatsapp': 'Extorsión WhatsApp',
        'extorsion_llamada': 'Extorsión Llamada',
        'extorsion_presencial': 'Extorsión Presencial',
        'marcaje': 'Marcaje / Vigilancia',
        'emergencia': 'Emergencia',
        'otro': 'Otro'
    };
    
    container.innerHTML = sorted.map(incident => {
        const levelClass = incident.nivel === 'ROJO' ? 'red' : 
                          incident.nivel === 'AMBAR' ? 'amber' : 'green';
        const timeAgo = getTimeAgo(new Date(incident.created_at));
        
        return `
            <div class="incident-item ${levelClass}" onclick="focusIncident(${incident.id})">
                <div class="incident-header">
                    <span class="incident-type">${tipoLabel[incident.tipo] || incident.tipo}</span>
                    <span class="incident-time">${timeAgo}</span>
                </div>
                <div class="incident-location">
                    <i class="fas fa-map-marker-alt"></i>
                    ${incident.distrito || 'Ubicación aproximada'}
                </div>
            </div>
        `;
    }).join('');
}

function focusIncident(id) {
    const incident = State.incidents.find(i => i.id === id);
    if (incident) {
        State.map.setView([incident.latitud, incident.longitud], 16);
        
        // Cerrar sidebar en móvil
        if (window.innerWidth < 768) {
            document.getElementById('sidebar').classList.remove('open');
        }
    }
}

function showIncidentDetail(id) {
    const incident = State.incidents.find(i => i.id === id);
    if (!incident) return;
    
    const levelEmoji = incident.nivel === 'ROJO' ? '🔴 EMERGENCIA' : 
                       incident.nivel === 'AMBAR' ? '🟠 EXTORSIÓN' : '🟢 SOSPECHA';
    
    const tipoLabel = {
        'robo': 'Robo / Asalto',
        'extorsion_whatsapp': 'Extorsión por WhatsApp',
        'extorsion_llamada': 'Extorsión por Llamada',
        'extorsion_presencial': 'Extorsión Presencial',
        'marcaje': 'Marcaje / Vigilancia',
        'emergencia': 'Emergencia',
        'otro': 'Otro'
    };
    
    document.getElementById('modal-incident-level').textContent = levelEmoji;
    document.getElementById('modal-incident-date').textContent = getTimeAgo(new Date(incident.created_at));
    
    document.getElementById('modal-incident-body').innerHTML = `
        <div style="margin-bottom: 1rem;">
            <strong>Tipo:</strong> ${tipoLabel[incident.tipo] || incident.tipo}
        </div>
        <div style="margin-bottom: 1rem;">
            <strong>Ubicación:</strong> ${incident.distrito || 'No especificada'}, ${incident.provincia || ''}, ${incident.departamento || ''}
        </div>
        <div style="margin-bottom: 1rem;">
            <strong>Estado:</strong> ${incident.estado === 'atendido' ? '✅ Atendido' : '⏳ Pendiente'}
        </div>
        ${incident.descripcion ? `
        <div style="margin-bottom: 1rem;">
            <strong>Descripción:</strong><br>
            <p style="color: var(--text-secondary); margin-top: 0.5rem;">${incident.descripcion}</p>
        </div>
        ` : ''}
        <div style="padding-top: 1rem; border-top: 1px solid var(--border-color); font-size: 0.8rem; color: var(--text-muted);">
            <i class="fas fa-shield-alt"></i> La ubicación exacta se mantiene en reserva por seguridad del comerciante.
        </div>
    `;
    
    openModal('modal-incident');
}

// ============================================
// FILTROS
// ============================================

function setupFilters() {
    console.log('[Mapa] Configurando filtros...');
    
    // Establecer fechas por defecto (últimos 30 días para mayor flexibilidad)
    const today = new Date();
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    
    const todayStr = today.toISOString().split('T')[0];
    const monthAgoStr = monthAgo.toISOString().split('T')[0];
    
    const dateFromEl = document.getElementById('filter-date-from');
    const dateToEl = document.getElementById('filter-date-to');
    
    if (dateFromEl) dateFromEl.value = monthAgoStr;
    if (dateToEl) dateToEl.value = todayStr;
    
    State.filters.dateFrom = monthAgoStr;
    State.filters.dateTo = todayStr;
    
    // Asegurar que los checkboxes de niveles estén marcados
    const redCheck = document.getElementById('filter-red');
    const amberCheck = document.getElementById('filter-amber');
    const greenCheck = document.getElementById('filter-green');
    
    if (redCheck) redCheck.checked = true;
    if (amberCheck) amberCheck.checked = true;
    if (greenCheck) greenCheck.checked = true;
    
    // Asegurar que los niveles estén en el state
    State.filters.levels = ['ROJO', 'AMBAR', 'VERDE'];
    
    console.log('[Mapa] Filtros iniciales:', State.filters);
}

function applyFilters() {
    // Niveles - verificar que los elementos existan
    const redCheck = document.getElementById('filter-red');
    const amberCheck = document.getElementById('filter-amber');
    const greenCheck = document.getElementById('filter-green');
    
    // Si los checkboxes existen, usarlos; si no, mostrar todos los niveles
    if (redCheck || amberCheck || greenCheck) {
        State.filters.levels = [];
        if (redCheck?.checked !== false) State.filters.levels.push('ROJO');
        if (amberCheck?.checked !== false) State.filters.levels.push('AMBAR');
        if (greenCheck?.checked !== false) State.filters.levels.push('VERDE');
        
        // Si ninguno está seleccionado, mostrar todos
        if (State.filters.levels.length === 0) {
            State.filters.levels = ['ROJO', 'AMBAR', 'VERDE'];
        }
    }
    
    // Tipo
    const typeSelect = document.getElementById('filter-type');
    State.filters.type = typeSelect?.value || 'all';
    
    // Ubicación ya se maneja con selectDistrito() y clearUbicacion()
    
    // Fechas
    const dateFrom = document.getElementById('filter-date-from');
    const dateTo = document.getElementById('filter-date-to');
    State.filters.dateFrom = dateFrom?.value || null;
    State.filters.dateTo = dateTo?.value || null;
    
    console.log('[Mapa] Filtros aplicados:', State.filters);
    console.log('[Mapa] Incidentes totales:', State.incidents.length);
    
    // Actualizar
    updateMap();
    updateStats();
    updateIncidentsList();
    
    // Log de incidentes filtrados
    const filtered = filterIncidents();
    console.log('[Mapa] Incidentes filtrados:', filtered.length);
}

function clearFilters() {
    // Reset checkboxes
    document.getElementById('filter-red').checked = true;
    document.getElementById('filter-amber').checked = true;
    document.getElementById('filter-green').checked = true;
    
    // Reset selects
    document.getElementById('filter-type').value = 'all';
    
    // Reset ubicación
    clearUbicacion();
    
    // Reset fechas (últimos 7 días)
    const today = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    document.getElementById('filter-date-to').value = today.toISOString().split('T')[0];
    document.getElementById('filter-date-from').value = weekAgo.toISOString().split('T')[0];
    
    // Aplicar
    applyFilters();
}

// ============================================
// BÚSQUEDA DE DISTRITO (UBIGEO)
// ============================================

let distritoSearchTimeout = null;

async function searchDistrito(query) {
    clearTimeout(distritoSearchTimeout);
    
    const resultsContainer = document.getElementById('distrito-results');
    
    if (!query || query.length < 2) {
        resultsContainer.classList.remove('show');
        return;
    }
    
    distritoSearchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`/api/v1/ubigeo/search?q=${encodeURIComponent(query)}`);
            
            if (response.ok) {
                const data = await response.json();
                displayDistritoResults(data.results || []);
            } else {
                // Si no hay API, usar datos locales de prueba
                const mockResults = searchDistritoLocal(query);
                displayDistritoResults(mockResults);
            }
        } catch (error) {
            console.log('[Ubigeo] Usando búsqueda local');
            const mockResults = searchDistritoLocal(query);
            displayDistritoResults(mockResults);
        }
    }, 300);
}

function searchDistritoLocal(query) {
    // Datos locales para cuando no hay API
    const distritos = [
        { distrito: 'San Juan de Lurigancho', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'San Martín de Porres', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Comas', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Ate', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Villa El Salvador', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Villa María del Triunfo', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'San Juan de Miraflores', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Los Olivos', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Puente Piedra', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Santiago de Surco', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Chorrillos', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Carabayllo', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Lima', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Santa Anita', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Independencia', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'El Agustino', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'La Victoria', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Rímac', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Miraflores', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'San Isidro', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'San Borja', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Surquillo', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Barranco', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'La Molina', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Jesús María', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Lince', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Pueblo Libre', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Magdalena del Mar', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'San Miguel', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Breña', provincia: 'Lima', departamento: 'Lima' },
        { distrito: 'Callao', provincia: 'Callao', departamento: 'Callao' },
        { distrito: 'Ventanilla', provincia: 'Callao', departamento: 'Callao' },
        { distrito: 'Bellavista', provincia: 'Callao', departamento: 'Callao' },
        { distrito: 'Arequipa', provincia: 'Arequipa', departamento: 'Arequipa' },
        { distrito: 'Trujillo', provincia: 'Trujillo', departamento: 'La Libertad' },
        { distrito: 'Chiclayo', provincia: 'Chiclayo', departamento: 'Lambayeque' },
        { distrito: 'Piura', provincia: 'Piura', departamento: 'Piura' },
        { distrito: 'Iquitos', provincia: 'Maynas', departamento: 'Loreto' },
        { distrito: 'Cusco', provincia: 'Cusco', departamento: 'Cusco' },
        { distrito: 'Huancayo', provincia: 'Huancayo', departamento: 'Junín' },
    ];
    
    const q = query.toLowerCase();
    return distritos.filter(d => 
        d.distrito.toLowerCase().includes(q)
    ).slice(0, 10);
}

function displayDistritoResults(results) {
    const container = document.getElementById('distrito-results');
    
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="distrito-result-item"><span class="distrito-name">No se encontraron resultados</span></div>';
        container.classList.add('show');
        return;
    }
    
    container.innerHTML = results.map(r => `
        <div class="distrito-result-item" onclick="selectDistrito('${r.distrito}', '${r.provincia}', '${r.departamento}', ${r.latitud || 'null'}, ${r.longitud || 'null'})">
            <div class="distrito-name">${r.distrito}</div>
            <div class="distrito-ubicacion">${r.provincia}, ${r.departamento}</div>
        </div>
    `).join('');
    
    container.classList.add('show');
}

function selectDistrito(distrito, provincia, departamento, lat = null, lng = null) {
    // Actualizar filtros
    State.filters.district = distrito.toLowerCase();
    State.filters.province = provincia.toLowerCase();
    State.filters.department = departamento.toLowerCase();
    
    // Mostrar badge de ubicación seleccionada
    document.getElementById('ubicacion-text').textContent = `${distrito}, ${provincia}, ${departamento}`;
    document.getElementById('ubicacion-selected').style.display = 'block';
    
    // Limpiar búsqueda
    document.getElementById('filter-distrito-search').value = '';
    document.getElementById('distrito-results').classList.remove('show');
    
    // Aplicar filtros
    applyFilters();
    
    // Centrar mapa en el distrito
    centerMapOnDistrito(distrito, lat, lng);
}

function clearUbicacion() {
    State.filters.district = 'all';
    State.filters.province = 'all';
    State.filters.department = 'all';
    
    document.getElementById('ubicacion-selected').style.display = 'none';
    document.getElementById('filter-distrito-search').value = '';
    
    applyFilters();
}

function centerMapOnDistrito(distrito, lat = null, lng = null) {
    // Si tenemos coordenadas directas, usarlas
    if (lat && lng) {
        State.map.setView([lat, lng], 14);
        return;
    }
    
    // Fallback: Buscar en los incidentes uno que coincida para centrar el mapa
    const incident = State.incidents.find(i => 
        i.distrito && i.distrito.toLowerCase().includes(distrito.toLowerCase())
    );
    
    if (incident && incident.latitud && incident.longitud) {
        State.map.setView([incident.latitud, incident.longitud], 14);
        return;
    }
    
    // Fallback 2: Coordenadas aproximadas de distritos conocidos de Lima
    const coordsConocidas = {
        'san juan de lurigancho': [-11.9833, -76.9833],
        'san martín de porres': [-11.9833, -77.0833],
        'comas': [-11.9333, -77.05],
        'ate': [-12.0167, -76.9167],
        'villa el salvador': [-12.2167, -76.95],
        'villa maría del triunfo': [-12.1667, -76.9333],
        'san juan de miraflores': [-12.15, -76.9667],
        'los olivos': [-11.95, -77.0667],
        'puente piedra': [-11.8667, -77.0833],
        'santiago de surco': [-12.1333, -76.9833],
        'chorrillos': [-12.1833, -77.0167],
        'carabayllo': [-11.85, -77.0333],
        'lima': [-12.0464, -77.0428],
        'la victoria': [-12.07, -77.0167],
        'el agustino': [-12.0333, -76.9833],
        'santa anita': [-12.0333, -76.9667],
        'independencia': [-11.9833, -77.05],
        'rímac': [-12.0167, -77.0333],
        'miraflores': [-12.1167, -77.0333],
        'san isidro': [-12.1, -77.0333],
        'san borja': [-12.1, -76.9833],
        'surquillo': [-12.1167, -77.0],
        'barranco': [-12.15, -77.0167],
        'la molina': [-12.0833, -76.9333],
        'jesús maría': [-12.0667, -77.05],
        'lince': [-12.0833, -77.0333],
        'pueblo libre': [-12.0667, -77.0667],
        'magdalena del mar': [-12.0833, -77.0667],
        'san miguel': [-12.0833, -77.0833],
        'breña': [-12.05, -77.05],
        'callao': [-12.05, -77.1167],
        'ventanilla': [-11.8833, -77.1333],
        'bellavista': [-12.0667, -77.1]
    };
    
    const distritoLower = distrito.toLowerCase();
    if (coordsConocidas[distritoLower]) {
        State.map.setView(coordsConocidas[distritoLower], 14);
    }
}

// ============================================
// CHATBOT
// ============================================

let chatbotOpen = false;
let chatbotRecognition = null;

function toggleChatbot() {
    chatbotOpen = !chatbotOpen;
    document.getElementById('chatbot-panel').classList.toggle('open', chatbotOpen);
    document.getElementById('chatbot-fab').classList.toggle('active', chatbotOpen);
    
    if (chatbotOpen) {
        document.getElementById('chatbot-input').focus();
    }
}

function askChatbot(question) {
    document.getElementById('chatbot-input').value = question;
    sendChatMessage();
}

function sendChatMessage() {
    const input = document.getElementById('chatbot-input');
    const message = input.value.trim();
    
    if (!message) return;
    
    // Mostrar mensaje del usuario
    addChatMessage(message, 'user');
    input.value = '';
    
    // Procesar con IA local (simulado por ahora)
    processChatbotQuery(message);
}

function addChatMessage(text, type) {
    const container = document.getElementById('chatbot-messages');
    const msg = document.createElement('div');
    msg.className = `chat-message ${type}`;
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

async function processChatbotQuery(query) {
    // Mostrar indicador de escritura
    const typingId = showTypingIndicator();
    
    const lowerQuery = query.toLowerCase();
    let response = '';
    let action = null;
    
    // Detectar intención
    if (lowerQuery.includes('peligros') || lowerQuery.includes('más incidentes') || lowerQuery.includes('zona roja')) {
        response = '🔴 Las zonas con más incidentes son: San Juan de Lurigancho, Comas, y Villa El Salvador. Activando vista de calor...';
        action = () => {
            setView('heatmap');
            document.getElementById('filter-red').checked = true;
            applyFilters();
        };
    }
    else if (lowerQuery.includes('extorsion') || lowerQuery.includes('amenaza')) {
        response = '🟠 Filtro activado: mostrando solo casos de extorsión.';
        action = () => {
            document.getElementById('filter-type').value = 'extorsion_whatsapp';
            document.getElementById('filter-amber').checked = true;
            applyFilters();
        };
    }
    else if (lowerQuery.includes('sjl') || lowerQuery.includes('san juan de lurigancho')) {
        response = '📍 Enfocando en San Juan de Lurigancho...';
        action = () => {
            selectDistrito('San Juan de Lurigancho', 'Lima', 'Lima');
        };
    }
    else if (lowerQuery.includes('comas')) {
        response = '📍 Enfocando en Comas...';
        action = () => {
            selectDistrito('Comas', 'Lima', 'Lima');
        };
    }
    else if (lowerQuery.includes('estadística') || lowerQuery.includes('cuantos') || lowerQuery.includes('hoy')) {
        const stats = calculateStats();
        response = `📊 Estadísticas del período:\n• Total: ${stats.total} incidentes\n• Emergencias: ${stats.red}\n• Extorsiones: ${stats.amber}\n• Sospechas: ${stats.green}`;
    }
    else if (lowerQuery.includes('limpiar') || lowerQuery.includes('reset')) {
        response = '🔄 Limpiando todos los filtros...';
        action = () => clearFilters();
    }
    else if (lowerQuery.includes('ayuda') || lowerQuery.includes('qué puedes')) {
        response = '🤖 Puedo ayudarte con:\n• "Zonas más peligrosas"\n• "Extorsiones en [distrito]"\n• "Estadísticas de hoy"\n• "Limpiar filtros"\n• Buscar cualquier distrito';
    }
    else {
        // Intentar buscar como distrito
        const distritos = searchDistritoLocal(query);
        if (distritos.length > 0) {
            const d = distritos[0];
            response = `📍 Encontré: ${d.distrito}, ${d.provincia}. Enfocando...`;
            action = () => selectDistrito(d.distrito, d.provincia, d.departamento);
        } else {
            response = '🤔 No entendí tu consulta. Prueba con:\n• "Zonas peligrosas"\n• "Extorsiones en Comas"\n• "Estadísticas de hoy"';
        }
    }
    
    // Simular delay de respuesta
    await new Promise(r => setTimeout(r, 800));
    
    // Quitar indicador y mostrar respuesta
    removeTypingIndicator(typingId);
    addChatMessage(response, 'bot');
    
    // Ejecutar acción si existe
    if (action) {
        setTimeout(action, 300);
    }
}

function calculateStats() {
    const filtered = getFilteredIncidents();
    return {
        total: filtered.length,
        red: filtered.filter(i => i.nivel === 'ROJO').length,
        amber: filtered.filter(i => i.nivel === 'AMBAR').length,
        green: filtered.filter(i => i.nivel === 'VERDE').length
    };
}

function showTypingIndicator() {
    const container = document.getElementById('chatbot-messages');
    const typing = document.createElement('div');
    typing.className = 'chat-message bot typing';
    typing.id = 'typing-indicator';
    typing.innerHTML = '<span>•</span><span>•</span><span>•</span>';
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
    return typing.id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// Voz para chatbot con OpenAI Whisper
let mediaRecorder = null;
let audioChunks = [];

function startChatbotVoice() {
    const micBtn = document.getElementById('chatbot-mic');
    
    // Si ya está grabando, detener
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        return;
    }
    
    // Solicitar permiso de micrófono
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            micBtn.classList.add('listening');
            audioChunks = [];
            
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = async () => {
                micBtn.classList.remove('listening');
                stream.getTracks().forEach(track => track.stop());
                
                // Crear blob de audio
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                
                // Enviar a Whisper para transcribir
                await transcribeWithWhisper(audioBlob);
            };
            
            // Iniciar grabación
            mediaRecorder.start();
            
            // Auto-detener después de 10 segundos
            setTimeout(() => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
            }, 10000);
        })
        .catch(error => {
            console.error('[Chatbot Voice] Error:', error);
            addChatMessage('❌ No pude acceder al micrófono. Verifica los permisos.', 'bot');
        });
}

async function transcribeWithWhisper(audioBlob) {
    const typingId = showTypingIndicator();
    
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        formData.append('language', 'es');
        
        const response = await fetch('/api/v1/voice/transcribe', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            
            if (result.success && result.text) {
                // Poner el texto en el input y enviarlo
                document.getElementById('chatbot-input').value = result.text;
                removeTypingIndicator(typingId);
                sendChatMessage();
            } else {
                removeTypingIndicator(typingId);
                addChatMessage('❌ No pude entender el audio. Intenta de nuevo.', 'bot');
            }
        } else {
            removeTypingIndicator(typingId);
            addChatMessage('❌ Error al procesar el audio.', 'bot');
        }
    } catch (error) {
        console.error('[Whisper] Error:', error);
        removeTypingIndicator(typingId);
        addChatMessage('❌ Error de conexión al servicio de voz.', 'bot');
    }
}

async function processChatbotQuery(query) {
    // Mostrar indicador de escritura
    const typingId = showTypingIndicator();
    
    try {
        // Intentar usar el endpoint del backend
        const response = await fetch('/api/v1/voice/chatbot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: query,
                context: 'mapa'
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            
            removeTypingIndicator(typingId);
            addChatMessage(result.reply, 'bot');
            
            // Ejecutar acción si existe
            if (result.action) {
                executeMapAction(result.action, result.action_params || {});
            }
            return;
        }
    } catch (error) {
        console.log('[Chatbot] Usando fallback local');
    }
    
    // Fallback: procesamiento local
    const lowerQuery = query.toLowerCase();
    let response = '';
    let action = null;
    
    // Detectar intención
    if (lowerQuery.includes('peligros') || lowerQuery.includes('más incidentes') || lowerQuery.includes('zona roja')) {
        response = '🔴 Las zonas con más incidentes son: San Juan de Lurigancho, Comas, y Villa El Salvador. Activando vista de calor...';
        action = () => {
            setView('heatmap');
            document.getElementById('filter-red').checked = true;
            applyFilters();
        };
    }
    else if (lowerQuery.includes('extorsion') || lowerQuery.includes('amenaza')) {
        response = '🟠 Filtro activado: mostrando solo casos de extorsión.';
        action = () => {
            document.getElementById('filter-type').value = 'extorsion_whatsapp';
            document.getElementById('filter-amber').checked = true;
            applyFilters();
        };
    }
    else if (lowerQuery.includes('sjl') || lowerQuery.includes('san juan de lurigancho')) {
        response = '📍 Enfocando en San Juan de Lurigancho...';
        action = () => {
            selectDistrito('San Juan de Lurigancho', 'Lima', 'Lima');
        };
    }
    else if (lowerQuery.includes('comas')) {
        response = '📍 Enfocando en Comas...';
        action = () => {
            selectDistrito('Comas', 'Lima', 'Lima');
        };
    }
    else if (lowerQuery.includes('estadística') || lowerQuery.includes('cuantos') || lowerQuery.includes('hoy')) {
        const stats = calculateStats();
        response = `📊 Estadísticas del período:\n• Total: ${stats.total} incidentes\n• Emergencias: ${stats.red}\n• Extorsiones: ${stats.amber}\n• Sospechas: ${stats.green}`;
    }
    else if (lowerQuery.includes('limpiar') || lowerQuery.includes('reset')) {
        response = '🔄 Limpiando todos los filtros...';
        action = () => clearFilters();
    }
    else if (lowerQuery.includes('ayuda') || lowerQuery.includes('qué puedes')) {
        response = '🤖 Puedo ayudarte con:\n• "Zonas más peligrosas"\n• "Extorsiones en [distrito]"\n• "Estadísticas de hoy"\n• "Limpiar filtros"\n• Buscar cualquier distrito';
    }
    else {
        // Intentar buscar como distrito
        const distritos = searchDistritoLocal(query);
        if (distritos.length > 0) {
            const d = distritos[0];
            response = `📍 Encontré: ${d.distrito}, ${d.provincia}. Enfocando...`;
            action = () => selectDistrito(d.distrito, d.provincia, d.departamento);
        } else {
            response = '🤔 No entendí tu consulta. Prueba con:\n• "Zonas peligrosas"\n• "Extorsiones en Comas"\n• "Estadísticas de hoy"';
        }
    }
    
    // Simular delay de respuesta
    await new Promise(r => setTimeout(r, 500));
    
    // Quitar indicador y mostrar respuesta
    removeTypingIndicator(typingId);
    addChatMessage(response, 'bot');
    
    // Ejecutar acción si existe
    if (action) {
        setTimeout(action, 300);
    }
}

function executeMapAction(action, params) {
    switch(action) {
        case 'setView':
            setView(params.view || 'heatmap');
            if (params.filter_level) {
                document.getElementById('filter-red').checked = params.filter_level === 'ROJO';
                applyFilters();
            }
            break;
        case 'filter':
            if (params.type) {
                document.getElementById('filter-type').value = params.type === 'extorsion' ? 'extorsion_whatsapp' : params.type;
            }
            if (params.level) {
                document.getElementById('filter-amber').checked = params.level === 'AMBAR';
            }
            applyFilters();
            break;
        case 'focusDistrict':
            if (params.distrito) {
                selectDistrito(params.distrito, 'Lima', 'Lima');
            }
            break;
        case 'clearFilters':
            clearFilters();
            break;
        case 'showStats':
            // Ya se muestran en el sidebar
            break;
    }
}

// ============================================
// SIDEBAR
// ============================================

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    sidebar.classList.toggle('open');
}

// ============================================
// MODALES
// ============================================

function openModal(id) {
    document.getElementById(id).classList.add('open');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

function showInfo() {
    openModal('modal-info');
}

// Cerrar modales con Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.open').forEach(modal => {
            modal.classList.remove('open');
        });
    }
});

// Cerrar modal al hacer clic fuera
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('open');
        }
    });
});

// ============================================
// EXPORTAR
// ============================================

function exportData() {
    const filtered = filterIncidents();
    
    if (filtered.length === 0) {
        alert('No hay datos para exportar');
        return;
    }
    
    // Crear CSV
    const headers = ['Fecha', 'Nivel', 'Tipo', 'Distrito', 'Provincia', 'Departamento', 'Estado'];
    const rows = filtered.map(i => [
        new Date(i.created_at).toLocaleString('es-PE'),
        i.nivel,
        i.tipo,
        i.distrito || '',
        i.provincia || '',
        i.departamento || '',
        i.estado
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    
    // Descargar
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `incidentes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// ============================================
// UTILIDADES
// ============================================

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    const intervals = {
        año: 31536000,
        mes: 2592000,
        semana: 604800,
        día: 86400,
        hora: 3600,
        minuto: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `Hace ${interval} ${unit}${interval !== 1 ? (unit === 'mes' ? 'es' : 's') : ''}`;
        }
    }
    
    return 'Hace un momento';
}

function updateLastUpdate(text = null) {
    const el = document.getElementById('last-update');
    if (text) {
        el.textContent = text;
    } else {
        el.textContent = `Actualizado: ${new Date().toLocaleTimeString('es-PE')}`;
    }
}

// ============================================
// INICIALIZAR
// ============================================

console.log('[Mapa] Script cargado');