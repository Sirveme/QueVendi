/**
 * ============================================
 * LAYERED VARIANTS MODAL - PREMIUM WOW EFFECT
 * ============================================
 * 
 * Sistema de selección por capas para listas largas
 * Diseño premium con animaciones y efectos visuales
 */

// ============================================
// 1. CONFIGURACIÓN
// ============================================

const LAYER_CONFIG = {
    itemsPerLayer: 6,
    animationDuration: 400,
    cardAnimationDelay: 80,
    celebrationDuration: 2000
};

// Estado global del modal
let layerState = {
    allProducts: [],
    currentLayer: 0,
    totalLayers: 0,
    selections: [],
    modalElement: null
};

// ============================================
// 2. FUNCIÓN PRINCIPAL
// ============================================

function showLayeredVariantsModal(productsList) {
    console.log('[LayeredVariants] 🎨 Iniciando con', productsList.length, 'productos');
    
    // Inicializar estado
    layerState.allProducts = productsList;
    layerState.totalLayers = Math.ceil(productsList.length / LAYER_CONFIG.itemsPerLayer);
    layerState.currentLayer = 0;
    layerState.selections = [];
    
    // Pre-seleccionar primera variante de cada producto
    productsList.forEach(product => {
        if (product.variants && product.variants.length > 0) {
            layerState.selections.push({
                productName: product.search_term,
                quantity: product.quantity,
                selected: null
                //selected: product.variants[0]
            });
        }
    });
    
    // Inyectar CSS si no existe
    injectLayeredVariantsCSS();
    
    // Mostrar primera capa
    showLayer(0);
}

// ============================================
// 3. MOSTRAR CAPA
// ============================================

function showLayer(layerIndex) {
    console.log('[LayeredVariants] 📄 Mostrando capa', layerIndex + 1, 'de', layerState.totalLayers);
    
    const start = layerIndex * LAYER_CONFIG.itemsPerLayer;
    const end = Math.min(start + LAYER_CONFIG.itemsPerLayer, layerState.allProducts.length);
    const layerProducts = layerState.allProducts.slice(start, end);
    
    // Remover modal anterior si existe
    if (layerState.modalElement) {
        layerState.modalElement.classList.add('fade-out-layer');
        setTimeout(() => {
            layerState.modalElement.remove();
        }, LAYER_CONFIG.animationDuration);
    }
    
    // Crear nuevo modal
    setTimeout(() => {
        createLayerModal(layerProducts, layerIndex);
    }, layerState.modalElement ? LAYER_CONFIG.animationDuration : 0);
}

// ============================================
// 4. CREAR MODAL DE CAPA
// ============================================

function createLayerModal(products, layerIndex) {
    const modal = document.createElement('div');
    modal.className = 'layered-variants-modal';
    layerState.modalElement = modal;
    
    const isLastLayer = layerIndex === layerState.totalLayers - 1;
    const totalSelected = layerState.allProducts.length;
    const progressPercent = ((layerIndex + 1) / layerState.totalLayers) * 100;
    
    modal.innerHTML = `
        <div class="layered-variants-overlay"></div>
        <div class="layered-variants-container">
            <!-- Header Premium -->
            <div class="layered-header">
                <div class="header-left">
                    <div class="layer-badge">
                        <span class="layer-number">${layerIndex + 1}</span>
                        <span class="layer-separator">/</span>
                        <span class="layer-total">${layerState.totalLayers}</span>
                    </div>
                    <h2 class="header-title">
                        <span class="title-icon">🛒</span>
                        Selecciona tus productos
                    </h2>
                </div>
                <button class="header-close" onclick="closeLayeredVariants()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <!-- Progress Bar -->
            <div class="layer-progress-container">
                <div class="layer-progress-bar" style="width: ${progressPercent}%"></div>
                <div class="layer-progress-text">${totalSelected} productos</div>
            </div>
            
            <!-- Grid de Productos -->
            <div class="variants-grid">
                ${products.map((product, productIndex) => createProductCard(product, layerIndex * LAYER_CONFIG.itemsPerLayer + productIndex)).join('')}
            </div>
            
            <!-- Footer con Acciones -->
            <div class="layered-footer">
                <div class="footer-summary">
                    <div class="summary-icon">💰</div>
                    <div class="summary-text">
                        <div class="summary-label">Total estimado</div>
                        <div class="summary-amount" id="layer-total">S/. 0.00</div>
                    </div>
                </div>
                
                <div class="footer-actions">
                    ${layerIndex > 0 ? `
                        <button class="btn-layer btn-back" onclick="goToPreviousLayer()">
                            <i class="fas fa-arrow-left"></i>
                            Anterior
                        </button>
                    ` : ''}
                    
                    ${!isLastLayer ? `
                        <button class="btn-layer btn-next" onclick="goToNextLayer()">
                            Siguiente
                            <i class="fas fa-arrow-right"></i>
                        </button>
                    ` : `
                        <button class="btn-layer btn-finish" onclick="finalizeLayeredSelection()">
                            <i class="fas fa-check-circle"></i>
                            Agregar Todo
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Animar entrada
    setTimeout(() => modal.classList.add('show'), 10);
    
    // Animar tarjetas progresivamente
    const cards = modal.querySelectorAll('.variant-card');
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('animate-in');
        }, index * LAYER_CONFIG.cardAnimationDelay);
    });
    
    // Actualizar total
    updateLayerTotal();
    
    // Voz
    if (layerIndex === 0) {
        speak(`${totalSelected} productos encontrados. Selecciona las variantes que prefieres.`);
    } else {
        speak(`Capa ${layerIndex + 1} de ${layerState.totalLayers}`);
    }
}

