/**
 * ============================================
 * VOICE PARSER MODULE - VERSIÓN DEFINITIVA
 * ============================================
  * UBICACIÓN: static/js/modules/voice-parser.js
  * Integra:
 * - Fracciones en palabras: "medio", "cuarto", "tercio"
 * - Fracciones matemáticas: 1/2, 1/4, 3/4
 * - Números en palabras: "dos", "tres", "docena"
 * - Montos: "2 soles de papa"
 * - Listas: "arroz, leche y pan"
 * - Normalización de acentos
  */
// ============================================
// 0. MANEJO DE PLURALES
// ============================================
const pluralMap = {
    'panes': 'pan',
    'huevos': 'huevo',
    'galletas': 'galleta',
    'papas': 'papa',
    'camotes': 'camote',
    'leches': 'leche',
    'cervezas': 'cerveza',
    'gaseosas': 'gaseosa'
};


// ============================================
// 1. DICCIONARIOS
// ============================================

const FRACTIONS = {
    // Medio
    'medio': 0.5,
    'media': 0.5,
    'medito': 0.5,
    'un medio': 0.5,
    'una media': 0.5,
    
    // Cuarto
    'cuarto': 0.25,
    'un cuarto': 0.25,
    'cuartito': 0.25,
    'un cuartito': 0.25,
    
    // Tres cuartos
    'tres cuartos': 0.75,
    'tres cuartitos': 0.75,
    
    // Tercio
    'tercio': 0.33,
    'un tercio': 0.33,
    'una tercera parte': 0.33,
    
    // Dos tercios
    'dos tercios': 0.67,
    'dos tercio': 0.67,
    
    // Quinto
    'un quinto': 0.2,
    'quinto': 0.2,
    
    // Octavo
    'un octavo': 0.125,
    'octavo': 0.125,
    
    // Matemáticas (NUEVO)
    '1/2': 0.5,
    '1/4': 0.25,
    '3/4': 0.75,
    '1/3': 0.33,
    '2/3': 0.67,
    '1/5': 0.2,
    '1/8': 0.125,
    '3/8': 0.375,
    '5/8': 0.625,
    '7/8': 0.875
};

const NUMBERS = {
    // Unidades
    'cero': 0,
    'un': 1,
    'uno': 1,
    'una': 1,
    'dos': 2,
    'tres': 3,
    'cuatro': 4,
    'cinco': 5,
    'seis': 6,
    'siete': 7,
    'ocho': 8,
    'nueve': 9,
    'diez': 10,
    'decena': 10,
    
    // 11-15
    'once': 11,
    'doce': 12,
    'docena': 12,
    'trece': 13,
    'catorce': 14,
    'quince': 15,
    
    // 20-90
    'veinte': 20,
    'veintiuno': 21,
    'veintidós': 22,
    'veintitrés': 23,
    'veinticuatro': 24,
    'veinticinco': 25,
    'treinta': 30,
    'cuarenta': 40,
    'cincuenta': 50,
    'sesenta': 60,
    'setenta': 70,
    'ochenta': 80,
    'noventa': 90,
    
    // Centenas
    'cien': 100,
    'ciento': 100,
    'medio ciento': 50,
    'doscientos': 200,
    'trescientos': 300
};

// Peruanismos y regionalismos (NUEVO)
// ✅ DESPUÉS (mantiene español):
const PERUANISMOS = {
    'chelita': 'cerveza',
    'chela': 'cerveza',
    'pilsen': 'cerveza',
    'cristal': 'cerveza',
    'jamonada': 'pan con jamón',
    'choclo': 'maíz',
    'yapa': 'regalo extra',
    'pollito': 'pollo',
    // ✅ MANTENER NOMBRES EN ESPAÑOL
    // Los peruanismos son para traducir SLANG a términos buscables
    // NO para traducir al inglés
};

// Cache de productos conocidos (agregar al inicio del archivo):
let knownProductsCache = [];

function getKnownProducts() {
    // Retornar productos del cache o cargar
    if (knownProductsCache.length === 0 && window.AppState && window.AppState.recentProducts) {
        knownProductsCache = window.AppState.recentProducts;
    }
    return knownProductsCache;
}

