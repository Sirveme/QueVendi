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
    idleTimer: null,                    // ⬅️ AGREGAR
    lastActivityTime: Date.now(),       // ⬅️ AGREGAR
    voiceSettings: {
        voice: 'es-PE-Standard-A',
        speed: 1.0,
        enabled: true
    }
};

// Configuración
const API_BASE = '/api';
const IDLE_TIMEOUT = 180000; // 3 minutos
//let idleTimer = null;

// Configuración de rutas API (SIN duplicar /sales)
const API_ROUTES = {
    parseCommand: '/api/v1/sales/voice/parse',
    createSale: '/api/v1/sales/',           // ✅ Ruta correcta
    voiceSettings: '/api/v1/sales/voice/settings',
    todaySales: '/api/v1/sales/today',
    todayTotal: '/api/v1/sales/today/total'
};;

console.log('[VoiceSystem] Rutas configuradas:', API_ROUTES);


// ========================================
// INICIALIZACIÓN COMPLETA
// ========================================

document.addEventListener('DOMContentLoaded', async function() {
    console.log('[VoiceSystem] Inicializando...');
    
    // 1. Detectar si es móvil
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // 2. Variable para audio (fuera del bloque)
    let audioOk = false;

    // 3. Inicializar audio SOLO si no es móvil
    if (!isMobile) {
        try {
            audioOk = await initAudioWithFilters();
            console.log('[Voice] Audio inicializado:', audioOk ? '✅' : '❌');
        } catch (error) {
            console.warn('[Voice] Error inicializando audio:', error);
            audioOk = false;
        }
        
        if (!audioOk) {
            console.warn('[VoiceSystem] ⚠️ Audio no configurado, pero continuando...');
        }
    } else {
        console.log('[VoiceSystem] 📱 Móvil detectado - audio se activará al tocar');
        audioOk = true; // En móvil se maneja automáticamente
    }

    // Ahora audioOk es accesible aquí
    console.log('[Voice] Estado final audioOk:', audioOk);
    
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
            
            if (!VoiceState.isListening) {
                console.log('[Voice] Activando por toque del usuario...');
                
                // Solicitar permisos de audio en móvil
                const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                if (isMobile) {
                    try {
                        // NO inicializar audio manualmente en móvil
                        // El recognition.start() maneja el micrófono automáticamente
                        console.log('[Voice] Iniciando reconocimiento directo...');
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
    if (!VoiceState.recognition) return;
    
    VoiceState.isListening = false;
    try {
        VoiceState.recognition.stop();
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
        // ⬇️⬇️⬇️ MANEJO DE SELECCIÓN AMBIGUA (AL INICIO) ⬇️⬇️⬇️
        if (VoiceState.pendingAmbiguous) {
            console.log('[Voice] 🔍 Procesando selección ambigua:', text);
            
            const { options, quantity } = VoiceState.pendingAmbiguous;
            let selectedIndex = -1;
            
            const textLower = text.toLowerCase().trim();
            
            // Opción 1: Usuario dice número directo ("uno", "dos", "1", "2")
            const numbers = {
                'uno': 1, 'una': 1, '1': 1, 'primero': 1, 'primera': 1,
                'dos': 2, '2': 2, 'segundo': 2, 'segunda': 2,
                'tres': 3, '3': 3, 'tercero': 3, 'tercera': 3,
                'cuatro': 4, '4': 4, 'cuarto': 4, 'cuarta': 4,
                'cinco': 5, '5': 5, 'quinto': 5, 'quinta': 5
            };
            
            for (const [word, num] of Object.entries(numbers)) {
                if (textLower === word || textLower === `opción ${num}` || textLower === `opcion ${num}`) {
                    if (num >= 1 && num <= options.length) {
                        selectedIndex = num - 1;
                        break;
                    }
                }
            }
            
            // Opción 2: Usuario dice el nombre o parte del nombre ("cielo", "san carlos", "pilsen")
            if (selectedIndex === -1) {
                for (let i = 0; i < options.length; i++) {
                    const optionName = options[i].name.toLowerCase();
                    // Buscar coincidencia por palabras (mínimo 3 caracteres)
                    const words = textLower.split(' ');
                    for (const word of words) {
                        if (word.length >= 3 && optionName.includes(word)) {
                            selectedIndex = i;
                            break;
                        }
                    }
                    if (selectedIndex !== -1) break;
                }
            }
            
            // Si encontró selección, procesar
            if (selectedIndex !== -1) {
                const selected = options[selectedIndex];
                console.log('[Voice] ✅ Seleccionado:', selected.name);
                
                // Cerrar modal
                closeAmbiguousModal();
                
                // Limpiar estado pendiente
                VoiceState.pendingAmbiguous = null;
                
                // Agregar producto al carrito
                await handleAdd({
                    type: 'add',
                    items: [{
                        product: selected,
                        quantity: quantity,
                        subtotal: selected.price * quantity
                    }],
                    total: selected.price * quantity
                });
                
                return; // ⬅️ IMPORTANTE: Terminar aquí sin hacer fetch
            }
            
            // Si no entendió, pedir de nuevo
            console.log('[Voice] ❌ No se entendió la selección');
            await speak('No entendí. Di el número de la opción.');
            playSound('error');
            
            // Reactivar micrófono
            setTimeout(() => {
                if (VoiceState.isActive) {
                    console.log('[Voice] 🎤 Reactivando micrófono');
                    startListening();
                }
            }, 1500);
            
            return; // ⬅️ Terminar sin hacer fetch
        }
        // ⬆️⬆️⬆️ FIN MANEJO AMBIGUO ⬆️⬆️⬆️
        
        // Flujo normal: hacer fetch al backend
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
    console.log('[Voice] 🎯 Comando:', data.type);
    const type = data.type;
    
    switch (type) {
        case 'cancel':
            await handleCancel();
            break;
        
        case 'confirm':
            await handleConfirm();
            break;

        case 'ambiguous':
            await handleAmbiguous(data);
            break;

        // ⬇️⬇️⬇️ AGREGAR ESTE CASO NUEVO ⬇️⬇️⬇️
        case 'ambiguous_sale_by_price':
            await handleAmbiguousSaleByPrice(data);
            break;
        // ⬆️⬆️⬆️ FIN CASO NUEVO ⬆️⬆️⬆️
        
        case 'add':
            await handleAdd(data);
            break;

        case 'add_by_price':  
            await handleAddByPrice(data);
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

async function handleAmbiguousSaleByPrice(data) {
    console.log('[Voice] 💰 Venta por precio ambigua:', data);
    
    const { product_query, target_amount, options } = data;
    
    // Guardar contexto especial para sale_by_price
    VoiceState.pendingAmbiguous = {
        query: product_query,
        options: options,
        quantity: null,  // No hay cantidad fija
        targetAmount: target_amount,  // Guardar el monto objetivo
        isSaleByPrice: true  // Flag especial
    };
    
    // Mensaje de voz
    const shortOptions = options.map((opt, i) => {
        const words = opt.name.split(' ');
        const shortName = words.slice(0, 2).join(' ');
        return `${shortName} opción ${i + 1}`;
    });
    
    const optionsText = shortOptions.join(', ');
    
    await speakWithoutStop(`Encontré ${optionsText} por ${target_amount} soles`);
    
    // Mostrar modal adaptado
    showAmbiguousOptionsSaleByPrice(product_query, options, target_amount);
    
    // Reiniciar reconocimiento
    console.log('[Voice] 🎤 Reactivando reconocimiento para selección...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (VoiceState.isActive && VoiceState.recognition) {
        try {
            try {
                VoiceState.recognition.stop();
            } catch (e) {}
            
            await new Promise(resolve => setTimeout(resolve, 100));
            VoiceState.recognition.start();
            VoiceState.isListening = true;
            
            const micStatus = document.getElementById('mic-status');
            if (micStatus) {
                micStatus.textContent = '🎤 ESCUCHANDO...';
                micStatus.classList.add('listening');
            }
            
            console.log('[Voice] ✅ Reconocimiento reiniciado');
        } catch (error) {
            console.error('[Voice] ❌ Error al reiniciar:', error);
        }
    }
}

function showAmbiguousOptionsSaleByPrice(query, options, targetAmount) {
    const modal = document.createElement('div');
    modal.className = 'modal show';
    modal.id = 'ambiguous-modal';
    modal.style.display = 'flex';
    
    const html = `
        <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
                <h2>¿Cuál "${query}" por S/. ${targetAmount}?</h2>
                <button class="modal-close" onclick="closeAmbiguousModal()">✕</button>
            </div>
            <div class="modal-body">
                ${options.map((opt, i) => {
                    // Calcular cantidad basada en precio
                    const calculatedQty = (targetAmount / opt.price).toFixed(2);
                    const unit = opt.unit || 'kg';
                    
                    return `
                        <div class="ambiguous-option" onclick="selectAmbiguousOptionFromUI(${i})">
                            <div class="option-number">${i + 1}</div>
                            <div class="option-info">
                                <div class="option-name">${opt.name}</div>
                                <div class="option-price">
                                    S/. ${opt.price.toFixed(2)}/${unit} 
                                    → <strong>${calculatedQty} ${unit}</strong>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
                <button onclick="closeAmbiguousModal()" 
                        style="width: 100%; margin-top: 16px; padding: 12px; 
                               background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                               color: white; border-radius: 8px; cursor: pointer;">
                    Cancelar
                </button>
                <div style="margin-top: 16px; text-align: center; color: rgba(255,255,255,0.6); font-size: 12px;">
                    🎤 Di el número o toca una opción
                </div>
            </div>
        </div>
    `;
    
    modal.innerHTML = html;
    document.body.appendChild(modal);
}

async function handleAmbiguous(data) {
    console.log('[Voice] Productos ambiguos:', data.ambiguous_items);
    
    const ambiguous = data.ambiguous_items[0];
    const query = ambiguous.query;
    const options = ambiguous.options;
    
    // Guardar contexto
    VoiceState.pendingAmbiguous = {
        query: query,
        options: options,
        quantity: ambiguous.quantity
    };
    
    // Mensaje natural
    const shortOptions = options.map((opt, i) => {
        const words = opt.name.split(' ');
        const shortName = words.slice(0, 2).join(' ');
        return `${shortName} opción ${i + 1}`;
    });
    
    const optionsText = shortOptions.join(', ');
    
    // Mostrar modal
    showAmbiguousOptions(query, options, ambiguous.quantity);
    
    // Hablar
    await speakWithoutStop(`Encontré ${optionsText}`);
    
    // ⬇️⬇️⬇️ REINICIAR RECONOCIMIENTO AQUÍ ⬇️⬇️⬇️
    console.log('[Voice] 🎤 Reactivando reconocimiento para selección...');
    
    // Pequeña pausa para que termine el TTS
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (VoiceState.isActive && VoiceState.recognition) {
        try {
            // Asegurar que esté detenido antes de reiniciar
            try {
                VoiceState.recognition.stop();
            } catch (e) {
                // Ignorar error si ya estaba detenido
            }
            
            // Esperar un poco
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Reiniciar
            VoiceState.recognition.start();
            VoiceState.isListening = true;
            
            // Actualizar UI
            const micStatus = document.getElementById('mic-status');
            if (micStatus) {
                micStatus.textContent = '🎤 ESCUCHANDO...';
                micStatus.classList.add('listening');
            }
            
            console.log('[Voice] ✅ Reconocimiento reiniciado para escuchar selección');
        } catch (error) {
            console.error('[Voice] ❌ Error al reiniciar reconocimiento:', error);
        }
    }
    // ⬆️⬆️⬆️ FIN REINICIO ⬆️⬆️⬆️
}

// ⬇️⬇️⬇️ NUEVA FUNCIÓN ⬇️⬇️⬇️
/**
 * Hablar sin detener el reconocimiento de voz
 */
async function speakWithoutStop(text) {
    console.log('[TTS] 🔊 Diciendo (sin detener mic):', text);
    
    if (!window.speechSynthesis) {
        console.warn('[TTS] ⚠️ Speech synthesis no disponible');
        return;
    }
    
    return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        utterance.onend = () => {
            console.log('[TTS] ✅ Finalizado (mic sigue activo)');
            resolve();
        };
        
        utterance.onerror = (event) => {
            console.error('[TTS] ❌ Error:', event);
            resolve();
        };
        
        window.speechSynthesis.speak(utterance);
        console.log('[TTS] ✅ Reproduciendo (mic activo)...');
    });
}
// ⬆️⬆️⬆️ FIN FUNCIÓN ⬆️⬆️⬆️


function showAmbiguousOptions(query, options, quantity) {  // ⬅️ AGREGAR quantity
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
                    <div class="ambiguous-option" onclick="selectAmbiguousOptionFromUI(${i})">
                        <div class="option-number">${i + 1}</div>
                        <div class="option-info">
                            <div class="option-name">${opt.name}</div>
                            <div class="option-price">S/. ${opt.price.toFixed(2)}</div>
                        </div>
                    </div>
                `).join('')}
                <button onclick="closeAmbiguousModal()" 
                        style="width: 100%; margin-top: 16px; padding: 12px; 
                               background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                               color: white; border-radius: 8px; cursor: pointer;">
                    Cancelar
                </button>
                <div style="margin-top: 16px; text-align: center; color: rgba(255,255,255,0.6); font-size: 12px;">
                    🎤 Di el número o toca una opción
                </div>
            </div>
        </div>
    `;
    
    modal.innerHTML = html;
    document.body.appendChild(modal);
}


// ⬇️⬇️⬇️ AGREGAR ESTA FUNCIÓN ⬇️⬇️⬇️
async function selectAmbiguousOptionFromUI(index) {
    if (!VoiceState.pendingAmbiguous) return;
    
    const { options, quantity, targetAmount, isSaleByPrice } = VoiceState.pendingAmbiguous;
    const selected = options[index];
    
    console.log('[Voice] ✅ Seleccionado por click:', selected.name);
    
    closeAmbiguousModal();
    VoiceState.pendingAmbiguous = null;
    
    // ⬇️⬇️⬇️ SI ES VENTA POR PRECIO, CALCULAR CANTIDAD ⬇️⬇️⬇️
    let finalQuantity = quantity;
    
    if (isSaleByPrice) {
        finalQuantity = targetAmount / selected.price;
        console.log(`[Voice] 💰 Calculando: ${targetAmount} / ${selected.price} = ${finalQuantity.toFixed(2)}`);
    }
    // ⬆️⬆️⬆️ FIN CÁLCULO ⬆️⬆️⬆️
    
    await handleAdd({
        type: 'add',
        items: [{
            product: selected,
            quantity: finalQuantity,
            subtotal: selected.price * finalQuantity
        }],
        total: selected.price * finalQuantity
    });
}
// ⬆️⬆️⬆️ FIN FUNCIÓN ⬆️⬆️⬆️

function closeAmbiguousModal() {
    const modal = document.getElementById('ambiguous-modal');
    if (modal) {
        modal.remove();
    }
    // Limpiar estado pendiente
    VoiceState.pendingAmbiguous = null;
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
    
    VoiceState.cart.push({
        product: product,
        quantity: 1,
        subtotal: price
    });
    
    updateCartDisplay();
    
    const total = VoiceState.cart.reduce((sum, i) => sum + i.subtotal, 0);
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
    if (VoiceState.cart.length === 0) {
        await speak('No hay productos en el carrito');
        return;
    }
    
    VoiceState.cart = [];
    updateCartDisplay();
    await speak('Venta cancelada');
    playSound('cancel');
}

async function handleConfirm() {
    if (VoiceState.cart.length === 0) {
        await speak('No hay productos para confirmar');
        return;
    }
    
    await confirmSale();
}

async function handleAdd(data) {
    console.log('[Voice] Agregando items:', data.items);
    
    // Para cada item a agregar
    for (const newItem of data.items) {
        // Buscar si ya existe en carrito
        const existingIndex = VoiceState.cart.findIndex(
            item => item.product.id === newItem.product.id
        );
        
        if (existingIndex !== -1) {
            // ✅ YA EXISTE - SUMAR CANTIDAD
            const existing = VoiceState.cart[existingIndex];
            existing.quantity += newItem.quantity;
            existing.subtotal = existing.quantity * existing.product.price;
            
            console.log(`[Voice] ➕ Sumado a existente: ${newItem.product.name} (ahora ${existing.quantity})`);
        } else {
            // ✅ NO EXISTE - AGREGAR NUEVO
            VoiceState.cart.push(newItem);
            console.log(`[Voice] 🆕 Agregado nuevo: ${newItem.product.name}`);
        }
    }
    
    updateCartDisplay();
    
    const total = VoiceState.cart.reduce((sum, item) => sum + item.subtotal, 0);
    
    // Mensaje de confirmación
    if (data.items.length === 1) {
        const item = data.items[0];
        
        if (data.by_price) {
            // Venta por precio
            await speak(`${item.quantity} ${item.product.unit} de ${item.product.name} por ${formatPrice(item.subtotal)}`);
        } else {
            // Venta normal
            await speak(`${formatQuantity(item.quantity)} ${item.product.name}. Van ${formatPrice(total)}`);
        }
    } else {
        // Múltiples items
        const itemNames = data.items.map(i => `${formatQuantity(i.quantity)} ${i.product.name}`).join(' y ');
        await speak(`${itemNames}. Van ${formatPrice(total)}`);
    }
    
    playSound('success');
    
    if (data.warning) {
        await speak(data.warning);
    }
}

async function handleAddByPrice(data) {
    // Es lo mismo que handleAdd, pero con mensaje especial
    await handleAdd(data);
}

async function handleSale(data) {
    // Reemplazar carrito (nueva venta)
    VoiceState.cart = data.items;
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
    const item = VoiceState.cart.find(i => 
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
    
    const total = VoiceState.cart.reduce((sum, i) => sum + i.subtotal, 0);
    await speak(`Precio de ${item.product.name} cambiado de ${formatPrice(oldPrice)} a ${formatPrice(newPrice)}. Nuevo total: ${formatPrice(total)}`);
}

async function handleProductChange(data) {
    const oldProduct = data.old_product;
    const newProduct = data.new_product;
    
    // Buscar y reemplazar en carrito
    const itemIndex = VoiceState.cart.findIndex(i => i.product.id === oldProduct.id);
    
    if (itemIndex === -1) {
        await speak(`No encontré ${oldProduct.name} en el carrito`);
        return;
    }
    
    const quantity = VoiceState.cart[itemIndex].quantity;
    VoiceState.cart[itemIndex] = {
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
    const index = VoiceState.cart.findIndex(item => item.product.id === data.product.id);
    
    if (index === -1) {
        await speak(`No encontré ${data.product.name} en el carrito`);
        playSound('error');
        return;
    }
    
    // Eliminar del carrito
    const removed = VoiceState.cart.splice(index, 1)[0];
    
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
    
    if (VoiceState.cart.length === 0) {
        await speak('El carrito está vacío');
        playSound('error');
        return;
    }
    
    const saleData = {
        items: VoiceState.cart.map(item => ({
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.product.price,
            subtotal: item.subtotal
        })),
        payment_method: VoiceState.paymentMethod,
        payment_reference: null,
        customer_name: null,
        is_credit: false
    };
    
    try {
        // ✅ Ruta hardcoded para evitar duplicación
        const response = await fetchWithAuth('/api/v1/sales/', {
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

        const total = VoiceState.cart.reduce((sum, i) => sum + i.subtotal, 0);
        const saleId = result.id;

        // Limpiar carrito
        VoiceState.cart = [];
        updateCartDisplay();

        // Actualizar UI
        htmx.ajax('GET', '/api/v1/sales/today/total/html', {target: '#daily-summary', swap: 'innerHTML'});
        htmx.ajax('GET', '/api/v1/sales/today/html', {target: '#sales-list', swap: 'innerHTML'});

        // Evento personalizado para actualizar otras partes
        document.body.dispatchEvent(new CustomEvent('salesUpdated'));

        // Respuesta de voz
        await speak(`Venta confirmada por ${formatPrice(total)}. Siguiente cliente`);
        playSound('confirm');

        // Mostrar modal de boleta si está disponible
        if (typeof showBoletaModal === 'function') {
            showBoletaModal(saleId, total);
        }
        
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
    
    if (VoiceState.cart.length === 0) {
        cartContainer.innerHTML = `
            <div class="cart-empty">
                <div class="empty-icon">🛒</div>
                <div class="empty-text">Carrito vacío</div>
                <div class="empty-hint">Di: "un café y 10 panes"</div>
            </div>
        `;
        return;
    }
    
    const total = VoiceState.cart.reduce((sum, item) => sum + item.subtotal, 0);
    
    let itemsHTML = '';
    VoiceState.cart.forEach((item, index) => {
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
    VoiceState.paymentMethod = method;
    
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
    if (VoiceState.idleTimer) clearTimeout(VoiceState.idleTimer);
    
    VoiceState.idleTimer = setTimeout(() => {
        console.log('[Idle] ⏰ Tiempo de inactividad alcanzado');
        checkIdleAlerts();
    }, IDLE_TIMEOUT);
}

async function checkIdleAlerts() {
    try {
        const response = await fetch(`${API_BASE}/sales/stats/today`);
        const stats = await response.json();
        
        // Verificar si hay carrito sin confirmar
        if (VoiceState.cart.length > 0) {
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