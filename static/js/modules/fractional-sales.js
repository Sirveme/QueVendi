/**
 * ============================================
 * SISTEMA: PRODUCTOS A GRANEL VS EMPACADOS
 * ============================================
 * 
 * PROBLEMA:
 * Usuario pide: "1/4 de aceite"
 * Bodega solo vende: Botellas de 1L
 * 
 * ¿Qué hacer?
 * 
 * SOLUCIONES POSIBLES:
 */

// ============================================
// SOLUCIÓN 1: CAMPO EN BD (RECOMENDADO)
// ============================================

/*
Agregar campo a tabla products:

ALTER TABLE products 
ADD COLUMN sell_by_fraction BOOLEAN DEFAULT false,
ADD COLUMN minimum_sale_unit DECIMAL(10,2) DEFAULT 1.0,
ADD COLUMN unit_type VARCHAR(50) DEFAULT 'unit';

Ejemplos:

Papa:
- sell_by_fraction: true
- minimum_sale_unit: 0.25 (1/4 kg)
- unit_type: 'weight' (kg)

Aceite embotellado:
- sell_by_fraction: false
- minimum_sale_unit: 1.0 (1 botella completa)
- unit_type: 'unit'

Arroz en bolsas:
- sell_by_fraction: false
- minimum_sale_unit: 1.0 (1 bolsa)
- unit_type: 'package'

Arroz a granel:
- sell_by_fraction: true
- minimum_sale_unit: 0.5 (medio kg)
- unit_type: 'weight'
*/

// ============================================
// SOLUCIÓN 2: VALIDACIÓN EN FRONTEND
// ============================================

/**
 * Validar si producto puede venderse por fracción
 */
async function validateFractionalSale(product, requestedQuantity) {
    console.log('[Validate] Producto:', product.name, 'Cantidad:', requestedQuantity);
    
    // Si producto no permite fracción
    if (!product.sell_by_fraction) {
        const minUnit = product.minimum_sale_unit || 1;
        
        // Verificar si cantidad es múltiplo de unidad mínima
        if (requestedQuantity % minUnit !== 0) {
            // No se puede vender fracción
            
            // Opción A: Redondear hacia arriba
            const roundedUp = Math.ceil(requestedQuantity / minUnit) * minUnit;
            
            // Opción B: Redondear hacia abajo
            const roundedDown = Math.floor(requestedQuantity / minUnit) * minUnit;
            
            // Mostrar modal de confirmación
            showFractionalWarningModal({
                product: product,
                requested: requestedQuantity,
                roundedUp: roundedUp,
                roundedDown: roundedDown,
                minUnit: minUnit
            });
            
            return false;
        }
    }
    
    return true;
}

/**
 * Modal de advertencia para productos que no se venden por fracción
 */
