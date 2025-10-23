"""
Endpoints para gestión de catálogos pre-cargados
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.product import Product
from app.models.user import User
from app.api.dependencies import get_current_user
import json
import os
from typing import List

router = APIRouter(prefix="/catalogs", tags=["catalogs"])

# Directorio donde están los catálogos JSON
CATALOGS_DIR = os.path.join(os.path.dirname(__file__), "../../catalogs")


@router.get("/templates")
async def get_catalog_templates():
    """
    Lista todos los catálogos disponibles
    """
    templates = []
    
    # Escanear directorio de catálogos
    for filename in os.listdir(CATALOGS_DIR):
        if filename.endswith('.json'):
            filepath = os.path.join(CATALOGS_DIR, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                catalog = json.load(f)
                templates.append({
                    'id': catalog['catalog_id'],
                    'name': catalog['name'],
                    'description': catalog['description'],
                    'icon': catalog['icon'],
                    'product_count': catalog['total_products']
                })
    
    return templates


@router.get("/templates/{catalog_id}")
async def get_catalog_detail(catalog_id: str):
    """
    Obtiene el detalle completo de un catálogo
    """
    filepath = os.path.join(CATALOGS_DIR, f"{catalog_id}.json")
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Catálogo no encontrado")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        catalog = json.load(f)
    
    return catalog


@router.post("/load/{catalog_id}")
async def load_catalog(
    catalog_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Carga un catálogo completo a la tienda del usuario
    """
    # Verificar que no tenga productos ya
    existing_products = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True
    ).count()
    
    if existing_products > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Ya tienes {existing_products} productos. Usa 'agregar' en lugar de 'cargar'"
        )
    
    # Cargar catálogo
    filepath = os.path.join(CATALOGS_DIR, f"{catalog_id}.json")
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Catálogo no encontrado")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        catalog = json.load(f)
    
    # Insertar productos en batch
    products_added = 0
    
    for category_data in catalog['categories']:
        for product_data in category_data['products']:
            product = Product(
                store_id=current_user.store_id,
                name=product_data['name'],
                sale_price=product_data['price'],
                cost_price=product_data.get('cost_price', 0),
                category=product_data['category'],
                aliases=product_data.get('aliases', []),
                stock=0,  # Empieza en 0, luego agregan stock
                is_active=True
            )
            db.add(product)
            products_added += 1
    
    db.commit()
    
    return {
        'message': f'Catálogo cargado exitosamente',
        'products_added': products_added,
        'catalog_name': catalog['name']
    }


@router.post("/adjust-prices")
async def adjust_prices(
    percentage: float,
    category: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Ajusta todos los precios por un porcentaje
    
    Args:
        percentage: Porcentaje de ajuste (ej: 10 para +10%, -10 para -10%)
        category: Categoría específica (opcional)
    """
    query = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True
    )
    
    if category:
        query = query.filter(Product.category == category)
    
    products = query.all()
    
    for product in products:
        product.sale_price = round(product.sale_price * (1 + percentage/100), 2)
    
    db.commit()
    
    return {
        'message': f'{len(products)} productos actualizados',
        'adjustment': f'{percentage:+.1f}%',
        'category': category or 'Todas'
    }


@router.get("/wizard", response_class=HTMLResponse)
async def catalog_wizard(
    current_user: User = Depends(get_current_user)
):
    """
    Renderiza el wizard de catálogos (HTML con HTMX)
    """
    # En producción, esto debería venir de un template Jinja2
    # Por ahora, devuelvo HTML directamente
    
    html = """
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Configurar Catálogo</title>
        <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        <link rel="stylesheet" href="/static/css/catalog.css">
    </head>
    <body>
        <div class="wizard-container">
            <div class="wizard-header">
                <h1>🏪 Configura tu Catálogo</h1>
                <p>Elige un catálogo base y ajusta los precios a tu zona</p>
            </div>
            
            <div id="wizard-content" 
                 hx-get="/api/v1/catalogs/templates" 
                 hx-trigger="load"
                 hx-swap="innerHTML">
                <div class="loading">Cargando catálogos...</div>
            </div>
        </div>
        
        <script>
            // Listener HTMX para manejar respuestas
            document.body.addEventListener('htmx:afterSwap', function(evt) {
                if (evt.detail.target.id === 'wizard-content') {
                    renderCatalogCards(evt.detail.xhr.response);
                }
            });
            
            function renderCatalogCards(data) {
                const templates = JSON.parse(data);
                const html = templates.map(t => `
                    <div class="catalog-card" 
                         hx-post="/api/v1/catalogs/load/${t.id}"
                         hx-swap="outerHTML"
                         hx-confirm="¿Cargar ${t.product_count} productos?">
                        <div class="catalog-icon">${t.icon}</div>
                        <h3>${t.name}</h3>
                        <p>${t.description}</p>
                        <button class="btn-select">Seleccionar</button>
                    </div>
                `).join('');
                
                document.getElementById('wizard-content').innerHTML = `
                    <div class="catalog-grid">${html}</div>
                `;
            }
        </script>
    </body>
    </html>
    """
    
    return HTMLResponse(content=html)