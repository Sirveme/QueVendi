// Variables globales
let recognition;
let isListening = false;
let cartItems = []; // Carrito de productos
let isWaitingConfirmation = false;

/**
 * Inicializar reconocimiento de voz
 */
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error('[Voice] Web Speech API no soportada');
        alert('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.');
        return false;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.lang = 'es-PE';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    
    recognition.onstart = () => {
        console.log('[Voice] Reconocimiento iniciado');
        isListening = true;
        updateVoiceButton(true);
        document.getElementById('voice-status').style.display = 'block';
        document.getElementById('voice-status').innerHTML = '🎤 Escuchando...';
    };
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log('[Voice] Transcripción:', transcript);
        
        document.getElementById('transcription').innerHTML = `"${transcript}"`;
        document.getElementById('transcription').style.display = 'block';
        document.getElementById('voice-status').style.display = 'none';
        
        processVoiceCommand(transcript);
    };
    
    recognition.onerror = (event) => {
        console.error('[Voice] Error:', event.error);
        isListening = false;
        updateVoiceButton(false);
        
        if (event.error === 'no-speech') {
            showNotification('No escuché nada. Intenta de nuevo.', 'warning');
        } else if (event.error === 'not-allowed') {
            alert('Permiso de micrófono denegado.');
        } else {
            showNotification('Error: ' + event.error, 'error');
        }
    };
    
    recognition.onend = () => {
        console.log('[Voice] Reconocimiento terminado');
        isListening = false;
        updateVoiceButton(false);
    };
    
    return true;
}

function startVoiceCapture() {
    if (!recognition && !initSpeechRecognition()) return;
    if (isListening) {
        recognition.stop();
        return;
    }
    
    try {
        recognition.start();
    } catch (error) {
        console.error('[Voice] Error al iniciar:', error);
        showNotification('Error al iniciar micrófono', 'error');
    }
}

function updateVoiceButton(listening) {
    const voiceBtn = document.getElementById('voice-btn');
    const btnText = voiceBtn.querySelector('span');
    
    if (listening) {
        voiceBtn.classList.add('recording');
        btnText.textContent = 'ESCUCHANDO...';
    } else {
        voiceBtn.classList.remove('recording');
        btnText.textContent = 'VENDER POR VOZ';
    }
}

/**
 * Procesar comando de voz
 */
async function processVoiceCommand(text) {
    const transcriptionDiv = document.getElementById('transcription');
    
    console.log('[Voice] Procesando comando:', text);

    try {
        const response = await fetch('/api/sales/voice/parse', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: text })
        });

        const data = await response.json();
        console.log('[Voice] Respuesta del servidor:', data);

        if (!response.ok) {
            throw new Error(data.detail || 'No se pudo procesar el comando');
        }
        
        transcriptionDiv.style.display = 'none';
        
        // Agregar items al carrito
        cartItems = data.items;
        isWaitingConfirmation = true;
        
        showCart();
        
        if (data.warning) {
            showNotification(data.warning, 'warning');
        }
        
    } catch (error) {
        console.error('[Voice] Error al procesar:', error);
        transcriptionDiv.style.display = 'none';
        showNotification('No se pudo procesar: ' + error.message, 'error');
    }
}

/**
 * Mostrar carrito con todos los productos
 */
function showCart() {
    const confirmationCard = document.getElementById('confirmation-card');
    confirmationCard.style.display = 'block';
    
    let itemsHTML = '';
    let total = 0;
    
    cartItems.forEach((item, index) => {
        const subtotal = item.quantity * item.product.price;
        total += subtotal;
        
        // Detectar si el producto se vende por peso (kg, litros) o unidad
        // Basado en la categoría o nombre del producto
        const isByWeight = 
            item.product.unit === 'kg' || 
            item.product.unit === 'litro' ||
            item.product.category?.toLowerCase().includes('granel') ||
            item.product.category?.toLowerCase().includes('abarrotes') ||
            item.product.name?.toLowerCase().includes('kilo') ||
            item.product.name?.toLowerCase().includes('kg') ||
            item.product.name?.toLowerCase().includes('litro');
        
        itemsHTML += `
            <div class="cart-item" data-index="${index}">
                <div class="cart-item-header">
                    <div class="cart-item-name">${item.product.name}</div>
                    <button class="btn-remove" onclick="removeCartItem(${index})" title="Eliminar">✕</button>
                </div>
                
                <div class="cart-item-price">
                    <span>Precio:</span>
                    <input 
                        type="number" 
                        class="price-input" 
                        value="${item.product.price.toFixed(2)}"
                        step="0.10"
                        min="0"
                        onchange="updateItemPrice(${index}, this.value)"
                    >
                    <span>c/u</span>
                </div>
                
                <div class="cart-item-quantity">
                    ${isByWeight ? `
                        <div class="quantity-buttons">
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, -1)">-1</button>
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, -0.5)">-½</button>
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, -0.25)">-¼</button>
                        </div>
                    ` : `
                        <div class="quantity-buttons">
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, -5)">-5</button>
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, -1)">-1</button>
                        </div>
                    `}
                    
                    <input 
                        type="number" 
                        class="quantity-input" 
                        value="${item.quantity}"
                        step="${isByWeight ? '0.25' : '1'}"
                        min="0.25"
                        onchange="updateItemQuantity(${index}, this.value)"
                    >
                    
                    ${isByWeight ? `
                        <div class="quantity-buttons">
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, 0.25)">+¼</button>
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, 0.5)">+½</button>
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, 1)">+1</button>
                        </div>
                    ` : `
                        <div class="quantity-buttons">
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, 1)">+1</button>
                            <button class="btn-qty" onclick="changeItemQuantity(${index}, 5)">+5</button>
                        </div>
                    `}
                </div>
                
                <div class="cart-item-subtotal">
                    Subtotal: <strong>S/ ${subtotal.toFixed(2)}</strong>
                </div>
            </div>
        `;
    });
    
    confirmationCard.innerHTML = `
        <div class="cart-header">
            <span class="cart-badge">Confirma tu venta</span>
            <button class="btn-close" onclick="cancelCart()" title="Cancelar">✕</button>
        </div>
        
        <div class="cart-items">
            ${itemsHTML}
        </div>
        
        <div class="cart-actions">
            <button class="btn-action btn-voice" onclick="startVoiceCapture()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                </svg>
                Agregar más
            </button>
        </div>
        
        <div class="cart-total">
            <span class="total-label">TOTAL:</span>
            <span class="total-amount">S/ ${total.toFixed(2)}</span>
        </div>
        
        <div class="cart-buttons">
            <button class="btn btn-secondary" onclick="cancelCart()">Cancelar</button>
            <button class="btn btn-primary btn-confirm" onclick="confirmCart()">
                ✓ Confirmar Venta
            </button>
        </div>
    `;
}

