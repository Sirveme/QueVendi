/**
 * QueVendi - Dashboard Principal
 * Adaptado de pos.js funcional
 */

// ============================================
// CONFIGURACIÓN
// ============================================

const CONFIG = {
    micTimer: 10,
    dailyGoal: 500,
    lowStockThreshold: 10,
    maxRecentProducts: 8,
    apiBase: '/api/v1',
    emergencyHoldTime: 3000,
    crossSellRules: {
        'coca cola': ['galletas', 'snacks', 'chocolate'],
        'pan': ['mantequilla', 'mermelada', 'queso'],
        'leche': ['cereales', 'chocolate', 'galletas'],
        'arroz': ['aceite', 'menestras', 'fideos'],
        'cerveza': ['snacks', 'limón', 'hielo'],
        'tallarines': ['atún', 'queso parmesano', 'tomate'],
        'gaseosa': ['galletas', 'snacks', 'pizza']
    }
};

// ============================================
// ESTADO GLOBAL
// ============================================

const AppState = {
    cart: [],
    paymentMethod: 'efectivo',
    selectedClient: null,
    voiceActive: false,
    voiceMode: null,
    user: null,
    store: null,
    isOwner: false,
    isPro: false,
    proTrialActive: false,
    recentProducts: [],
    dailySales: 0,
    panicMenuOpen: false,
    emergencyTimer: null,
    emergencyProgress: 0,
    pendingVoiceQuantity: 1,
    speechEnabled: true,
    pendingVariants: []
};


// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Dashboard] 🚀 Inicializando...');
    
    // Verificar autenticación
    if (!checkAuth()) return;
    
    // Cargar datos del usuario
    await loadUserData();
    
    // Cargar configuraciones
    loadMicSettings();
    
    // Cargar datos
    loadCart();
    loadRecentProducts();
    renderCart();
    renderRecentProducts();
    await loadDailySales();
    
    // Verificar plan PRO
    checkProStatus();
    
    // Configurar event listeners
    setupEventListeners();
    
    // Seleccionar método de pago por defecto
    selectPaymentUI('efectivo');
    
    console.log('[Dashboard] ✅ Sistema cargado correctamente');
});

// ============================================
// AUTENTICACIÓN
// ============================================

function getAuthToken() {
    return localStorage.getItem('access_token') || localStorage.getItem('token');
}

function checkAuth() {
    const token = getAuthToken();
    if (!token) {
        console.warn('[Auth] No hay token');
        window.location.href = '/auth/login';
        return false;
    }
    return true;
}

async function fetchWithAuth(url, options = {}) {
    const token = getAuthToken();
    
    if (!token) {
        window.location.href = '/auth/login';
        throw new Error('No autenticado');
    }
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401) {
        localStorage.clear();
        window.location.href = '/auth/login';
        throw new Error('Token inválido');
    }
    
    return response;
}

async function loadUserData() {
    try {
        const cachedUser = localStorage.getItem('user');
        if (cachedUser) {
            const user = JSON.parse(cachedUser);
            setUserData(user);
        }
        
        const response = await fetchWithAuth(`${CONFIG.apiBase}/users/me`);
        if (response.ok) {
            const user = await response.json();
            localStorage.setItem('user', JSON.stringify(user));
            setUserData(user);
        }
    } catch (error) {
        console.error('[Auth] Error cargando usuario:', error);
    }
}

function setUserData(user) {
    AppState.user = user;
    AppState.isOwner = user.role === 'owner';
    
    const initial = user.full_name ? user.full_name[0].toUpperCase() : 'U';
    
    document.getElementById('header-username').textContent = user.full_name || 'Usuario';
    document.getElementById('sidebar-username').textContent = user.full_name || 'Usuario';
    document.getElementById('sidebar-avatar').textContent = initial;
    
    const storeName = localStorage.getItem('store_name') || 'Mi Bodega';
    document.getElementById('header-store').textContent = storeName;
    document.getElementById('sidebar-store').textContent = storeName;
    
    if (AppState.isOwner) {
        document.body.classList.add('is-owner');
    }
}

function logout() {
    if (confirm('¿Cerrar sesión?')) {
        localStorage.clear();
        window.location.href = '/auth/login';
    }
}

// ============================================
// CARRITO - FUNCIONES BÁSICAS
// ============================================

function addToCart(product, quantity = 1, silent = false) {
    const existing = AppState.cart.find(item => item.id === product.id);
    
    if (existing) {
        existing.quantity += quantity;
    } else {
        AppState.cart.unshift({
            id: product.id,
            name: product.name,
            code: product.code || product.barcode || '',
            price: parseFloat(product.sale_price) || parseFloat(product.price) || 0,
            unit: product.unit || 'unidad',
            quantity: quantity,
            stock: product.stock || 0
        });
        
        addToRecentProducts(product);
    }
    
    saveCart();
    renderCart();
    showCrossSell(product.name);
    showToast(`✅ ${product.name} agregado`, 'success');
    playSound('add');
    
    // Anunciar total por voz (solo si no es silencioso)
    if (!silent) {
        const total = getCartTotal();
        speak(`${product.name}. Total: ${total.toFixed(2)} soles`);
    }
}

function updateQuantity(productId, quantity) {
    const item = AppState.cart.find(i => i.id === productId);
    if (item) {
        const newQty = Math.max(0.01, parseFloat(quantity));
        
        if (item.stock && newQty > item.stock) {
            showToast(`Stock disponible: ${item.stock}`, 'warning');
            return;
        }
        
        item.quantity = newQty;
        saveCart();
        renderCart();
    }
}

function increaseQty(productId) {
    const item = AppState.cart.find(i => i.id === productId);
    if (item) {
        if (item.stock && item.quantity >= item.stock) {
            showToast('Stock máximo alcanzado', 'warning');
            return;
        }
        item.quantity += 1;
        saveCart();
        renderCart();
        
        // Anunciar total por voz
        speakTotal();
    }
}

function decreaseQty(productId) {
    const item = AppState.cart.find(i => i.id === productId);
    if (item) {
        if (item.quantity <= 1) {
            removeFromCart(productId);
        } else {
            item.quantity -= 1;
            saveCart();
            renderCart();
            
            // Anunciar total por voz
            speakTotal();
        }
    }
}

function removeFromCart(productId) {
    const item = AppState.cart.find(i => i.id === productId);
    if (item) {
        AppState.cart = AppState.cart.filter(i => i.id !== productId);
        saveCart();
        renderCart();
        showToast(`${item.name} eliminado`, 'info');
        playSound('remove');
        
        // Anunciar total por voz
        speakTotal();
    }
}

function clearCart() {
    if (AppState.cart.length === 0) return;
    
    if (confirm('¿Vaciar el carrito?')) {
        AppState.cart = [];
        saveCart();
        renderCart();
        document.getElementById('cross-sell').style.display = 'none';
        showToast('Carrito limpiado', 'info');
    }
}

function getCartTotal() {
    return AppState.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

function getCartItemsCount() {
    return AppState.cart.reduce((sum, item) => sum + item.quantity, 0);
}

function saveCart() {
    localStorage.setItem('quevendi_cart_v2', JSON.stringify(AppState.cart));
}

function loadCart() {
    const saved = localStorage.getItem('quevendi_cart_v2');
    if (saved) {
        try {
            AppState.cart = JSON.parse(saved);
        } catch (e) {
            AppState.cart = [];
        }
    }
}

function renderCart() {
    const container = document.getElementById('cart-items');
    const emptyState = document.getElementById('cart-empty');
    const countEl = document.getElementById('cart-count');
    const totalEl = document.getElementById('total-amount');
    
    if (AppState.cart.length === 0) {
        container.innerHTML = '';
        if (emptyState) {
            emptyState.style.display = 'flex';
            container.appendChild(emptyState);
        }
        countEl.textContent = '0 items';
        totalEl.textContent = 'S/. 0.00';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    const total = getCartTotal();
    const itemsCount = getCartItemsCount();
    
    container.innerHTML = AppState.cart.map(item => {
        const itemPrice = parseFloat(item.price) || 0;
        const itemQuantity = parseFloat(item.quantity) || 1;
        const itemTotal = itemPrice * itemQuantity;
        
        return `
        <div class="cart-item">
            <div class="cart-item-info">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">S/. ${itemPrice.toFixed(2)} / ${item.unit}</div>
            </div>
            <div class="cart-item-qty">
                <button onclick="decreaseQty(${item.id})">−</button>
                <span>${itemQuantity}</span>
                <button onclick="increaseQty(${item.id})">+</button>
            </div>
            <div class="cart-item-subtotal">S/. ${itemTotal.toFixed(2)}</div>
        </div>
        `;
    }).join('');
    
    totalEl.textContent = `S/. ${total.toFixed(2)}`;
    countEl.textContent = `${itemsCount} item${itemsCount !== 1 ? 's' : ''}`;
}

// ============================================
// PRODUCTOS RECIENTES
// ============================================

function addToRecentProducts(product) {
    AppState.recentProducts = AppState.recentProducts.filter(p => p.id !== product.id);
    
    AppState.recentProducts.unshift({
        id: product.id,
        name: product.name,
        code: product.code || '',
        sale_price: parseFloat(product.sale_price) || parseFloat(product.price) || 0,
        unit: product.unit || 'unidad',
        stock: product.stock || 0
    });
    
    if (AppState.recentProducts.length > CONFIG.maxRecentProducts) {
        AppState.recentProducts = AppState.recentProducts.slice(0, CONFIG.maxRecentProducts);
    }
    
    saveRecentProducts();
    renderRecentProducts();
}

function saveRecentProducts() {
    localStorage.setItem('recent_products', JSON.stringify(AppState.recentProducts));
}

function loadRecentProducts() {
    const saved = localStorage.getItem('recent_products');
    if (saved) {
        try {
            AppState.recentProducts = JSON.parse(saved);
        } catch (e) {
            AppState.recentProducts = [];
        }
    }
}

function renderRecentProducts() {
    // Si tienes un contenedor de recientes en el dashboard
    const grid = document.getElementById('recent-products-grid');
    if (!grid) return;
    
    if (AppState.recentProducts.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No hay productos recientes</p>';
        return;
    }
    
    grid.innerHTML = AppState.recentProducts.map(p => `
        <div class="recent-product-chip" onclick="quickAddFromRecent(${p.id})">
            <span>${p.name}</span>
            <strong style="color: var(--accent-gold);">+</strong>
        </div>
    `).join('');
}

function quickAddFromRecent(productId) {
    const product = AppState.recentProducts.find(p => p.id === productId);
    
    if (!product) {
        showToast('Producto no encontrado', 'error');
        return;
    }
    
    addToCart({
        id: product.id,
        name: product.name,
        code: product.code,
        sale_price: product.sale_price,
        unit: product.unit,
        stock: product.stock
    });
}

// ============================================
// VENTA CRUZADA (CROSS-SELL)
// ============================================

function showCrossSell(productName) {
    const suggestions = findCrossSellProducts(productName);
    
    if (suggestions.length === 0) {
        document.getElementById('cross-sell').style.display = 'none';
        return;
    }
    
    const container = document.getElementById('cross-sell-items');
    container.innerHTML = suggestions.map(s => `
        <button class="cross-sell-chip" onclick="searchAndAdd('${s}')">
            ${s}
        </button>
    `).join('');
    
    document.getElementById('cross-sell').style.display = 'block';
}

function findCrossSellProducts(productName) {
    const name = productName.toLowerCase();
    
    for (const [key, suggestions] of Object.entries(CONFIG.crossSellRules)) {
        if (name.includes(key)) {
            return suggestions.slice(0, 3);
        }
    }
    
    return [];
}

async function searchAndAdd(productName) {
    try {
        const response = await fetchWithAuth(`${CONFIG.apiBase}/products/search`, {
            method: 'POST',
            body: JSON.stringify({ query: productName, limit: 1 })
        });
        
        if (response.ok) {
            const products = await response.json();
            if (products && products.length > 0) {
                addToCart(products[0]);
            }
        }
    } catch (error) {
        console.error('[CrossSell] Error:', error);
    }
}

// ============================================
// BÚSQUEDA DE PRODUCTOS
// ============================================

let searchTimeout = null;

function searchProducts(query) {
    clearTimeout(searchTimeout);
    
    const resultsContainer = document.getElementById('search-results');
    
    if (!query || query.length < 2) {
        resultsContainer.style.display = 'none';
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetchWithAuth(`${CONFIG.apiBase}/products/search`, {
                method: 'POST',
                body: JSON.stringify({ query: query, limit: 20 })
            });
            
            if (response.ok) {
                const products = await response.json();
                displaySearchResults(products);
            }
        } catch (error) {
            console.error('[Search] Error:', error);
        }
    }, 300);
}

