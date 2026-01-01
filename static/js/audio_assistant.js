// ============================================
// AUDIO ASSISTANT - Text-to-Speech
// AGREGAR AL INICIO de dashboard_principal.js
// ============================================

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
    
    // Hablar texto
    speak: function(text, options = {}) {
        if (!this.enabled || !text) return;
        
        try {
            // Cancelar cualquier mensaje anterior
            window.speechSynthesis.cancel();
            
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
            
            // Callbacks
            utterance.onstart = () => {
                console.log('[AudioAssistant] 🔊 Hablando:', text);
            };
            
            utterance.onerror = (e) => {
                console.error('[AudioAssistant] Error:', e);
            };
            
            // Hablar
            window.speechSynthesis.speak(utterance);
            
        } catch (error) {
            console.error('[AudioAssistant] Error al hablar:', error);
        }
    },
    
    // Detener audio
    stop: function() {
        window.speechSynthesis.cancel();
    },
    
    // Toggle enabled
    toggle: function() {
        this.enabled = !this.enabled;
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
    
    // Sugerir según producto
    sugerirPorProducto: function(productName) {
        const nombre = productName.toLowerCase();
        
        if (nombre.includes('gaseosa') || nombre.includes('coca') || nombre.includes('inca')) {
            this.speak(this.sugerencias.gaseosa);
        } else if (nombre.includes('pan')) {
            this.speak(this.sugerencias.pan);
        } else if (nombre.includes('cerveza') || nombre.includes('cristal') || nombre.includes('pilsen')) {
            this.speak(this.sugerencias.cerveza);
        }
    }
};

// Inicializar al cargar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AudioAssistant.init());
} else {
    AudioAssistant.init();
}

// ============================================
// EJEMPLOS DE USO:
// ============================================

// En cualquier parte del código:
// AudioAssistant.speak("¡Bienvenido a la bodega!");
// AudioAssistant.speak(AudioAssistant.sugerencias.gaseosa);
// AudioAssistant.sugerirPorProducto("Coca Cola 1.5L");
// AudioAssistant.stop(); // Detener audio
// AudioAssistant.toggle(); // Activar/desactivar