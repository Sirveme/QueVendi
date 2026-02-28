/**
 * ============================================
 * DICCIONARIO DE COMANDOS ESPECIALES
 * Accesible por voz
 * ============================================
 * 
 * COMANDO: "ayuda" / "qué puedo decir" / "comandos"
 */

// ============================================
// 1. DICCIONARIO COMPLETO
// ============================================

const VOICE_COMMANDS_HELP = {
    categorias: [
        {
            nombre: 'Ventas',
            emoji: '🛒',
            comandos: [
                {
                    comando: '"2 de leche"',
                    descripcion: 'Agregar 2 unidades de leche',
                    ejemplo: 'dos de leche'
                },
                {
                    comando: '"medio kilo de arroz"',
                    descripcion: 'Agregar medio kilo de arroz',
                    ejemplo: 'medio kilo de arroz'
                },
                {
                    comando: '"un cuarto de aceite"',
                    descripcion: 'Agregar 1/4 de aceite',
                    ejemplo: 'un cuarto de aceite'
                },
                {
                    comando: '"2 soles de papa"',
                    descripcion: 'Vender S/. 2 de papa (calcula cantidad)',
                    ejemplo: 'dos soles de papa'
                },
                {
                    comando: '"arroz, leche y pan"',
                    descripcion: 'Agregar múltiples productos',
                    ejemplo: 'arroz coma leche y pan'
                }
            ]
        },
        {
            nombre: 'Consultas',
            emoji: '❓',
            comandos: [
                {
                    comando: '"cuánto va"',
                    descripcion: 'Escuchar el total actual',
                    ejemplo: 'cuánto va'
                },
                {
                    comando: '"total"',
                    descripcion: 'Escuchar el total y número de productos',
                    ejemplo: 'total'
                }
            ]
        },
        {
            nombre: 'Modificar carrito',
            emoji: '✏️',
            comandos: [
                {
                    comando: '"quita el arroz"',
                    descripcion: 'Eliminar arroz del carrito',
                    ejemplo: 'quita el arroz'
                },
                {
                    comando: '"borra la leche"',
                    descripcion: 'Eliminar leche del carrito',
                    ejemplo: 'borra la leche'
                },
                {
                    comando: '"cambiar arroz por fideos"',
                    descripcion: 'Reemplazar arroz con fideos',
                    ejemplo: 'cambiar arroz por fideos'
                }
            ]
        },
        {
            nombre: 'Finalizar',
            emoji: '✅',
            comandos: [
                {
                    comando: '"listo"',
                    descripcion: 'Finalizar venta y cobrar',
                    ejemplo: 'listo'
                },
                {
                    comando: '"eso es todo"',
                    descripcion: 'Finalizar venta y cobrar',
                    ejemplo: 'eso es todo'
                },
                {
                    comando: '"borra todo"',
                    descripcion: 'Cancelar venta completa',
                    ejemplo: 'borra todo'
                },
                {
                    comando: '"cancelar"',
                    descripcion: 'Cancelar venta completa',
                    ejemplo: 'cancelar'
                }
            ]
        },
        {
            nombre: 'Ayuda',
            emoji: '💡',
            comandos: [
                {
                    comando: '"ayuda"',
                    descripcion: 'Mostrar este diccionario',
                    ejemplo: 'ayuda'
                },
                {
                    comando: '"qué puedo decir"',
                    descripcion: 'Listar comandos disponibles',
                    ejemplo: 'qué puedo decir'
                },
                {
                    comando: '"comandos"',
                    descripcion: 'Ver lista de comandos',
                    ejemplo: 'comandos'
                }
            ]
        }
    ]
};

// ============================================
// 2. DETECTAR PETICIÓN DE AYUDA
// ============================================

function detectHelpRequest(text) {
    const helpWords = ['ayuda', 'que puedo decir', 'qué puedo decir', 'comandos', 'opciones'];
    text = text.toLowerCase().trim();
    
    return helpWords.some(word => text.includes(word));
}

// Agregar en voice-commands.js, función detectCommandType:

function detectCommandType(text) {
    text = text.toLowerCase().trim();
    
    // ✅ NUEVO: Detectar petición de ayuda
    if (detectHelpRequest(text)) {
        console.log('[VoiceCommands] → help');
        return 'help';
    }
    
    // ... resto del código existente ...
}

// ============================================
// 3. MODAL DE AYUDA
// ============================================

