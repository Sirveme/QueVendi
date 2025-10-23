/**
 * SISTEMA DE VOZ SIMPLIFICADO - QueVendí PRO
 * Flujo: Escuchar → Procesar → Responder → Esperar siguiente comando
 */

// Estado global
// Variables globales
//let recognition;
//let isListening = false;
//let cart = [];
//let paymentMethod = 'efectivo'; // efectivo, yape, plin

// ========================================
// ESTADO GLOBAL - COMO EN PEDIDOS
// ========================================
const VoiceState = {
    recognition: null,
    isListening: false,
    cart: [],
    paymentMethod: 'efectivo',
    voiceSettings: {
        voice: 'es-PE-Standard-A',
        speed: 1.0,
        enabled: true
    }
};



let idleTimer;
let lastActivityTime = Date.now();
let voiceSettings = {
    voice: 'es-PE-Standard-A',
    speed: 1.0,
    enabled: true
};

// Configuración
const API_BASE = '/api';
const IDLE_TIMEOUT = 180000; // 3 minutos
//let idleTimer = null;

// Configuración de rutas API (SIN duplicar /sales)
const API_ROUTES = {
    parseCommand: '/api/sales/voice/parse',
    createSale: '/api/sales/',           // ✅ Ruta correcta
    voiceSettings: '/api/sales/voice/settings',
    todaySales: '/api/sales/today',
    todayTotal: '/api/sales/today/total'
};;

console.log('[VoiceSystem] Rutas configuradas:', API_ROUTES);


// ========================================
// INICIALIZACIÓN COMPLETA
// ========================================

document.addEventListener('DOMContentLoaded', async function() {
    console.log('[VoiceSystem] Inicializando...');
    
    // 1. Detectar si es móvil
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    // 2. Inicializar audio SOLO si no es móvil
    if (!isMobile) {
        const audioOk = await initAudioWithFilters();
        if (!audioOk) {
            console.warn('[VoiceSystem] ⚠️ Audio no configurado, pero continuando...');
        }
    } else {
        console.log('[VoiceSystem] 📱 Móvil detectado - audio se activará al tocar');
    }
    
    // 3. Inicializar reconocimiento
    initSpeechRecognition();
    
    // 4. Inicializar otros componentes
    initPaymentButtons();
    await loadVoiceSettings();
    startIdleMonitor();
    
    // 5. NO iniciar escucha automática en móvil
    if (!isMobile) {
        startListening();
    } else {
        console.log('[Voice] 📱 Toca el micrófono para activar');
        updateMicStatus(false);
        const micStatus = document.getElementById('mic-status');
        if (micStatus) {
            micStatus.textContent = '🎤 TOCA PARA ACTIVAR';
            micStatus.style.cursor = 'pointer';
        }
    }
    
    console.log('[VoiceSystem] ✅ Sistema listo');

    // Hacer clickeable el estado del micrófono
    const micStatus = document.getElementById('mic-status');
    if (micStatus) {
        micStatus.addEventListener('click', async function() {
            console.log('[Voice] 🎤 Click en micrófono');
            
            if (!isListening) {
                console.log('[Voice] Activando por toque del usuario...');
                
                // Solicitar permisos de audio en móvil
                const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                if (isMobile) {
                    try {
                        await initAudioWithFilters();
                    } catch (e) {
                        console.error('[Voice] Error al inicializar audio:', e);
                    }
                }
                
                startListening();
                micStatus.textContent = '🎤 ESCUCHANDO...';
            } else {
                console.log('[Voice] Pausando...');
                stopListening();
                micStatus.textContent = '🎤 TOCA PARA ACTIVAR';
            }
        });
        
        console.log('[Voice] ✅ Listener de click agregado');
    } else {
        console.error('[Voice] ❌ Elemento mic-status no encontrado');
    }
});



/**
 * RECONOCIMIENTO DE VOZ
 */
