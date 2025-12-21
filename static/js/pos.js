// ============================================
// SISTEMA DE ROTACIÓN DE APIs
// ============================================

const LLM_APIS = ['claude', 'openai', 'gemini'];
let currentAPI = null;
let sessionId = null;

function initLLMSession() {
    // Generar session ID
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Asignar API aleatoria para esta sesión
    currentAPI = LLM_APIS[Math.floor(Math.random() * LLM_APIS.length)];
    
    console.log(`[LLM] Session: ${sessionId}, API: ${currentAPI}`);
    
    // Guardar en localStorage para referencia
    localStorage.setItem('llm_session_id', sessionId);
    localStorage.setItem('llm_current_api', currentAPI);
    
    // Mostrar en UI
    updateAPIIndicator();
}

function updateAPIIndicator() {
    const indicator = document.getElementById('api-indicator');
    if (indicator && currentAPI) {
        const labels = {
            'claude': '🤖 Claude',
            'openai': '🤖 OpenAI',
            'gemini': '🤖 Gemini'
        };
        indicator.textContent = labels[currentAPI];
        indicator.className = `api-badge api-${currentAPI}`;
    }
}

// ============================================
// CONFIGURACIÓN Y CONSTANTES
// ============================================

const CONFIG = {
    micTimer: 10,
    dailyGoal: 500,
    lowStockThreshold: 10,
    expiringDays: 30,
    maxRecentProducts: 8, // ⬅️ AUMENTADO de 5 a 8
    suggestionRules: {
        complementary: {
            'coca cola': ['galletas', 'snacks', 'chocolate'],
            'pan': ['mantequilla', 'mermelada', 'queso'],
            'leche': ['cereales', 'chocolate', 'galletas'],
            'arroz': ['aceite', 'menestras', 'fideos'],
            'cerveza': ['snacks', 'limón', 'hielo']
        },
        minCartAmount: 5
    }
};

// Debug mode
const DEBUG = true;

