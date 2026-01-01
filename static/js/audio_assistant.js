// ============================================
// AUDIO ASSISTANT - Text-to-Speech con QUEUE
// ============================================

// ✅ QUEUE DE AUDIO
let speechQueue = [];
let isSpeaking = false;

const AudioAssistant = {
    // Configuración
    enabled: true,
    volume: 0.8,
    rate: 1.0,
    pitch: 1.0,
    lang: 'es-PE', // Español Perú
    
    // Voz seleccionada
    selectedVoice: null,
    
    // Inicializar voces
    init: function() {
        if ('speechSynthesis' in window) {
            // Esperar a que las voces se carguen
            window.speechSynthesis.onvoiceschanged = () => {
                const voices = window.speechSynthesis.getVoices();
                
                // Buscar voz en español (preferir español latino o Perú)
                this.selectedVoice = voices.find(v => 
                    v.lang === 'es-PE' || 
                    v.lang === 'es-MX' || 
                    v.lang === 'es-ES' || 
                    v.lang.startsWith('es')
                ) || voices[0];
                
                console.log('[AudioAssistant] Voz seleccionada:', this.selectedVoice?.name);
            };
        } else {
            console.warn('[AudioAssistant] Text-to-Speech no disponible');
            this.enabled = false;
        }
    },
    
    // ✅ HABLAR CON QUEUE (previene "interrupted")
    speak: function(text, options = {}) {
        if (!this.enabled || !text || text.trim().length === 0) return;
        
        console.log('[AudioAssistant] 🔊 Solicitado:', text);
        
        // Si es prioritario, limpiar queue y hablar inmediatamente
        if (options.priority) {
            window.speechSynthesis.cancel();
            speechQueue = [];
            isSpeaking = false;
        }
        
        // Agregar a queue
        speechQueue.push({ text, options });
        
        // Procesar queue si no está hablando
        if (!isSpeaking) {
            this.processQueue();
        }
    },
    
    // ✅ PROCESAR QUEUE
    processQueue: function() {
        if (speechQueue.length === 0) {
            isSpeaking = false;
            return;
        }
        
        isSpeaking = true;
        const { text, options } = speechQueue.shift();
        
        console.log('[AudioAssistant] 🔊 Hablando:', text);
        
        try {
            // Crear mensaje
            const utterance = new SpeechSynthesisUtterance(text);
            
            // Configurar voz
            if (this.selectedVoice) {
                utterance.voice = this.selectedVoice;
            }
            utterance.lang = options.lang || this.lang;
            utterance.volume = options.volume || this.volume;
            utterance.rate = options.rate || this.rate;
            utterance.pitch = options.pitch || this.pitch;
            
            // ✅ CALLBACKS
            utterance.onend = () => {
                console.log('[AudioAssistant] ✅ Terminado');
                isSpeaking = false;
                
                // Procesar siguiente en queue después de pequeña pausa
                setTimeout(() => {
                    this.processQueue();
                }, 300);
            };
            
            utterance.onerror = (event) => {
                console.log('[AudioAssistant] Error:', event);
                isSpeaking = false;
                
                // Intentar siguiente en queue
                setTimeout(() => {
                    this.processQueue();
                }, 300);
            };
            
            // Hablar
            window.speechSynthesis.speak(utterance);
            
        } catch (error) {
            console.error('[AudioAssistant] Error al hablar:', error);
            isSpeaking = false;
            
            // Continuar con siguiente
            setTimeout(() => {
                this.processQueue();
            }, 300);
        }
    },
    
    // Detener audio y limpiar queue
    stop: function() {
        window.speechSynthesis.cancel();
        speechQueue = [];
        isSpeaking = false;
        console.log('[AudioAssistant] 🛑 Audio detenido y queue limpiado');
    },
    
    // Toggle enabled
    toggle: function() {
        this.enabled = !this.enabled;
        
        if (!this.enabled) {
            this.stop(); // Detener si se desactiva
        }
        
        console.log('[AudioAssistant] Estado:', this.enabled ? 'Activado' : 'Desactivado');
        return this.enabled;
    },
    
    // Sugerencias predefinidas para bodega
    sugerencias: {
        gaseosa: "¿Con qué acompañará su gaseosa? Tenemos galletas y snacks en promoción",
        pan: "¿Desea mantequilla o mermelada para su pan?",
        cerveza: "Tenemos limón y hielo frescos para su cerveza",
        desayuno: "¿Le falta algo para su desayuno? Tenemos huevos, pan fresco y leche",
        almuerzo: "¿Qué tal un postre para acompañar? Tenemos frutas frescas",
        promocion: "Hoy tenemos promoción en productos seleccionados",
        gracias: "¡Gracias por su compra! Vuelva pronto",
        fiado: "Su fiado ha sido registrado correctamente. Recuerde la fecha de pago"
    },
    
    // ✅ SUGERIR CON FILTRO DE CARRITO
    sugerirPorProducto: function(productName) {
        const nombre = normalizeText(productName);
        
        // Obtener productos en carrito
        const productsInCart = AppState.cart.map(item => 
            normalizeText(item.name)
        );
        
        // Determinar sugerencia según producto
        let sugerencia = null;
        
        if (nombre.includes('gaseosa') || nombre.includes('coca') || nombre.includes('inca')) {
            // Solo sugerir si NO hay galletas/snacks en carrito
            if (!productsInCart.some(p => p.includes('galleta') || p.includes('snack'))) {
                sugerencia = this.sugerencias.gaseosa;
            }
        } else if (nombre.includes('pan')) {
            // Solo sugerir si NO hay mantequilla/mermelada en carrito
            if (!productsInCart.some(p => p.includes('mantequilla') || p.includes('mermelada'))) {
                sugerencia = this.sugerencias.pan;
            }
        } else if (nombre.includes('cerveza') || nombre.includes('cristal') || nombre.includes('pilsen')) {
            // Solo sugerir si NO hay limón/hielo en carrito
            if (!productsInCart.some(p => p.includes('limon') || p.includes('hielo'))) {
                sugerencia = this.sugerencias.cerveza;
            }
        }
        
        // Hablar si hay sugerencia válida
        if (sugerencia) {
            this.speak(sugerencia);
        } else {
            console.log('[AudioAssistant] No hay sugerencias relevantes (productos ya en carrito)');
        }
    }
};

// Inicializar al cargar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AudioAssistant.init());
} else {
    AudioAssistant.init();
}

// ✅ ALIAS GLOBAL para compatibilidad
window.speak = function(text, priority = false) {
    AudioAssistant.speak(text, { priority });
};

// ============================================
// EJEMPLOS DE USO:
// ============================================

// En cualquier parte del código:
// AudioAssistant.speak("¡Bienvenido a la bodega!");
// AudioAssistant.speak("Producto agregado", { priority: true }); // Prioritario
// AudioAssistant.sugerirPorProducto("Coca Cola 1.5L");
// AudioAssistant.stop(); // Detener audio y limpiar queue
// AudioAssistant.toggle(); // Activar/desactivar

// O usar el alias global:
// speak("¡Hola!");