function initSpeechRecognition() {
    console.log('[Voice] Inicializando reconocimiento...');
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.error('[Voice] ❌ Reconocimiento de voz no disponible');
        return;
    }
    
    // Crear instancia como en Pedidos
    VoiceState.recognition = new SpeechRecognition();
    VoiceState.recognition.continuous = false;  // Como en Pedidos
    VoiceState.recognition.interimResults = false;
    VoiceState.recognition.lang = 'es-PE';
    
    console.log('[Voice] Configuración:', {
        continuous: VoiceState.recognition.continuous,
        interimResults: VoiceState.recognition.interimResults,
        lang: VoiceState.recognition.lang
    });
    
    // Event handlers - COPIADOS DE PEDIDOS
    VoiceState.recognition.onresult = function(event) {
        const texto = event.results[0][0].transcript.trim();
        console.log('[Voice] 📝 Transcripción:', texto);
        showTranscript(texto);
        processCommand(texto);
    };
    
    VoiceState.recognition.onend = function() {
        console.log('[Voice] Reconocimiento terminado');
        VoiceState.isListening = false;
        const micStatus = document.getElementById('mic-status');
        if (micStatus) {
            micStatus.textContent = '🎤 TOCA PARA ACTIVAR';
            micStatus.classList.remove('listening');
        }
    };
    
    VoiceState.recognition.onerror = function(event) {
        console.error('[Voice] ❌ Error:', event.error);
        VoiceState.isListening = false;
        const micStatus = document.getElementById('mic-status');
        if (micStatus) {
            micStatus.textContent = '🎤 TOCA PARA ACTIVAR';
            micStatus.classList.remove('listening');
        }
    };
}

// ========================================
// INICIALIZAR CON FILTROS DE AUDIO
// ========================================

async function initAudioWithFilters() {
    console.log('[Audio] Inicializando con filtros de ruido...');
    
    try {
        // ✅ Solicitar micrófono con filtros optimizados
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,      // Cancelar eco
                noiseSuppression: true,      // Suprimir ruido de fondo
                autoGainControl: true,       // Control automático de ganancia
                sampleRate: 48000            // Calidad de audio alta
            }
        });
        
        console.log('[Audio] ✅ Micrófono configurado con filtros');
        console.log('[Audio] Configuración:', stream.getAudioTracks()[0].getSettings());
        
        // No necesitamos hacer nada más con el stream
        // El navegador ya aplicará los filtros al reconocimiento
        
        return true;
        
    } catch (error) {
        console.error('[Audio] ❌ Error configurando micrófono:', error);
        
        if (error.name === 'NotAllowedError') {
            showError('Permiso de micrófono denegado. Permite el acceso para usar comandos de voz.');
        } else if (error.name === 'NotFoundError') {
            showError('No se encontró micrófono. Conecta un micrófono para usar comandos de voz.');
        }
        
        return false;
    }
}


function startListening() {
    if (!VoiceState.recognition) {
        console.error('[Voice] Recognition no inicializado');
        return;
    }
    
    const micButton = document.getElementById('mic-status');
    
    if (VoiceState.isListening) {
        VoiceState.recognition.stop();
    } else {
        VoiceState.recognition.start();
        VoiceState.isListening = true;
        if (micButton) {
            micButton.classList.add('listening');
            micButton.textContent = '🎤 ESCUCHANDO...';
        }
    }
}

function stopListening() {
    if (!recognition) return;
    
    isListening = false;
    try {
        recognition.stop();
        console.log('[Voice] 🛑 Detenido');
    } catch (error) {
        console.warn('[Voice] Error al detener:', error);
    }
    
    const micStatus = document.getElementById('mic-status');
    if (micStatus) {
        micStatus.textContent = '🎤 TOCA PARA ACTIVAR';
        micStatus.classList.remove('listening');
    }
}

// ========================================
// FUNCIONES CORREGIDAS CON fetchWithAuth()
// Reemplaza estas 3 funciones en voice_system.js
// ========================================

// ========================================
// PROCESAMIENTO DE COMANDOS (con ruta correcta)
// ========================================