function debugLog(category, message, data = null) {
    if (!DEBUG) return;
    
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] [${category}]`, message, data || '');
}


// ============================================
// HELPER: Obtener token (compatible con ambos formatos)
// ============================================

function getAuthToken() {
    // Primero intentar 'access_token' (formato actual de tu app)
    let token = localStorage.getItem('access_token');
    
    // Si no existe, intentar 'token' (formato antiguo)
    if (!token) {
        token = localStorage.getItem('token');
    }
    
    return token;
}

// ============================================
// ESTADO GLOBAL
// ============================================

const AppState = {
    cart: [],
    paymentMethod: 'cash',
    selectedClient: null,
    voiceActive: false,
    user: null,
    recentProducts: [],
    favorites: [],
    dailySales: {
        count: 0,
        total: 0,
        avgTicket: 0
    },
    inventory: {
        lowStock: [],
        expiring: [],
        newProducts: []
    }
};

// ============================================
// AUTENTICACIÓN
// ============================================


function checkAuth() {
    const token = getAuthToken();
    
    if (!token) {
        console.warn('[Auth] No hay token, redirigiendo a home...');
        window.location.href = '/auth/login';
        return false;
    }
    
    return true;
}

async function fetchWithAuth(url, options = {}) {
    const token = getAuthToken();
    
    if (!token) {
        console.warn('[Auth] No autenticado');
        window.location.href = '/auth/login';
        throw new Error('No autenticado');
    }
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    if (response.status === 401) {
        console.warn('[Auth] Token inválido, redirigiendo...');
        localStorage.clear();
        window.location.href = '/auth/login';
        throw new Error('Token inválido');
    }
    
    return response;
}

async function loadUserData() {
    try {
        const token = getAuthToken();
        
        if (!token) {
            console.warn('[Auth] No hay token - redirigiendo a login');
            setTimeout(() => {
                window.location.href = '/auth/login';
            }, 1000);
            return null;
        }
        
        // Intentar obtener del localStorage primero
        const cachedUser = localStorage.getItem('user');
        if (cachedUser) {
            try {
                const user = JSON.parse(cachedUser);
                document.querySelector('.avatar').textContent = user.full_name[0].toUpperCase();
                document.querySelector('.username').textContent = user.full_name;
                
                const storeName = localStorage.getItem('store_name') || 'Mi Bodega del Centro';
                document.querySelector('.store-name').textContent = storeName;
                
                console.log('[Auth] ✅ Usuario cargado desde cache');
                return user;
            } catch (e) {
                console.warn('[Auth] Error al parsear usuario en cache');
            }
        }
        
        // Si no hay cache, obtener del servidor
        const response = await fetchWithAuth('/api/v1/users/me');
        const user = await response.json();
        
        document.querySelector('.avatar').textContent = user.full_name[0].toUpperCase();
        document.querySelector('.username').textContent = user.full_name;
        
        const storeName = localStorage.getItem('store_name') || 'Mi Bodega del Centro';
        document.querySelector('.store-name').textContent = storeName;
        
        // Guardar en cache
        localStorage.setItem('user', JSON.stringify(user));
        
        console.log('[Auth] ✅ Usuario cargado desde API');
        return user;
        
    } catch (error) {
        console.error('[Auth] Error al cargar usuario:', error);
        
        // Intentar usar datos cacheados del localStorage
        const cachedUser = localStorage.getItem('user');
        if (cachedUser) {
            try {
                const user = JSON.parse(cachedUser);
                console.log('[Auth] ⚠️ Usando usuario desde cache (API falló)');
                return user;
            } catch (e) {}
        }
        
        showToast('Error de autenticación - redirigiendo...', 'error');
        setTimeout(() => {
            window.location.href = '/auth/login';
        }, 1500);
        return null;
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

function addToCart(product, quantity = 1) {
    const existing = AppState.cart.find(item => item.id === product.id);
    
    if (existing) {
        existing.quantity += quantity;
    } else {
        // ⬇️ AGREGAR AL INICIO (unshift) en lugar de al final (push)
        AppState.cart.unshift({
            id: product.id,
            name: product.name,
            code: product.code || product.barcode || '',
            price: parseFloat(product.sale_price) || 0,
            unit: product.unit || 'unidad',
            quantity: quantity,
            stock: product.stock || 0
        });
        
        addToRecentProducts(product);
    }
    
    saveCart();
    renderCart();
    updateSuggestions();
    showToast(`✅ ${product.name} agregado`, 'success');
    playSound('add');
}

function updateQuantity(productId, quantity) {
    const item = AppState.cart.find(i => i.id === productId);
    if (item) {
        const newQty = Math.max(0.01, parseFloat(quantity));
        
        // Validar stock
        if (item.stock && newQty > item.stock) {
            showToast(`Stock disponible: ${item.stock}`, 'warning');
            return;
        }
        
        item.quantity = newQty;
        saveCart();
        renderCart();
        updateSuggestions();
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
        updateSuggestions();
    }
}

function decreaseQty(productId) {
    const item = AppState.cart.find(i => i.id === productId);
    if (item && item.quantity > 0.01) {
        item.quantity = Math.max(0.01, item.quantity - 1);
        saveCart();
        renderCart();
        updateSuggestions();
    }
}

function removeFromCart(productId) {
    const item = AppState.cart.find(i => i.id === productId);
    if (item) {
        AppState.cart = AppState.cart.filter(i => i.id !== productId);
        saveCart();
        renderCart();
        updateSuggestions();
        showToast(`${item.name} eliminado`, 'info');
        playSound('remove');
    }
}

function clearCart() {
    if (AppState.cart.length === 0) return;
    
    if (confirm('¿Limpiar todo el carrito?')) {
        AppState.cart = [];
        saveCart();
        renderCart();
        hideSuggestions();
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
            console.error('[Cart] Error al cargar:', e);
            AppState.cart = [];
        }
    }
}

function renderCart() {
    const container = document.getElementById('cart-items');
    const totalElement = document.getElementById('cart-total-amount');
    const subtotalElement = document.getElementById('cart-subtotal');
    const checkoutBtn = document.getElementById('checkout-btn');
    const itemsCountElement = document.getElementById('items-count');
    
    if (AppState.cart.length === 0) {
        container.innerHTML = `
            <div class="cart-empty">
                <p class="empty-icon">🛒</p>
                <p class="empty-text">Carrito vacío</p>
                <p class="empty-hint">Busca productos o usa el micrófono</p>
            </div>
        `;
        totalElement.textContent = 'S/. 0.00';
        if (subtotalElement) subtotalElement.textContent = 'S/. 0.00';
        checkoutBtn.disabled = true;
        itemsCountElement.textContent = '0 items';
        return;
    }
    
    const total = getCartTotal();
    const itemsCount = getCartItemsCount();
    
    container.innerHTML = AppState.cart.map(item => {
        const itemPrice = parseFloat(item.price) || 0;
        const itemQuantity = parseFloat(item.quantity) || 1;
        const itemTotal = itemPrice * itemQuantity;
        
        return `
        <div class="cart-item">
            <div class="item-details">
                <div class="item-name">${item.name}</div>
                <div class="item-meta">
                    <span>Stock: ${item.stock || '∞'}</span>
                    ${item.code ? `<span>Cód: ${item.code}</span>` : ''}
                </div>
            </div>
            
            <div class="qty-controls">
                <button class="btn-qty" onclick="decreaseQty(${item.id})">−</button>
                <input type="number" 
                       class="qty-input"
                       value="${itemQuantity}"
                       min="0.01"
                       step="0.01"
                       onchange="updateQuantity(${item.id}, this.value)">
                <button class="btn-qty" onclick="increaseQty(${item.id})">+</button>
            </div>
            
            <div class="item-price">
                <span class="price-unit">S/. ${itemPrice.toFixed(2)}/${item.unit}</span>
                <span class="price-total">S/. ${itemTotal.toFixed(2)}</span>
            </div>
            
            <button class="btn-remove-item" onclick="removeFromCart(${item.id})">🗑️</button>
        </div>
        `;
    }).join('');
    
    totalElement.textContent = `S/. ${total.toFixed(2)}`;
    if (subtotalElement) subtotalElement.textContent = `S/. ${total.toFixed(2)}`;
    checkoutBtn.disabled = false;
    itemsCountElement.textContent = `${itemsCount} item${itemsCount !== 1 ? 's' : ''}`;
    
    // ⬇️ Scroll suave al último item agregado
    setTimeout(() => {
        const cartBody = container.parentElement;
        if (cartBody) {
            cartBody.scrollTop = cartBody.scrollHeight;
        }
    }, 100);
}

// ============================================
// PRODUCTOS RECIENTES
// ============================================

function addToRecentProducts(product) {
    // Eliminar si ya existe
    AppState.recentProducts = AppState.recentProducts.filter(p => p.id !== product.id);
    
    // Agregar al inicio con TODOS los datos necesarios
    AppState.recentProducts.unshift({
        id: product.id,
        name: product.name,
        code: product.code || '',
        sale_price: parseFloat(product.sale_price) || parseFloat(product.price) || 0, // ⬅️ CRÍTICO
        unit: product.unit || 'unidad',
        stock: product.stock || 0
    });
    
    // Limitar cantidad
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
    const grid = document.getElementById('recent-products-grid');
    
    if (AppState.recentProducts.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No hay productos recientes</p>';
        return;
    }
    
    grid.innerHTML = AppState.recentProducts.map(p => `
        <div class="recent-product-chip" onclick="quickAddFromRecent(${p.id})">
            <span>${p.name}</span>
            <strong style="color: var(--primary);">+</strong>
        </div>
    `).join('');
}

async function quickAddProduct(productId) {
    try {
        const response = await fetchWithAuth(`/api/v1/products/${productId}`);
        const product = await response.json();
        addToCart(product);
    } catch (error) {
        console.error('[QuickAdd] Error:', error);
        showToast('Error al agregar producto', 'error');
    }
}

function quickAddFromRecent(productId) {
    // Buscar el producto en los recientes
    const product = AppState.recentProducts.find(p => p.id === productId);
    
    if (!product) {
        showToast('Producto no encontrado', 'error');
        return;
    }
    
    // Agregar al carrito con datos completos
    addToCart({
        id: product.id,
        name: product.name,
        code: product.code,
        sale_price: product.sale_price,
        unit: product.unit,
        stock: product.stock
    });
}

function clearRecent() {
    if (confirm('¿Limpiar productos recientes?')) {
        AppState.recentProducts = [];
        saveRecentProducts();
        renderRecentProducts();
    }
}

// ============================================
// SUGERENCIAS INTELIGENTES
// ============================================

function updateSuggestions() {
    const total = getCartTotal();
    
    // Solo sugerir si el carrito tiene cierto monto
    if (total < CONFIG.suggestionRules.minCartAmount) {
        hideSuggestions();
        return;
    }
    
    const suggestions = generateSuggestions();
    
    if (suggestions.length > 0) {
        renderSuggestions(suggestions);
    } else {
        hideSuggestions();
    }
}

function generateSuggestions() {
    const suggestions = [];
    const cartProductNames = AppState.cart.map(item => 
        item.name.toLowerCase().split(' ')[0] // Solo primera palabra
    );
    
    // Reglas más específicas
    const rules = {
        'coca': ['galletas', 'snacks'],
        'cerveza': ['snacks', 'limón'],
        'pan': ['mantequilla', 'mermelada'],
        'leche': ['cereales', 'galletas'],
        'arroz': ['aceite', 'menestras']
    };
    
    for (const cartItem of AppState.cart) {
        const firstWord = cartItem.name.toLowerCase().split(' ')[0];
        
        if (rules[firstWord]) {
            for (const suggestion of rules[firstWord]) {
                if (!cartProductNames.includes(suggestion) && 
                    !suggestions.find(s => s.keyword === suggestion)) {
                    suggestions.push({
                        keyword: suggestion,
                        reason: `Ideal con ${cartItem.name.split(' ')[0]}`
                    });
                }
            }
        }
    }
    
    return suggestions.slice(0, 3);
}

async function renderSuggestions(suggestions) {
    const section = document.getElementById('suggestions-section');
    const grid = document.getElementById('suggestions-grid');
    
    section.style.display = 'block';
    
    // Buscar productos reales que coincidan
    try {
        const productsPromises = suggestions.map(async (sugg) => {
            const response = await fetchWithAuth('/api/v1/products/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: sugg.keyword,
                    limit: 1
                })
            });
            const products = await response.json();
            return products.length > 0 ? { ...products[0], reason: sugg.reason } : null;
        });
        
        const products = (await Promise.all(productsPromises)).filter(p => p !== null);
        
        if (products.length === 0) {
            hideSuggestions();
            return;
        }
        
        grid.innerHTML = products.map(p => `
            <div class="suggestion-card" onclick="addSuggestedProduct(${p.id})">
                <div class="suggestion-name">${p.name}</div>
                <div class="suggestion-reason">${p.reason}</div>
                <div class="suggestion-price">S/. ${p.sale_price.toFixed(2)}</div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('[Suggestions] Error:', error);
        hideSuggestions();
    }
}