function updateKnownProducts(products) {
    knownProductsCache = products;
}

// Exportar para uso global
//window.VoiceParser.updateKnownProducts = updateKnownProducts;


// ============================================
// 2. NORMALIZACIÓN
// ============================================

/**
 * Normalizar texto removiendo acentos
 */
/**
 * Normalizar texto: acentos, números, fracciones, peruanismos, unidades
 */
function normalizeText(text) {
    // ============================================
    // 1. REMOVER TODOS LOS ACENTOS
    // ============================================
    let normalized = text
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    
    // ============================================
    // 2. NÚMEROS EN TEXTO → DÍGITOS
    // ============================================
    const numberWords = {
        'un': '1',
        'uno': '1',
        'una': '1',
        'dos': '2',
        'tres': '3',
        'cuatro': '4',
        'cinco': '5',
        'seis': '6',
        'siete': '7',
        'ocho': '8',
        'nueve': '9',
        'diez': '10',
        'once': '11',
        'doce': '12',
        'trece': '13',
        'catorce': '14',
        'quince': '15',
        'veinte': '20',
        'veinticinco': '25',
        'treinta': '30',
        'cincuenta': '50'
    };
    
    for (const [word, digit] of Object.entries(numberWords)) {
        normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit);
    }
    
    // ============================================
    // 3. FRACCIONES → DECIMALES
    // ============================================
    const fractionWords = {
        'medio': '0.5',
        'media': '0.5',
        'un cuarto': '0.25',
        'cuarto': '0.25',
        'tres cuartos': '0.75',
        'un tercio': '0.33',
        'dos tercios': '0.67'
    };
    
    for (const [word, value] of Object.entries(fractionWords)) {
        normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), value);
    }
    
    // ============================================
    // 4. PERUANISMOS → TÉRMINOS FORMALES
    // ============================================
    const peruanismos = {
        'chela': 'cerveza',
        'chelita': 'cerveza',
        'pancito': 'pan',
        'panecito': 'pan',
        'huevito': 'huevo',
        'aguita': 'agua',
        'lechita': 'leche',
        'pollito': 'pollo',
        'camotito': 'camote',
        'papita': 'papa'
    };
    
    for (const [slang, formal] of Object.entries(peruanismos)) {
        normalized = normalized.replace(new RegExp(`\\b${slang}\\b`, 'gi'), formal);
    }
    
    // ============================================
    // 5. UNIDADES DE MEDIDA (ELIMINAR)
    // ============================================
    const units = [
        'kilo',
        'kilos',
        'kilogramo',
        'kilogramos',
        'kg',
        'litro',
        'litros',
        'lt',
        'gramo',
        'gramos',
        'docena',
        'docenas',
        'decena',
        'metro',
        'metros',
        'centimetro',
        'centimetros'
    ];
    
    units.forEach(unit => {
        normalized = normalized.replace(new RegExp(`\\b${unit}\\b`, 'gi'), '');
    });
    
    // ============================================
    // 6. PLURALES → SINGULAR
    // ============================================
    const pluralMap = {
        'panes': 'pan',
        'papas': 'papa',
        'camotes': 'camote',
        'leches': 'leche',
        'cervezas': 'cerveza',
        'gaseosas': 'gaseosa',
        'huevos': 'huevo',
        'galletas': 'galleta',
        'aceites': 'aceite',
        'arroces': 'arroz',
        'azucares': 'azucar',
        'cafes': 'cafe',
        'jabones': 'jabon',
        'detergentes': 'detergente'
    };
    
    for (const [plural, singular] of Object.entries(pluralMap)) {
        normalized = normalized.replace(new RegExp(`\\b${plural}\\b`, 'gi'), singular);
    }
    
    // ============================================
    // 7. NORMALIZAR "SOLES" Y VARIANTES
    // ============================================
    normalized = normalized.replace(/\bs\s*\/\s*\.?\s*/gi, 'sol');  // "s/." → "sol"
    normalized = normalized.replace(/\bs\s*\.\s*/gi, 'sol');        // "s." → "sol"
    normalized = normalized.replace(/\bsol\b/gi, 'sol');
    normalized = normalized.replace(/\bsoles\b/gi, 'sol');
    
    // ============================================
    // 8. STOP WORDS (ELIMINAR AL FINAL)
    // ============================================
    const stopWords = [
        'un',
        'una',
        'unos',
        'unas',
        'el',
        'la',
        'los',
        'las',
        'de',
        'del',
        'por',
        'para',
        'dame',
        'quiero',
        'necesito',
        'porfa',
        'porfavor'
    ];
    
    stopWords.forEach(word => {
        normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
    });
    
    // ============================================
    // 9. LIMPIAR ESPACIOS MÚLTIPLES
    // ============================================
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
}

