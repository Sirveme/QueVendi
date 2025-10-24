# app/config/catalogs.py

CATALOG_DEFINITIONS = {
    # ========== BODEGAS ==========
    'bodega_estandar': {
        'name': 'Bodega Estándar',
        'description': 'Productos básicos para bodega tradicional',
        'icon': '🏪',
        'estimated_products': 200
    },
    'bodega_frutas_verduras': {
        'name': 'Bodega + Frutas/Verduras',
        'description': 'Bodega con sección de productos frescos',
        'icon': '🍎',
        'estimated_products': 200
    },
    
    # ========== MINIMARKET ==========
    'minimarket': {
        'name': 'Minimarket',
        'description': 'Variedad amplia de productos',
        'icon': '🛒',
        'estimated_products': 250
    },
    
    # ========== BAZAR Y PERFUMERÍA ==========
    'bazar_perfumeria': {
        'name': 'Bazar y Perfumería',
        'description': 'Artículos de bazar, cosméticos y regalos',
        'icon': '💄',
        'estimated_products': 200
    },
    
    # ========== PASAMANERÍA Y BISUTERÍA ==========
    'pasamaneria': {
        'name': 'Pasamanería',
        'description': 'Hilos, telas, botones, cierres y mercería',
        'icon': '🧵',
        'estimated_products': 150
    },
    'pasamaneria_bisuteria': {
        'name': 'Pasamanería + Bisutería',
        'description': 'Mercería y materiales para joyería artesanal',
        'icon': '💍',
        'estimated_products': 200
    },
    
    # ========== LIBRERÍA ==========
    'libreria_escolar': {
        'name': 'Librería Escolar',
        'description': 'Útiles escolares, cuadernos y materiales educativos',
        'icon': '📚',
        'estimated_products': 180
    },
    'libreria_oficina': {
        'name': 'Librería y Oficina',
        'description': 'Útiles escolares y artículos de oficina',
        'icon': '📎',
        'estimated_products': 200
    },
    
    # ========== FERRETERÍA ==========
    'ferreteria_basica': {
        'name': 'Ferretería Básica',
        'description': 'Herramientas y materiales básicos de construcción',
        'icon': '🔨',
        'estimated_products': 250
    },
    'ferreteria_completa': {
        'name': 'Ferretería Completa',
        'description': 'Herramientas, electricidad, plomería y construcción',
        'icon': '🛠️',
        'estimated_products': 400
    },
    
    # ========== FARMACIA (FUTURO) ==========
    'farmacia_basica': {
        'name': 'Farmacia Básica',
        'description': 'Medicamentos OTC y productos de cuidado personal',
        'icon': '💊',
        'estimated_products': 300,
        'available': False  # Aún no disponible
    }
}

def get_available_catalogs():
    """Retorna solo catálogos disponibles"""
    return {
        code: info 
        for code, info in CATALOG_DEFINITIONS.items() 
        if info.get('available', True)  # Por defecto True
    }