async function addSuggestedProduct(productId) {
    try {
        const response = await fetchWithAuth(`/api/v1/products/${productId}`);
        const product = await response.json();
        addToCart(product);
        showToast('💡 ¡Buena elección!', 'success');
    } catch (error) {
        console.error('[Suggestions] Error:', error);
    }
}

function hideSuggestions() {
    document.getElementById('suggestions-section').style.display = 'none';
}

function dismissSuggestions() {
    hideSuggestions();
}

// ============================================
// MÉTODOS DE PAGO
// ============================================

function selectPaymentMethod(method) {
    AppState.paymentMethod = method;
    
    // Actualizar UI de botones
    document.querySelectorAll('.payment-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-method="${method}"]`).classList.add('active');
    
    // Actualizar botón de checkout
    const checkoutBtn = document.getElementById('checkout-btn');
    const checkoutText = document.getElementById('checkout-text');
    const checkoutIcon = document.querySelector('.checkout-icon');
    
    // Colores según método
    const styles = {
        cash: {
            text: 'COBRAR EN EFECTIVO',
            icon: '💵',
            gradient: 'linear-gradient(135deg, #c1272d 0%, #e63946 100%)',
            shadow: '0 8px 25px rgba(193, 39, 45, 0.4)'
        },
        yape: {
            text: 'COBRAR CON YAPE',
            icon: '📱',
            gradient: 'linear-gradient(135deg, #722284 0%, #9333ea 100%)',
            shadow: '0 8px 25px rgba(114, 34, 132, 0.4)'
        },
        plin: {
            text: 'COBRAR CON PLIN',
            icon: '💳',
            gradient: 'linear-gradient(135deg, #00a7e1 0%, #06d6ff 100%)',
            shadow: '0 8px 25px rgba(0, 167, 225, 0.4)'
        },
        credit: {
            text: 'REGISTRAR FIADO',
            icon: '📝',
            gradient: 'linear-gradient(135deg, #06d6a0 0%, #10b981 100%)',
            shadow: '0 8px 25px rgba(6, 214, 160, 0.4)'
        }
    };
    
    const style = styles[method];
    checkoutText.textContent = style.text;
    checkoutIcon.textContent = style.icon;
    checkoutBtn.style.background = style.gradient;
    checkoutBtn.style.boxShadow = style.shadow;
}

// ============================================
// CHECKOUT
// ============================================

async function processCheckout() {
    if (AppState.cart.length === 0) return;
    
    // Si es fiado, primero seleccionar cliente
    if (AppState.paymentMethod === 'credit') {
        openClientModal();
        return;
    }
    
    const total = getCartTotal();
    
    // Confirmar venta
    const confirmMsg = `¿Confirmar venta por S/. ${total.toFixed(2)}?`;
    if (!confirm(confirmMsg)) {
        return;
    }
    
    // ⬇️ NO usar showLoading
    const checkoutBtn = document.getElementById('checkout-btn');
    const originalText = checkoutBtn.innerHTML;
    checkoutBtn.disabled = true;
    checkoutBtn.innerHTML = '<span style="font-size: 20px;">⏳</span> Procesando...';
    
    try {
        const response = await fetchWithAuth('/api/v1/sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: AppState.cart.map(item => ({
                    product_id: item.id,
                    quantity: item.quantity,
                    unit_price: item.price
                })),
                payment_method: AppState.paymentMethod,
                client_id: AppState.selectedClient?.id
            })
        });
        
        if (response.ok) {
            // ⬇️ Restaurar botón
            checkoutBtn.disabled = false;
            checkoutBtn.innerHTML = originalText;
            
            showToast('✅ ¡Venta registrada!', 'success');
            playSound('success');
            
            // Limpiar carrito
            AppState.cart = [];
            saveCart();
            renderCart();
            hideSuggestions();
            
            // Actualizar resumen del día
            loadDailySummary();
            
            // Confetti effect
            confettiEffect();
            
            // Auto-imprimir si está configurado
            if (localStorage.getItem('auto_print') === 'true') {
                setTimeout(() => printTicket(), 500);
            }
            
        } else {
            throw new Error('Error en la respuesta');
        }
        
    } catch (error) {
        // ⬇️ Restaurar botón
        checkoutBtn.disabled = false;
        checkoutBtn.innerHTML = originalText;
        
        console.error('[Checkout] Error:', error);
        showToast('❌ Error al registrar venta', 'error');
        playSound('error');
    }
}