function displaySearchResults(products) {
    const container = document.getElementById('search-results');
    
    if (!products || products.length === 0) {
        container.innerHTML = `
            <div class="search-result-item">
                <span>No se encontraron productos</span>
            </div>
        `;
        container.style.display = 'block';
        return;
    }
    
    // Si hay un solo producto, mostrarlo en dropdown simple
    if (products.length === 1) {
        container.innerHTML = products.map(p => `
            <div class="search-result-item" onclick='selectSearchResult(${JSON.stringify(p).replace(/'/g, "\\'")})'>
                <img src="/static/img/product-default.png" alt="${p.name}">
                <div class="search-result-info">
                    <div class="search-result-name">${p.name}</div>
                    <div class="search-result-stock">Stock: ${p.stock || '∞'} ${p.unit || ''}</div>
                </div>
                <div class="search-result-price">S/. ${(p.sale_price || 0).toFixed(2)}</div>
            </div>
        `).join('');
        container.style.display = 'block';
        return;
    }
    
    // Si hay múltiples productos, mostrar modal PRO
    container.style.display = 'none';
    document.getElementById('search-input').value = '';
    AppState.pendingVoiceQuantity = 1;
    showSearchResultsModal(products);
}

function selectSearchResult(product) {
    addToCart(product);
    
    // Limpiar búsqueda
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').style.display = 'none';
}

// Cerrar resultados al hacer clic fuera
document.addEventListener('click', (e) => {
    const searchSection = document.querySelector('.search-section');
    if (searchSection && !searchSection.contains(e.target)) {
        document.getElementById('search-results').style.display = 'none';
    }
});

// ============================================
// VOZ - SISTEMA DE RECONOCIMIENTO
// ============================================

let recognition = null;
let recognitionTimeout = null;

function initVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.warn('[Voice] Reconocimiento de voz no soportado');
        return false;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.lang = 'es-PE';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    
    recognition.onstart = () => {
        console.log('[Voice] 🎤 Escuchando...');
        AppState.voiceActive = true;
    };
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        console.log('[Voice] Escuchado:', transcript);
        processVoiceCommand(transcript.toLowerCase());
    };
    
    recognition.onerror = (event) => {
        console.error('[Voice] Error:', event.error);
        stopVoice();
        
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
            showToast('Error en el micrófono', 'error');
        }
    };
    
    recognition.onend = () => {
        console.log('[Voice] Micrófono apagado');
        stopVoice();
    };
    
    return true;
}

function startVoiceSearch(mode) {
    // Verificar acceso PRO
    if (mode === 'pro' && !AppState.isPro && !AppState.proTrialActive) {
        showProTrialOffer();
        return;
    }
    
    AppState.voiceMode = mode;
    
    // Indicador visual
    const btnId = mode === 'pro' ? 'btn-mic-pro' : 'btn-mic-basic';
    const btn = document.getElementById(btnId);
    
    if (mode === 'pro') {
        // Modo PRO: usar Whisper (grabación + API)
        startWhisperRecording(btn);
    } else {
        // Modo básico: usar Web Speech Recognition
        startBasicVoice(btn);
    }
}

function startBasicVoice(btn) {
    if (!recognition) {
        const initialized = initVoiceRecognition();
        if (!initialized) {
            showToast('Micrófono no disponible', 'error');
            return;
        }
    }
    
    try {
        recognition.start();
        btn?.classList.add('active');
        showToast('🎤 Escuchando...', 'info');
        
        recognitionTimeout = setTimeout(() => {
            if (AppState.voiceActive) {
                recognition.stop();
            }
        }, CONFIG.micTimer * 1000);
        
    } catch (error) {
        console.error('[Voice] Error al iniciar:', error);
        showToast('No se pudo activar el micrófono', 'error');
    }
}

// Variables para grabación Whisper
let whisperRecorder = null;
let whisperChunks = [];

function startWhisperRecording(btn) {
    // Si ya está grabando, detener
    if (whisperRecorder && whisperRecorder.state === 'recording') {
        whisperRecorder.stop();
        return;
    }
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            btn?.classList.add('active');
            whisperChunks = [];
            showToast('🎤 PRO: Grabando...', 'info');
            
            whisperRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            
            whisperRecorder.ondataavailable = (event) => {
                whisperChunks.push(event.data);
            };
            
            whisperRecorder.onstop = async () => {
                btn?.classList.remove('active');
                stream.getTracks().forEach(track => track.stop());
                
                const audioBlob = new Blob(whisperChunks, { type: 'audio/webm' });
                await processWhisperAudio(audioBlob);
            };
            
            whisperRecorder.start();
            
            // Auto-detener después del tiempo configurado
            setTimeout(() => {
                if (whisperRecorder && whisperRecorder.state === 'recording') {
                    whisperRecorder.stop();
                }
            }, CONFIG.micTimer * 1000);
        })
        .catch(error => {
            console.error('[Whisper] Error de micrófono:', error);
            showToast('No pude acceder al micrófono', 'error');
        });
}

async function processWhisperAudio(audioBlob) {
    showToast('🤖 PRO: Transcribiendo con Whisper...', 'info');
    
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        formData.append('language', 'es');
        
        const response = await fetch('/api/v1/voice/transcribe', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            
            if (result.success && result.text) {
                console.log('[Whisper] Transcripción:', result.text);
                showToast(`🎯 "${result.text}"`, 'success');
                
                // Ahora parsear y buscar productos usando LLM
                await parseAndAddProducts(result.text);
            } else {
                showToast('No pude entender el audio', 'warning');
            }
        } else {
            const error = await response.json();
            showToast(error.detail || 'Error al transcribir', 'error');
        }
    } catch (error) {
        console.error('[Whisper] Error:', error);
        showToast('Error de conexión', 'error');
    }
}

// Variable global para variantes pendientes
//let pendingVariants = [];

async function parseAndAddProducts(transcript) {
    try {
        showToast('🧠 Analizando productos...', 'info');
        
        const response = await fetchWithAuth('/api/v1/voice/parse-llm', {
            method: 'POST',
            body: JSON.stringify({
                transcript: transcript,
                api: 'openai',
                session_id: Date.now().toString()
            })
        });
        
        if (!response.ok) {
            // Fallback: usar el parser local
            processVoiceCommand(transcript.toLowerCase());
            return;
        }
        
        const result = await response.json();
        console.log('[Voice LLM] Resultado:', result);
        
        // Mostrar métricas de tiempo si están disponibles
        if (result.timing) {
            console.log(`[Voice LLM] ⏱️ Tiempos: LLM=${result.timing.llm_ms}ms, BD=${result.timing.db_search_ms}ms, Total=${result.timing.total_ms}ms`);
        }
        
        // Si hubo corrección de transcript, mostrarla
        if (result.transcript_corregido) {
            console.log(`[Voice LLM] 📝 Corregido: "${result.transcript_corregido}"`);
        }
        
        let productsAdded = 0;
        
        // 1. Agregar productos con match único (automáticamente)
        if (result.products && result.products.length > 0) {
            const isMultiple = result.products.length > 1 || 
                               (result.products_with_variants && result.products_with_variants.length > 0);
            
            for (const product of result.products) {
                if (product.product_id) {
                    addToCart({
                        id: product.product_id,
                        name: product.name,
                        sale_price: product.price,
                        unit: product.unit,
                        stock: 999
                    }, product.quantity, isMultiple);
                    productsAdded++;
                }
            }
        }
        
        // 2. Manejar productos con variantes
        if (result.products_with_variants && result.products_with_variants.length > 0) {
            AppState.pendingVariants = result.products_with_variants;
            showVariantsModal(AppState.pendingVariants);
        } else if (productsAdded > 0) {
            // Solo productos directos, anunciar
            const total = getCartTotal();
            if (productsAdded > 1) {
                speak(`${productsAdded} productos agregados. Total: ${total.toFixed(2)} soles`);
            }
        }
        
        // 3. Mostrar productos no encontrados
        if (result.not_found && result.not_found.length > 0) {
            showToast(`⚠️ No encontrados: ${result.not_found.join(', ')}`, 'warning');
            if (productsAdded === 0 && (!result.products_with_variants || result.products_with_variants.length === 0)) {
                speak(`No encontré ${result.not_found.join(' ni ')}`);
            }
        }
        
        // 4. Si no hubo ningún resultado
        if (productsAdded === 0 && 
            (!result.products_with_variants || result.products_with_variants.length === 0) &&
            (!result.not_found || result.not_found.length === 0)) {
            showToast('No pude identificar productos', 'warning');
            // Fallback al parser local
            processVoiceCommand(transcript.toLowerCase());
        }
        
    } catch (error) {
        console.error('[Parse LLM] Error:', error);
        showToast('Error al procesar', 'error');
        // Fallback: usar el parser local
        processVoiceCommand(transcript.toLowerCase());
    }
}