async function processCommand(text) {
    console.log('[Voice] 🔄 Procesando:', text);
    
    try {
        const response = await fetchWithAuth(API_ROUTES.parseCommand, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });
        
        const data = await response.json();
        console.log('[Voice] 📦 Respuesta:', data);
        
        if (!response.ok) {
            throw new Error(data.detail || 'Error al procesar comando');
        }
        
        await handleCommand(data);
        
    } catch (error) {
        console.error('[Voice] ❌ Error:', error);
        await speak(`No entendí ese comando. ${error.message}`);
        playSound('error');
    }
}

async function handleCommand(data) {
    const type = data.type;
    
    switch (type) {
        case 'cancel':
            await handleCancel();
            break;
        
        case 'confirm':
            await handleConfirm();
            break;
        
        case 'add':
            await handleAdd(data);
            break;
        
        case 'sale':
            await handleSale(data);
            break;
        
        case 'change_price':
            await handlePriceChange(data);
            break;
        
        case 'change_product':
            await handleProductChange(data);
            break;
        
        // ✅ NUEVO: Manejar 'remove'
        case 'remove':
            await handleRemove(data);
            break;

        // ✅ NUEVO: Manejar ambigüedad
        case 'ambiguous':
            await handleAmbiguous(data);
            break;
        
        default:
            console.warn('[Voice] Tipo de comando desconocido:', type);
    }
}

async function handleAmbiguous(data) {
    console.log('[Voice] Productos ambiguos:', data.ambiguous_products);
    
    const ambiguous = data.ambiguous_products[0];  // Por ahora solo el primero
    const query = ambiguous.query;
    const options = ambiguous.options;
    
    // Crear mensaje de voz con opciones
    const optionsText = options.map((opt, i) => 
        `${i + 1}: ${opt.name}`
    ).join(', ');
    
    await speak(`Encontré varios ${query}. ${optionsText}. ¿Cuál quieres?`);
    
    // Mostrar opciones en pantalla
    showAmbiguousOptions(query, options);
    
    // Esperar respuesta del usuario
    // El usuario puede decir el número o el nombre completo
}

function showAmbiguousOptions(query, options) {
    // Crear modal con opciones
    const modal = document.createElement('div');
    modal.className = 'modal show';
    modal.id = 'ambiguous-modal';
    modal.style.display = 'flex';
    
    const html = `
        <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
                <h2>¿Cuál "${query}"?</h2>
                <button class="modal-close" onclick="closeAmbiguousModal()">✕</button>
            </div>
            <div class="modal-body">
                ${options.map((opt, i) => `
                    <div class="ambiguous-option" onclick="selectAmbiguousOption(${i}, ${opt.id}, '${opt.name}', ${opt.price})">
                        <div class="option-number">${i + 1}</div>
                        <div class="option-info">
                            <div class="option-name">${opt.name}</div>
                            <div class="option-price">S/. ${opt.price.toFixed(2)}</div>
                        </div>
                    </div>
                `).join('')}
                <div style="margin-top: 16px; text-align: center; color: rgba(255,255,255,0.6); font-size: 12px;">
                    Di el número o toca una opción
                </div>
            </div>
        </div>
    `;
    
    modal.innerHTML = html;
    document.body.appendChild(modal);
}


window.closeAmbiguousModal = function() {
    const modal = document.getElementById('ambiguous-modal');
    if (modal) {
        modal.remove();
    }
};

window.selectAmbiguousOption = async function(index, productId, productName, price) {
    console.log('[Voice] Opción seleccionada:', productName);
    
    // Cerrar modal
    closeAmbiguousModal();
    
    // Agregar al carrito
    const product = {
        id: productId,
        name: productName,
        price: price
    };
    
    cart.push({
        product: product,
        quantity: 1,
        subtotal: price
    });
    
    updateCartDisplay();
    
    const total = cart.reduce((sum, i) => sum + i.subtotal, 0);
    await speak(`Un ${productName}. Van ${formatPrice(total)}`);
    playSound('success');
};


