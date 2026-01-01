/**
 * ============================================
 * VOICE COMMANDS MODULE
 * ============================================
 * 
 * UBICACIÓN: static/js/modules/voice-commands.js
 * 
 * Comandos especiales para control total por voz:
 * - "listo" / "eso es todo" → Confirmar venta
 * - "cuánto va" / "total" → Decir total
 * - "quita el arroz" → Remover producto
 * - "borra todo" / "cancelar" → Cancelar venta
 * - "cambiar arroz por fideos" → Cambiar producto
 * 
 * Basado en: app/services/voice_service.py
 */

// ============================================
// 1. DICCIONARIOS DE COMANDOS
// ============================================

const COMMAND_WORDS = {
    // Cancelar TODO
    cancel: ['cancelar', 'anular', 'borra todo', 'borrar todo', 'elimina todo'],
    
    // Confirmar venta
    confirm: ['listo', 'total', 'confirmar', 'suma', 'cierra', 'terminar', 'dale', 'ok', 'vale', 'eso es todo'],
    
    // Agregar producto
    add: ['adicionar', 'sumale', 'agregar', 'agrega', 'añadir', 'añade', 'aumentar', 'pon', 'incluye'],
    
    // Cambiar algo
    change: ['cambiar', 'cambia', 'modificar', 'corregir', 'actualizar', 'ajustar', 'mejor'],
    
    // Quitar producto
    remove: ['quitar', 'quita', 'eliminar', 'elimina', 'sacar', 'saca', 'borrar', 'borra', 'ya no', 'no quiero'],
    
    // Consultar total
    query: ['cuánto', 'cuanto', 'total', 'suma', 'va']
};

// ============================================
// 2. DETECCIÓN DE TIPO DE COMANDO
// ============================================

/**
 * Detectar qué tipo de comando es
 */
function detectCommandType(text) {
    text = text.toLowerCase().trim();
    
    console.log('[VoiceCommands] Analizando:', text);
    
    // 1. CONSULTA DE TOTAL
    if (COMMAND_WORDS.query.some(word => text.includes(word))) {
        if (text.includes('va') || text.includes('total')) {
            console.log('[VoiceCommands] → query_total');
            return 'query_total';
        }
    }
    
    // 2. CANCELAR TODO (frases específicas)
    const cancelPhrases = ['borra todo', 'borrar todo', 'elimina todo'];
    if (cancelPhrases.some(phrase => text.includes(phrase))) {
        console.log('[VoiceCommands] → cancel');
        return 'cancel';
    }
    
    // 3. CANCELAR (palabra sola)
    if (COMMAND_WORDS.cancel.some(word => text.includes(word))) {
        // Asegurar que no es "quitar" que también puede sonar a cancel
        if (!COMMAND_WORDS.remove.some(word => text.includes(word))) {
            console.log('[VoiceCommands] → cancel');
            return 'cancel';
        }
    }
    
    // 4. CONFIRMAR VENTA
    if (COMMAND_WORDS.confirm.some(word => text.includes(word))) {
        console.log('[VoiceCommands] → confirm');
        return 'confirm';
    }
    
    // 5. QUITAR PRODUCTO
    if (COMMAND_WORDS.remove.some(word => text.includes(word))) {
        console.log('[VoiceCommands] → remove');
        return 'remove';
    }
    
    // 6. CAMBIAR PRODUCTO (X por Y)
    if (text.includes(' por ') && COMMAND_WORDS.change.some(word => text.includes(word))) {
        console.log('[VoiceCommands] → change_product');
        return 'change_product';
    }
    
    // 7. CAMBIAR PRECIO
    if (text.match(/\ba\s+\d+\s*soles?\b/) || 
        (text.includes('precio') && text.includes(' a ')) ||
        text.match(/(ponle|ponlo|dale)\s+\d+\s*soles?/)) {
        console.log('[VoiceCommands] → change_price');
        return 'change_price';
    }
    
    // 8. CAMBIO GENÉRICO
    if (COMMAND_WORDS.change.some(word => text.includes(word))) {
        console.log('[VoiceCommands] → change');
        return 'change';
    }
    
    // 9. AGREGAR EXPLÍCITO
    if (COMMAND_WORDS.add.some(word => text.includes(word))) {
        console.log('[VoiceCommands] → add');
        return 'add';
    }
    
    // 10. VENTA POR PRECIO
    if (text.match(/\d+\s*soles?\s+de\s+/) ||
        (text.match(/por\s+\d+\s*soles?/) && !COMMAND_WORDS.change.some(word => text.includes(word))) ||
        text.match(/(?:dame|quiero)\s+\d+\s*soles?\s+(?:en|de)\s+/)) {
        console.log('[VoiceCommands] → sale_by_price');
        return 'sale_by_price';
    }
    
    // 11. POR DEFECTO: SALE/ADD
    console.log('[VoiceCommands] → sale/add');
    return 'sale';
}