// ============================================
// 5. CREAR TARJETA DE PRODUCTO
// ============================================

function createProductCard(product, globalIndex) {
    const emoji = getProductEmoji(product.search_term);
    const currentSelection = layerState.selections[globalIndex];
    
    return `
        <div class="variant-card" data-product-index="${globalIndex}">
            <div class="card-header">
                <div class="card-emoji">${emoji}</div>
                <div class="card-title-group">
                    <div class="card-title">${product.search_term.toUpperCase()}</div>
                    ${product.searchByAmount 
                        ? `<div class="card-amount">S/. ${product.amount.toFixed(2)}</div>`
                        : `<div class="card-quantity">× ${product.quantity}</div>`
                    }
                </div>
            </div>
            
            <div class="card-variants">
                ${product.variants.map((variant, variantIndex) => `
                    <label class="variant-option" 
                           data-variant-index="${variantIndex}">
                        <input type="radio" 
                               name="variant-${globalIndex}" 
                               value="${variantIndex}"
                               onchange="selectVariant(${globalIndex}, ${variantIndex})">
                        <div class="variant-content">
                            <div class="variant-name">${variant.name}</div>
                            <div class="variant-price">S/. ${variant.price.toFixed(2)}</div>
                        </div>
                        <div class="variant-check">
                            <i class="fas fa-check-circle"></i>
                        </div>
                    </label>
                `).join('')}
            </div>
            
            <div class="card-footer">
                <div class="card-subtotal">
                    ${currentSelection && currentSelection.selected 
                        ? `S/. ${(currentSelection.selected.price * product.quantity).toFixed(2)}`
                        : `<span style="opacity: 0.5;">Selecciona una opción</span>`
                    }
                </div>
            </div>
        </div>
    `;
}

// ============================================
// 6. MANEJADORES DE EVENTOS
// ============================================

function selectVariant(productIndex, variantIndex) {
    const product = layerState.allProducts[productIndex];
    const variant = product.variants[variantIndex];
    
    // Actualizar selección en estado
    layerState.selections[productIndex].selected = variant;
    
    // ✅ NUEVO: Si es búsqueda por monto, calcular cantidad automáticamente
    if (product.searchByAmount && product.amount) {
        const calculatedQty = product.amount / variant.price;
        layerState.selections[productIndex].quantity = calculatedQty;
        
        console.log('[LayeredVariants] Cantidad calculada por monto:', {
            monto: product.amount,
            precio: variant.price,
            cantidad: calculatedQty
        });
    }
    
    // ✅ ACTUALIZAR UI: Desmarcar todas las opciones primero
    const card = document.querySelector(`[data-product-index="${productIndex}"]`);
    if (card) {
        // Remover 'selected' de TODAS las opciones
        card.querySelectorAll('.variant-option').forEach(option => {
            option.classList.remove('selected');
        });
        
        // Agregar 'selected' solo a la opción clickeada
        const selectedOption = card.querySelector(`input[value="${variantIndex}"]`)?.closest('.variant-option');
        if (selectedOption) {
            selectedOption.classList.add('selected');
        }
        
        // ✅ Animar selección
        selectedOption?.classList.add('pulse-once');
        setTimeout(() => selectedOption?.classList.remove('pulse-once'), 600);
    }
    
    console.log('[LayeredVariants] ✅ Seleccionado:', variant.name);
    
    // Actualizar total
    updateLayerTotal();
}