// Agregar estilos CSS para las opciones ambiguas
const ambiguousStyles = `
<style id="ambiguous-styles">
.ambiguous-option {
    display: flex;
    align-items: center;
    padding: 12px;
    margin-bottom: 8px;
    background: rgba(15, 23, 42, 0.5);
    border: 2px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
}

.ambiguous-option:hover {
    background: rgba(139, 92, 246, 0.2);
    border-color: rgba(139, 92, 246, 0.6);
    transform: translateX(4px);
}

.option-number {
    font-size: 24px;
    font-weight: 700;
    color: #8b5cf6;
    margin-right: 16px;
    min-width: 32px;
    text-align: center;
}

.option-info {
    flex: 1;
}

.option-name {
    font-size: 14px;
    color: white;
    font-weight: 500;
    margin-bottom: 4px;
}

.option-price {
    font-size: 16px;
    color: #10b981;
    font-weight: 600;
}
</style>
`;

// Insertar estilos si no existen
if (!document.getElementById('ambiguous-styles')) {
    document.head.insertAdjacentHTML('beforeend', ambiguousStyles);
}



async function handleCancel() {
    if (cart.length === 0) {
        await speak('No hay productos en el carrito');
        return;
    }
    
    cart = [];
    updateCartDisplay();
    await speak('Venta cancelada');
    playSound('cancel');
}

async function handleConfirm() {
    if (cart.length === 0) {
        await speak('No hay productos para confirmar');
        return;
    }
    
    await confirmSale();
}

async function handleAdd(data) {
    // Agregar al carrito existente
    for (const item of data.items) {
        cart.push(item);
    }
    
    updateCartDisplay();
    
    const total = cart.reduce((sum, item) => sum + item.subtotal, 0);
    const itemNames = data.items.map(i => `${formatQuantity(i.quantity)} ${i.product.name}`).join(' y ');
    
    await speak(`Agregado ${itemNames}. Van ${formatPrice(total)}`);
    
    if (data.warning) {
        await speak(data.warning);
    }
}

async function handleSale(data) {
    // Reemplazar carrito (nueva venta)
    cart = data.items;
    updateCartDisplay();
    
    const total = data.total;
    const itemNames = data.items.map(i => `${formatQuantity(i.quantity)} ${i.product.name}`).join(' y ');
    
    await speak(`${itemNames}. Van ${formatPrice(total)}`);
    
    if (data.warning) {
        await speak(data.warning);
    }
}

async function handlePriceChange(data) {
    const productQuery = data.product_query;
    const newPrice = data.new_price;
    
    // Buscar producto en el carrito
    const item = cart.find(i => 
        i.product.name.toLowerCase().includes(productQuery) ||
        productQuery.includes(i.product.name.toLowerCase())
    );
    
    if (!item) {
        await speak(`No encontré ${productQuery} en el carrito`);
        return;
    }
    
    const oldPrice = item.product.price;
    item.product.price = newPrice;
    item.subtotal = item.quantity * newPrice;
    
    updateCartDisplay();
    
    const total = cart.reduce((sum, i) => sum + i.subtotal, 0);
    await speak(`Precio de ${item.product.name} cambiado de ${formatPrice(oldPrice)} a ${formatPrice(newPrice)}. Nuevo total: ${formatPrice(total)}`);
}

async function handleProductChange(data) {
    const oldProduct = data.old_product;
    const newProduct = data.new_product;
    
    // Buscar y reemplazar en carrito
    const itemIndex = cart.findIndex(i => i.product.id === oldProduct.id);
    
    if (itemIndex === -1) {
        await speak(`No encontré ${oldProduct.name} en el carrito`);
        return;
    }
    
    const quantity = cart[itemIndex].quantity;
    cart[itemIndex] = {
        product: newProduct,
        quantity: quantity,
        subtotal: quantity * newProduct.price
    };
    
    updateCartDisplay();
    await speak(`Cambiado ${oldProduct.name} por ${newProduct.name}`);
}