// ============================================
// 3. PARSERS ESPECÍFICOS
// ============================================

/**
 * Parsear remoción de producto
 * "quita el arroz" → "arroz"
 * "ya no quiero la leche" → "leche"
 */
function parseRemove(text) {
    text = text.toLowerCase().trim();
    
    // Remover palabras de comando
    for (const word of COMMAND_WORDS.remove) {
        text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), '').trim();
    }
    
    // Remover frases comunes
    text = text.replace(/ya no quiero/g, '');
    text = text.replace(/no quiero/g, '');
    
    // Remover artículos
    text = text.replace(/\b(el|la|los|las|un|una|de|del)\b/g, '').trim();
    
    console.log('[VoiceCommands] Remove:', text);
    
    return text || null;
}

/**
 * Parsear cambio de producto
 * "cambiar arroz por fideos" → {old: "arroz", new: "fideos"}
 */
function parseProductChange(text) {
    text = text.toLowerCase().trim();
    
    const match = text.match(/(?:cambiar|cambia|cambio|mejor)\s+(?:el|la)?\s*(.+?)\s+por\s+(.+)/);
    
    if (match) {
        let oldProd = match[1].trim();
        let newProd = match[2].trim();
        
        // Limpiar artículos
        oldProd = oldProd.replace(/\b(el|la|los|las|un|una)\b/g, '').trim();
        newProd = newProd.replace(/\b(el|la|los|las|un|una)\b/g, '').trim();
        
        console.log('[VoiceCommands] Change:', oldProd, '→', newProd);
        
        return {
            old_product: oldProd,
            new_product: newProd
        };
    }
    
    return null;
}

/**
 * Parsear cambio de precio
 * "ponle 8 soles al aceite" → {product: "aceite", price: 8}
 */
function parsePriceChange(text) {
    text = text.toLowerCase().trim();
    
    // Patrón 1: "precio de X a Y soles"
    let match = text.match(/precio\s+(?:de\s+)?(.+?)\s+a\s+(\d+(?:\.\d+)?)\s*soles?/);
    if (match) {
        return {
            product_query: match[1].trim(),
            new_price: parseFloat(match[2])
        };
    }
    
    // Patrón 2: "ponle 8 soles al aceite"
    match = text.match(/(ponle|ponlo|dale)\s+(\d+(?:\.\d+)?)\s*soles?\s+(?:al?|a la)\s+(.+)/);
    if (match) {
        return {
            product_query: match[3].trim(),
            new_price: parseFloat(match[2])
        };
    }
    
    // Patrón 3: "cambiar X a Y soles"
    if (!text.includes(' y ')) {
        match = text.match(/(?:cambiar\s+precio\s+(?:de\s+)?)?(.+?)\s+a\s+(\d+(?:\.\d+)?)\s*soles?/);
        if (match) {
            let product = match[1].trim();
            product = product.replace(/\b(cambiar|precio|modificar|de|del|la|el)\b/g, '').trim();
            
            if (product) {
                return {
                    product_query: product,
                    new_price: parseFloat(match[2])
                };
            }
        }
    }
    
    return null;
}

// ============================================
// 4. COMANDOS PROCESABLES
// ============================================

/**
 * Procesar comando detectado
 */
function processCommand(text) {
    const commandType = detectCommandType(text);
    
    const result = {
        type: commandType,
        originalText: text
    };
    
    switch (commandType) {
        case 'cancel':
        case 'confirm':
        case 'query_total':
            // Comandos simples sin parámetros
            break;
            
        case 'remove':
            const productToRemove = parseRemove(text);
            if (productToRemove) {
                result.product_query = productToRemove;
            }
            break;
            
        case 'change_product':
            const productChange = parseProductChange(text);
            if (productChange) {
                result.old_product = productChange.old_product;
                result.new_product = productChange.new_product;
            }
            break;
            
        case 'change_price':
            const priceChange = parsePriceChange(text);
            if (priceChange) {
                result.product_query = priceChange.product_query;
                result.new_price = priceChange.new_price;
                result.requires_owner = true; // Requiere permisos
            }
            break;
    }
    
    console.log('[VoiceCommands] Resultado:', result);
    return result;
}