function updateLayerTotal() {
    const total = layerState.selections.reduce((sum, selection) => {
        // ✅ AGREGAR validación:
        if (!selection.selected) {
            return sum;
        }
        return sum + (selection.selected.price * selection.quantity);
    }, 0);
    
    const totalElement = document.getElementById('layer-total');
    if (totalElement) {
        animateNumber(totalElement, parseFloat(totalElement.textContent.replace('S/. ', '')) || 0, total);
    }
}

function animateNumber(element, start, end) {
    const duration = 500;
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (end - start) * eased;
        
        element.textContent = `S/. ${current.toFixed(2)}`;
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

function goToNextLayer() {
    if (layerState.currentLayer < layerState.totalLayers - 1) {
        layerState.currentLayer++;
        showLayer(layerState.currentLayer);
    }
}

function goToPreviousLayer() {
    if (layerState.currentLayer > 0) {
        layerState.currentLayer--;
        showLayer(layerState.currentLayer);
    }
}

function finalizeLayeredSelection() {
    console.log('[LayeredVariants] 🎉 Finalizando selección');

    // ✅ Auto-seleccionar primera variante SOLO si está vacía
    layerState.selections.forEach((selection, index) => {
        if (!selection.selected && layerState.allProducts[index].variants.length > 0) {
            const firstVariant = layerState.allProducts[index].variants[0];
            selection.selected = firstVariant;
            
            // Si es búsqueda por monto, calcular cantidad
            const product = layerState.allProducts[index];
            if (product.searchByAmount && product.amount) {
                selection.quantity = product.amount / firstVariant.price;
            }
            
            console.log('[LayeredVariants] ⚠️ Auto-completado:', firstVariant.name);
        }
    });
    
    // Cerrar modal con animación
    if (layerState.modalElement) {
        layerState.modalElement.classList.add('fade-out-layer');
        
        setTimeout(() => {
            layerState.modalElement.remove();
            
            // Agregar todos al carrito
            const addedItems = [];
            
            layerState.selections.forEach(selection => {
                // ✅ VALIDAR que selected existe:
                if (!selection.selected) {
                    console.warn('[LayeredVariants] Producto sin selección:', selection.productName);
                    return; // Skip este producto
                }
                
                const product = {
                    id: selection.selected.product_id,
                    name: selection.selected.name,
                    sale_price: selection.selected.price,
                    unit: selection.selected.unit,
                    stock: selection.selected.stock
                };
                
                addToCart(product, selection.quantity, true);
                
                addedItems.push({
                    name: product.name,
                    quantity: selection.quantity,
                    unit: product.unit,
                    price: product.sale_price
                });
            });
            
            // ✅ VALIDAR que hay items antes de mostrar:
            if (addedItems.length > 0) {
                setTimeout(() => {
                    celebrateCompletion(addedItems.length);
                    
                    const total = getCartTotal();
                    speak(`${addedItems.length} productos agregados. Total: ${total.toFixed(2)} soles`);
                }, 300);
            } else {
                showToast('No se seleccionó ningún producto', 'warning');
            }
            
        }, LAYER_CONFIG.animationDuration);
    }
}

function closeLayeredVariants() {
    if (confirm('¿Cancelar selección de productos?')) {
        if (layerState.modalElement) {
            layerState.modalElement.classList.add('fade-out-layer');
            setTimeout(() => {
                layerState.modalElement.remove();
                layerState = {
                    allProducts: [],
                    currentLayer: 0,
                    totalLayers: 0,
                    selections: [],
                    modalElement: null
                };
            }, LAYER_CONFIG.animationDuration);
        }
    }
}

// ============================================
// 7. CELEBRACIÓN
// ============================================

function celebrateCompletion(itemCount) {
    // Confetti
    const emojis = ['🎉', '✨', '🎊', '⭐', '💫', '🌟'];
    const container = document.body;
    
    for (let i = 0; i < Math.min(itemCount * 5, 50); i++) {
        const confetti = document.createElement('div');
        confetti.className = 'celebration-confetti';
        confetti.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.fontSize = (Math.random() * 20 + 20) + 'px';
        
        container.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), LAYER_CONFIG.celebrationDuration);
    }
    
    // Sonido de éxito
    if (window.UIFeedback) {
        window.UIFeedback.playSuccessSound();
    }
}