/**
 * Traducir peruanismos
 */
function translatePeruanisms(text) {
    let translated = text.toLowerCase();
    
    for (const [slang, formal] of Object.entries(PERUANISMOS)) {
        const regex = new RegExp(`\\b${slang}\\b`, 'gi');
        translated = translated.replace(regex, formal);
    }
    
    return translated;
}

/**
 * Convertir palabra a número
 */
function palabraANumero(palabra) {
    palabra = palabra.toLowerCase().trim();
    
    // Buscar en fracciones primero
    if (FRACTIONS[palabra] !== undefined) {
        return FRACTIONS[palabra];
    }
    
    // Buscar en números
    if (NUMBERS[palabra] !== undefined) {
        return NUMBERS[palabra];
    }
    
    return null;
}

// ============================================
// 3. PARSING DE FRACCIONES
// ============================================

/**
 * Parsear fracciones (palabras y matemáticas)
 * "medio kilo" → 0.5
 * "1/2 kilo" → 0.5
 * "dos y medio" → 2.5
 */
function parseFraction(text) {
    text = text.toLowerCase().trim();
    
    console.log('[ParseFraction] Analizando:', text);
    
    // 1. Patrón: "X y FRACCIÓN" (ej: "dos y medio")
    const fractionPattern = /(\w+)\s+y\s+(\w+)/;
    const fractionMatch = text.match(fractionPattern);
    
    if (fractionMatch) {
        const baseWord = fractionMatch[1];
        const fractionWord = fractionMatch[2];
        
        let base = 0;
        
        if (/^\d+$/.test(baseWord)) {
            base = parseFloat(baseWord);
        } else {
            base = palabraANumero(baseWord) || 0;
        }
        
        const fraction = palabraANumero(fractionWord) || 0;
        const result = base + fraction;
        
        console.log(`[ParseFraction] "${baseWord} y ${fractionWord}" → ${result}`);
        return { quantity: result, matched: fractionMatch[0] };
    }
    
    // 2. Fracciones matemáticas (NUEVO): 1/2, 3/4, etc.
    const mathFractionPattern = /(\d+)\/(\d+)/;
    const mathMatch = text.match(mathFractionPattern);
    
    if (mathMatch) {
        const numerator = parseInt(mathMatch[1]);
        const denominator = parseInt(mathMatch[2]);
        const result = numerator / denominator;
        
        console.log(`[ParseFraction] ${mathMatch[0]} → ${result.toFixed(2)}`);
        return { quantity: result, matched: mathMatch[0] };
    }
    
    // 3. Buscar fracciones en palabras (del más largo al más corto)
    const sortedFractions = Object.keys(FRACTIONS).sort((a, b) => b.length - a.length);
    
    for (const key of sortedFractions) {
        if (text.includes(key)) {
            console.log(`[ParseFraction] "${key}" → ${FRACTIONS[key]}`);
            return { quantity: FRACTIONS[key], matched: key };
        }
    }
    
    // 4. Números en palabras
    const sortedNumbers = Object.keys(NUMBERS).sort((a, b) => b.length - a.length);
    
    for (const key of sortedNumbers) {
        if (text.includes(key)) {
            console.log(`[ParseFraction] "${key}" → ${NUMBERS[key]}`);
            return { quantity: NUMBERS[key], matched: key };
        }
    }
    
    // 5. Decimales: 2.5, 1,5
    const decimalMatch = text.match(/(\d+[.,]\d+)/);
    if (decimalMatch) {
        const num = parseFloat(decimalMatch[1].replace(',', '.'));
        console.log(`[ParseFraction] Decimal: ${decimalMatch[1]} → ${num}`);
        return { quantity: num, matched: decimalMatch[1] };
    }
    
    // 6. Enteros
    const numberMatch = text.match(/\b(\d+)\b/);
    if (numberMatch) {
        const num = parseInt(numberMatch[1]);
        console.log(`[ParseFraction] Entero: ${numberMatch[1]} → ${num}`);
        return { quantity: num, matched: numberMatch[1] };
    }
    
    // 7. Sin cantidad detectada
    console.log('[ParseFraction] Sin cantidad → 1');
    return { quantity: 1, matched: null };
}