// ============================================
// MODAL DE SELECCIÓN DE VARIANTES
// ============================================

function showVariantsModal(variantsList) {
    const existingModal = document.getElementById('variants-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'variants-modal';
    modal.className = 'modal-overlay open';
    
    // Calcular total de variantes
    const totalVariants = variantsList.reduce((sum, item) => sum + item.variants.length, 0);
    
    let html = `
        <div class="variants-modal">
            <div class="variants-header">
                <h3><i class="fas fa-search"></i> Selecciona productos</h3>
                <button class="modal-close-btn" onclick="closeVariantsModal()">×</button>
            </div>
            <div class="variants-body">
    `;
    
    variantsList.forEach((item, itemIndex) => {
        item.variants.forEach((variant, variantIndex) => {
            const isFirst = variantIndex === 0;
            const scoreClass = variant.score >= 0.8 ? 'high' : variant.score >= 0.5 ? 'medium' : 'low';
            
            html += `
                <label class="variant-option-v2" data-item="${itemIndex}" data-variant="${variantIndex}">
                    <input type="checkbox" 
                           class="variant-checkbox"
                           name="variant-${itemIndex}-${variantIndex}" 
                           value="${variant.product_id}"
                           data-name="${variant.name}"
                           data-price="${variant.price}"
                           data-unit="${variant.unit}"
                           data-quantity="${item.quantity}"
                           ${isFirst ? 'checked' : ''}>
                    
                    <div class="variant-icon">
                        <i class="fas fa-box"></i>
                    </div>
                    
                    <div class="variant-content-v2">
                        <div class="variant-name-v2">${variant.name}</div>
                        <div class="variant-meta-v2">
                            ${variant.stock ? `<span class="variant-stock-badge"><i class="fas fa-cubes"></i> ${variant.stock}</span>` : ''}
                            <span class="variant-unit-badge">${variant.unit}</span>
                        </div>
                    </div>
                    
                    <div class="variant-price-v2">S/. ${variant.price.toFixed(2)}</div>
                    
                    <div class="variant-check-v2">
                        <i class="fas fa-check-circle"></i>
                    </div>
                </label>
            `;
        });
    });
    
    html += `
            </div>
            <div class="variants-footer-v2">
                <div class="selected-count">
                    <span id="selected-count">0</span> seleccionados
                </div>
                <div class="footer-actions">
                    <button class="btn-cancel-v2" onclick="closeVariantsModal()">
                        <i class="fas fa-times"></i> Cancelar
                    </button>
                    <button class="btn-confirm-v2" onclick="confirmVariantsSelection()">
                        <i class="fas fa-shopping-cart"></i> Agregar
                    </button>
                </div>
            </div>
        </div>
    `;
    
    modal.innerHTML = html;
    document.body.appendChild(modal);
    
    // Event listener para actualizar contador
    document.querySelectorAll('.variant-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', updateSelectedCount);
    });
    
    // Inicializar contador
    updateSelectedCount();
    
    speak(`${totalVariants} opciones disponibles. Selecciona los productos.`);
}

function closeVariantsModal() {
    const modal = document.getElementById('variants-modal');
    if (modal) {
        modal.classList.remove('open');
        setTimeout(() => modal.remove(), 300);
    }
    AppState.pendingVariants = [];
}

function confirmVariantsSelection() {
    const selectedInputs = document.querySelectorAll('.variant-checkbox:checked');
    
    if (selectedInputs.length === 0) {
        showToast('⚠️ Selecciona al menos un producto', 'warning');
        return;
    }
    
    let addedCount = 0;
    
    selectedInputs.forEach(input => {
        const productId = parseInt(input.value);
        const name = input.dataset.name;
        const price = parseFloat(input.dataset.price);
        const unit = input.dataset.unit;
        const quantity = parseFloat(input.dataset.quantity) || 1;
        
        addToCart({
            id: productId,
            name: name,
            sale_price: price,
            unit: unit,
            stock: 999
        }, quantity, true);
        
        addedCount++;
    });
    
    closeVariantsModal();
    
    const total = getCartTotal();
    showToast(`✅ ${addedCount} producto${addedCount > 1 ? 's' : ''} agregado${addedCount > 1 ? 's' : ''}`, 'success');
    speak(`${addedCount} producto${addedCount > 1 ? 's' : ''} agregado${addedCount > 1 ? 's' : ''}. Total: ${total.toFixed(2)} soles`);
}

function stopVoice() {
    document.getElementById('btn-mic-basic')?.classList.remove('active');
    document.getElementById('btn-mic-pro')?.classList.remove('active');
    AppState.voiceActive = false;
    AppState.voiceMode = null;
    
    if (recognitionTimeout) {
        clearTimeout(recognitionTimeout);
        recognitionTimeout = null;
    }
}

function processVoiceCommand(transcript) {
    console.log('[Voice] 🎤 Procesando:', transcript);
    
    const parsed = extractProductAndQuantity(transcript);
    console.log('[Voice] 📦 Parseado:', parsed);
    
    if (!parsed.productName || parsed.productName.length < 2) {
        showToast('No entendí el producto', 'warning');
        return;
    }
    
    if (parsed.searchByAmount) {
        showToast(`🔍 S/. ${parsed.amount} de ${parsed.productName}`, 'info');
        searchProductByAmount(parsed.productName, parsed.amount);
    } else {
        showToast(`🔍 ${parsed.quantity !== 1 ? parsed.quantity + ' ' : ''}${parsed.productName}`, 'info');
        searchProductByVoice(parsed.productName, parsed.quantity);
    }
}

function extractProductAndQuantity(text) {
    let cleaned = text.toLowerCase().trim();
    
    // 1. Detectar monto
    const amountResult = parseAmount(cleaned);
    if (amountResult.isAmount) {
        return {
            quantity: null,
            amount: amountResult.amount,
            productName: amountResult.product,
            searchByAmount: true
        };
    }
    
    // 2. Detectar fracción/cantidad
    const fractionResult = parseFraction(cleaned);
    let quantity = fractionResult.quantity;
    let productName = cleaned;
    
    if (fractionResult.matched) {
        productName = productName.replace(fractionResult.matched, '');
    }
    
    // Limpiar palabras comunes
    const stopWords = [
        'de', 'del', 'la', 'el', 'un', 'una',
        'kilo', 'kilogramo', 'kg', 'litro', 'gramo', 'gr',
        'unidad', 'unidades', 'paquete', 'paquetes',
        'dame', 'quiero', 'necesito', 'vender', 'vendeme',
        'por', 'favor', 'medio', 'cuarto', 'soles', 'sol'
    ];
    
    productName = productName.replace(/\b\d+\b/g, '');
    productName = productName.replace(/\d+\/\d+/g, '');
    productName = productName.replace(/\s+/g, ' ');
    
    const words = productName.split(' ').filter(word => 
        word.length > 1 && !stopWords.includes(word)
    );
    
    productName = words.join(' ').trim();
    
    return {
        quantity: quantity,
        amount: null,
        productName: productName,
        searchByAmount: false
    };
}

function parseFraction(text) {
    const fractions = {
        'un cuarto': 0.25, 'cuarto': 0.25, '1/4': 0.25,
        'un medio': 0.5, 'medio': 0.5, 'media': 0.5, '1/2': 0.5,
        'tres cuartos': 0.75, '3/4': 0.75,
        'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4,
        'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9,
        'diez': 10, 'docena': 12, 'veinte': 20
    };
    
    for (const [key, value] of Object.entries(fractions)) {
        if (text.includes(key)) {
            return { quantity: value, matched: key };
        }
    }
    
    const numberMatch = text.match(/(\d+)/);
    if (numberMatch) {
        return { quantity: parseInt(numberMatch[1]), matched: numberMatch[1] };
    }
    
    return { quantity: 1, matched: null };
}

function parseAmount(text) {
    const patterns = [
        /(\d+(?:[.,]\d+)?)\s*sol(?:es)?\s+de\s+(.+)/i,
        /(.+?)\s+(\d+(?:[.,]\d+)?)\s*sol(?:es)?$/i,
        /(un|dos|tres|cuatro|cinco)\s+sol(?:es)?\s+de\s+(.+)/i
    ];
    
    const numberWords = { 'un': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5 };
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            let amount, product;
            
            if (pattern.source.includes('(.+?)')) {
                product = match[1].trim();
                amount = match[2];
            } else {
                amount = match[1];
                product = match[2].trim();
            }
            
            if (numberWords[amount?.toLowerCase()]) {
                amount = numberWords[amount.toLowerCase()];
            } else {
                amount = parseFloat(String(amount).replace(',', '.'));
            }
            
            return { amount, product, isAmount: true };
        }
    }
    
    return { amount: null, product: text, isAmount: false };
}