function showSavedCarts() {
    const savedCarts = JSON.parse(localStorage.getItem('saved_carts') || '[]');
    
    if (savedCarts.length === 0) {
        showToast('No hay pedidos pendientes', 'info');
        return;
    }
    
    showToast(`${savedCarts.length} pedidos pendientes`, 'info');
    // Implementar modal de pedidos pendientes después
}

// ============================================
// BÚSQUEDA
// ============================================

let searchTimeout;

function handleSearchInput(event) {
    const query = event.target.value.trim();
    
    if (event.key === 'Enter') {
        if (query.length >= 1) {
            searchProducts(query);
        }
        return;
    }
    
    // Búsqueda automática con debounce
    clearTimeout(searchTimeout);
    
    if (query.length >= 2) {
        searchTimeout = setTimeout(() => {
            searchProducts(query);
        }, 500);
    }
}

async function searchProducts(query) {
    if (!query.trim()) return;
    
    const searchInput = document.getElementById('search-input');
    const searchBox = document.querySelector('.search-box');
    
    searchInput.disabled = true;
    searchInput.placeholder = '🔍 Buscando...';
    searchBox.classList.add('searching');
    
    try {
        // ⬇️ CONEXIÓN REAL CON API
        const response = await fetchWithAuth('/api/v1/products/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query, limit: 20 })
        });
        
        const products = await response.json();
        
        searchInput.disabled = false;
        searchInput.placeholder = 'Buscar productos...';
        searchBox.classList.remove('searching');
        
        if (products.length === 0) {
            showToast('No se encontraron productos', 'info');
        } else if (products.length === 1) {
            addToCart(products[0]);
            searchInput.value = '';
        } else {
            showSearchResults(products);
        }
        
    } catch (error) {
        searchInput.disabled = false;
        searchInput.placeholder = 'Buscar productos...';
        searchBox.classList.remove('searching');
        console.error('[Search] Error:', error);
        showToast('Error al buscar', 'error');
    }
}

function showSearchResults(products) {
    const modal = document.getElementById('search-results-modal');
    const resultsContainer = document.getElementById('search-results');
    
    resultsContainer.innerHTML = products.map(p => `
        <label class="product-result">
            <input type="checkbox" 
                   data-id="${p.id}"
                   data-name="${p.name}"
                   data-price="${p.sale_price}"
                   data-unit="${p.unit || 'unidad'}"
                   data-code="${p.code || ''}"
                   data-stock="${p.stock || 0}">
            <div class="product-result-info">
                <div class="product-result-name">${p.name}</div>
                <div class="product-result-meta">
                    Cód: ${p.code || 'N/A'} | Stock: ${p.stock || '∞'}
                </div>
            </div>
            <div class="product-result-price">S/. ${p.sale_price.toFixed(2)}</div>
        </label>
    `).join('');
    
    modal.classList.add('show');
}

function closeSearchModal() {
    document.getElementById('search-results-modal').classList.remove('show');
}

function addSelectedProducts() {
    const checkboxes = document.querySelectorAll('#search-results input[type="checkbox"]:checked');
    
    if (checkboxes.length === 0) {
        showToast('No hay productos seleccionados', 'info');
        return;
    }
    
    checkboxes.forEach(cb => {
        const product = {
            id: parseInt(cb.dataset.id),
            name: cb.dataset.name,
            sale_price: parseFloat(cb.dataset.price),
            unit: cb.dataset.unit,
            code: cb.dataset.code,
            stock: parseInt(cb.dataset.stock) || 0
        };
        addToCart(product);
    });
    
    closeSearchModal();
}

// ============================================
// PROCESAMIENTO DE FRACCIONES Y CANTIDADES
// ============================================

function parseFraction(text) {
    // Diccionario de fracciones comunes
    const fractions = {
        // Fracciones escritas
        'un cuarto': 0.25,
        'cuarto': 0.25,
        'cuartito': 0.25,
        '1/4': 0.25,
        'un medio': 0.5,
        'medio': 0.5,
        'medito': 0.5,
        'media': 0.5,
        '1/2': 0.5,
        'tres cuartos': 0.75,
        'tres cuartitos': 0.75,
        '3/4': 0.75,
        'un tercio': 0.33,
        'tercio': 0.33,
        '1/3': 0.33,
        'dos tercios': 0.67,
        '2/3': 0.67,
        'un quinto': 0.2,
        'quinto': 0.2,
        '1/5': 0.2,
        // Números enteros
        'uno': 1,
        'una': 1,
        'dos': 2,
        'tres': 3,
        'cuatro': 4,
        'cinco': 5,
        'seis': 6,
        'siete': 7,
        'ocho': 8,
        'nueve': 9,
        'diez': 10,
        'decena': 10,
        'once': 11,
        'doce': 12,
        'docena': 12,
        'quince': 15,
        'veinte': 20,
        'veinticinco': 25,
        'treinta': 30,
        'cincuenta': 50,
        'medio ciento': 50,
        'ciento': 100,
        'cien': 100
    };
    
    // Buscar fracción en el texto
    for (const [key, value] of Object.entries(fractions)) {
        if (text.includes(key)) {
            return { quantity: value, matched: key };
        }
    }
    
    // Buscar número decimal
    const decimalMatch = text.match(/(\d+[.,]\d+)/);
    if (decimalMatch) {
        const num = parseFloat(decimalMatch[1].replace(',', '.'));
        return { quantity: num, matched: decimalMatch[1] };
    }
    
    // Buscar número entero
    const numberMatch = text.match(/(\d+)/);
    if (numberMatch) {
        const num = parseInt(numberMatch[1]);
        return { quantity: num, matched: numberMatch[1] };
    }
    
    return { quantity: 1, matched: null };
}