function showFractionalWarningModal(data) {
    const modal = document.createElement('div');
    modal.className = 'fractional-warning-modal';
    modal.innerHTML = `
        <div class="fractional-warning-content">
            <h3>⚠️ Producto no se vende por fracción</h3>
            
            <p>${data.product.name} solo se vende en unidades de <strong>${data.minUnit} ${data.product.unit}</strong></p>
            
            <p>Solicitaste: <strong>${data.requested} ${data.product.unit}</strong></p>
            
            <div class="options">
                <button onclick="confirmFractional(${data.product.id}, ${data.roundedUp})">
                    Vender ${data.roundedUp} ${data.product.unit}
                    <span class="price">S/. ${(data.roundedUp * data.product.sale_price).toFixed(2)}</span>
                </button>
                
                ${data.roundedDown > 0 ? `
                    <button onclick="confirmFractional(${data.product.id}, ${data.roundedDown})">
                        Vender ${data.roundedDown} ${data.product.unit}
                        <span class="price">S/. ${(data.roundedDown * data.product.sale_price).toFixed(2)}</span>
                    </button>
                ` : ''}
                
                <button onclick="closeFractionalModal()" class="cancel">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// ============================================
// SOLUCIÓN 3: CASOS ESPECÍFICOS
// ============================================

/**
 * Manejo inteligente por tipo de producto
 */
function handleFractionalRequest(product, quantity) {
    const productType = detectProductType(product);
    
    switch (productType) {
        case 'liquid_bottled':
            // Líquidos embotellados (aceite, gaseosa)
            // Solo venden botellas completas
            return {
                allowed: false,
                message: `${product.name} solo se vende en botellas completas`,
                suggestedQuantity: Math.ceil(quantity)
            };
            
        case 'bulk_weight':
            // A granel por peso (papa, arroz)
            // Permiten cualquier cantidad
            return {
                allowed: true,
                quantity: quantity
            };
            
        case 'packaged':
            // Empaquetados (galletas, fideos)
            // Solo venden paquetes completos
            return {
                allowed: false,
                message: `${product.name} solo se vende en paquetes completos`,
                suggestedQuantity: Math.ceil(quantity)
            };
            
        case 'countable':
            // Contables (huevos, panes)
            // Solo enteros
            if (quantity % 1 !== 0) {
                return {
                    allowed: false,
                    message: `${product.name} solo se vende en unidades completas`,
                    suggestedQuantity: Math.round(quantity)
                };
            }
            return {
                allowed: true,
                quantity: quantity
            };
            
        default:
            return {
                allowed: true,
                quantity: quantity
            };
    }
}

/**
 * Detectar tipo de producto por categoría o características
 */
function detectProductType(product) {
    const name = product.name.toLowerCase();
    const category = product.category?.toLowerCase() || '';
    
    // Líquidos embotellados
    if (name.includes('aceite') || name.includes('gaseosa') || 
        name.includes('agua') || name.includes('cerveza') ||
        category.includes('bebida') || category.includes('aceite')) {
        return 'liquid_bottled';
    }
    
    // A granel por peso
    if (name.includes('papa') || name.includes('camote') || 
        name.includes('arroz granel') || name.includes('azúcar granel') ||
        category.includes('verdura') || category.includes('fruta')) {
        return 'bulk_weight';
    }
    
    // Empaquetados
    if (name.includes('paquete') || name.includes('bolsa') ||
        name.includes('galleta') || name.includes('fideos') ||
        category.includes('abarrote')) {
        return 'packaged';
    }
    
    // Contables
    if (name.includes('huevo') || name.includes('pan') ||
        name.includes('unidad') || product.unit === 'unidad') {
        return 'countable';
    }
    
    return 'other';
}

// ============================================
// INTEGRACIÓN EN FLUJO DE VENTA
// ============================================

/**
 * Modificar addToCart para validar fracciones
 */
async function addToCartWithFractionalValidation(product, quantity) {
    // Validar si se puede vender por fracción
    const validation = handleFractionalRequest(product, quantity);
    
    if (!validation.allowed) {
        // Mostrar advertencia y sugerencia
        const confirmed = await showFractionalConfirmation({
            product: product,
            requested: quantity,
            suggested: validation.suggestedQuantity,
            message: validation.message
        });
        
        if (confirmed) {
            // Usuario aceptó la cantidad sugerida
            addToCart(product, validation.suggestedQuantity);
        } else {
            // Usuario canceló
            showToast('Venta cancelada', 'info');
        }
    } else {
        // Se puede vender la cantidad solicitada
        addToCart(product, quantity);
    }
}

// ============================================
// EJEMPLO DE USO
// ============================================

/*
CASO 1: "1/4 de aceite"

1. Usuario: "un cuarto de aceite"
2. Sistema detecta: quantity=0.25, product="aceite"
3. Busca producto: "Aceite Primor 1L"
4. Detecta tipo: liquid_bottled
5. Valida: 0.25 < 1.0 (mínimo)
6. Muestra modal:
   
   ┌───────────────────────────────────────┐
   │ ⚠️ Aceite solo se vende en botellas  │
   │                                        │
   │ Solicitaste: 0.25 L                   │
   │                                        │
   │ Opciones:                              │
   │ ○ Vender 1 botella - S/. 8.50        │
   │ ○ Cancelar                            │
   └───────────────────────────────────────┘

7. Usuario elige: 1 botella
8. Se agrega: 1 × Aceite Primor 1L


CASO 2: "medio kilo de papa"

1. Usuario: "medio kilo de papa"
2. Sistema detecta: quantity=0.5, product="papa"
3. Busca producto: "Papa blanca kg"
4. Detecta tipo: bulk_weight
5. Valida: OK (venta a granel permitida)
6. Agrega: 0.5 × Papa blanca kg


CASO 3: "dos bolsas y media de arroz"

1. Usuario: "dos y media de arroz"
2. Sistema detecta: quantity=2.5, product="arroz"
3. Busca producto: "Arroz Superior 1kg"
4. Detecta tipo: packaged
5. Valida: 2.5 no es entero
6. Muestra modal:
   
   ┌───────────────────────────────────────┐
   │ ⚠️ Arroz solo se vende en bolsas     │
   │                                        │
   │ Solicitaste: 2.5 bolsas               │
   │                                        │
   │ Opciones:                              │
   │ ○ Vender 3 bolsas - S/. 9.00         │
   │ ○ Vender 2 bolsas - S/. 6.00         │
   │ ○ Cancelar                            │
   └───────────────────────────────────────┘

7. Usuario elige opción
*/

// ============================================
// EXPORTS
// ============================================

window.FractionalSales = {
    validateFractionalSale,
    handleFractionalRequest,
    detectProductType,
    addToCartWithFractionalValidation
};