function showHelpModalXXXX() {
    const modal = document.createElement('div');
    modal.className = 'voice-help-modal';
    modal.innerHTML = `
        <div class="voice-help-content">
            <div class="help-header">
                <h2>💡 Comandos de Voz</h2>
                <button onclick="closeHelpModal()" class="close-btn">✕</button>
            </div>
            
            <div class="help-intro">
                <p>Habla naturalmente para controlar el sistema:</p>
            </div>
            
            <div class="help-categories">
                ${VOICE_COMMANDS_HELP.categorias.map(categoria => `
                    <div class="help-category">
                        <h3>
                            <span class="category-emoji">${categoria.emoji}</span>
                            ${categoria.nombre}
                        </h3>
                        <div class="help-commands">
                            ${categoria.comandos.map(cmd => `
                                <div class="help-command">
                                    <div class="command-text">${cmd.comando}</div>
                                    <div class="command-desc">${cmd.descripcion}</div>
                                    <div class="command-example">
                                        <button onclick="tryCommand('${cmd.ejemplo}')" class="try-btn">
                                            🎤 Probar
                                        </button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div class="help-footer">
                <p><strong>Tip:</strong> Habla claro y en un ambiente tranquilo para mejor precisión</p>
                <p>Di "ayuda" en cualquier momento para ver estos comandos</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    injectHelpCSS();
}

function closeHelpModal() {
    const modal = document.querySelector('.voice-help-modal');
    if (modal) {
        modal.classList.add('fade-out');
        setTimeout(() => modal.remove(), 300);
    }
}

// ============================================
// 4. CSS PARA MODAL DE AYUDA
// ============================================

function injectHelpCSS() {
    if (document.getElementById('voice-help-css')) return;
    
    const style = document.createElement('style');
    style.id = 'voice-help-css';
    style.textContent = `
        .voice-help-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0,0,0,0.85);
            z-index: 99999;
            display: flex;
            justify-content: center;
            align-items: center;
            animation: fadeIn 0.3s ease-out;
        }
        
        .voice-help-content {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 0;
            border-radius: 20px;
            max-width: 800px;
            max-height: 90vh;
            overflow-y: auto;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        
        .help-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 30px;
            background: rgba(0,0,0,0.2);
            border-radius: 20px 20px 0 0;
        }
        
        .help-header h2 {
            margin: 0;
            font-size: 2em;
        }
        
        .close-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            font-size: 1.5em;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .close-btn:hover {
            background: rgba(255,255,255,0.3);
            transform: scale(1.1);
        }
        
        .help-intro {
            padding: 20px 30px;
            font-size: 1.1em;
            text-align: center;
            background: rgba(255,255,255,0.1);
        }
        
        .help-categories {
            padding: 20px;
        }
        
        .help-category {
            background: rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .help-category h3 {
            margin: 0 0 15px 0;
            font-size: 1.5em;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .category-emoji {
            font-size: 1.3em;
        }
        
        .help-commands {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .help-command {
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
            padding: 15px;
            display: grid;
            grid-template-columns: 1fr 2fr auto;
            gap: 15px;
            align-items: center;
        }
        
        .command-text {
            font-family: 'Courier New', monospace;
            font-size: 1.1em;
            font-weight: bold;
            color: #ffd700;
        }
        
        .command-desc {
            font-size: 1em;
            opacity: 0.9;
        }
        
        .try-btn {
            background: #ffd700;
            color: #1a1a2e;
            border: none;
            padding: 8px 15px;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .try-btn:hover {
            background: #ffed4e;
            transform: scale(1.05);
        }
        
        .help-footer {
            padding: 20px 30px;
            background: rgba(0,0,0,0.2);
            border-radius: 0 0 20px 20px;
            text-align: center;
        }
        
        .help-footer p {
            margin: 10px 0;
            font-size: 0.95em;
        }
        
        .fade-out {
            animation: fadeOut 0.3s ease-out forwards;
        }
        
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: scale(0.9);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }
        
        @keyframes fadeOut {
            from {
                opacity: 1;
                transform: scale(1);
            }
            to {
                opacity: 0;
                transform: scale(0.9);
            }
        }
        
        @media (max-width: 768px) {
            .help-command {
                grid-template-columns: 1fr;
                text-align: center;
            }
            
            .command-text {
                font-size: 1em;
            }
        }
    `;
    
    document.head.appendChild(style);
}

// ============================================
// 5. FUNCIÓN "PROBAR COMANDO"
// ============================================

function tryCommand(commandText) {
    closeHelpModal();
    
    // Simular que el usuario dijo el comando
    showToast(`🎤 "${commandText}"`, 'info');
    
    setTimeout(() => {
        processVoiceCommand(commandText);
    }, 500);
}

// ============================================
// 6. EJECUTOR DE COMANDO DE AYUDA
// ============================================

// Agregar en voice-commands.js, función executeCommand:

async function executeCommand(command) {
    console.log('[VoiceCommands] Ejecutando:', command.type);
    
    switch (command.type) {
        // ✅ NUEVO CASO
        case 'help':
            showHelpModal();
            speak('Mostrando comandos disponibles');
            return true;
            
        case 'query_total':
            return await queryTotal();
            
        // ... resto de casos ...
    }
}

// ============================================
// 7. VERSIÓN VOZ (sin modal)
// ============================================

function speakHelpCommands() {
    const helpText = `
        Comandos disponibles:
        
        Para ventas, di: dos de leche, medio kilo de arroz, o dos soles de papa.
        
        Para consultar, di: cuánto va, o total.
        
        Para modificar, di: quita el arroz, o cambiar arroz por fideos.
        
        Para finalizar, di: listo, o eso es todo.
        
        Di ayuda en cualquier momento para recordar estos comandos.
    `;
    
    speak(helpText);
}

// ============================================
// 8. EXPORTS
// ============================================

window.VoiceHelp = {
    showHelpModal,
    closeHelpModal,
    tryCommand,
    speakHelpCommands,
    VOICE_COMMANDS_HELP
};

// ============================================
// 9. BOTÓN DE AYUDA EN UI
// ============================================

// Agregar botón de ayuda en dashboard:
function addHelpButtonXXXXXX() {
    const helpBtn = document.createElement('button');
    helpBtn.className = 'voice-help-btn';
    helpBtn.innerHTML = '💡 Comandos de voz';
    helpBtn.onclick = showHelpModal;
    
    const container = document.querySelector('.voice-controls') || document.body;
    container.appendChild(helpBtn);
    
    // CSS para el botón
    const style = document.createElement('style');
    style.textContent = `
        .voice-help-btn {
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 25px;
            font-size: 1em;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            z-index: 9999;
            transition: all 0.3s;
        }
        
        .voice-help-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
    `;
    document.head.appendChild(style);
}

// Inicializar al cargar
document.addEventListener('DOMContentLoaded', addHelpButton);