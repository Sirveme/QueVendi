/**
 * ============================================
 * MEJORAS VISUALES PARA EL CARRITO
 * Mantener el nivel WOW después del modal
 * ============================================
 * 
 * UBICACIÓN: static/js/modules/cart-animations.js
 */

// ============================================
// 1. ANIMACIONES AL AGREGAR PRODUCTO
// ============================================

function animateProductAdded(productElement) {
    // Efecto de entrada
    productElement.style.animation = 'slideInRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    
    // Highlight temporal
    productElement.style.backgroundColor = 'rgba(102, 126, 234, 0.2)';
    
    setTimeout(() => {
        productElement.style.backgroundColor = '';
    }, 1000);
}

// ============================================
// 2. CONTADOR ANIMADO
// ============================================

function animateCartCount(newCount) {
    const countElement = document.getElementById('cart-count');
    if (!countElement) return;
    
    // Bounce effect
    countElement.style.animation = 'bounce 0.6s ease-out';
    
    // Actualizar número
    countElement.textContent = newCount;
    
    // Cambiar color temporalmente
    countElement.style.color = '#ffd700';
    setTimeout(() => {
        countElement.style.color = '';
    }, 600);
}

// ============================================
// 3. TOTAL ANIMADO
// ============================================

function animateCartTotal(newTotal) {
    const totalElement = document.getElementById('cart-total');
    if (!totalElement) return;
    
    const oldTotal = parseFloat(totalElement.textContent.replace('S/. ', '')) || 0;
    
    // Animar cambio de número
    animateNumber(totalElement, oldTotal, newTotal, 500);
    
    // Efecto de brillo
    totalElement.style.animation = 'glow 0.8s ease-out';
}

function animateNumber(element, start, end, duration) {
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function (easeOutCubic)
        const eased = 1 - Math.pow(1 - progress, 3);
        
        const current = start + (end - start) * eased;
        element.textContent = `S/. ${current.toFixed(2)}`;
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

// ============================================
// 4. MEJORAS VISUALES DEL CARRITO
// ============================================

function enhanceCartVisuals() {
    const cartContainer = document.getElementById('cart-items');
    if (!cartContainer) return;
    
    // Agregar gradiente sutil al fondo
    cartContainer.style.background = `
        linear-gradient(
            to bottom,
            rgba(102, 126, 234, 0.05) 0%,
            rgba(118, 75, 162, 0.05) 100%
        )
    `;
    
    // Mejorar cada item del carrito
    const items = cartContainer.querySelectorAll('.cart-item');
    items.forEach((item, index) => {
        // Delay de entrada progresivo
        item.style.animationDelay = `${index * 0.1}s`;
        item.style.animation = 'fadeInUp 0.4s ease-out forwards';
        
        // Hover effect
        item.addEventListener('mouseenter', () => {
            item.style.transform = 'translateX(5px)';
            item.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.2)';
        });
        
        item.addEventListener('mouseleave', () => {
            item.style.transform = '';
            item.style.boxShadow = '';
        });
    });
}

// ============================================
// 5. EMOJIS DINÁMICOS EN CARRITO
// ============================================

function addEmojiToCartItems() {
    const items = document.querySelectorAll('.cart-item');
    
    items.forEach(item => {
        const nameElement = item.querySelector('.cart-item-name');
        if (!nameElement) return;
        
        const productName = nameElement.textContent;
        const emoji = getProductEmoji(productName);
        
        // Agregar emoji si no existe
        if (!nameElement.querySelector('.product-emoji')) {
            const emojiSpan = document.createElement('span');
            emojiSpan.className = 'product-emoji';
            emojiSpan.textContent = emoji + ' ';
            nameElement.prepend(emojiSpan);
        }
    });
}

// ============================================
// 6. INDICADOR DE AHORRO (para conversiones)
// ============================================

function showSavingsIndicator(item) {
    // Si compró por monto (conversión)
    if (item.searchByAmount) {
        const savingsElement = document.createElement('div');
        savingsElement.className = 'savings-badge';
        savingsElement.innerHTML = `
            💰 Compra exacta: S/. ${item.amount.toFixed(2)}
        `;
        
        const itemElement = document.querySelector(`[data-product-id="${item.id}"]`);
        if (itemElement) {
            itemElement.appendChild(savingsElement);
        }
    }
}

// ============================================
// 7. MINI-ANIMACIÓN AL ELIMINAR
// ============================================