function parseAmount(text) {
    const patterns = [
        // "X soles de producto"
        /(\d+(?:[.,]\d+)?)\s*sol(?:es)?\s+de\s+(.+)/i,
        // "producto X soles"
        /(.+?)\s+(\d+(?:[.,]\d+)?)\s*sol(?:es)?$/i,
        // "un sol de producto"
        /(un|dos|tres|cuatro|cinco)\s+sol(?:es)?\s+de\s+(.+)/i
    ];
    
    const numberWords = {
        'un': 1, 'una': 1, 'dos': 2, 'tres': 3, 
        'cuatro': 4, 'cinco': 5
    };
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            let amount, product;
            
            // Detectar orden de patrón
            if (pattern.source.includes('(.+?)')) {
                // Patrón: "producto X soles"
                product = match[1].trim();
                amount = match[2];
            } else {
                // Patrón: "X soles de producto"
                amount = match[1];
                product = match[2].trim();
            }
            
            // Convertir palabra a número
            if (numberWords[amount?.toLowerCase()]) {
                amount = numberWords[amount.toLowerCase()];
            } else {
                amount = parseFloat(String(amount).replace(',', '.'));
            }
            
            console.log(`[ParseAmount] Detectado: ${amount} soles de "${product}"`);
            
            return { 
                amount: amount, 
                product: product, 
                isAmount: true 
            };
        }
    }
    
    return { amount: null, product: text, isAmount: false };
}


function extractProductAndQuantity(text) {
    let cleaned = text.toLowerCase().trim();
    
    // 1. Detectar monto PRIMERO
    const amountResult = parseAmount(cleaned);
    if (amountResult.isAmount) {
        return {
            quantity: null,
            amount: amountResult.amount,
            productName: amountResult.product,
            searchByAmount: true
        };
    }
    
    // 2. Detectar fracción
    const fractionResult = parseFraction(cleaned);
    let quantity = fractionResult.quantity;
    let productName = cleaned;
    
    // 3. LIMPIAR producto (remover cantidad y palabras comunes)
    if (fractionResult.matched) {
        productName = productName.replace(fractionResult.matched, '');
    }
    
    // Remover palabras comunes MÁS AGRESIVO
    const stopWords = [
        'de', 'del', 'la', 'el', 'un', 'una',
        'kilo', 'kilogramo', 'kg', 'litro', 'gramo', 'gr',
        'unidad', 'unidades', 'paquete', 'paquetes',
        'dame', 'quiero', 'necesito', 'vender', 'vendeme',
        'por', 'favor', 'medio', 'cuarto', 'soles', 'sol'
    ];
    
    // Remover números sueltos
    productName = productName.replace(/\b\d+\b/g, '');
    
    // Remover fracciones 1/4, 3/4, etc
    productName = productName.replace(/\d+\/\d+/g, '');
    
    // Limpiar espacios múltiples
    productName = productName.replace(/\s+/g, ' ');
    
    // Remover stop words
    const words = productName.split(' ').filter(word => 
        word.length > 1 && !stopWords.includes(word)
    );
    
    productName = words.join(' ').trim();
    
    console.log(`[Parse] Original: "${text}" → Producto: "${productName}" | Cantidad: ${quantity}`);
    
    return {
        quantity: quantity,
        amount: null,
        productName: productName,
        searchByAmount: false
    };
}


function toggleMicSettings() {
    const settings = document.getElementById('mic-settings');
    settings.classList.toggle('show');
    
    // NO cerrar el quick menu
    // El quick menu se cierra solo si clickeas fuera
}

function setMicTimer(seconds) {
    CONFIG.micTimer = seconds;
    localStorage.setItem('mic_timer', seconds);
    
    // Actualizar UI
    document.querySelectorAll('.timer-option').forEach(opt => {
        opt.classList.remove('active');
        if (parseInt(opt.dataset.seconds) === seconds) {
            opt.classList.add('active');
        }
    });
    
    showToast(`Micrófono: ${seconds}s`, 'success');
}

function loadMicSettings() {
    const saved = localStorage.getItem('mic_timer');
    if (saved) {
        CONFIG.micTimer = parseInt(saved);
        document.querySelectorAll('.timer-option').forEach(opt => {
            if (parseInt(opt.dataset.seconds) === CONFIG.micTimer) {
                opt.classList.add('active');
            }
        });
    }
}

// ============================================
// QUICK MENU
// ============================================

function toggleQuickMenu() {
    const menu = document.getElementById('quick-menu');
    menu.classList.toggle('show');
    
    // Cargar contadores si se abre
    if (menu.classList.contains('show')) {
        loadQuickMenuData();
    }
}

async function loadQuickMenuData() {
    try {
        // Cargar productos con stock bajo
        const lowStockResponse = await fetchWithAuth('/api/v1/products/low-stock');
        const lowStock = await lowStockResponse.json();
        document.getElementById('low-stock-count').textContent = lowStock.length;
        AppState.inventory.lowStock = lowStock;
        
        // Cargar productos por vencer (si tienes ese endpoint)
        // const expiringResponse = await fetchWithAuth('/api/v1/products/expiring');
        // ...
        
    } catch (error) {
        console.error('[QuickMenu] Error:', error);
    }
}

async function showLowStock() {
    const modal = document.getElementById('low-stock-modal');
    const content = document.getElementById('low-stock-content');
    
    modal.classList.add('show');
    
    if (AppState.inventory.lowStock.length === 0) {
        content.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No hay productos con stock bajo</p>';
        return;
    }
    
    content.innerHTML = AppState.inventory.lowStock.map(p => `
        <div class="product-result" onclick="quickAddProduct(${p.id})">
            <div class="product-result-info">
                <div class="product-result-name">${p.name}</div>
                <div class="product-result-meta">
                    Stock actual: ${p.stock} ${p.unit}
                </div>
            </div>
            <div class="product-result-price">S/. ${p.sale_price.toFixed(2)}</div>
        </div>
    `).join('');
}