async function handleRemove(data) {
    console.log('[Voice] Eliminando producto:', data.product.name);
    
    // Buscar producto en el carrito
    const index = cart.findIndex(item => item.product.id === data.product.id);
    
    if (index === -1) {
        await speak(`No encontré ${data.product.name} en el carrito`);
        playSound('error');
        return;
    }
    
    // Eliminar del carrito
    const removed = cart.splice(index, 1)[0];
    
    // Actualizar UI
    updateCartDisplay();
    
    // Respuesta de voz
    await speak(`Eliminado ${removed.product.name}`);
    playSound('success');
}


/**
 * BÚSQUEDA DE PRODUCTOS (SI EXISTE EN TU CÓDIGO - AGREGAR SI LA TIENES)
 * Si tienes alguna función que busque productos, también debe usar fetchWithAuth
 */
async function searchProduct(query) {
    try {
        // ✅ USAR fetchWithAuth
        const response = await fetchWithAuth(`${API_BASE}/products/search?q=${encodeURIComponent(query)}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error('Error al buscar producto');
        }
        
        return await response.json();
    } catch (error) {
        console.error('[Voice] Error buscando producto:', error);
        throw error;
    }
}

// ========================================
// CONFIRMAR VENTA (con ruta hardcoded para evitar duplicación)
// ========================================

async function confirmSale() {
    console.log('[Voice] 💾 Confirmando venta...');
    
    if (cart.length === 0) {
        await speak('El carrito está vacío');
        playSound('error');
        return;
    }
    
    const saleData = {
        items: cart.map(item => ({
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.product.price,
            subtotal: item.subtotal
        })),
        payment_method: paymentMethod,
        payment_reference: null,
        customer_name: null,
        is_credit: false
    };
    
    try {
        // ✅ Ruta hardcoded para evitar duplicación
        const response = await fetchWithAuth('/api/sales/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(saleData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Error al guardar venta');
        }
        
        const result = await response.json();
        console.log('[Voice] ✅ Venta guardada:', result);
        
        const total = cart.reduce((sum, i) => sum + i.subtotal, 0);
        
        // Limpiar carrito
        cart = [];
        updateCartDisplay();
        
        // Actualizar UI
        htmx.ajax('GET', '/api/sales/today/total/html', {target: '#daily-summary', swap: 'innerHTML'});
        htmx.ajax('GET', '/api/sales/today/html', {target: '#sales-list', swap: 'innerHTML'});
        
        // Evento personalizado para actualizar otras partes
        document.body.dispatchEvent(new CustomEvent('salesUpdated'));
        
        // Respuesta de voz
        await speak(`Venta confirmada por ${formatPrice(total)}. Siguiente cliente`);
        playSound('confirm');
        
    } catch (error) {
        console.error('[Voice] ❌ Error al confirmar:', error);
        await speak(`Error al guardar venta: ${error.message}`);
        playSound('error');
    }
}

/**
 * TEXT-TO-SPEECH (VOZ DEL SISTEMA)
 */
/**
 * TEXT-TO-SPEECH (SOLO NAVEGADOR)
 */
async function speak(text) {
    console.log('[TTS] 🔊 Diciendo:', text);
    
    // Verificar si el navegador soporta síntesis de voz
    if (!('speechSynthesis' in window)) {
        console.error('[TTS] El navegador no soporta síntesis de voz');
        return;
    }
    
    // Cancelar cualquier speech en curso
    window.speechSynthesis.cancel();
    
    // Crear utterance
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configurar voz en español
    const voices = window.speechSynthesis.getVoices();
    const spanishVoice = voices.find(voice => voice.lang.startsWith('es'));
    if (spanishVoice) {
        utterance.voice = spanishVoice;
    }
    utterance.lang = 'es-PE';  // Español de Perú
    
    // Configuración de voz
    utterance.rate = 1.0;      // Velocidad normal
    utterance.pitch = 1.0;     // Tono normal
    utterance.volume = 1.0;    // Volumen máximo
    
    // Eventos
    utterance.onstart = () => {
        console.log('[TTS] ✅ Reproduciendo...');
    };
    
    utterance.onend = () => {
        console.log('[TTS] ✅ Finalizado');
    };
    
    utterance.onerror = (error) => {
        console.error('[TTS] ❌ Error:', error);
    };
    
    // Reproducir
    window.speechSynthesis.speak(utterance);
}

function speakWithWebAPI(text) {
    if (!('speechSynthesis' in window)) {
        console.warn('[TTS] Web Speech API no disponible');
        return;
    }
    
    // Cancelar cualquier síntesis en curso
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-PE';
    utterance.rate = voiceSettings.speed;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    
    // Intentar usar voz específica si está disponible
    const voices = window.speechSynthesis.getVoices();
    const spanishVoice = voices.find(v => v.lang.startsWith('es'));
    if (spanishVoice) {
        utterance.voice = spanishVoice;
    }
    
    window.speechSynthesis.speak(utterance);
}

function playAudioBase64(base64Audio) {
    const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
    audio.play().catch(error => {
        console.error('[TTS] Error reproduciendo audio:', error);
    });
}

/**
 * INTERFAZ DE USUARIO
 */
function updateCartDisplay() {
    const cartContainer = document.getElementById('cart-display');
    if (!cartContainer) return;
    
    if (cart.length === 0) {
        cartContainer.innerHTML = `
            <div class="cart-empty">
                <div class="empty-icon">🛒</div>
                <div class="empty-text">Carrito vacío</div>
                <div class="empty-hint">Di: "un café y 10 panes"</div>
            </div>
        `;
        return;
    }
    
    const total = cart.reduce((sum, item) => sum + item.subtotal, 0);
    
    let itemsHTML = '';
    cart.forEach((item, index) => {
        itemsHTML += `
            <div class="cart-item">
                <div class="item-info">
                    <span class="item-qty">${formatQuantity(item.quantity)}x</span>
                    <span class="item-name">${item.product.name}</span>
                </div>
                <div class="item-price">S/ ${item.subtotal.toFixed(2)}</div>
            </div>
        `;
    });
    
    cartContainer.innerHTML = `
        <div class="cart-items">
            ${itemsHTML}
        </div>
        <div class="cart-total">
            <span class="total-label">TOTAL:</span>
            <span class="total-amount">S/ ${total.toFixed(2)}</span>
        </div>
    `;
}

function updateMicStatus(listening) {
    const statusDiv = document.getElementById('mic-status');
    if (!statusDiv) return;
    
    if (listening) {
        statusDiv.innerHTML = '🎤 ESCUCHANDO...';
        statusDiv.className = 'mic-status listening';
    } else {
        statusDiv.innerHTML = '🎤 PAUSADO';
        statusDiv.className = 'mic-status paused';
    }
}

function showTranscript(text) {
    const transcriptDiv = document.getElementById('transcript');
    if (!transcriptDiv) return;
    
    transcriptDiv.textContent = `"${text}"`;
    transcriptDiv.style.display = 'block';
    
    // Ocultar después de 3 segundos
    setTimeout(() => {
        transcriptDiv.style.display = 'none';
    }, 3000);
}

function showError(message) {
    console.error('[Error]', message);
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-toast';
    errorDiv.innerHTML = `
        <div class="error-icon">⚠️</div>
        <div class="error-message">${message}</div>
    `;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => errorDiv.classList.add('show'), 10);
    
    setTimeout(() => {
        errorDiv.classList.remove('show');
        setTimeout(() => errorDiv.remove(), 300);
    }, 5000);
}

/**
 * MÉTODOS DE PAGO
 */
function initPaymentButtons() {
    const paymentButtons = document.querySelectorAll('.payment-btn');
    
    paymentButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const method = this.dataset.method;
            setPaymentMethod(method);
        });
    });
}

function setPaymentMethod(method) {
    paymentMethod = method;
    
    // Actualizar UI
    document.querySelectorAll('.payment-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.method === method) {
            btn.classList.add('active');
        }
    });
    
    console.log('[Payment] Método:', method);
}

/**
 * CONFIGURACIÓN DE VOZ
 */
function initVoiceSettings() {
    const settingsBtn = document.getElementById('voice-settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', openVoiceSettings);
    }
}

function openVoiceSettings() {
    // TODO: Abrir modal con configuración
    console.log('[Settings] Abriendo configuración de voz');
}

async function loadVoiceSettings() {
    try {
        const response = await fetchWithAuth(API_ROUTES.voiceSettings, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            console.log('[Settings] Usando configuración por defecto');
            return null;  // ⬅️ Retornar null sin warning
        }
        
        const settings = await response.json();
        console.log('[Settings] Configuración cargada:', settings);
        return settings;
        
    } catch (error) {
        console.log('[Settings] Usando defaults');
        return null;  // ⬅️ Retornar null silenciosamente
    }
}

async function saveVoiceSettings(settings) {
    try {
        await fetch(`${API_BASE}/voice/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        voiceSettings = settings;
        console.log('[Settings] Configuración guardada');
    } catch (error) {
        console.error('[Settings] Error guardando configuración:', error);
    }
}

/**
 * MONITOR DE INACTIVIDAD
 */
function startIdleMonitor() {
    resetIdleTimer();
}

function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    
    idleTimer = setTimeout(() => {
        console.log('[Idle] ⏰ Tiempo de inactividad alcanzado');
        checkIdleAlerts();
    }, IDLE_TIMEOUT);
}