// ============================================
// 4. PARSING DE MONTOS
// ============================================

/**
 * Parsear ventas por monto
 * "2 soles de papa" → {amount: 2, product: "papa"}
 */
// ============================================
// FIX 2: "1 sol 50" formato con centavos
// ============================================
function parseAmount(text) {
    text = text.toLowerCase().trim();
    
    console.log('[ParseAmount] Analizando:', text);

    // ✅ NUEVO PATRÓN: "1 sol 50 de PRODUCTO"
    const solCentavosPattern = /(\d+)\s*sol(?:es)?\s+(\d+)\s+(?:de\s+)?(.+)/i;
    const centavosMatch = text.match(solCentavosPattern);
    
    if (centavosMatch) {
        const soles = parseInt(centavosMatch[1]);
        const centavos = parseInt(centavosMatch[2]);
        const amount = soles + (centavos / 100);
        const product = centavosMatch[3].trim();
        
        console.log(`[ParseAmount] ✅ ${soles} sol ${centavos} = S/. ${amount.toFixed(2)} de "${product}"`);
        
        return {
            amount: amount,
            product: product,
            isAmount: true
        };
    }

    
    const patterns = [
        // "X sol(es) de PRODUCTO"
        {
            regex: /(\d+(?:[.,]\d+)?)\s*sol(?:es)?\s+de\s+(.+)/i,
            amountIndex: 1,
            productIndex: 2
        },
        // "PRODUCTO por X sol(es)"
        {
            regex: /(.+?)\s+por\s+(\d+(?:[.,]\d+)?)\s*sol(?:es)?$/i,
            amountIndex: 2,
            productIndex: 1
        },
        // "dame X sol(es) en/de PRODUCTO"
        {
            regex: /(?:dame|quiero)\s+(\d+(?:[.,]\d+)?)\s*sol(?:es)?\s+(?:en|de)\s+(.+)/i,
            amountIndex: 1,
            productIndex: 2
        },
        // Palabras: "un sol de PRODUCTO"
        {
            regex: /(un|dos|tres|cuatro|cinco|medio)\s+sol(?:es)?\s+de\s+(.+)/i,
            amountIndex: 1,
            productIndex: 2,
            useWords: true
        }
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern.regex);
        if (match) {
            let amount = match[pattern.amountIndex];
            let product = match[pattern.productIndex].trim();
            
            if (pattern.useWords) {
                const numWord = palabraANumero(amount);
                if (numWord !== null) {
                    amount = numWord;
                } else {
                    continue; // Palabra no reconocida, siguiente patrón
                }
            } else {
                amount = parseFloat(String(amount).replace(',', '.'));
            }
            
            console.log(`[ParseAmount] ✅ ${amount} soles de "${product}"`);
            
            return {
                amount: amount,
                product: product,
                isAmount: true
            };
        }
    }
    
    console.log('[ParseAmount] No es búsqueda por monto');
    return { amount: null, product: text, isAmount: false };

}

/**
 * Verificar si cantidad ambigua debe interpretarse como monto
 * "1.5 de camote" → ¿1.5 kg o S/. 1.50?
 */