function closeLowStockModal() {
    document.getElementById('low-stock-modal').classList.remove('show');
}

async function showExpiringSoon() {
    showToast('Función en desarrollo', 'info');
}

async function showNewProducts() {
    showToast('Función en desarrollo', 'info');
}

async function showTopSelling() {
    showToast('Función en desarrollo', 'info');
}

function showFavorites() {
    showToast('Función en desarrollo', 'info');
}

// ============================================
// CLIENTES
// ============================================

function openClientModal() {
    document.getElementById('client-modal').classList.add('show');
}

function closeClientModal() {
    document.getElementById('client-modal').classList.remove('show');
}

async function searchClients(query) {
    if (!query || query.length < 2) return;
    
    try {
        const response = await fetchWithAuth(`/api/v1/clients/search?q=${query}`);
        const clients = await response.json();
        
        const resultsContainer = document.getElementById('client-results');
        
        if (clients.length === 0) {
            resultsContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No se encontraron clientes</p>';
            return;
        }
        
        resultsContainer.innerHTML = clients.map(c => `
            <div class="client-item" onclick="selectClient(${c.id}, '${c.name}')">
                <div class="client-name">${c.name}</div>
                <div class="client-meta">
                    ${c.dni ? `DNI: ${c.dni}` : ''} 
                    ${c.phone ? `| Tel: ${c.phone}` : ''}
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('[Clients] Error:', error);
    }
}

function selectClient(clientId, clientName) {
    AppState.selectedClient = { id: clientId, name: clientName };
    closeClientModal();
    showToast(`Cliente: ${clientName}`, 'success');
    
    // Procesar el checkout ahora que tenemos cliente
    processCheckout();
}

function openNewClientForm() {
    showToast('Función en desarrollo', 'info');
}

// ============================================
// RESUMEN DEL DÍA
// ============================================

async function loadDailySummary() {
    try {
        const response = await fetchWithAuth('/api/v1/sales/today/summary');
        const data = await response.json();
        
        AppState.dailySales = {
            count: data.count || 0,
            total: data.total || 0,
            avgTicket: data.count > 0 ? data.total / data.count : 0
        };
        
        updateDailyGoalUI();
        
    } catch (error) {
        console.error('[DailySummary] Error:', error);
    }
}

function updateDailyGoalUI() {
    const progress = (AppState.dailySales.total / CONFIG.dailyGoal) * 100;
    const goalBar = document.getElementById('goal-bar');
    const goalText = document.getElementById('goal-text');
    
    if (goalBar) {
        goalBar.style.width = `${Math.min(progress, 100)}%`;
    }
    
    if (goalText) {
        goalText.textContent = `S/. ${AppState.dailySales.total.toFixed(0)} / S/. ${CONFIG.dailyGoal}`;
    }
}

// ============================================
// SIDEBAR - VENTAS
// ============================================

function openSalesHistory() {
    document.getElementById('sales-sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('show');
    
    // Actualizar stats
    document.getElementById('sidebar-sales-count').textContent = AppState.dailySales.count;
    document.getElementById('sidebar-sales-total').textContent = `S/. ${AppState.dailySales.total.toFixed(2)}`;
    document.getElementById('sidebar-avg-ticket').textContent = `S/. ${AppState.dailySales.avgTicket.toFixed(2)}`;
    
    loadRecentSales();
}

function closeSidebar() {
    document.getElementById('sales-sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
}

async function loadRecentSales() {
    try {
        const response = await fetchWithAuth('/api/v1/sales/today');
        const sales = await response.json();
        
        const container = document.getElementById('recent-sales');
        
        if (sales.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No hay ventas hoy</p>';
            return;
        }
        
        container.innerHTML = sales.map(sale => `
            <div style="padding: 14px; background: var(--bg-input); border-radius: 8px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <strong>${new Date(sale.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</strong>
                    <strong style="color: var(--primary);">S/. ${sale.total.toFixed(2)}</strong>
                </div>
                <div style="font-size: 12px; color: var(--text-muted);">
                    ${sale.items_count} items · ${sale.payment_method}
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('[RecentSales] Error:', error);
    }
}

// ============================================
// IMPRESIÓN
// ============================================

function printTicket() {
    if (AppState.cart.length === 0) {
        showToast('No hay productos para imprimir', 'info');
        return;
    }
    
    const ticketHTML = generateTicketHTML();
    
    const printWindow = window.open('', '', 'width=300,height=600');
    printWindow.document.write(ticketHTML);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
}

function generateTicketHTML() {
    const date = new Date().toLocaleString('es-PE');
    const storeName = localStorage.getItem('store_name') || 'Mi Bodega';
    
    const items = AppState.cart.map(item => `
        <tr>
            <td>${item.name}</td>
            <td style="text-align: right;">${item.quantity}</td>
            <td style="text-align: right;">S/. ${(item.price * item.quantity).toFixed(2)}</td>
        </tr>
    `).join('');
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Ticket</title>
            <style>
                body {
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    width: 300px;
                    margin: 0;
                    padding: 10px;
                }
                h2 { text-align: center; margin: 10px 0; }
                table { width: 100%; border-collapse: collapse; }
                td { padding: 5px 0; border-bottom: 1px dashed #ccc; }
                .total { font-weight: bold; font-size: 14px; }
                .footer { text-align: center; margin-top: 20px; font-size: 10px; }
            </style>
        </head>
        <body>
            <h2>${storeName}</h2>
            <p style="text-align: center; margin: 5px 0;">${date}</p>
            <hr>
            <table>
                <thead>
                    <tr>
                        <th style="text-align: left;">Producto</th>
                        <th style="text-align: right;">Cant.</th>
                        <th style="text-align: right;">Total</th>
                    </tr>
                </thead>
                <tbody>${items}</tbody>
            </table>
            <hr>
            <table>
                <tr class="total">
                    <td>TOTAL:</td>
                    <td></td>
                    <td style="text-align: right;">S/. ${getCartTotal().toFixed(2)}</td>
                </tr>
            </table>
            <div class="footer">
                <p>¡Gracias por su compra!</p>
                <p>QueVendi.pro</p>
            </div>
        </body>
        </html>
    `;
}

// ============================================
// CONFIGURACIÓN
// ============================================

function openSettings() {
    showToast('Configuración', 'info');
    // Implementar modal de configuración si es necesario
}

function saveStoreName() {
    const input = document.getElementById('store-name-input');
    if (input) {
        const name = input.value.trim();
        if (name) {
            localStorage.setItem('store_name', name);
            document.querySelector('.store-name').textContent = name;
            showToast('Nombre guardado', 'success');
        }
    }
}

// ============================================
// UI HELPERS
// ============================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}


function playSound(type) {
    // Implementar sonidos si tienes archivos de audio
    // const audio = new Audio(`/sounds/${type}.mp3`);
    // audio.play().catch(() => {});
}

function confettiEffect() {
    // Implementar efecto confetti si deseas
    console.log('🎉 Confetti!');
}

// ============================================
// PWA
// ============================================

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    deferredPrompt = e;
    document.getElementById('install-btn').style.display = 'block';
});

document.getElementById('install-btn')?.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        document.getElementById('install-btn').style.display = 'none';
    }
});

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[App] 🚀 Inicializando QueVendi POS v2...');
    
    initLLMSession();

    // Verificar autenticación
    //if (!checkAuth()) return;
    
    // Cargar configuraciones
    loadMicSettings();
    
    // Cargar datos del usuario
    AppState.user = await loadUserData();
    if (!AppState.user) {
        console.error('[App] No se pudo cargar usuario');
        return;
    }
    
    // Cargar datos
    loadCart();
    loadRecentProducts();
    renderCart();
    renderRecentProducts();
    loadDailySummary();
    
    // Cerrar menús al hacer click fuera
    // Al final del DOMContentLoaded, MODIFICAR:

    document.addEventListener('click', (e) => {
        const quickMenu = document.getElementById('quick-menu');
        const micSettings = document.getElementById('mic-settings');
        const micBtn = document.getElementById('mic-btn');
        
        // No cerrar si clickeaste en el botón de micrófono
        if (micBtn && micBtn.contains(e.target)) {
            return; // Dejar que toggleVoiceSearch maneje el click
        }
        
        // No cerrar si clickeaste en el botón de quick menu o dentro del menu
        if (!e.target.closest('[onclick*="toggleQuickMenu"]') && 
            !quickMenu.contains(e.target)) {
            quickMenu.classList.remove('show');
            micSettings.classList.remove('show');
        }
    });

    // Inicializar método de pago por defecto
    selectPaymentMethod('cash');
    
    console.log('[App] ✅ Sistema cargado correctamente');
});


// ============================================
// SISTEMA DE VOZ
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
        console.log(`[Voice ${voiceMode?.toUpperCase()}] 🎤 Escuchando...`);
    };
    
    // ⬇️ Handler dinámico según modo
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        console.log(`[Voice ${voiceMode?.toUpperCase()}] Escuchado:`, transcript);
        
        // ⬇️ CRUCIAL: Verificar modo actual
        if (voiceMode === 'ai') {
            handleAIVoiceResult(event);
        } else {
            // Modo FREE
            const transcriptLower = transcript.toLowerCase();
            processVoiceCommand(transcriptLower);
        }
    };
    
    recognition.onerror = (event) => {
        console.error('[Voice] Error:', event.error);
        stopVoiceSearch();
        
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
            showToast('Error en el micrófono', 'error');
        }
    };
    
    recognition.onend = () => {
        console.log('[Voice] Micrófono apagado');
        stopVoiceSearch();
    };
    
    return true;
}

function startVoiceSearch() {
    if (!recognition) {
        const initialized = initVoiceRecognition();
        if (!initialized) {
            showToast('Micrófono no disponible', 'error');
            return;
        }
    }
    
    try {
        recognition.start();
        AppState.voiceActive = true;
        
        // Auto-apagar después del tiempo configurado
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

function stopVoiceSearch() {
    document.getElementById('mic-btn-free')?.classList.remove('listening');
    document.getElementById('mic-btn-ai')?.classList.remove('listening');
    AppState.voiceActive = false;
    
    if (recognitionTimeout) {
        clearTimeout(recognitionTimeout);
        recognitionTimeout = null;
    }
    
    // Restaurar handler normal
    if (recognition) {
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript.toLowerCase().trim();
            console.log('[Voice] Escuchado:', transcript);
            processVoiceCommand(transcript);
        };
    }
}

function processVoiceCommand(transcript) {
    console.log('[Voice] 🎤 Escuchado:', transcript);
    
    const parsed = extractProductAndQuantity(transcript);
    console.log('[Voice] 📦 Parseado:', parsed);
    
    if (!parsed.productName || parsed.productName.length < 2) {
        showToast('No entendí el producto', 'warning');
        return;
    }
    
    // Buscar por monto o por cantidad
    if (parsed.searchByAmount) {
        showToast(`🔍 S/. ${parsed.amount} de ${parsed.productName}`, 'info');
        searchProductByAmount(parsed.productName, parsed.amount);
    } else {
        if (parsed.quantity !== 1) {
            showToast(`🔍 ${parsed.quantity} ${parsed.productName}`, 'info');
        } else {
            showToast(`🔍 ${parsed.productName}`, 'info');
        }
        searchProductByVoice(parsed.productName, parsed.quantity);
    }
}

function normalizePlural(text) {
    // Manejar plurales comunes en español
    const singulars = {
        'panes': 'pan',
        'limones': 'limón',
        'tomates': 'tomate',
        'papas': 'papa',
        'cebollas': 'cebolla',
        'ajos': 'ajo',
        'huevos': 'huevo',
        'soles': 'sol',
        'kilos': 'kilo'
    };
    
    // Si existe mapeo específico
    if (singulars[text]) {
        return singulars[text];
    }
    
    // Regla general: quitar 's' final (funciona para mayoría)
    if (text.endsWith('s') && text.length > 3) {
        return text.slice(0, -1);
    }
    
    return text;
}

async function searchProductByAmount(productName, amount) {
    try {
        const normalizedName = normalizePlural(productName.trim());
        
        const response = await fetchWithAuth('/api/v1/products/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: normalizedName, limit: 10 })
        });
        
        const products = await response.json();
        
        // ⬇️ VERIFICAR CORRECTAMENTE
        if (!products || products.length === 0) {
            showToast(`❌ No encontré: ${productName}`, 'error');
            playSound('error');
            return; // ⬅️ IMPORTANTE: salir aquí
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


async function searchProductByVoice(productName, quantity = 1) {
    try {
        const normalizedName = normalizePlural(productName.trim());
        
        const response = await fetchWithAuth('/api/v1/products/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: normalizedName, limit: 10 })
        });
        
        const products = await response.json();
        
        // ⬇️ VERIFICAR CORRECTAMENTE
        if (!products || products.length === 0) {
            showToast(`❌ No encontré: ${productName}`, 'error');
            playSound('error');
            return; // ⬅️ IMPORTANTE: salir aquí
        }
        
        // Solo llega aquí si SÍ hay productos
        const product = products[0];
        addToCart(product, quantity);
        
        if (products.length > 1) {
            showToast(`✅ ${product.name} (${products.length} opciones)`, 'success');
        }
        
    } catch (error) {
        console.error('[VoiceSearch] Error:', error);
        showToast('Error al buscar', 'error');
        playSound('error');
    }
}

function playSound(type) {
    // Sonidos web simples sin archivos
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Configurar sonido según tipo
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
}


function toggleVoiceSearch(mode) {
    console.log(`[Voice] Toggle mode: ${mode}, current: ${voiceMode}, active: ${AppState.voiceActive}`);
    
    // Si ya está activo el mismo modo → apagar
    if (voiceMode === mode && AppState.voiceActive) {
        console.log('[Voice] Apagando mismo modo');
        stopVoiceSearch();
        return;
    }
    
    // Si está activo otro modo → apagar primero
    if (AppState.voiceActive && voiceMode !== mode) {
        console.log('[Voice] Cambiando de modo');
        stopVoiceSearch();
    }
    
    // Establecer nuevo modo
    voiceMode = mode;
    console.log(`[Voice] Modo establecido: ${voiceMode}`);
    
    // Activar según modo
    if (mode === 'free') {
        startVoiceSearchFree();
    } else if (mode === 'ai') {
        startVoiceSearchAI();
    }
}


function startVoiceSearchFree() {
    // Usar el sistema existente (regex)
    if (!recognition) {
        const initialized = initVoiceRecognition();
        if (!initialized) {
            showToast('Micrófono no disponible', 'error');
            return;
        }
    }
    
    try {
        recognition.start();
        AppState.voiceActive = true;
        
        document.getElementById('mic-btn-free').classList.add('listening');
        showToast('🎤 Di UN producto', 'info');
        
        recognitionTimeout = setTimeout(() => {
            if (AppState.voiceActive) {
                recognition.stop();
            }
        }, CONFIG.micTimer * 1000);
        
    } catch (error) {
        console.error('[Voice Free] Error:', error);
        showToast('No se pudo activar el micrófono', 'error');
    }
}

function startVoiceSearchAI() {
    console.log('[Voice AI] 🚀 Iniciando modo AI');
    
    if (!recognition) {
        const initialized = initVoiceRecognition();
        if (!initialized) {
            showToast('Micrófono no disponible', 'error');
            return;
        }
    }
    
    try {
        recognition.start();
        AppState.voiceActive = true;
        
        document.getElementById('mic-btn-ai').classList.add('listening');
        
        const apiLabels = {
            'claude': '🟠 Claude',
            'openai': '🟢 OpenAI',
            'gemini': '🔵 Gemini'
        };
        
        showToast(`${apiLabels[currentAPI]} escuchando... Di TODOS los productos`, 'info');
        
        recognitionTimeout = setTimeout(() => {
            if (AppState.voiceActive) {
                console.log('[Voice AI] Timeout alcanzado');
                recognition.stop();
            }
        }, CONFIG.micTimer * 1000);
        
    } catch (error) {
        console.error('[Voice AI] Error al iniciar:', error);
        showToast('No se pudo activar el micrófono', 'error');
        voiceMode = null;
    }
}


async function handleAIVoiceResult(event) {
    const transcript = event.results[0][0].transcript.trim();
    console.log('[Voice AI] 🤖 Escuchado:', transcript);
    
    stopVoiceSearch();
    
    // Mostrar processing
    const processingToast = showToast('🤖 Procesando con IA...', 'processing');
    
    try {
        console.log('[Voice AI] Enviando a API:', currentAPI);
        
        const response = await fetchWithAuth('/api/v1/voice/parse-llm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: transcript,
                api: currentAPI,
                session_id: sessionId
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log('[Voice AI] ✅ Resultado:', data);
        
        if (data.success && data.products.length > 0) {
            // Agregar todos los productos
            let addedCount = 0;
            
            for (const product of data.products) {
                try {
                    addToCart({
                        id: product.product_id,
                        name: product.name,
                        sale_price: product.price,
                        unit: product.unit,
                        stock: 999
                    }, product.quantity);
                    addedCount++;
                } catch (err) {
                    console.error('[Voice AI] Error agregando producto:', err);
                }
            }
            
            // Feedback detallado
            const apiLabels = {
                'claude': '🟠 Claude',
                'openai': '🟢 OpenAI',
                'gemini': '🔵 Gemini'
            };
            
            let message = `✅ ${addedCount} producto${addedCount !== 1 ? 's' : ''} agregado${addedCount !== 1 ? 's' : ''}`;
            
            if (data.not_found.length > 0) {
                message += `\n⚠️ No encontrados: ${data.not_found.join(', ')}`;
            }
            
            message += `\n${apiLabels[data.api_used]} (${data.latency_ms}ms)`;
            
            showToast(message, 'success');
            playSound('success');
            
        } else if (data.not_found && data.not_found.length > 0) {
            showToast(`❌ No encontrados: ${data.not_found.join(', ')}`, 'error');
            playSound('error');
        } else {
            showToast('❌ No se detectaron productos válidos', 'error');
            playSound('error');
        }
        
    } catch (error) {
        console.error('[Voice AI] ❌ Error:', error);
        showToast(`Error al procesar: ${error.message}`, 'error');
        playSound('error');
    }
}