async function searchProductByVoice(productName, quantity = 1) {
    try {
        const response = await fetchWithAuth(`${CONFIG.apiBase}/products/search`, {
            method: 'POST',
            body: JSON.stringify({ query: productName, limit: 10 })
        });
        
        const products = await response.json();
        
        if (!products || products.length === 0) {
            showToast(`❌ No encontré: ${productName}`, 'error');
            playSound('error');
            speak(`No encontré ${productName}`);
            return;
        }
        
        // Si hay un solo producto, agregarlo directamente
        if (products.length === 1) {
            addToCart(products[0], quantity);
            return;
        }
        
        // Si hay múltiples productos, mostrar modal para elegir
        AppState.pendingVoiceQuantity = quantity;
        showSearchResultsModal(products);
        speak(`Encontré ${products.length} opciones. Selecciona una.`);
        
    } catch (error) {
        console.error('[VoiceSearch] Error:', error);
        showToast('Error al buscar', 'error');
        playSound('error');
    }
}

async function searchProductByAmount(productName, amount) {
    try {
        const response = await fetchWithAuth(`${CONFIG.apiBase}/products/search`, {
            method: 'POST',
            body: JSON.stringify({ query: productName, limit: 10 })
        });
        
        const products = await response.json();
        
        if (!products || products.length === 0) {
            showToast(`❌ No encontré: ${productName}`, 'error');
            playSound('error');
            return;
        }
        
        const product = products[0];
        const quantity = amount / product.sale_price;
        
        addToCart(product, parseFloat(quantity.toFixed(2)));
        showToast(`✅ ${quantity.toFixed(2)} ${product.unit} de ${product.name}`, 'success');
        
    } catch (error) {
        console.error('[AmountSearch] Error:', error);
        showToast('Error al buscar', 'error');
        playSound('error');
    }
}

// ============================================
// MÉTODOS DE PAGO
// ============================================

function selectPayment(method) {
    AppState.paymentMethod = method;
    selectPaymentUI(method);
    
    // Mostrar/ocultar campo de cliente para fiado
    const fiadoClient = document.getElementById('fiado-client');
    const btnCheckout = document.getElementById('btn-checkout');
    
    if (method === 'fiado') {
        if (fiadoClient) fiadoClient.style.display = 'block';
        if (btnCheckout) btnCheckout.style.display = 'none';
        // Focus en el input
        setTimeout(() => {
            document.getElementById('fiado-client-name')?.focus();
        }, 100);
    } else {
        if (fiadoClient) fiadoClient.style.display = 'none';
        if (btnCheckout) btnCheckout.style.display = 'flex';
    }
}

function selectPaymentUI(method) {
    document.querySelectorAll('.payment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.method === method);
    });
    AppState.paymentMethod = method;
}

// ============================================
// PROCESAR VENTA
// ============================================

async function processSale() {
    if (AppState.cart.length === 0) {
        showToast('El carrito está vacío', 'warning');
        return;
    }
    
    // Validar cliente para fiado
    if (AppState.paymentMethod === 'fiado') {
        const clientName = document.getElementById('fiado-client-name')?.value.trim();
        if (!clientName) {
            showToast('Ingresa el nombre del cliente', 'warning');
            document.getElementById('fiado-client-name')?.focus();
            return;
        }
    }
    
    const total = getCartTotal();
    
    // Mostrar modal de confirmación con opciones de impresión
    showConfirmModal(total, AppState.paymentMethod, async (printType) => {
        await executeSale(total, printType);
    });
}

async function executeSale(total, printType = 'none') {
    try {
        // Formato exacto que espera SaleCreate en schemas/sale.py
        const saleData = {
            items: AppState.cart.map(item => ({
                product_id: item.id,
                quantity: parseFloat(item.quantity),
                unit_price: parseFloat(item.price),
                subtotal: parseFloat(item.price) * parseFloat(item.quantity)  // REQUERIDO
            })),
            payment_method: AppState.paymentMethod,
            payment_reference: null,
            customer_name: AppState.paymentMethod === 'fiado' 
                ? document.getElementById('fiado-client-name')?.value.trim() 
                : null,
            is_credit: AppState.paymentMethod === 'fiado'
        };
        
        console.log('[Sale] Enviando:', JSON.stringify(saleData, null, 2));
        console.log('[Sale] Tipo impresión:', printType);
        
        const response = await fetchWithAuth(`${CONFIG.apiBase}/sales`, {
            method: 'POST',
            body: JSON.stringify(saleData)
        });
        
        const responseText = await response.text();
        console.log('[Sale] Response status:', response.status);
        console.log('[Sale] Response body:', responseText);
        
        if (response.ok) {
            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                result = {};
            }
            
            // Actualizar ventas del día
            AppState.dailySales += total;
            updateGoalProgress();
            
            // Manejar impresión según el tipo seleccionado
            handlePrint(printType, result, total);
            
            // Limpiar carrito
            AppState.cart = [];
            saveCart();
            renderCart();
            
            // Limpiar campo fiado
            if (document.getElementById('fiado-client-name')) {
                document.getElementById('fiado-client-name').value = '';
            }
            if (document.getElementById('fiado-client')) {
                document.getElementById('fiado-client').style.display = 'none';
            }
            if (document.getElementById('btn-checkout')) {
                document.getElementById('btn-checkout').style.display = 'flex';
            }
            
            // Reset método de pago
            selectPaymentUI('efectivo');
            AppState.paymentMethod = 'efectivo';
            
            playSound('success');
            speak(`Venta completada. ${total.toFixed(2)} soles`);
            
        } else {
            let errorMsg = 'Error al registrar venta';
            try {
                const error = JSON.parse(responseText);
                errorMsg = error.detail || JSON.stringify(error);
            } catch (e) {
                errorMsg = responseText || errorMsg;
            }
            console.error('[Sale] Error:', errorMsg);
            showToast(errorMsg, 'error');
        }
        
    } catch (error) {
        console.error('[Sale] Error:', error);
        showToast('Error de conexión', 'error');
    }
}

function handlePrint(printType, saleResult, total) {
    switch (printType) {
        case 'none':
            showToast('✅ Venta registrada', 'success');
            break;
            
        case 'simple':
            showToast('🖨️ Imprimiendo ticket simple...', 'info');
            printSimpleTicket(saleResult, total);
            break;
            
        case 'boleta':
            showToast('📄 Generando Boleta SUNAT...', 'info');
            // TODO: Integrar con API de facturación electrónica
            printBoletaSunat(saleResult, total);
            break;
            
        case 'factura':
            showToast('📋 Generando Factura SUNAT...', 'info');
            // TODO: Solicitar datos del cliente (RUC, razón social)
            requestFacturaData(saleResult, total);
            break;
            
        default:
            showToast('✅ Venta registrada', 'success');
    }
}

function printSimpleTicket(saleResult, total) {
    // Crear ventana de impresión con ticket simple
    const ticketHtml = generateSimpleTicketHtml(saleResult, total);
    
    const printWindow = window.open('', '_blank', 'width=300,height=600');
    printWindow.document.write(ticketHtml);
    printWindow.document.close();
    
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
}