async function shouldInterpretAsAmount(productName, quantity) {
    // Solo para cantidades que parecen dinero
    if (quantity > 10) {
        return false; // Nadie compra S/. 20 de papa, es cantidad
    }
    
    // Buscar si producto tiene conversión configurada
    try {
        const response = await fetch(`${CONFIG.apiBase}/conversions/check/${productName}`);
        if (response.ok) {
            const data = await response.json();
            return data.allow_currency_sale === true;
        }
    } catch (error) {
        console.log('[shouldInterpretAsAmount] No pudo verificar:', error);
    }
    
    return false; // Por defecto: cantidad
}


// ============================================
// 5. EXTRACTION PRINCIPAL
// ============================================

/**
 * Extraer producto y cantidad de comando de voz
 */
function extractProductAndQuantity(text) {
    const original = text;
    
    // 1. Traducir peruanismos
    text = translatePeruanisms(text);
    
    // 2. Normalizar
    text = normalizeText(text.toLowerCase().trim());
    
    console.log('[Extract] 📝 Original:', original);
    console.log('[Extract] 🔄 Procesado:', text);
    
    // 3. PRIORIDAD 1: Detectar monto
    const amountResult = parseAmount(text);
    if (amountResult.isAmount) {
        console.log('[Extract] 💰 Búsqueda por MONTO');
        return {
            productName: amountResult.product,
            quantity: 1,
            amount: amountResult.amount,
            searchByAmount: true
        };
    }
    
    // 4. Detectar fracción/cantidad
    const fractionResult = parseFraction(text);
    let quantity = fractionResult.quantity;
    let productName = text;

    // ✅ NUEVO: Verificar si es monto ambiguo
    if (quantity >= 0.5 && quantity <= 10 && quantity % 0.5 === 0) {
        // Puede ser dinero (0.5, 1, 1.5, 2, 2.5, etc.)
        // Marcar para verificación posterior
        return {
            productName: productName,
            quantity: quantity,
            amount: quantity,
            searchByAmount: null, // null = ambiguo, decidir después
            needsVerification: true
        };
    }
    
    // 5. Limpiar nombre del producto
    if (fractionResult.matched) {
        productName = productName.replace(fractionResult.matched, '');
    }
    
    // Remover números sueltos
    productName = productName.replace(/\b\d+(?:[.,]\d+)?\b/g, '');
    
    // Remover fracciones matemáticas
    productName = productName.replace(/\d+\/\d+/g, '');
    
    // Stop words
    const stopWords = [
        'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
        'kilo', 'kilogramo', 'kilos', 'kg',
        'litro', 'litros', 'lts', 'lt', 'l',
        'gramo', 'gramos', 'gr', 'g',
        'unidad', 'unidades', 'und',
        'paquete', 'paquetes', 'paq',
        'botella', 'botellas',
        'lata', 'latas',
        'dame', 'quiero', 'necesito', 'vender', 'vendeme',
        'pon', 'ponme', 'agrega', 'agregame', 'añade',
        'por', 'favor', 'porfavor', 'porfa', 'gracias'
    ];
    
    const words = productName.split(/\s+/).filter(word => 
        word.length > 1 && !stopWords.includes(word)
    );
    
    productName = words.join(' ').trim();
    
    console.log(`[Extract] ✅ Producto: "${productName}" | Cantidad: ${quantity}`);
    
    return {
        productName: productName,
        quantity: quantity,
        amount: null,
        searchByAmount: false
    };
}

// ============================================
// 6. PARSING DE LISTAS
// ============================================

/**
 * Parsear listas de productos
 * "arroz, leche y pan" → [{...}, {...}, {...}]
 */