function changeItemQuantity(index, delta) {
    const item = cartItems[index];
    let newQty = item.quantity + delta;
    
    if (newQty < 0.25) newQty = 0.25;
    if (newQty > item.product.stock) {
        showNotification(`Stock máximo: ${item.product.stock}`, 'warning');
        return;
    }
    
    item.quantity = newQty;
    showCart();
}

function updateItemQuantity(index, value) {
    const item = cartItems[index];
    let newQty = parseFloat(value);
    
    if (isNaN(newQty) || newQty < 0.25) newQty = 0.25;
    if (newQty > item.product.stock) {
        showNotification(`Stock máximo: ${item.product.stock}`, 'warning');
        newQty = item.product.stock;
    }
    
    item.quantity = newQty;
    showCart();
}

function updateItemPrice(index, value) {
    const item = cartItems[index];
    let newPrice = parseFloat(value);
    
    if (isNaN(newPrice) || newPrice < 0) newPrice = 0;
    
    item.product.price = newPrice;
    showCart();
}

function removeCartItem(index) {
    cartItems.splice(index, 1);
    
    if (cartItems.length === 0) {
        cancelCart();
    } else {
        showCart();
    }
}

async function confirmCart() {
    console.log('[Voice] Confirmando carrito:', cartItems);
    
    isWaitingConfirmation = false;
    
    const saleData = {
        items: cartItems.map(item => ({
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.product.price,
            subtotal: item.quantity * item.product.price
        })),
        payment_method: 'efectivo',
        payment_reference: null,
        customer_name: null,
        is_credit: false
    };

    try {
        const response = await fetch('/api/sales/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(saleData)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error('Error al guardar venta: ' + response.status);
        }

        const result = await response.json();
        console.log('[Voice] Venta guardada:', result);
        
        // Limpiar
        cartItems = [];
        document.getElementById('confirmation-card').style.display = 'none';
        document.getElementById('transcription').style.display = 'none';
        
        // Actualizar UI
        htmx.ajax('GET', '/sales/today/total', {target: '#daily-summary', swap: 'innerHTML'});
        htmx.ajax('GET', '/sales/today', {target: '#sales-list', swap: 'innerHTML'});
        
        const total = saleData.items.reduce((sum, item) => sum + item.subtotal, 0);
        showSuccessNotification(`✓ Venta registrada: S/ ${total.toFixed(2)}`);
        
    } catch (error) {
        console.error('[Voice] Error:', error);
        showNotification('Error al guardar venta: ' + error.message, 'error');
        isWaitingConfirmation = true;
    }
}

function cancelCart() {
    cartItems = [];
    isWaitingConfirmation = false;
    document.getElementById('confirmation-card').style.display = 'none';
    document.getElementById('transcription').style.display = 'none';
    showNotification('Venta cancelada', 'info');
}

function showSuccessNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'toast toast-success';
    notification.innerHTML = `
        <div class="toast-icon">✓</div>
        <div class="toast-message">${message}</div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function showNotification(message, type = 'info') {
    const icons = { info: 'ℹ', warning: '⚠', error: '✕', success: '✓' };
    const notification = document.createElement('div');
    notification.className = `toast toast-${type}`;
    notification.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-message">${message}</div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

document.addEventListener('DOMContentLoaded', function() {
    initSpeechRecognition();
    
    const voiceBtn = document.getElementById('voice-btn');
    if (voiceBtn) {
        voiceBtn.addEventListener('click', startVoiceCapture);
        console.log('[Voice] Sistema inicializado');
    }
});