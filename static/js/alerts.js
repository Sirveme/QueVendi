/**
 * Sistema de Alertas Inteligentes
 * - Pedidos sin terminar
 * - Ventas lentas
 * - Productos agotados
 * - Tiempo excesivo
 */

const ALERT_CONFIG = {
    CHECK_INTERVAL: 300000, // 5 minutos
    IDLE_WARNING: 180000, // 3 minutos
    SLOW_SALES_THRESHOLD: 5,
    SLOW_SALES_HOURS: 2
};

let alertTimer = null;
let lastSaleTime = Date.now();

async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('access_token');
    if (!token) {
        console.warn('[Alerts] No hay token');
        return null;
    }
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    return await fetch(url, { ...options, headers });
}

/**
 * INICIALIZACIÓN
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Alerts] Inicializando sistema de alertas...');
    startAlertSystem();
});

function startAlertSystem() {
    // Verificar alertas cada 5 minutos
    alertTimer = setInterval(checkAllAlerts, ALERT_CONFIG.CHECK_INTERVAL);
    
    // Primera verificación después de 1 minuto
    setTimeout(checkAllAlerts, 60000);
    
    console.log('[Alerts] ✅ Sistema activo');
}

/**
 * VERIFICACIÓN DE ALERTAS
 */
async function checkAllAlerts() {
    console.log('[Alerts] 🔍 Verificando alertas...');
    
    try {
        const response = await fetchWithAuth('/api/sales/stats/today');
        
        // ✅ Verificar que la respuesta sea válida
        if (!response) {
            console.warn('[Alerts] ⚠️ No se pudo obtener estadísticas (sin token)');
            return;
        }
        
        if (!response.ok) {
            console.warn('[Alerts] ⚠️ Error al obtener estadísticas:', response.status);
            return;
        }
        
        const stats = await response.json();
        
        // 1. Pedido sin terminar
        if (window.cart && window.cart.length > 0) {
            const timeSinceLastInteraction = Date.now() - lastSaleTime;
            if (timeSinceLastInteraction > ALERT_CONFIG.IDLE_WARNING) {
                await triggerAlert('pending_order', {
                    message: 'Hay un pedido sin terminar',
                    severity: 'warning'
                });
            }
        }
        
        // 2. Ventas lentas
        const now = new Date();
        const currentHour = now.getHours();
        
        // Solo alertar en horario comercial (8am - 8pm)
        if (currentHour >= 8 && currentHour < 20) {
            if (stats.sales_count < ALERT_CONFIG.SLOW_SALES_THRESHOLD) {
                await triggerAlert('slow_sales', {
                    message: `Solo ${stats.sales_count} ventas en las últimas ${ALERT_CONFIG.SLOW_SALES_HOURS} horas`,
                    severity: 'info',
                    count: stats.sales_count
                });
            }
        }
        
        // 3. Productos agotados
        if (stats.low_stock && stats.low_stock.length > 0) {
            const outOfStock = stats.low_stock.filter(p => p.stock === 0);
            const lowStock = stats.low_stock.filter(p => p.stock > 0 && p.stock <= 5);
            
            if (outOfStock.length > 0) {
                await triggerAlert('out_of_stock', {
                    message: `${outOfStock.length} producto${outOfStock.length > 1 ? 's' : ''} agotado${outOfStock.length > 1 ? 's' : ''}`,
                    severity: 'error',
                    products: outOfStock
                });
            }
            
            if (lowStock.length > 0) {
                await triggerAlert('low_stock', {
                    message: `${lowStock.length} producto${lowStock.length > 1 ? 's' : ''} con poco stock`,
                    severity: 'warning',
                    products: lowStock
                });
            }
        }
        
        // 4. Tiempo promedio excedido
        if (stats.last_sale) {
            const lastSaleDate = new Date(stats.last_sale);
            const minutesSinceLastSale = (Date.now() - lastSaleDate.getTime()) / 60000;
            
            // Si pasaron más de 30 minutos sin ventas en horario comercial
            if (minutesSinceLastSale > 30 && currentHour >= 8 && currentHour < 20) {
                await triggerAlert('no_recent_sales', {
                    message: `Sin ventas hace ${Math.floor(minutesSinceLastSale)} minutos`,
                    severity: 'info',
                    minutes: Math.floor(minutesSinceLastSale)
                });
            }
        }
        
    } catch (error) {
        console.error('[Alerts] Error verificando alertas:', error);
    }
}