// ============================================
// 5. EJECUTORES DE COMANDOS
// ============================================

/**
 * Ejecutar comando procesado
 */
async function executeCommand(command) {
    console.log('[VoiceCommands] Ejecutando:', command.type);
    
    switch (command.type) {
        case 'query_total':
            return await queryTotal();
            
        case 'confirm':
            return await confirmSale();
            
        case 'cancel':
            return await cancelCart();
            
        case 'remove':
            return await removeProduct(command.product_query);
            
        case 'change_product':
            return await changeProduct(command.old_product, command.new_product);
            
        case 'change_price':
            if (!command.requires_owner || await verifyOwnerPermission()) {
                return await changePrice(command.product_query, command.new_price);
            } else {
                showToast('⚠️ Requiere permisos de dueño', 'warning');
                speak('Requiere permisos de dueño');
                return false;
            }
            
        default:
            return false;
    }
}

async function queryTotal() {
    const total = getCartTotal();
    const items = AppState.cart.length;
    
    showToast(`💰 Total: S/. ${total.toFixed(2)}`, 'info');
    speak(`El total es ${total.toFixed(2)} soles con ${items} producto${items > 1 ? 's' : ''}`);
    
    return true;
}

async function confirmSale() {
    if (AppState.cart.length === 0) {
        showToast('⚠️ Carrito vacío', 'warning');
        speak('El carrito está vacío');
        return false;
    }
    
    // Abrir modal de pago o procesar venta
    const btnCobrar = document.getElementById('btn-cobrar');
    if (btnCobrar) {
        btnCobrar.click();
        speak('Procesando venta');
        return true;
    }
    
    return false;
}

async function cancelCart() {
    if (AppState.cart.length === 0) {
        showToast('⚠️ Carrito vacío', 'warning');
        return false;
    }
    
    // Confirmar antes de borrar todo
    const confirmed = confirm('¿Borrar todos los productos del carrito?');
    
    if (confirmed) {
        AppState.cart = [];
        saveCart();
        renderCart();
        
        showToast('✅ Carrito vaciado', 'success');
        speak('Carrito vaciado');
        return true;
    }
    
    return false;
}

async function removeProduct(productQuery) {
    if (!productQuery) {
        showToast('⚠️ No entendí qué producto quitar', 'warning');
        return false;
    }
    
    // Buscar producto en carrito
    const index = AppState.cart.findIndex(item => 
        item.name.toLowerCase().includes(productQuery) ||
        normalizeText(item.name.toLowerCase()).includes(normalizeText(productQuery))
    );
    
    if (index === -1) {
        showToast(`❌ "${productQuery}" no está en el carrito`, 'warning');
        speak(`${productQuery} no está en el carrito`);
        return false;
    }
    
    const removed = AppState.cart[index];
    AppState.cart.splice(index, 1);
    saveCart();
    renderCart();
    
    showToast(`✅ ${removed.name} eliminado`, 'success');
    speak(`${removed.name} eliminado`);
    
    return true;
}

async function changeProduct(oldProductQuery, newProductQuery) {
    // Implementar cambio de producto
    // 1. Buscar oldProduct en carrito
    // 2. Buscar newProduct en BD
    // 3. Reemplazar en carrito
    
    showToast('Cambio de producto en desarrollo', 'info');
    return false;
}

async function changePrice(productQuery, newPrice) {
    // Requiere permisos de dueño
    // Implementar cambio de precio
    
    showToast('Cambio de precio requiere implementación backend', 'info');
    return false;
}

async function verifyOwnerPermission() {
    // Verificar si usuario actual es dueño
    return AppState.userRole === 'owner' || AppState.userRole === 'admin';
}

// ============================================
// 6. EXPORTS
// ============================================

window.VoiceCommands = {
    detectCommandType,
    processCommand,
    executeCommand,
    parseRemove,
    parseProductChange,
    parsePriceChange,
    COMMAND_WORDS
};

console.log('[VoiceCommands] ✅ Módulo cargado');