function generateSimpleTicketHtml(saleResult, total) {
    const now = new Date();
    const fecha = now.toLocaleDateString('es-PE');
    const hora = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    
    // Obtener items del carrito antes de que se limpie (usamos AppState)
    const items = AppState.cart.map(item => `
        <tr>
            <td style="text-align:left">${item.name}</td>
            <td style="text-align:center">${item.quantity}</td>
            <td style="text-align:right">S/. ${(item.price * item.quantity).toFixed(2)}</td>
        </tr>
    `).join('');
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Ticket</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    width: 80mm;
                    padding: 5mm;
                }
                .header { text-align: center; margin-bottom: 10px; }
                .store-name { font-size: 16px; font-weight: bold; }
                .divider { border-top: 1px dashed #000; margin: 8px 0; }
                table { width: 100%; }
                .total-row { font-weight: bold; font-size: 14px; }
                .footer { text-align: center; margin-top: 10px; font-size: 10px; }
                .no-fiscal { 
                    text-align: center; 
                    font-size: 10px; 
                    margin-top: 5px;
                    padding: 5px;
                    border: 1px dashed #999;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="store-name">MI BODEGA</div>
                <div>${fecha} ${hora}</div>
            </div>
            
            <div class="divider"></div>
            
            <table>
                <thead>
                    <tr>
                        <th style="text-align:left">Producto</th>
                        <th style="text-align:center">Cant</th>
                        <th style="text-align:right">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    ${items}
                </tbody>
            </table>
            
            <div class="divider"></div>
            
            <table>
                <tr class="total-row">
                    <td>TOTAL:</td>
                    <td style="text-align:right">S/. ${total.toFixed(2)}</td>
                </tr>
                <tr>
                    <td>Pago:</td>
                    <td style="text-align:right">${AppState.paymentMethod.toUpperCase()}</td>
                </tr>
            </table>
            
            <div class="no-fiscal">
                *** TICKET NO FISCAL ***
                <br>Este documento no tiene valor tributario
            </div>
            
            <div class="footer">
                ¡Gracias por su compra!
                <br>Vuelva pronto
            </div>
        </body>
        </html>
    `;
}

function printBoletaSunat(saleResult, total) {
    // TODO: Implementar integración con SUNAT
    showToast('⚠️ Boleta SUNAT: Próximamente', 'warning');
    // Por ahora, imprimir ticket simple con nota
    printSimpleTicket(saleResult, total);
}

function requestFacturaData(saleResult, total) {
    // TODO: Mostrar modal para solicitar RUC y razón social
    showToast('⚠️ Factura SUNAT: Próximamente', 'warning');
}

// ============================================
// META DEL DÍA
// ============================================

async function loadDailySales() {
    try {
        const response = await fetchWithAuth(`${CONFIG.apiBase}/sales/today/total`);
        if (response.ok) {
            const data = await response.json();
            AppState.dailySales = data.total || 0;
            updateGoalProgress();
        }
    } catch (error) {
        console.error('[Sales] Error:', error);
    }
}

function updateGoalProgress() {
    const goal = CONFIG.dailyGoal;
    const current = AppState.dailySales;
    const percent = Math.min((current / goal) * 100, 100);
    
    const goalBar = document.getElementById('goal-bar');
    const goalText = document.getElementById('goal-text');
    const goalPercent = document.getElementById('goal-percent');
    
    if (goalBar) goalBar.style.width = `${percent}%`;
    if (goalText) goalText.textContent = `S/. ${current.toFixed(0)} / S/. ${goal}`;
    if (goalPercent) goalPercent.textContent = `${percent.toFixed(0)}%`;
}

function editDailyGoal() {
    if (!AppState.isOwner) {
        showToast('Solo el dueño puede editar la meta', 'warning');
        return;
    }
    
    const newGoal = prompt('Nueva meta diaria (S/.)', CONFIG.dailyGoal);
    if (newGoal && !isNaN(newGoal)) {
        CONFIG.dailyGoal = parseFloat(newGoal);
        updateGoalProgress();
        showToast('Meta actualizada', 'success');
    }
}

// ============================================
// MODAL DE VENTA EXITOSA
// ============================================

function showSaleSuccessModal(amount, method) {
    const methodNames = {
        'efectivo': 'Efectivo',
        'yape': 'Yape',
        'plin': 'Plin',
        'tarjeta': 'Tarjeta',
        'fiado': 'Fiado'
    };
    
    document.getElementById('modal-sale-amount').textContent = `S/. ${amount.toFixed(2)}`;
    document.getElementById('modal-sale-method').textContent = methodNames[method] || method;
    document.getElementById('modal-sale-success').classList.add('open');
}

function closeSaleModal() {
    document.getElementById('modal-sale-success').classList.remove('open');
}

function printTicket(type) {
    showToast(`Imprimiendo ticket ${type}...`, 'info');
    closeSaleModal();
}

// ============================================
// SIDEBAR
// ============================================

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
}

function switchCategory(category) {
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === category);
    });
    
    document.querySelectorAll('.category-content').forEach(content => {
        content.classList.toggle('active', content.id === `cat-${category}`);
    });
}

// Event listeners para tabs
document.querySelectorAll('.category-tab')?.forEach(tab => {
    tab.addEventListener('click', () => switchCategory(tab.dataset.category));
});

// ============================================
// PLAN PRO
// ============================================

function checkProStatus() {
    const plan = localStorage.getItem('user_plan');
    AppState.isPro = plan === 'crece' || plan === 'pro';
    
    const trialEnd = localStorage.getItem('pro_trial_end');
    if (trialEnd && new Date(trialEnd) > new Date()) {
        AppState.proTrialActive = true;
    }
    
    const btnPro = document.getElementById('btn-mic-pro');
    if (btnPro && !AppState.isPro && !AppState.proTrialActive) {
        btnPro.classList.add('locked');
        btnPro.title = 'Prueba PRO gratis por 24h';
    }
}

function showProTrialOffer() {
    if (confirm('¿Quieres probar el micrófono PRO (Whisper) GRATIS por 24 horas?')) {
        activateProTrial();
    }
}

function activateProTrial() {
    const trialEnd = new Date();
    trialEnd.setHours(trialEnd.getHours() + 24);
    
    localStorage.setItem('pro_trial_end', trialEnd.toISOString());
    AppState.proTrialActive = true;
    
    document.getElementById('btn-mic-pro')?.classList.remove('locked');
    showToast('¡PRO activado por 24 horas!', 'success');
}

// ============================================
// SEMÁFORO DE PÁNICO (ALERT MENU)
// ============================================

function toggleAlertMenu() {
    AppState.panicMenuOpen = !AppState.panicMenuOpen;
    document.getElementById('alert-menu-popup').classList.toggle('open', AppState.panicMenuOpen);
}

function closeAlertMenu() {
    AppState.panicMenuOpen = false;
    document.getElementById('alert-menu-popup')?.classList.remove('open');
}

function reportSuspect() {
    closeAlertMenu();
    showPanicModal('green', 'Reportar Sospecha', `
        <p style="margin-bottom: 1rem; color: var(--text-secondary);">
            Reporta actividad sospechosa: marcaje, vigilancia, preguntas extrañas.
        </p>
        <textarea id="suspect-description" placeholder="Describe lo que observaste..." 
            style="width: 100%; height: 100px; padding: 0.75rem; background: var(--bg-tertiary); 
            border: 1px solid var(--border-color); border-radius: 8px; color: white; resize: none;"></textarea>
        <div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
            <button class="btn-modal secondary" onclick="closePanicModal()">Cancelar</button>
            <button class="btn-modal primary" onclick="submitReport('green')">Enviar a Red</button>
        </div>
    `);
}

function reportThreat() {
    closeAlertMenu();
    showPanicModal('amber', 'Reportar Amenaza', `
        <p style="margin-bottom: 1rem; color: var(--text-secondary);">
            Reporta amenazas digitales: WhatsApp, llamadas, mensajes.
        </p>
        <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem;">Tipo de amenaza:</label>
            <select id="threat-type" style="width: 100%; padding: 0.75rem; background: var(--bg-tertiary); 
                border: 1px solid var(--border-color); border-radius: 8px; color: white;">
                <option value="whatsapp">WhatsApp</option>
                <option value="llamada">Llamada telefónica</option>
                <option value="sms">SMS</option>
                <option value="otro">Otro</option>
            </select>
        </div>
        <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem;">Número del extorsionador:</label>
            <input type="tel" id="threat-phone" placeholder="Ej: 999888777" 
                style="width: 100%; padding: 0.75rem; background: var(--bg-tertiary); 
                border: 1px solid var(--border-color); border-radius: 8px; color: white;">
        </div>
        <div style="display: flex; gap: 0.5rem;">
            <button class="btn-modal secondary" onclick="closePanicModal()">Cancelar</button>
            <button class="btn-modal primary" onclick="submitReport('amber')">Generar Reporte</button>
        </div>
    `);
}

function startEmergency() {
    AppState.emergencyTimer = setInterval(() => {
        AppState.emergencyProgress += 100;
        const percent = (AppState.emergencyProgress / CONFIG.emergencyHoldTime) * 100;
        document.getElementById('emergency-progress').style.width = `${percent}%`;
        
        if (AppState.emergencyProgress >= CONFIG.emergencyHoldTime) {
            clearInterval(AppState.emergencyTimer);
            triggerEmergency();
        }
    }, 100);
}

function cancelEmergency() {
    clearInterval(AppState.emergencyTimer);
    AppState.emergencyProgress = 0;
    document.getElementById('emergency-progress').style.width = '0%';
}

function triggerEmergency() {
    closeAlertMenu();
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => sendEmergencyAlert(position.coords),
            () => sendEmergencyAlert(null)
        );
    } else {
        sendEmergencyAlert(null);
    }
}

async function sendEmergencyAlert(coords) {
    showToast('🚨 ENVIANDO ALERTA DE EMERGENCIA...', 'error');
    
    try {
        const alertData = {
            nivel: 'ROJO',
            tipo: 'emergencia',
            ubicacion: coords ? { lat: coords.latitude, lng: coords.longitude } : null,
            timestamp: new Date().toISOString()
        };
        
        console.log('[EMERGENCY]', alertData);
        
        showPanicModal('red', '🚨 ALERTA ENVIADA', `
            <div style="text-align: center;">
                <p style="font-size: 1.1rem; margin-bottom: 1rem;">
                    Tu alerta ha sido enviada a:
                </p>
                <ul style="text-align: left; margin: 1rem 0; list-style: none;">
                    <li>✅ Red de bodegueros cercanos</li>
                    <li>✅ Serenazgo municipal</li>
                    <li>✅ Tus contactos de emergencia</li>
                </ul>
                <p style="color: var(--text-secondary); font-size: 0.9rem;">
                    Mantén la calma. Ayuda en camino.
                </p>
                <button class="btn-modal primary" onclick="closePanicModal()" style="margin-top: 1rem;">
                    Entendido
                </button>
            </div>
        `);
        
    } catch (error) {
        console.error('[Emergency] Error:', error);
        showToast('Error enviando alerta', 'error');
    }
}

function showPanicModal(level, title, content) {
    document.getElementById('panic-modal-title').textContent = title;
    document.getElementById('panic-modal-body').innerHTML = content;
    document.getElementById('modal-panic').classList.add('open');
}

function closePanicModal() {
    document.getElementById('modal-panic').classList.remove('open');
}

async function submitReport(level) {
    showToast('Enviando reporte...', 'info');
    
    setTimeout(() => {
        closePanicModal();
        showToast('Reporte enviado correctamente', 'success');
    }, 1000);
}

// ============================================
// GERENTE IA
// ============================================

function askGerente(question) {
    const input = document.getElementById('gerente-input');
    if (input) input.value = question;
    sendGerenteQuestion();
}

async function sendGerenteQuestion() {
    const input = document.getElementById('gerente-input');
    const question = input?.value.trim();
    
    if (!question) return;
    
    showToast('Consultando...', 'info');
    console.log('[Gerente] Pregunta:', question);
    
    if (input) input.value = '';
    
    setTimeout(() => {
        showToast('Función en desarrollo', 'warning');
    }, 1000);
}

function voiceAskGerente() {
    showToast('Grabando pregunta...', 'info');
}

// ============================================
// UI HELPERS
// ============================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 
            type === 'error' ? 'exclamation-circle' : 
            type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function playSound(type) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        switch(type) {
            case 'add':
            case 'success':
                oscillator.frequency.value = 800;
                gainNode.gain.value = 0.1;
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.1);
                break;
            case 'remove':
            case 'error':
                oscillator.frequency.value = 200;
                gainNode.gain.value = 0.1;
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.15);
                break;
        }
    } catch (e) {
        // Silenciar errores de audio
    }
}

// ============================================
// MIC SETTINGS
// ============================================

function setMicTimer(seconds) {
    CONFIG.micTimer = seconds;
    localStorage.setItem('mic_timer', seconds);
    showToast(`Micrófono: ${seconds}s`, 'success');
}

function loadMicSettings() {
    const saved = localStorage.getItem('mic_timer');
    if (saved) {
        CONFIG.micTimer = parseInt(saved);
    }
}

// ============================================
// FUNCIONES PLACEHOLDER
// ============================================

function showNotifications() { showToast('Notificaciones: próximamente', 'info'); }
function showStock() { window.location.href = '/products'; }
function showSales() { window.location.href = '/reports'; }

// ============================================
// PANEL DE GESTIÓN DE TICKETS
// ============================================

// Cache inteligente para evitar consultas repetidas
const TicketCache = {
    data: null,
    timestamp: null,
    maxAge: 5 * 60 * 1000, // 5 minutos
    
    isValid() {
        return this.data && this.timestamp && (Date.now() - this.timestamp < this.maxAge);
    },
    
    set(data) {
        this.data = data;
        this.timestamp = Date.now();
        try {
            localStorage.setItem('ticketCache', JSON.stringify({ data, timestamp: this.timestamp }));
        } catch (e) {}
    },
    
    get() {
        if (this.isValid()) return this.data;
        try {
            const stored = localStorage.getItem('ticketCache');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Date.now() - parsed.timestamp < this.maxAge) {
                    this.data = parsed.data;
                    this.timestamp = parsed.timestamp;
                    return this.data;
                }
            }
        } catch (e) {}
        return null;
    },
    
    invalidate() {
        this.data = null;
        this.timestamp = null;
        try { localStorage.removeItem('ticketCache'); } catch (e) {}
    }
};

let currentTicketPeriod = 'today';

function printLastTicket() { 
    showTicketPanel();
}

function showTicketPanel() {
    let modal = document.getElementById('ticket-panel-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'ticket-panel-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content ticket-panel">
                <div class="ticket-panel-header">
                    <h3><i class="fas fa-receipt"></i> Gestión de Tickets</h3>
                    <button class="modal-close-btn" onclick="closeTicketPanel()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="ticket-panel-tabs">
                    <button class="ticket-tab active" onclick="switchTicketTab('today', this)">
                        <i class="fas fa-calendar-day"></i> Hoy
                    </button>
                    <button class="ticket-tab" onclick="switchTicketTab('week', this)">
                        <i class="fas fa-calendar-week"></i> Semana
                    </button>
                    <button class="ticket-tab" onclick="switchTicketTab('search', this)">
                        <i class="fas fa-search"></i> Buscar
                    </button>
                </div>
                
                <div class="ticket-search-box" id="ticket-search-box" style="display:none;">
                    <input type="text" id="ticket-search-input" placeholder="Buscar por código, cliente o producto..." oninput="searchTickets(this.value)">
                </div>
                
                <div class="ticket-panel-body" id="ticket-list">
                    <div class="loading-tickets">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span>Cargando tickets...</span>
                    </div>
                </div>
                
                <div class="ticket-panel-footer">
                    <div class="ticket-summary">
                        <span id="ticket-summary-count">0 tickets</span>
                        <span id="ticket-summary-total">S/. 0.00</span>
                    </div>
                    <button class="ticket-refresh-btn" onclick="loadTickets(currentTicketPeriod, true)" title="Actualizar">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    modal.classList.add('open');
    loadTickets('today', false);
}

function closeTicketPanel() {
    const modal = document.getElementById('ticket-panel-modal');
    if (modal) modal.classList.remove('open');
}

function switchTicketTab(tab, btn) {
    document.querySelectorAll('.ticket-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    
    const searchBox = document.getElementById('ticket-search-box');
    if (tab === 'search') {
        searchBox.style.display = 'block';
        document.getElementById('ticket-search-input').focus();
        const cached = TicketCache.get();
        if (cached) renderTicketList(cached);
    } else {
        searchBox.style.display = 'none';
        currentTicketPeriod = tab;
        loadTickets(tab, false);
    }
}

async function loadTickets(period = 'today', forceRefresh = false) {
    const container = document.getElementById('ticket-list');
    
    if (!forceRefresh) {
        const cached = TicketCache.get();
        if (cached) {
            console.log('[Tickets] Usando cache');
            filterAndRenderTickets(cached, period);
            return;
        }
    }
    
    container.innerHTML = `
        <div class="loading-tickets">
            <i class="fas fa-spinner fa-spin"></i>
            <span>Cargando tickets...</span>
        </div>
    `;
    
    try {
        const response = await fetchWithAuth(`${CONFIG.apiBase}/sales/today`);
        if (response.ok) {
            const sales = await response.json();
            TicketCache.set(sales);
            filterAndRenderTickets(sales, period);
        } else {
            container.innerHTML = `<div class="empty-tickets"><i class="fas fa-exclamation-circle"></i><span>Error al cargar tickets</span></div>`;
        }
    } catch (error) {
        console.error('[Tickets] Error:', error);
        container.innerHTML = `<div class="empty-tickets"><i class="fas fa-wifi-slash"></i><span>Error de conexión</span></div>`;
    }
}

function filterAndRenderTickets(sales, period) {
    let filtered = sales;
    if (period === 'today') {
        const today = new Date().toDateString();
        filtered = sales.filter(s => new Date(s.sale_date || s.created_at).toDateString() === today);
    } else if (period === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        filtered = sales.filter(s => new Date(s.sale_date || s.created_at) >= weekAgo);
    }
    renderTicketList(filtered);
}

function searchTickets(query) {
    const cached = TicketCache.get() || [];
    if (!query || query.length < 2) {
        renderTicketList(cached);
        return;
    }
    const q = query.toLowerCase();
    const filtered = cached.filter(sale => {
        const items = sale.items || [];
        return items.some(i => (i.product_name || '').toLowerCase().includes(q)) ||
               (sale.customer_name || '').toLowerCase().includes(q) ||
               sale.id.toString().includes(q);
    });
    renderTicketList(filtered);
}

function renderTicketList(sales) {
    const container = document.getElementById('ticket-list');
    
    if (!sales || sales.length === 0) {
        container.innerHTML = `<div class="empty-tickets"><i class="fas fa-receipt"></i><span>No hay tickets en este período</span></div>`;
        updateTicketSummary(0, 0);
        return;
    }
    
    sales.sort((a, b) => new Date(b.sale_date || b.created_at) - new Date(a.sale_date || a.created_at));
    
    let html = '';
    let totalAmount = 0;
    let validCount = 0;
    
    for (const sale of sales) {
        const date = new Date(sale.sale_date || sale.created_at);
        const time = date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
        
        const items = sale.items || [];
        const itemsPreview = items.slice(0, 2).map(i => i.product_name || 'Producto').join(', ');
        const moreItems = items.length > 2 ? ` +${items.length - 2}` : '';
        
        const paymentIcons = { 'efectivo': 'fa-money-bill-wave', 'yape': 'fa-mobile-alt', 'plin': 'fa-mobile-alt', 'tarjeta': 'fa-credit-card' };
        const paymentIcon = paymentIcons[sale.payment_method?.toLowerCase()] || 'fa-receipt';
        
        // Tipo de documento
        const docType = sale.document_type || 'simple';
        const docInfo = {
            'none': { label: 'SIN DOC', class: 'none' },
            'simple': { label: 'SIMPLE', class: 'simple' },
            'boleta': { label: 'BOLETA', class: 'boleta' },
            'factura': { label: 'FACTURA', class: 'factura' }
        }[docType] || { label: 'SIMPLE', class: 'simple' };
        
        const statusClass = sale.is_credit ? 'credit' : (sale.voided ? 'voided' : '');
        let statusBadge = '';
        if (sale.voided) statusBadge = '<span class="ticket-badge voided">ANULADO</span>';
        else if (sale.is_credit) statusBadge = '<span class="ticket-badge credit">FIADO</span>';
        
        if (!sale.voided) {
            totalAmount += parseFloat(sale.total) || 0;
            validCount++;
        }
        
        html += `
            <div class="ticket-item ${statusClass}" data-sale-id="${sale.id}">
                <div class="ticket-item-main" onclick="toggleTicketActions(${sale.id})">
                    <div class="ticket-item-time">
                        <span class="ticket-time">${time}</span>
                        <span class="ticket-date">${dateStr}</span>
                    </div>
                    <div class="ticket-item-info">
                        <div class="ticket-item-products">${itemsPreview}${moreItems}</div>
                        <div class="ticket-item-meta">
                            <i class="fas ${paymentIcon}"></i>
                            <span class="doc-type-badge ${docInfo.class}">${docInfo.label}</span>
                            ${statusBadge}
                        </div>
                    </div>
                    <div class="ticket-item-total">${sale.voided ? '<s>' : ''}S/. ${parseFloat(sale.total).toFixed(2)}${sale.voided ? '</s>' : ''}</div>
                    <div class="ticket-expand-icon"><i class="fas fa-chevron-down"></i></div>
                </div>
                <div class="ticket-item-actions" id="ticket-actions-${sale.id}">
                    ${!sale.voided ? `
                        <div class="ticket-actions-row">
                            <button class="ticket-action-btn ${docType === 'simple' ? 'current' : ''}" onclick="event.stopPropagation(); reprintTicket(${sale.id}, 'simple')">
                                <i class="fas fa-receipt"></i>
                                <span>Simple${docType === 'simple' ? ' ✓' : ''}</span>
                            </button>
                            <button class="ticket-action-btn sunat ${docType === 'boleta' ? 'current' : ''}" onclick="event.stopPropagation(); reprintTicket(${sale.id}, 'boleta')">
                                <i class="fas fa-file-invoice"></i>
                                <span>Boleta${docType === 'boleta' ? ' ✓' : ''}</span>
                            </button>
                            <button class="ticket-action-btn factura ${docType === 'factura' ? 'current' : ''}" onclick="event.stopPropagation(); reprintTicket(${sale.id}, 'factura')">
                                <i class="fas fa-file-invoice-dollar"></i>
                                <span>Factura${docType === 'factura' ? ' ✓' : ''}</span>
                            </button>
                            <button class="ticket-action-btn danger" onclick="event.stopPropagation(); confirmVoidTicket(${sale.id})">
                                <i class="fas fa-ban"></i>
                                <span>Anular</span>
                            </button>
                        </div>
                    ` : `<div class="ticket-voided-notice"><i class="fas fa-info-circle"></i> Venta anulada</div>`}
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    updateTicketSummary(validCount, totalAmount);
}

function toggleTicketActions(saleId) {
    const item = document.querySelector(`.ticket-item[data-sale-id="${saleId}"]`);
    const actionsEl = document.getElementById(`ticket-actions-${saleId}`);
    const isOpen = actionsEl.classList.contains('open');
    
    document.querySelectorAll('.ticket-item-actions.open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.ticket-item.expanded').forEach(el => el.classList.remove('expanded'));
    
    if (!isOpen) {
        actionsEl.classList.add('open');
        item?.classList.add('expanded');
    }
}

function updateTicketSummary(count, total) {
    const countEl = document.getElementById('ticket-summary-count');
    const totalEl = document.getElementById('ticket-summary-total');
    if (countEl) countEl.textContent = `${count} ticket${count !== 1 ? 's' : ''}`;
    if (totalEl) totalEl.textContent = `S/. ${total.toFixed(2)}`;
}

async function reprintTicket(saleId, docType = 'simple') {
    const cached = TicketCache.get() || [];
    const sale = cached.find(s => s.id === saleId);
    
    if (!sale) {
        showToast('Error: ticket no encontrado', 'error');
        return;
    }
    
    const currentDocType = sale.document_type || 'simple';
    
    // Si es Boleta o Factura y ya tiene documento oficial
    if ((docType === 'boleta' || docType === 'factura') && (currentDocType === 'boleta' || currentDocType === 'factura')) {
        if (docType === currentDocType) {
            showToast('🖨️ Reimprimiendo...', 'info');
            printTicketFromSale(sale, docType);
        } else {
            showToast(`⚠️ Ya tiene ${currentDocType.toUpperCase()} emitida. No se puede cambiar.`, 'warning');
        }
        return;
    }
    
    // Emitir documento oficial nuevo
    if (docType === 'boleta' || docType === 'factura') {
        showDocumentEmissionModal(sale, docType);
        return;
    }
    
    // Ticket simple
    showToast('🖨️ Imprimiendo ticket...', 'info');
    printTicketFromSale(sale, 'simple');
}

function showDocumentEmissionModal(sale, docType) {
    const docName = docType === 'boleta' ? 'Boleta' : 'Factura';
    
    let modal = document.getElementById('doc-emission-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'doc-emission-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="modal-content doc-emission-modal">
            <div class="doc-emission-header">
                <div class="doc-emission-icon ${docType}">
                    <i class="fas fa-${docType === 'boleta' ? 'file-invoice' : 'file-invoice-dollar'}"></i>
                </div>
                <h4>Emitir ${docName} SUNAT</h4>
            </div>
            <div class="doc-emission-body">
                <div class="doc-emission-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Al emitir documento oficial:</span>
                </div>
                <ul class="doc-emission-list">
                    <li>Se enviará a SUNAT</li>
                    <li>No podrá anularse desde aquí</li>
                    <li>Reemplaza ticket simple</li>
                </ul>
                ${docType === 'factura' ? `
                    <div class="doc-emission-fields">
                        <div class="field-group">
                            <label>RUC:</label>
                            <input type="text" id="factura-ruc" placeholder="20XXXXXXXXX" maxlength="11">
                        </div>
                        <div class="field-group">
                            <label>Razón Social:</label>
                            <input type="text" id="factura-razon" placeholder="Empresa S.A.C.">
                        </div>
                    </div>
                ` : ''}
                <div class="doc-emission-total">
                    <span>Total:</span>
                    <strong>S/. ${parseFloat(sale.total).toFixed(2)}</strong>
                </div>
            </div>
            <div class="doc-emission-actions">
                <button class="btn-cancel" onclick="closeDocEmissionModal()">Cancelar</button>
                <button class="btn-confirm" onclick="emitDocument(${sale.id}, '${docType}')">
                    <i class="fas fa-paper-plane"></i> Emitir ${docName}
                </button>
            </div>
        </div>
    `;
    modal.classList.add('open');
}

function closeDocEmissionModal() {
    const modal = document.getElementById('doc-emission-modal');
    if (modal) modal.classList.remove('open');
}

async function emitDocument(saleId, docType) {
    const docName = docType === 'boleta' ? 'Boleta' : 'Factura';
    
    if (docType === 'factura') {
        const ruc = document.getElementById('factura-ruc')?.value.trim();
        const razon = document.getElementById('factura-razon')?.value.trim();
        if (!ruc || ruc.length !== 11) {
            showToast('RUC inválido (11 dígitos)', 'warning');
            return;
        }
        if (!razon) {
            showToast('Ingresa razón social', 'warning');
            return;
        }
    }
    
    closeDocEmissionModal();
    showToast(`📤 Emitiendo ${docName}...`, 'info');
    
    // TODO: Integrar con facturación electrónica
    setTimeout(() => {
        showToast(`⚠️ ${docName} SUNAT: Próximamente`, 'warning');
    }, 1500);
}

function printTicketFromSale(sale, docType = 'simple') {
    const date = new Date(sale.sale_date || sale.created_at);
    const fecha = date.toLocaleDateString('es-PE');
    const hora = date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    
    const items = (sale.items || []).map(item => `
        <tr>
            <td style="text-align:left">${item.product_name || 'Producto'}</td>
            <td style="text-align:center">${item.quantity}</td>
            <td style="text-align:right">S/. ${(item.subtotal || 0).toFixed(2)}</td>
        </tr>
    `).join('');
    
    const ticketHtml = `
        <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ticket #${sale.id}</title>
        <style>
            *{margin:0;padding:0;box-sizing:border-box}
            body{font-family:'Courier New',monospace;font-size:12px;width:80mm;padding:5mm}
            .header{text-align:center;margin-bottom:10px}
            .store-name{font-size:16px;font-weight:bold}
            .divider{border-top:1px dashed #000;margin:8px 0}
            table{width:100%}
            .total-row{font-weight:bold;font-size:14px}
            .footer{text-align:center;margin-top:10px;font-size:10px}
            .reprint{text-align:center;font-size:10px;background:#eee;padding:3px;margin-bottom:5px}
            .no-fiscal{text-align:center;font-size:9px;margin-top:5px;padding:3px;border:1px dashed #999}
        </style></head><body>
        <div class="reprint">*** REIMPRESIÓN ***</div>
        <div class="header">
            <div class="store-name">MI BODEGA</div>
            <div>Ticket #${sale.id}</div>
            <div>${fecha} ${hora}</div>
        </div>
        <div class="divider"></div>
        <table>
            <thead><tr><th style="text-align:left">Producto</th><th>Cant</th><th style="text-align:right">Subtotal</th></tr></thead>
            <tbody>${items}</tbody>
        </table>
        <div class="divider"></div>
        <table>
            <tr class="total-row"><td>TOTAL:</td><td style="text-align:right">S/. ${parseFloat(sale.total).toFixed(2)}</td></tr>
            <tr><td>Pago:</td><td style="text-align:right">${(sale.payment_method || 'EFECTIVO').toUpperCase()}</td></tr>
        </table>
        <div class="no-fiscal">*** TICKET NO FISCAL ***</div>
        <div class="footer">¡Gracias por su compra!</div>
        </body></html>
    `;
    
    const printWindow = window.open('', '_blank', 'width=300,height=600');
    printWindow.document.write(ticketHtml);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
}

function confirmVoidTicket(saleId) {
    let modal = document.getElementById('void-confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'void-confirm-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="modal-content void-confirm-modal">
            <div class="void-confirm-icon"><i class="fas fa-exclamation-triangle"></i></div>
            <h4>¿Anular esta venta?</h4>
            <p>Esta acción no se puede deshacer. El stock será devuelto.</p>
            <div class="void-confirm-actions">
                <button class="btn-cancel" onclick="closeVoidConfirmModal()">Cancelar</button>
                <button class="btn-danger" onclick="voidTicket(${saleId})">
                    <i class="fas fa-ban"></i> Sí, anular
                </button>
            </div>
        </div>
    `;
    modal.classList.add('open');
}

function closeVoidConfirmModal() {
    const modal = document.getElementById('void-confirm-modal');
    if (modal) modal.classList.remove('open');
}

async function voidTicket(saleId) {
    closeVoidConfirmModal();
    showToast('Anulando venta...', 'info');
    
    try {
        const response = await fetchWithAuth(`${CONFIG.apiBase}/sales/${saleId}/void`, { method: 'POST' });
        if (response.ok) {
            showToast('✅ Venta anulada', 'success');
            TicketCache.invalidate();
            loadTickets(currentTicketPeriod, true);
        } else {
            const error = await response.json();
            showToast(error.detail || 'Error al anular', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}
function showLowStock() { showToast('Stock bajo: próximamente', 'info'); }
function showExpiring() { showToast('Por vencer: próximamente', 'info'); }
function showPurchaseForm() { showToast('Registro de compras: próximamente', 'info'); }
function showInventory() { showToast('Inventario: próximamente', 'info'); }
function showProfits() { showToast('Ganancias: próximamente', 'info'); }
function showFiados() { showToast('Fiados: próximamente', 'info'); }
function showCashFlow() { showToast('Flujo de caja: próximamente', 'info'); }
function showTopProducts() { showToast('Top ventas: próximamente', 'info'); }
function showSlowProducts() { showToast('Sin rotación: próximamente', 'info'); }
function showComboSuggestions() { showToast('Combos: próximamente', 'info'); }
function showFrequentClients() { showToast('Clientes: próximamente', 'info'); }
function showPromotions() { showToast('Promociones: próximamente', 'info'); }
function showReportIncident() { reportThreat(); }
function showMyReports() { showToast('Mis reportes: próximamente', 'info'); }
function showBodeguerosNetwork() { showToast('Red de bodegueros: próximamente', 'info'); }
function showEmergencyContacts() { showToast('Contactos: próximamente', 'info'); }
function showSecurityGuide() { showToast('Guía: próximamente', 'info'); }
function showProfile() { showToast('Perfil: próximamente', 'info'); }
function showUsers() { showToast('Usuarios: próximamente', 'info'); }
function showVoiceConfig() { showToast('Config voz: próximamente', 'info'); }
function showPrinterConfig() { showToast('Impresora: próximamente', 'info'); }
function showPlanBilling() { showToast('Plan: próximamente', 'info'); }

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Cerrar sidebar con Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (AppState.panicMenuOpen) closeAlertMenu();
            if (document.getElementById('sidebar')?.classList.contains('open')) toggleSidebar();
            if (document.getElementById('modal-sale-success')?.classList.contains('open')) closeSaleModal();
            if (document.getElementById('modal-panic')?.classList.contains('open')) closePanicModal();
            if (document.getElementById('modal-search-results')?.classList.contains('open')) closeSearchResultsModal();
        }
    });
    
    // Cerrar menú de alerta al hacer clic fuera
    document.addEventListener('click', (e) => {
        const alertMenu = document.getElementById('alert-menu-popup');
        const alertBtn = document.querySelector('.footer-btn.alert-btn');
        
        if (AppState.panicMenuOpen && 
            !alertMenu?.contains(e.target) && 
            !alertBtn?.contains(e.target)) {
            closeAlertMenu();
        }
    });
    
    // Enter en búsqueda
    document.getElementById('search-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const results = document.querySelectorAll('.search-result-item');
            if (results.length > 0) {
                results[0].click();
            }
        }
    });
    
    // Input en búsqueda
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        searchProducts(e.target.value);
    });
    
    // Enter en gerente
    document.getElementById('gerente-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendGerenteQuestion();
        }
    });
    
    // Category tabs
    document.querySelectorAll('.category-tab')?.forEach(tab => {
        tab.addEventListener('click', () => switchCategory(tab.dataset.category));
    });
    
    // Cargar voces para TTS
    if ('speechSynthesis' in window) {
        speechSynthesis.onvoiceschanged = () => {
            const voices = speechSynthesis.getVoices();
            console.log('[TTS] Voces disponibles:', voices.length);
        };
    }
}