/**
 * DISPARAR ALERTA
 */
async function triggerAlert(type, data) {
    console.log(`[Alerts] 🚨 ${type}:`, data);
    
    const alertHandlers = {
        'pending_order': handlePendingOrderAlert,
        'slow_sales': handleSlowSalesAlert,
        'out_of_stock': handleOutOfStockAlert,
        'low_stock': handleLowStockAlert,
        'no_recent_sales': handleNoRecentSalesAlert
    };
    
    const handler = alertHandlers[type];
    if (handler) {
        await handler(data);
    }
}

/**
 * MANEJADORES DE ALERTAS
 */
async function handlePendingOrderAlert(data) {
    showVisualAlert(data.message, data.severity);
    
    if (window.VoiceSystem && window.VoiceSystem.speak) {
        await window.VoiceSystem.speak('Hay un pedido sin terminar');
    }
    
    playSound('alert');
}

async function handleSlowSalesAlert(data) {
    showVisualAlert(data.message, data.severity);
    
    // No molestar con voz si ya hay pocas ventas
    console.log('[Alerts] Ventas lentas detectadas');
}

async function handleOutOfStockAlert(data) {
    const productNames = data.products.map(p => p.name).join(', ');
    const message = `Productos agotados: ${productNames}`;
    
    showVisualAlert(message, data.severity);
    
    if (window.VoiceSystem && window.VoiceSystem.speak) {
        await window.VoiceSystem.speak(message);
    }
    
    playSound('alert');
}

async function handleLowStockAlert(data) {
    const productNames = data.products.map(p => `${p.name} (${p.stock})`).join(', ');
    const message = `Poco stock: ${productNames}`;
    
    showVisualAlert(message, data.severity);
}

async function handleNoRecentSalesAlert(data) {
    showVisualAlert(data.message, data.severity);
}

/**
 * UI DE ALERTAS
 */
function showVisualAlert(message, severity = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${severity}`;
    
    const icons = {
        'error': '🔴',
        'warning': '⚠️',
        'info': 'ℹ️',
        'success': '✅'
    };
    
    alertDiv.innerHTML = `
        <div class="alert-icon">${icons[severity]}</div>
        <div class="alert-message">${message}</div>
        <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
    `;
    
    const alertContainer = document.getElementById('alert-container') || createAlertContainer();
    alertContainer.appendChild(alertDiv);
    
    setTimeout(() => alertDiv.classList.add('show'), 10);
    
    // Auto-remover después de 10 segundos
    setTimeout(() => {
        alertDiv.classList.remove('show');
        setTimeout(() => alertDiv.remove(), 300);
    }, 10000);
}

function createAlertContainer() {
    const container = document.createElement('div');
    container.id = 'alert-container';
    container.className = 'alert-container';
    document.body.appendChild(container);
    return container;
}

function playSound(type) {
    const audio = new Audio(`/static/sounds/${type}.mp3`);
    audio.volume = 0.5;
    audio.play().catch(e => console.warn('[Sound] Error:', e));
}

/**
 * ACTUALIZAR ÚLTIMA INTERACCIÓN
 */
function updateLastInteraction() {
    lastSaleTime = Date.now();
}

// Escuchar eventos de interacción
document.addEventListener('click', updateLastInteraction);
document.addEventListener('keypress', updateLastInteraction);

// Exportar
window.AlertSystem = {
    check: checkAllAlerts,
    trigger: triggerAlert,
    updateInteraction: updateLastInteraction
};