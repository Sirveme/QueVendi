/**
 * ============================================
 * UI FEEDBACK MODULE
 * ============================================
 * 
 * UBICACIÓN: static/js/modules/ui-feedback.js
 * 
 * Feedback visual y sonoro premium:
 * - Confirmación grande cuando se agrega producto
 * - Cliente VE lo que se agregó
 * - Transparencia total
 * - Impresionante para demo
 * 
 * CRÍTICO para decisión en 1 minuto
 */

// ============================================
// 1. EMOJIS POR CATEGORÍA
// ============================================

const PRODUCT_EMOJIS = {
    // Frutas y verduras
    'papa': '🥔',
    'camote': '🍠',
    'yuca': '🥔',
    'arroz': '🍚',
    'fideos': '🍝',
    'pasta': '🍝',
    'pan': '🍞',
    'galleta': '🍪',
    
    // Bebidas
    'leche': '🥛',
    'cerveza': '🍺',
    'chamba': '🍺',
    'agua': '💧',
    'gaseosa': '🥤',
    'inca kola': '🥤',
    'coca cola': '🥤',
    
    // Carne y pollo
    'pollo': '🍗',
    'carne': '🥩',
    'pescado': '🐟',
    'huevo': '🥚',
    
    // Aceites y condimentos
    'aceite': '🛢️',
    'sal': '🧂',
    'azucar': '🍬',
    'azúcar': '🍬',
    
    // Default
    'default': '📦'
};

/**
 * Obtener emoji para producto
 */
function getProductEmoji(productName) {
    const name = productName.toLowerCase();
    
    for (const [key, emoji] of Object.entries(PRODUCT_EMOJIS)) {
        if (name.includes(key)) {
            return emoji;
        }
    }
    
    return PRODUCT_EMOJIS.default;
}

// ============================================
// 2. CONFIRMACIÓN VISUAL GRANDE
// ============================================

/**
 * Mostrar confirmación grande cuando se agrega producto
 * ¡ESTA ES LA FEATURE QUE HACE LA DIFERENCIA!
 */
function showLargeConfirmation(items) {
    // Remover confirmación anterior si existe
    const existing = document.getElementById('large-confirmation-modal');
    if (existing) {
        existing.remove();
    }
    
    const total = getCartTotal();
    const cartCount = AppState.cart.length;
    
    const modal = document.createElement('div');
    modal.id = 'large-confirmation-modal';
    modal.className = 'large-confirmation-modal';
    
    modal.innerHTML = `
        <div class="large-confirmation-content">
            <div class="confirmation-header">
                <h2>✅ AGREGADO</h2>
            </div>
            
            <div class="confirmation-items">
                ${items.map(item => `
                    <div class="confirmation-item">
                        <span class="item-emoji">${getProductEmoji(item.name)}</span>
                        <div class="item-details">
                            <span class="item-name">${item.name}</span>
                            <span class="item-quantity">${item.quantity} ${item.unit || 'und'}</span>
                        </div>
                        <span class="item-price">S/. ${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
            
            <div class="confirmation-footer">
                <div class="total-row">
                    <span>TOTAL</span>
                    <span class="total-amount">S/. ${total.toFixed(2)}</span>
                </div>
                <div class="cart-count">${cartCount} producto${cartCount > 1 ? 's' : ''}</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Animar entrada
    setTimeout(() => modal.classList.add('show'), 10);
    
    // Auto-cerrar en 2.5 segundos
    setTimeout(() => {
        modal.classList.add('fade-out');
        setTimeout(() => modal.remove(), 500);
    }, 2500);
}

/**
 * Inyectar CSS para confirmación
 */
function injectConfirmationCSS() {
    if (document.getElementById('large-confirmation-css')) {
        return; // Ya existe
    }
    
    const style = document.createElement('style');
    style.id = 'large-confirmation-css';
    style.textContent = `
        .large-confirmation-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.8);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 0;
            border-radius: 24px;
            box-shadow: 0 25px 80px rgba(0,0,0,0.5);
            z-index: 99999;
            min-width: 450px;
            max-width: 600px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        .large-confirmation-modal.show {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }
        
        .large-confirmation-modal.fade-out {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.9);
        }
        
        .large-confirmation-content {
            padding: 30px;
        }
        
        .confirmation-header h2 {
            margin: 0 0 25px 0;
            font-size: 2em;
            font-weight: 700;
            text-align: center;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        
        .confirmation-items {
            background: rgba(255,255,255,0.15);
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 20px;
            backdrop-filter: blur(10px);
        }
        
        .confirmation-item {
            display: flex;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .confirmation-item:last-child {
            border-bottom: none;
        }
        
        .item-emoji {
            font-size: 2.5em;
            margin-right: 20px;
            min-width: 50px;
            text-align: center;
        }
        
        .item-details {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        
        .item-name {
            font-size: 1.3em;
            font-weight: 600;
            margin-bottom: 5px;
        }
        
        .item-quantity {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .item-price {
            font-size: 1.4em;
            font-weight: 700;
            min-width: 100px;
            text-align: right;
        }
        
        .confirmation-footer {
            padding-top: 20px;
            border-top: 3px solid rgba(255,255,255,0.3);
        }
        
        .total-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .total-row span:first-child {
            font-size: 1.2em;
            font-weight: 600;
            letter-spacing: 2px;
        }
        
        .total-amount {
            font-size: 2.2em;
            font-weight: 800;
            text-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        
        .cart-count {
            text-align: center;
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        /* Responsive */
        @media (max-width: 600px) {
            .large-confirmation-modal {
                min-width: 90%;
                max-width: 90%;
            }
            
            .item-emoji {
                font-size: 2em;
                margin-right: 15px;
            }
            
            .item-name {
                font-size: 1.1em;
            }
            
            .total-amount {
                font-size: 1.8em;
            }
        }
    `;
    
    document.head.appendChild(style);
}

// ============================================
// 3. SONIDOS
// ============================================

/**
 * Reproducir sonido de éxito
 */
function playSuccessSound() {
    if (typeof playSound === 'function') {
        playSound('success');
    }
}

/**
 * Reproducir sonido de error
 */
function playErrorSound() {
    if (typeof playSound === 'function') {
        playSound('error');
    }
}

// ============================================
// 4. INTEGRACIÓN CON addToCart
// ============================================

/**
 * Wrapper para addToCart con confirmación visual
 */
function addToCartWithConfirmation(product, quantity, silent = false) {
    // Llamar a función original
    if (typeof addToCart === 'function') {
        addToCart(product, quantity, silent);
    }
    
    // Mostrar confirmación grande
    if (!silent) {
        const item = {
            name: product.name,
            quantity: quantity,
            unit: product.unit || 'unidad',
            price: product.sale_price
        };
        
        showLargeConfirmation([item]);
        playSuccessSound();
    }
}

// ============================================
// 5. EXPORTS
// ============================================

window.UIFeedback = {
    showLargeConfirmation,
    getProductEmoji,
    playSuccessSound,
    playErrorSound,
    addToCartWithConfirmation
};

// Inyectar CSS al cargar
document.addEventListener('DOMContentLoaded', () => {
    injectConfirmationCSS();
});

// Si ya está cargado
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectConfirmationCSS();
}

console.log('[UIFeedback] ✅ Módulo cargado');