function animateItemRemoval(itemElement, callback) {
    // Animación de salida
    itemElement.style.animation = 'slideOutRight 0.4s ease-out';
    
    setTimeout(() => {
        itemElement.style.opacity = '0';
        itemElement.style.transform = 'translateX(100%)';
        
        setTimeout(() => {
            if (callback) callback();
        }, 100);
    }, 300);
}

// ============================================
// 8. CONFETTI EFFECT AL CONFIRMAR VENTA
// ============================================

function celebrateSale() {
    // Crear confetti simple con emojis
    const emojis = ['🎉', '✨', '💰', '🎊', '⭐'];
    const container = document.body;
    
    for (let i = 0; i < 30; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.fontSize = (Math.random() * 20 + 20) + 'px';
        
        container.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 3000);
    }
}

// ============================================
// 9. PROGRESS BAR PARA META DE VENTA
// ============================================

function updateSalesGoalProgress(currentTotal, goalAmount = 100) {
    const progressBar = document.getElementById('sales-goal-progress');
    if (!progressBar) return;
    
    const percentage = Math.min((currentTotal / goalAmount) * 100, 100);
    
    progressBar.style.width = percentage + '%';
    progressBar.style.background = percentage >= 100 ? 
        'linear-gradient(90deg, #4ade80 0%, #22c55e 100%)' :
        'linear-gradient(90deg, #667eea 0%, #764ba2 100%)';
    
    if (percentage >= 100) {
        celebrateSale();
    }
}

// ============================================
// 10. CSS PARA TODAS LAS ANIMACIONES
// ============================================

function injectCartAnimationCSS() {
    if (document.getElementById('cart-animations-css')) return;
    
    const style = document.createElement('style');
    style.id = 'cart-animations-css';
    style.textContent = `
        @keyframes slideInRight {
            from {
                opacity: 0;
                transform: translateX(50px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        @keyframes slideOutRight {
            from {
                opacity: 1;
                transform: translateX(0);
            }
            to {
                opacity: 0;
                transform: translateX(100px);
            }
        }
        
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes bounce {
            0%, 100% {
                transform: scale(1);
            }
            25% {
                transform: scale(1.3);
            }
            50% {
                transform: scale(0.9);
            }
            75% {
                transform: scale(1.1);
            }
        }
        
        @keyframes glow {
            0%, 100% {
                text-shadow: 0 0 5px rgba(255, 215, 0, 0);
            }
            50% {
                text-shadow: 0 0 20px rgba(255, 215, 0, 0.8);
            }
        }
        
        .confetti {
            position: fixed;
            top: -50px;
            z-index: 99999;
            animation: fall 3s linear forwards;
            pointer-events: none;
        }
        
        @keyframes fall {
            to {
                top: 110vh;
                transform: rotate(720deg);
            }
        }
        
        .cart-item {
            transition: all 0.3s ease-out;
        }
        
        .product-emoji {
            font-size: 1.3em;
            margin-right: 8px;
        }
        
        .savings-badge {
            background: linear-gradient(90deg, #4ade80 0%, #22c55e 100%);
            color: white;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: bold;
            margin-top: 5px;
            display: inline-block;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% {
                opacity: 1;
            }
            50% {
                opacity: 0.7;
            }
        }
        
        #sales-goal-progress {
            height: 4px;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            border-radius: 2px;
            transition: width 0.5s ease-out, background 0.3s ease-out;
        }
    `;
    
    document.head.appendChild(style);
}

// ============================================
// 11. INTEGRACIÓN CON renderCart
// ============================================

// Modificar renderCart existente:
const originalRenderCart = window.renderCart;

window.renderCart = function() {
    // Llamar a función original
    if (originalRenderCart) {
        originalRenderCart();
    }
    
    // Agregar mejoras visuales
    setTimeout(() => {
        enhanceCartVisuals();
        addEmojiToCartItems();
        animateCartCount(AppState.cart.length);
        animateCartTotal(getCartTotal());
    }, 50);
};

// ============================================
// 12. EXPORTS
// ============================================

window.CartAnimations = {
    animateProductAdded,
    animateCartCount,
    animateCartTotal,
    enhanceCartVisuals,
    addEmojiToCartItems,
    animateItemRemoval,
    celebrateSale,
    updateSalesGoalProgress
};

// Inyectar CSS al cargar
document.addEventListener('DOMContentLoaded', injectCartAnimationCSS);

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectCartAnimationCSS();
}

console.log('[CartAnimations] ✅ Módulo cargado');