function parseProductList(text) {
    console.log('[ParseList] 📋 Analizando:', text);
    
    // ✅ NORMALIZAR UNA SOLA VEZ (incluye todo: acentos, números, unidades, peruanismos)
    // ✅ TRADUCIR PERUANISMOS Y NORMALIZAR
    const normalized = normalizeText(translatePeruanisms(text));
    console.log('[ParseList] 🔄 Normalizado:', normalized);
    
    // ============================================
    // 1. DETECTAR LISTAS CON MONTOS
    // ============================================
    // "2 soles de camote 1 sol de papa y 6 panes"
    const amountPattern = /(\d+(?:\.\d+)?)\s*(?:sol(?:es)?|s\/\.?)\s+(?:de\s+)?(\w+)/gi;
    const hasAmounts = amountPattern.test(normalized);

    if (hasAmounts) {
        console.log('[ParseList] 💰 Lista con montos detectada');
        const products = [];
        
        // Resetear regex
        amountPattern.lastIndex = 0;
        
        let lastIndex = 0;
        let match;
        
        while ((match = amountPattern.exec(normalized)) !== null) {
            const amount = parseFloat(match[1]);
            const productName = match[2];
            
            products.push({
                productName: productName,
                quantity: 1,
                amount: amount,
                searchByAmount: true
            });
            
            lastIndex = match.index + match[0].length;
        }
        
        // Buscar productos sin monto después del último match
        const remainingText = normalized.substring(lastIndex).trim();
        if (remainingText.length > 0) {
            // Parsear resto como lista normal
            const remaining = remainingText.replace(/^(y|,)\s*/, '');
            if (remaining.length > 2) {
                const parsed = extractProductAndQuantity(remaining);
                if (parsed.productName) {
                    products.push(parsed);
                }
            }
        }
        
        console.log('[ParseList] Total detectados:', products.length);
        return products;
    }
    
    // ============================================
    // 2. DETECTAR SI TIENE COMAS
    // ============================================
    const hasComas = normalized.includes(',');
    
    if (hasComas) {
        // "arroz, leche, pan" → separar por comas
        const items = normalized.split(',').map(s => s.trim()).filter(s => s.length > 0);
        const products = items.map(item => extractProductAndQuantity(item)).filter(p => p.productName);
        console.log(`[ParseList] Total válidos: ${products.length}`);
        return products;
    }
    
    // ============================================
    // 3. DETECTAR SI TIENE "Y"
    // ============================================
    const hasY = /\s+(y|e)\s+/.test(normalized);
    
    if (hasY) {
        // "arroz leche pan y huevo" → separar por espacios
        
        // Primero separar por " y "
        const parts = normalized.split(/\s+(y|e)\s+/);
        
        // Cada parte puede tener múltiples productos
        const allProducts = [];
        
        for (const part of parts) {
            // Dividir por espacios
            const words = part.trim().split(/\s+/);
            
            // Si tiene cantidad al inicio, extraer
            let quantity = 1;
            let startIndex = 0;
            
            // Detectar si primera palabra es número
            const firstWord = words[0];
            
            // Ya normalizado, solo verificar si es dígito
            if (/^\d+(?:\.\d+)?$/.test(firstWord)) {
                quantity = parseFloat(firstWord);
                startIndex = 1; // Saltar primera palabra
            }
            
            // Resto de palabras son productos individuales
            for (let i = startIndex; i < words.length; i++) {
                const productName = words[i].trim();
                
                // Ignorar palabras muy cortas
                if (productName.length < 2) continue;
                
                allProducts.push({
                    productName: productName,
                    quantity: i === startIndex ? quantity : 1, // Solo primer producto lleva cantidad
                    amount: null,
                    searchByAmount: false
                });
            }
        }
        
        console.log(`[ParseList] Total detectados: ${allProducts.length}`);
        return allProducts.filter(p => p.productName);
    }
    
    // ============================================
    // 4. NO ES LISTA, ITEM ÚNICO
    // ============================================
    console.log('[ParseList] No es lista, item único');
    const parsed = extractProductAndQuantity(normalized);
    return parsed.productName ? [parsed] : [];
}

// ============================================
// 7. EXPORTS (Globales)
// ============================================

window.VoiceParser = {
    normalizeText,
    translatePeruanisms,
    palabraANumero,
    parseFraction,
    parseAmount,
    extractProductAndQuantity,
    parseProductList,
    updateKnownProducts,
    FRACTIONS,
    NUMBERS,
    PERUANISMOS
};

// Compatibilidad
window.normalizeText = normalizeText;
window.palabraANumero = palabraANumero;
window.parseFraction = parseFraction;
window.parseAmount = parseAmount;
window.extractProductAndQuantity = extractProductAndQuantity;
window.parseProductList = parseProductList;

console.log('[VoiceParser] ✅ Módulo cargado');