async function checkIdleAlerts() {
    try {
        const response = await fetch(`${API_BASE}/sales/stats/today`);
        const stats = await response.json();
        
        // Verificar si hay carrito sin confirmar
        if (cart.length > 0) {
            await speak('Hay un pedido sin terminar');
            playSound('alert');
        }
        
        // Verificar ventas lentas
        if (stats.sales_count < 5) {
            console.log('[Alert] Pocas ventas hoy');
        }
        
        // Verificar productos agotados
        if (stats.low_stock && stats.low_stock.length > 0) {
            const outOfStock = stats.low_stock.filter(p => p.stock === 0);
            if (outOfStock.length > 0) {
                const names = outOfStock.map(p => p.name).join(', ');
                await speak(`Productos agotados: ${names}`);
                playSound('alert');
            }
        }
        
    } catch (error) {
        console.error('[Idle] Error verificando alertas:', error);
    }
}

/**
 * SONIDOS DEL SISTEMA
 */
function playSound(type) {
    // Solo reproducir sonidos si NO está hablando
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        console.log('[Sound] Esperando a que termine de hablar...');
        setTimeout(() => playSound(type), 500);
        return;
    }
    
    const sounds = {
        'confirm': '/static/sounds/confirm.mp3',
        'cancel': '/static/sounds/cancel.mp3',
        'alert': '/static/sounds/alert.mp3',
        'error': '/static/sounds/error.mp3'
    };
    
    const soundFile = sounds[type];
    if (!soundFile) return;
    
    const audio = new Audio(soundFile);
    audio.volume = 0.3; // Bajado de 0.5 a 0.3
    audio.play().catch(e => console.warn('[Sound] Error:', e));
}

/**
 * UTILIDADES
 */
function formatQuantity(qty) {
    if (qty % 1 === 0) {
        return qty.toString();
    }
    return qty.toFixed(2).replace(/\.?0+$/, '');
}

function formatPrice(price) {
    const soles = Math.floor(price);
    const centavos = Math.round((price - soles) * 100);
    
    if (centavos === 0) {
        return `${soles} ${soles === 1 ? 'sol' : 'soles'}`;
    }
    
    return `${soles} soles con ${centavos} centavos`;
}

/**
 * EXPORTAR FUNCIONES GLOBALES
 */
window.VoiceSystem = {
    startListening,
    stopListening,
    speak,
    setPaymentMethod,
    saveVoiceSettings
};



/**
 * MODAL DE COMANDOS
 */
function openCommandsModal() {
    const modal = document.getElementById('voice-commands-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

function closeCommandsModal() {
    const modal = document.getElementById('voice-commands-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// Exportar globalmente
window.openCommandsModal = openCommandsModal;
window.closeCommandsModal = closeCommandsModal;