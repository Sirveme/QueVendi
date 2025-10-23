/**
 * Detección de orientación del dispositivo
 * Modos: Normal (vertical), Horizontal (cliente), Invertido (pausado)
 */

let currentOrientation = 'normal';
let orientationLocked = false;

document.addEventListener('DOMContentLoaded', function() {
    initOrientationDetection();
});

function initOrientationDetection() {
    // Detectar orientación inicial
    updateOrientation();
    
    // Escuchar cambios
    window.addEventListener('orientationchange', updateOrientation);
    window.addEventListener('resize', updateOrientation);
    
    // Detectar rotación física (acelerómetro)
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', handleDeviceOrientation);
    }
}

function updateOrientation() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const orientation = window.orientation || screen.orientation?.angle || 0;
    
    let newMode = 'normal';
    
    if (width > height) {
        // Horizontal
        newMode = 'horizontal';
    } else if (orientation === 180 || Math.abs(orientation) === 180) {
        // Invertido (boca abajo)
        newMode = 'inverted';
    }
    
    if (newMode !== currentOrientation) {
        console.log('[Orientation] Cambio:', currentOrientation, '→', newMode);
        currentOrientation = newMode;
        handleOrientationChange(newMode);
    }
}

function handleDeviceOrientation(event) {
    const beta = event.beta; // Inclinación frontal-trasera (-180 a 180)
    
    // Si está casi boca abajo (> 150° o < -150°)
    if (Math.abs(beta) > 150) {
        if (currentOrientation !== 'inverted') {
            currentOrientation = 'inverted';
            handleOrientationChange('inverted');
        }
    }
}

function handleOrientationChange(mode) {
    const body = document.body;
    const overlay = document.getElementById('orientation-overlay') || createOrientationOverlay();
    
    // Remover clases anteriores
    body.classList.remove('mode-normal', 'mode-horizontal', 'mode-inverted');
    
    switch (mode) {
        case 'horizontal':
            body.classList.add('mode-horizontal');
            overlay.style.display = 'none';
            
            // MODO CLIENTE: Mostrar solo productos y total grande
            console.log('[Orientation] Modo Cliente (horizontal)');
            showClientMode();
            
            // Pausar micrófono
            if (window.VoiceSystem) {
                window.VoiceSystem.stopListening();
            }
            break;
        
        case 'inverted':
            body.classList.add('mode-inverted');
            overlay.innerHTML = `
                <div class="orientation-message">
                    <div class="orientation-icon">📱</div>
                    <div class="orientation-text">Sistema Pausado</div>
                    <div class="orientation-hint">Voltea el dispositivo para continuar</div>
                </div>
            `;
            overlay.style.display = 'flex';
            
            console.log('[Orientation] Modo Pausado (invertido)');
            
            // Pausar micrófono
            if (window.VoiceSystem) {
                window.VoiceSystem.stopListening();
            }
            break;
        
        case 'normal':
        default:
            body.classList.add('mode-normal');
            overlay.style.display = 'none';
            
            console.log('[Orientation] Modo Normal (vertical)');
            showNormalMode();
            
            // Reanudar micrófono
            if (window.VoiceSystem) {
                window.VoiceSystem.startListening();
            }
            break;
    }
}

function createOrientationOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'orientation-overlay';
    overlay.className = 'orientation-overlay';
    document.body.appendChild(overlay);
    return overlay;
}

function showClientMode() {
    // Ocultar controles de vendedora
    const controls = document.querySelector('.vendor-controls');
    if (controls) controls.style.display = 'none';
    
    // Hacer total más grande
    const total = document.querySelector('.cart-total');
    if (total) {
        total.style.fontSize = '48px';
        total.style.padding = '40px';
    }
}

function showNormalMode() {
    // Mostrar controles de vendedora
    const controls = document.querySelector('.vendor-controls');
    if (controls) controls.style.display = 'block';
    
    // Restaurar tamaño de total
    const total = document.querySelector('.cart-total');
    if (total) {
        total.style.fontSize = '';
        total.style.padding = '';
    }
}

// Exportar
window.OrientationManager = {
    getCurrentMode: () => currentOrientation,
    lock: () => { orientationLocked = true; },
    unlock: () => { orientationLocked = false; }
};