// ========================================
// SISTEMA DE BÚSQUEDA Y CARRITO
// ========================================

const CartManager = {
    items: [],
    
    addItem(product, quantity = 1) {
        const existing = this.items.find(item => item.id === product.id);
        
        if (existing) {
            existing.quantity += quantity;
        } else {
            this.items.push({
                id: product.id,
                name: product.name,
                code: product.code || '',
                category: product.category || '',
                price: product.sale_price,
                unit: product.unit || 'unidad',
                quantity: quantity
            });
        }
        
        this.save();
        this.render();
    },
    
    updateQuantity(productId, quantity) {
        const item = this.items.find(i => i.id === productId);
        if (item) {
            item.quantity = Math.max(0.01, parseFloat(quantity));
            this.save();
            this.render();
        }
    },
    
    increaseQty(productId) {
        const item = this.items.find(i => i.id === productId);
        if (item) {
            item.quantity += 1;
            this.save();
            this.render();
        }
    },
    
    decreaseQty(productId) {
        const item = this.items.find(i => i.id === productId);
        if (item && item.quantity > 0.01) {
            item.quantity = Math.max(0.01, item.quantity - 1);
            this.save();
            this.render();
        }
    },
    
    removeItem(productId) {
        this.items = this.items.filter(i => i.id !== productId);
        this.save();
        this.render();
    },
    
    clear() {
        this.items = [];
        this.save();
        this.render();
    },
    
    getTotal() {
        return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    },
    
    save() {
        localStorage.setItem('quevendi_cart', JSON.stringify(this.items));
    },
    
    load() {
        const saved = localStorage.getItem('quevendi_cart');
        if (saved) {
            this.items = JSON.parse(saved);
        }
    },
    
    render() {
        const container = document.getElementById('cart-container');
        if (!container) return;
        
        if (this.items.length === 0) {
            container.innerHTML = `
                <div class="empty-cart">
                    <p>🛒 Carrito vacío</p>
                    <p class="text-muted">Usa el micrófono o busca productos</p>
                </div>
            `;
            return;
        }
        
        const html = `
            <div class="cart-panel">
                <div class="cart-header">
                    <h3>Productos del Pedido</h3>
                    <button class="btn-clear" onclick="CartManager.clear()">Limpiar</button>
                </div>
                
                <div class="cart-items">
                    ${this.items.map(item => `
                        <div class="cart-item" data-id="${item.id}">
                            <div class="item-info">
                                <strong>${item.name}</strong>
                                <small class="text-muted">${item.code || ''}</small>
                            </div>
                            
                            <div class="quantity-controls">
                                <button class="btn-qty" onclick="CartManager.decreaseQty(${item.id})">−</button>
                                <input type="number" 
                                       class="qty-input"
                                       value="${item.quantity}" 
                                       min="0.01"
                                       step="0.01"
                                       onchange="CartManager.updateQuantity(${item.id}, this.value)">
                                <button class="btn-qty" onclick="CartManager.increaseQty(${item.id})">+</button>
                            </div>
                            
                            <div class="item-prices">
                                <small>S/. ${item.price.toFixed(2)}/${item.unit}</small>
                                <strong>S/. ${(item.price * item.quantity).toFixed(2)}</strong>
                            </div>
                            
                            <button class="btn-remove" onclick="CartManager.removeItem(${item.id})">🗑️</button>
                        </div>
                    `).join('')}
                </div>
                
                <div class="cart-footer">
                    <div class="cart-total">
                        <span>Total:</span>
                        <strong>S/. ${this.getTotal().toFixed(2)}</strong>
                    </div>
                    <button class="btn-confirm" onclick="confirmOrder()">
                        CONFIRMAR PEDIDO
                    </button>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }
};

// ========================================
// BÚSQUEDA DE PRODUCTOS
// ========================================

async function searchProducts(query) {
    console.log('[Search] Buscando:', query);
    
    try {
        const response = await fetchWithAuth('/api/v1/products/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                query: query,
                store_id: null  // Se obtiene del token
            })
        });
        
        const products = await response.json();
        console.log('[Search] Resultados:', products.length);
        
        if (products.length > 0) {
            showProductSelectionModal(query, products);
        } else {
            await speak('No se encontraron productos');
        }
        
    } catch (error) {
        console.error('[Search] Error:', error);
        await speak('Error al buscar productos');
    }
}

// ========================================
// MODAL DE SELECCIÓN
// ========================================

function showProductSelectionModal(query, products) {
    const modal = document.createElement('div');
    modal.className = 'modal show';
    modal.id = 'search-modal';
    modal.style.display = 'flex';
    
    const html = `
        <div class="modal-content search-modal-content">
            <div class="modal-header">
                <h2>BUSCAR PRODUCTOS</h2>
                <button class="modal-close" onclick="closeSearchModal()">✕</button>
            </div>
            
            <div class="search-bar">
                <input type="text" 
                       id="search-input" 
                       value="${query}" 
                       placeholder="Buscar..."
                       onkeyup="handleSearchInput(event)">
                <button class="btn-mic" onclick="startVoiceSearch()">🎤</button>
                <button class="btn-check" onclick="addSelectedProducts()">✓</button>
            </div>
            
            <div class="selection-count">
                <span id="selected-count">0 seleccionados</span>
            </div>
            
            <div class="product-list">
                ${products.map(p => `
                    <label class="product-item">
                        <input type="checkbox" 
                               class="product-checkbox"
                               data-id="${p.id}" 
                               data-name="${p.name}"
                               data-code="${p.code || ''}"
                               data-category="${p.category || ''}"
                               data-price="${p.sale_price}"
                               data-unit="${p.unit || 'unidad'}"
                               onchange="updateSelectionCount()">
                        
                        <div class="product-info">
                            <div class="product-name">${p.name}</div>
                            <div class="product-meta">
                                <span class="product-code">Código: ${p.code || 'N/A'}</span>
                                <span class="product-category">${p.category || ''}</span>
                            </div>
                        </div>
                        
                        <div class="product-price">S/. ${p.sale_price.toFixed(2)}</div>
                    </label>
                `).join('')}
            </div>
        </div>
    `;
    
    modal.innerHTML = html;
    document.body.appendChild(modal);
    
    // Focus en el input
    setTimeout(() => {
        document.getElementById('search-input')?.focus();
    }, 100);
}

function updateSelectionCount() {
    const selected = document.querySelectorAll('.product-checkbox:checked').length;
    const counter = document.getElementById('selected-count');
    if (counter) {
        counter.textContent = `${selected} seleccionado${selected !== 1 ? 's' : ''}`;
    }
}

function handleSearchInput(event) {
    if (event.key === 'Enter') {
        const query = event.target.value.trim();
        if (query) {
            closeSearchModal();
            searchProducts(query);
        }
    }
}

function startVoiceSearch() {
    closeSearchModal();
    // Activar el sistema de voz existente
    const micBtn = document.getElementById('mic-status');
    if (micBtn) {
        micBtn.click();
    }
}

function addSelectedProducts() {
    const checkboxes = document.querySelectorAll('.product-checkbox:checked');
    
    if (checkboxes.length === 0) {
        speak('No hay productos seleccionados');
        return;
    }
    
    checkboxes.forEach(checkbox => {
        const product = {
            id: parseInt(checkbox.dataset.id),
            name: checkbox.dataset.name,
            code: checkbox.dataset.code,
            category: checkbox.dataset.category,
            sale_price: parseFloat(checkbox.dataset.price),
            unit: checkbox.dataset.unit
        };
        
        CartManager.addItem(product, 1);
    });
    
    closeSearchModal();
    speak(`${checkboxes.length} producto${checkboxes.length !== 1 ? 's' : ''} agregado${checkboxes.length !== 1 ? 's' : ''}`);
}

function closeSearchModal() {
    const modal = document.getElementById('search-modal');
    if (modal) {
        modal.remove();
    }
}

// ========================================
// CONFIRMAR PEDIDO
// ========================================

async function confirmOrder() {
    if (CartManager.items.length === 0) {
        await speak('El carrito está vacío');
        return;
    }
    
    try {
        const response = await fetchWithAuth('/api/v1/sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: CartManager.items.map(item => ({
                    product_id: item.id,
                    quantity: item.quantity,
                    unit_price: item.price
                })),
                payment_method: 'cash'
            })
        });
        
        if (response.ok) {
            await speak('Pedido confirmado');
            CartManager.clear();
            playSound('success');
            
            // Recargar stats
            htmx.trigger('#sales-stats', 'refresh');
        }
        
    } catch (error) {
        console.error('[Order] Error:', error);
        await speak('Error al confirmar pedido');
        playSound('error');
    }
}

// ========================================
// INTEGRACIÓN CON VOZ
// ========================================

// Modificar handleCommand para usar el nuevo sistema
window.handleVoiceSearch = function(query) {
    searchProducts(query);
};

// Inicializar al cargar
document.addEventListener('DOMContentLoaded', () => {
    CartManager.load();
    CartManager.render();
});