// ============================================
// 8. UTILIDADES
// ============================================

function getProductEmoji(productName) {
    const name = productName.toLowerCase();
    const emojiMap = {
        'pan': '🍞',
        'leche': '🥛',
        'huevo': '🥚',
        'mantequilla': '🧈',
        'arroz': '🍚',
        'aceite': '🛢️',
        'azucar': '🍬',
        'sal': '🧂',
        'fideos': '🍝',
        'atun': '🐟',
        'galleta': '🍪',
        'gaseosa': '🥤',
        'cerveza': '🍺',
        'papel': '🧻',
        'detergente': '🧴',
        'jabon': '🧼',
        'carne': '🥩',
        'pollo': '🍗',
        'pescado': '🐟',
        'fruta': '🍎',
        'verdura': '🥬'
    };
    
    for (const [key, emoji] of Object.entries(emojiMap)) {
        if (name.includes(key)) {
            return emoji;
        }
    }
    
    return '📦';
}

function playSuccessSound() {
    // Sonido sutil de click
    if (window.UIFeedback && window.UIFeedback.playSuccessSound) {
        // Usar sonido existente si está disponible
    }
}

// ============================================
// 9. CSS PREMIUM
// ============================================

function injectLayeredVariantsCSS() {
    if (document.getElementById('layered-variants-css')) return;
    
    const style = document.createElement('style');
    style.id = 'layered-variants-css';
    style.textContent = `
        /* Modal Container */
        .layered-variants-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 99999;
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.4s ease-out;
        }
        
        .layered-variants-modal.show {
            opacity: 1;
        }
        
        .layered-variants-modal.fade-out-layer {
            opacity: 0;
            transform: scale(0.95);
        }
        
        .layered-variants-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            backdrop-filter: blur(8px);
        }
        
        .layered-variants-container {
            position: relative;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 24px;
            max-width: 1200px;
            width: 95%;
            max-height: 90vh;
            overflow: hidden;
            box-shadow: 0 30px 80px rgba(0, 0, 0, 0.8);
            display: flex;
            flex-direction: column;
        }
        
        /* Header */
        .layered-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 25px 30px;
            background: rgba(0, 0, 0, 0.3);
            border-bottom: 2px solid rgba(102, 126, 234, 0.3);
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 20px;
        }
        
        .layer-badge {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 8px 16px;
            border-radius: 12px;
            font-weight: bold;
            font-size: 18px;
            color: white;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        
        .layer-separator {
            margin: 0 5px;
            opacity: 0.6;
        }
        
        .header-title {
            margin: 0;
            color: white;
            font-size: 24px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .title-icon {
            font-size: 28px;
        }
        
        .header-close {
            background: rgba(255, 255, 255, 0.1);
            border: none;
            color: white;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 20px;
            transition: all 0.3s;
        }
        
        .header-close:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: rotate(90deg);
        }
        
        /* Progress Bar */
        .layer-progress-container {
            position: relative;
            height: 6px;
            background: rgba(255, 255, 255, 0.1);
            margin: 0 30px;
        }
        
        .layer-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
            box-shadow: 0 0 20px rgba(102, 126, 234, 0.8);
        }
        
        .layer-progress-text {
            position: absolute;
            top: -25px;
            right: 0;
            color: rgba(255, 255, 255, 0.7);
            font-size: 14px;
            font-weight: 600;
        }
        
        /* Grid de Productos */
        .variants-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            padding: 30px;
            overflow-y: auto;
            flex: 1;
        }
        
        @media (max-width: 1024px) {
            .variants-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        
        @media (max-width: 768px) {
            .variants-grid {
                grid-template-columns: 1fr;
            }
        }
        
        /* Tarjeta de Producto */
        .variant-card {
            background: rgba(255, 255, 255, 0.05);
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 20px;
            transition: all 0.3s;
            opacity: 0;
            transform: translateY(20px);
        }
        
        .variant-card.animate-in {
            opacity: 1;
            transform: translateY(0);
        }
        
        .variant-card:hover {
            border-color: rgba(102, 126, 234, 0.6);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
            transform: translateY(-2px);
        }
        
        .variant-card.pulse {
            animation: cardPulse 0.4s ease-out;
        }
        
        @keyframes cardPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        
        .card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .card-amount {
            color: #48bb78;
            font-size: 14px;
            font-weight: 700;
            background: rgba(72, 187, 120, 0.2);
            padding: 4px 10px;
            border-radius: 6px;
        }
        
        .card-emoji {
            font-size: 32px;
        }
        
        .card-title-group {
            flex: 1;
        }
        
        .card-title {
            color: white;
            font-weight: 700;
            font-size: 14px;
            margin-bottom: 4px;
        }
        
        .card-quantity {
            color: rgba(255, 255, 255, 0.6);
            font-size: 13px;
        }
        
        .card-variants {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 15px;
        }
        
        .variant-option {
            position: relative;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: rgba(0, 0, 0, 0.3);
            border: 2px solid transparent;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .variant-option:hover {
            background: rgba(102, 126, 234, 0.2);
            border-color: rgba(102, 126, 234, 0.4);
        }
        
        .variant-option.selected {
            background: rgba(102, 126, 234, 0.3);
            border-color: rgba(102, 126, 234, 0.8);
        }
        
        .variant-option input[type="radio"] {
            appearance: none;
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .variant-option.selected input[type="radio"] {
            background: #667eea;
            border-color: #667eea;
        }
        
        .variant-content {
            flex: 1;
        }
        
        .variant-name {
            color: white;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 2px;
        }
        
        .variant-price {
            color: #48bb78;
            font-size: 16px;
            font-weight: 700;
        }
        
        .variant-check {
            color: #667eea;
            font-size: 20px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        
        .variant-option.selected .variant-check {
            opacity: 1;
        }
        
        .card-footer {
            padding-top: 15px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            text-align: right;
        }
        
        .card-subtotal {
            color: #ffd700;
            font-size: 20px;
            font-weight: 800;
            text-shadow: 0 2px 8px rgba(255, 215, 0, 0.3);
        }
        
        /* Footer */
        .layered-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 25px 30px;
            background: rgba(0, 0, 0, 0.3);
            border-top: 2px solid rgba(102, 126, 234, 0.3);
        }
        
        .footer-summary {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .summary-icon {
            font-size: 40px;
        }
        
        .summary-label {
            color: rgba(255, 255, 255, 0.7);
            font-size: 14px;
            margin-bottom: 5px;
        }
        
        .summary-amount {
            color: #ffd700;
            font-size: 32px;
            font-weight: 900;
            text-shadow: 0 2px 15px rgba(255, 215, 0, 0.5);
        }
        
        .footer-actions {
            display: flex;
            gap: 15px;
        }
        
        .btn-layer {
            padding: 15px 30px;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .btn-back {
            background: rgba(255, 255, 255, 0.1);
            color: white;
        }
        
        .btn-back:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: translateX(-5px);
        }
        
        .btn-next {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        
        .btn-next:hover {
            transform: translateX(5px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        
        .btn-finish {
            background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
            color: white;
            box-shadow: 0 4px 15px rgba(72, 187, 120, 0.4);
        }
        
        .btn-finish:hover {
            transform: scale(1.05);
            box-shadow: 0 6px 20px rgba(72, 187, 120, 0.6);
        }
        
        /* Celebración */
        .celebration-confetti {
            position: fixed;
            top: -50px;
            z-index: 999999;
            animation: confettiFall 2s linear forwards;
            pointer-events: none;
        }
        
        @keyframes confettiFall {
            to {
                top: 110vh;
                transform: rotate(720deg);
            }
        }
    `;
    
    document.head.appendChild(style);
}

// ============================================
// 10. EXPORTS
// ============================================

window.LayeredVariants = {
    show: showLayeredVariantsModal,
    close: closeLayeredVariants
};

// Funciones globales para onclick
window.selectVariant = selectVariant;
window.goToNextLayer = goToNextLayer;
window.goToPreviousLayer = goToPreviousLayer;
window.finalizeLayeredSelection = finalizeLayeredSelection;
window.closeLayeredVariants = closeLayeredVariants;

console.log('[LayeredVariants] ✅ Módulo cargado');