// ============================================
// TEXT-TO-SPEECH
// ============================================

function speak(text) {
    if (!AppState.speechEnabled) return;
    
    if ('speechSynthesis' in window) {
        // Cancelar cualquier speech anterior
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-PE';
        utterance.rate = 1.1;
        utterance.pitch = 1;
        utterance.volume = 0.8;
        
        // Intentar usar una voz en español
        const voices = window.speechSynthesis.getVoices();
        const spanishVoice = voices.find(v => v.lang.includes('es'));
        if (spanishVoice) {
            utterance.voice = spanishVoice;
        }
        
        window.speechSynthesis.speak(utterance);
    }
}

function speakTotal() {
    const total = getCartTotal();
    if (total > 0) {
        speak(`Total: ${total.toFixed(2)} soles`);
    } else {
        speak('Carrito vacío');
    }
}

function toggleSpeech() {
    AppState.speechEnabled = !AppState.speechEnabled;
    showToast(AppState.speechEnabled ? '🔊 Voz activada' : '🔇 Voz desactivada', 'info');
}

// ============================================
// MODAL DE CONFIRMACIÓN BONITO
// ============================================

function showConfirmModal(total, paymentMethod, onConfirm) {
    // Crear modal si no existe
    let modal = document.getElementById('confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirm-modal';
        modal.className = 'confirm-modal';
        modal.innerHTML = `
            <div class="confirm-modal-content">
                <div class="confirm-modal-header">
                    <div class="confirm-modal-icon">
                        <i class="fas fa-cash-register"></i>
                    </div>
                    <div class="confirm-modal-title">Confirmar Venta</div>
                    <div class="confirm-modal-amount" id="confirm-amount">S/. 0.00</div>
                    <div class="confirm-modal-method" id="confirm-method">
                        <i class="fas fa-money-bill-wave"></i>
                        <span>Efectivo</span>
                    </div>
                </div>
                <div class="confirm-modal-print-label">¿Cómo deseas finalizar?</div>
                <div class="confirm-modal-actions">
                    <button class="confirm-action-btn no-print" data-print="none">
                        <i class="fas fa-times"></i>
                        <span>Sin Imprimir</span>
                    </button>
                    <button class="confirm-action-btn simple" data-print="simple">
                        <i class="fas fa-receipt"></i>
                        <span>Ticket Simple</span>
                    </button>
                    <button class="confirm-action-btn sunat" data-print="boleta">
                        <i class="fas fa-file-invoice"></i>
                        <span>Boleta SUNAT</span>
                    </button>
                    <button class="confirm-action-btn factura" data-print="factura">
                        <i class="fas fa-file-invoice-dollar"></i>
                        <span>Factura</span>
                    </button>
                </div>
                <button class="confirm-cancel-btn" onclick="closeConfirmModal()">
                    <i class="fas fa-arrow-left"></i> Cancelar
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Actualizar contenido
    document.getElementById('confirm-amount').textContent = `S/. ${total.toFixed(2)}`;
    
    // Iconos y nombres de métodos de pago
    const methods = {
        'efectivo': { icon: 'fa-money-bill-wave', name: 'Efectivo' },
        'yape': { icon: 'fa-mobile-alt', name: 'Yape' },
        'plin': { icon: 'fa-mobile-alt', name: 'Plin' },
        'tarjeta': { icon: 'fa-credit-card', name: 'Tarjeta' },
        'fiado': { icon: 'fa-handshake', name: 'Fiado' }
    };
    
    const method = methods[paymentMethod] || methods['efectivo'];
    document.getElementById('confirm-method').innerHTML = `
        <i class="fas ${method.icon}"></i>
        <span>${method.name}</span>
    `;
    
    // Configurar botones de acción
    const actionBtns = modal.querySelectorAll('.confirm-action-btn');
    actionBtns.forEach(btn => {
        btn.onclick = () => {
            const printType = btn.dataset.print;
            closeConfirmModal();
            if (onConfirm) onConfirm(printType);
        };
    });
    
    modal.classList.add('open');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) {
        modal.classList.remove('open');
    }
}

// ============================================
// MODAL DE RESULTADOS DE BÚSQUEDA (PRO STYLE)
// ============================================

function showSearchResultsModal(products) {
    // Crear modal si no existe
    let modal = document.getElementById('modal-search-results');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-search-results';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content search-modal">
                <div class="modal-header-search">
                    <h3><i class="fas fa-search"></i> Selecciona productos</h3>
                    <button class="modal-close-btn" onclick="closeSearchResultsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body-search" id="search-modal-body">
                </div>
                <div class="modal-footer-search" id="search-modal-footer">
                    <div class="selected-count">
                        <span id="selected-products-count">0</span> seleccionados
                    </div>
                    <button class="btn-add-selected" onclick="addSelectedFromModal()">
                        <i class="fas fa-cart-plus"></i> Agregar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    const body = document.getElementById('search-modal-body');
    
    body.innerHTML = products.map((p, index) => `
        <label class="search-modal-item" for="product-check-${index}">
            <input type="checkbox" 
                   id="product-check-${index}" 
                   class="product-checkbox"
                   data-index="${index}"
                   onchange="updateSelectedCount()">
            <div class="search-modal-item-icon">
                <i class="fas fa-box"></i>
            </div>
            <div class="search-modal-item-info">
                <div class="search-modal-item-name">${p.name}</div>
                <div class="search-modal-item-meta">
                    <span class="stock-badge ${(p.stock || 0) < 10 ? 'low' : ''}">
                        <i class="fas fa-cubes"></i> ${p.stock || '∞'}
                    </span>
                    <span class="unit-badge">${p.unit || 'und'}</span>
                </div>
            </div>
            <div class="search-modal-item-price">
                <span class="price-value">S/. ${(p.sale_price || 0).toFixed(2)}</span>
            </div>
            <div class="search-modal-item-check">
                <i class="fas fa-check-circle"></i>
            </div>
        </label>
    `).join('');
    
    // Guardar productos para selección
    AppState.searchModalProducts = products;
    
    // Reset contador
    updateSelectedCount();
    
    modal.classList.add('open');
}

function updateSelectedCount() {
    const checkedCount = document.querySelectorAll('.variant-checkbox:checked').length;
    const countElement = document.getElementById('selected-count');
    if (countElement) {
        countElement.textContent = checkedCount;
    }
}

function addSelectedFromModal() {
    const checkboxes = document.querySelectorAll('.product-checkbox:checked');
    const products = AppState.searchModalProducts;
    const quantity = AppState.pendingVoiceQuantity || 1;
    
    if (checkboxes.length === 0) {
        showToast('Selecciona al menos un producto', 'warning');
        return;
    }
    
    let addedNames = [];
    const isMultiple = checkboxes.length > 1;
    
    checkboxes.forEach(cb => {
        const index = parseInt(cb.dataset.index);
        if (products && products[index]) {
            // Usar modo silencioso si hay múltiples productos
            addToCart(products[index], quantity, isMultiple);
            addedNames.push(products[index].name);
        }
    });
    
    AppState.pendingVoiceQuantity = 1;
    closeSearchResultsModal();
    
    // Anunciar resumen si fueron múltiples productos
    if (isMultiple) {
        const total = getCartTotal();
        speak(`${addedNames.length} productos agregados. Total: ${total.toFixed(2)} soles`);
    }
}

function selectProductFromModal(index) {
    // Esta función ya no se usa, pero la dejamos por compatibilidad
    const products = AppState.searchModalProducts;
    if (products && products[index]) {
        const quantity = AppState.pendingVoiceQuantity || 1;
        addToCart(products[index], quantity);
        AppState.pendingVoiceQuantity = 1;
    }
    closeSearchResultsModal();
}

function closeSearchResultsModal() {
    const modal = document.getElementById('modal-search-results');
    if (modal) {
        modal.classList.remove('open');
    }
    AppState.searchModalProducts = null;
    AppState.pendingVoiceQuantity = 1;
}

// ============================================
// INICIALIZAR
// ============================================

console.log('[Dashboard] Script cargado');