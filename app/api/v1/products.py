# En app/api/v1/products.py (o crear si no existe)
# AGREGAR este endpoint

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.product import Product
from app.models.store import Store
from typing import List
from app.services.product_service import ProductService
from pydantic import BaseModel

router = APIRouter(prefix="/products")

# ============================================
# ENDPOINT TEMPORAL: Cargar productos de prueba
# ============================================
@router.post("/load-sample-products")
async def load_sample_products(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Carga productos de prueba para la tienda actual.
    ENDPOINT TEMPORAL - Eliminar en producción.
    """
    store_id = current_user.store_id

    # Verificar si ya hay productos
    existing = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_active == True
    ).count()

    if existing > 0:
        return {"message": f"Ya hay {existing} productos cargados", "loaded": 0}

    # Productos de bodega básicos
    sample_products = [
        # BEBIDAS
        {"name": "Coca Cola 500ml", "category": "Bebidas", "sale_price": 3.50, "stock": 50, "aliases": ["coca", "cola", "gaseosa"]},
        {"name": "Coca Cola 1L", "category": "Bebidas", "sale_price": 5.50, "stock": 30, "aliases": ["coca grande"]},
        {"name": "Inca Kola 500ml", "category": "Bebidas", "sale_price": 3.50, "stock": 50, "aliases": ["inca", "inka", "kola"]},
        {"name": "Agua San Luis 625ml", "category": "Bebidas", "sale_price": 2.00, "stock": 100, "aliases": ["agua", "san luis"]},
        {"name": "Gatorade 500ml", "category": "Bebidas", "sale_price": 4.50, "stock": 30, "aliases": ["gatorade"]},
        {"name": "Cerveza Pilsen 620ml", "category": "Bebidas", "sale_price": 6.00, "stock": 48, "aliases": ["pilsen", "cerveza", "birra"]},

        # ABARROTES
        {"name": "Arroz Costeño 1kg", "category": "Abarrotes", "sale_price": 5.50, "stock": 50, "aliases": ["arroz", "costeño"]},
        {"name": "Azúcar Rubia 1kg", "category": "Abarrotes", "sale_price": 4.50, "stock": 50, "aliases": ["azucar", "azúcar"]},
        {"name": "Aceite Primor 1L", "category": "Abarrotes", "sale_price": 12.00, "stock": 30, "aliases": ["aceite", "primor"]},
        {"name": "Fideos Don Vittorio 500g", "category": "Abarrotes", "sale_price": 3.50, "stock": 50, "aliases": ["fideos", "tallarines", "spaguetti"]},
        {"name": "Sal Marina 1kg", "category": "Abarrotes", "sale_price": 2.50, "stock": 40, "aliases": ["sal"]},
        {"name": "Leche Gloria 400ml", "category": "Abarrotes", "sale_price": 4.50, "stock": 48, "aliases": ["leche", "gloria", "tarro"]},
        {"name": "Atún Florida 170g", "category": "Abarrotes", "sale_price": 6.50, "stock": 30, "aliases": ["atun", "atún", "florida"]},

        # PAN Y GALLETAS
        {"name": "Pan Francés", "category": "Panadería", "sale_price": 0.20, "stock": 200, "aliases": ["pan", "frances"]},
        {"name": "Galletas Soda Field", "category": "Galletas", "sale_price": 2.50, "stock": 30, "aliases": ["galleta", "soda", "field"]},
        {"name": "Galletas Oreo", "category": "Galletas", "sale_price": 3.50, "stock": 30, "aliases": ["galleta", "oreo"]},
        {"name": "Galletas Casino", "category": "Galletas", "sale_price": 1.50, "stock": 50, "aliases": ["galleta", "casino"]},

        # SNACKS
        {"name": "Papitas Lays 42g", "category": "Snacks", "sale_price": 2.50, "stock": 50, "aliases": ["papitas", "lays", "papa"]},
        {"name": "Doritos 40g", "category": "Snacks", "sale_price": 2.50, "stock": 40, "aliases": ["doritos"]},
        {"name": "Sublime 30g", "category": "Snacks", "sale_price": 2.00, "stock": 40, "aliases": ["sublime", "chocolate"]},

        # LÁCTEOS
        {"name": "Yogurt Gloria 1L", "category": "Lácteos", "sale_price": 8.50, "stock": 20, "aliases": ["yogurt", "gloria"]},
        {"name": "Queso Fresco 250g", "category": "Lácteos", "sale_price": 8.00, "stock": 15, "aliases": ["queso", "fresco"]},

        # LIMPIEZA
        {"name": "Detergente Ace 500g", "category": "Limpieza", "sale_price": 5.50, "stock": 30, "aliases": ["detergente", "ace"]},
        {"name": "Lejía Clorox 1L", "category": "Limpieza", "sale_price": 6.00, "stock": 25, "aliases": ["lejia", "clorox"]},
        {"name": "Papel Higiénico Elite 4 rollos", "category": "Limpieza", "sale_price": 7.00, "stock": 30, "aliases": ["papel", "higienico", "elite"]},
    ]

    loaded = 0
    for p in sample_products:
        product = Product(
            store_id=store_id,
            name=p["name"],
            category=p["category"],
            sale_price=p["sale_price"],
            cost_price=p["sale_price"] * 0.8,
            stock=p["stock"],
            unit="unidad",
            aliases=p.get("aliases", []),
            is_active=True,
            min_stock_alert=5
        )
        db.add(product)
        loaded += 1

    db.commit()

    return {
        "success": True,
        "message": f"✅ {loaded} productos cargados para tu tienda",
        "loaded": loaded
    }

class ProductResponse(BaseModel):
    id: int
    name: str
    barcode: str | None = None
    category: str | None = None
    sale_price: float
    stock: int
    unit: str = "unidad"
    
    class Config:
        from_attributes = True

def require_owner(current_user: User = Depends(get_current_user)):
    """Solo owners pueden gestionar configuración"""
    if current_user.role != "owner":
        raise HTTPException(
            status_code=403, 
            detail="Solo los dueños pueden realizar esta acción"
        )
    return current_user


@router.get("", response_class=HTMLResponse)
async def get_products_html(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Lista de productos en formato HTML
    """
    product_service = ProductService(db)
    products = product_service.get_products_by_store(current_user.store_id)
    
    if not products:
        return HTMLResponse(content="""
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-title">No hay productos registrados</div>
                <div class="empty-subtitle">Agrega productos para comenzar a vender</div>
            </div>
        """)
    
    html_items = []
    for product in products:
        stock_class = "low" if product.stock < 10 else ""
        stock_text = f"{product.stock} unidades" if product.stock > 0 else "Sin stock"
        
        html_items.append(f"""
            <div class="product-card">
                <div class="product-info">
                    <div class="product-name">{product.name}</div>
                    <div class="product-meta">{product.category or 'Sin categoría'}</div>
                    <div class="product-stock {stock_class}">{stock_text}</div>
                </div>
                <div style="text-align: right;">
                    <div class="product-price">S/. {product.sale_price:.2f}</div>
                </div>
            </div>
        """)
    
    return HTMLResponse(content="".join(html_items))

# Si estás creando el archivo, también agregar esto en main.py:
# from app.api.v1 import products
# app.include_router(products.router, prefix="/api")

@router.get("/json")
async def get_products_json(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Lista de productos en formato JSON (para wizard, sync, etc)
    """
    product_service = ProductService(db)
    products = product_service.get_products_by_store(current_user.store_id)
    
    # Retornar solo campos que SÍ existen en Product
    return [
        {
            "id": p.id,
            "name": p.name,
            "barcode": p.barcode,
            "category": p.category,
            "sale_price": float(p.sale_price),
            "cost_price": float(p.cost_price) if p.cost_price else 0,
            "stock": p.stock,
            "is_active": p.is_active,
            "unit": p.unit if hasattr(p, 'unit') else 'unidad'
        }
        for p in products
    ]

class ProductCreate(BaseModel):
    name: str
    category: str | None = None
    unit: str = "unidad"
    sale_price: float
    cost_price: float = 0.0
    stock: int
    min_stock_alert: int = 0
    aliases: str | None = None
    is_active: bool = True

@router.post("")
async def create_product(
    product_data: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Crear nuevo producto"""
    from app.models.product import Product
    
    # Verificar que no exista producto con el mismo nombre
    existing = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.name == product_data.name,
        Product.is_active == True
    ).first()
    
    if existing:
        raise HTTPException(400, detail="Ya existe un producto con ese nombre")
    
    # Crear producto
    new_product = Product(
        store_id=current_user.store_id,
        name=product_data.name,
        category=product_data.category,
        unit=product_data.unit,
        sale_price=product_data.sale_price,
        cost_price=product_data.cost_price,
        stock=product_data.stock,
        min_stock_alert=product_data.min_stock_alert,
        aliases=product_data.aliases,
        is_active=product_data.is_active
    )
    
    db.add(new_product)
    db.commit()
    db.refresh(new_product)
    
    print(f"[Products] ✅ Producto creado: {new_product.name} (ID: {new_product.id})")
    
    return {
        "id": new_product.id,
        "name": new_product.name,
        "sale_price": new_product.sale_price,
        "stock": new_product.stock
    }


@router.delete("/{product_id}")
async def delete_product(
    product_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db)
):
    """Eliminar producto (soft delete)"""
    from sqlalchemy import func
    
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id
    ).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    # SOFT DELETE - no eliminar físicamente
    product.is_active = False
    product.deleted_at = func.now()
    
    db.commit()
    
    return {
        "success": True,
        "message": "Producto eliminado correctamente"
    }


@router.post("/{product_id}/restore")
async def restore_product(
    product_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db)
):
    """Restaurar producto eliminado"""
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id
    ).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    product.is_active = True
    product.deleted_at = None
    
    db.commit()
    
    return {
        "success": True,
        "message": "Producto restaurado correctamente"
    }


@router.post("/deactivate-all")  # ⬅️ SIN /products
async def deactivate_all_products(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Desactivar todos los productos de la tienda (solo owners)"""
    from sqlalchemy import func
    
    # Verificar que sea owner
    if current_user.role != "owner":
        raise HTTPException(
            status_code=403, 
            detail="Solo los dueños pueden realizar esta acción"
        )
    
    # Contar cuántos se van a desactivar
    updated = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True  # ⬅️ Solo los activos
    ).update({
        "is_active": False,
        "deleted_at": func.now()
    })
    
    db.commit()
    
    return {
        "success": True, 
        "message": f"{updated} productos desactivados"
    }


@router.post("/reset-catalog")
async def reset_catalog(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db)
):
    """
    Desactiva TODOS los productos para poder elegir catálogo de nuevo
    """
    from sqlalchemy import func
    
    # Desactivar todos
    db.query(Product).filter(
        Product.store_id == current_user.store_id
    ).update({
        "is_active": False,
        "deleted_at": func.now()
    })
    
    # Marcar onboarding como NO completado
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    if store:
        store.onboarding_completed = False
    
    db.commit()
    
    return {
        "success": True,
        "message": "Catálogo restablecido. Puedes elegir uno nuevo."
    }


class ProductSearch(BaseModel):
    query: str
    limit: int = 20

@router.post("/search")
async def search_products(
    search: ProductSearch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Buscar productos por nombre con reglas mejoradas"""
    
    try:
        query_text = search.query.lower().strip()
        
        # Limpiar puntuación
        query_text = query_text.rstrip('.,;:!?¡¿')
        
        # Mínimo 3 caracteres
        if len(query_text) < 3:
            return []
        
        # 🔥 REGLAS PARA PALABRAS CORTAS (≤3 chars)
        if len(query_text) <= 3:
            products = db.query(Product).filter(
                Product.store_id == current_user.store_id,
                Product.is_active == True,
                or_(
                    Product.name.ilike(f"{query_text} %"),      # Empieza con
                    Product.name.ilike(f"% {query_text} %"),    # Contiene palabra
                    Product.name.ilike(f"% {query_text}"),      # Termina con
                    func.lower(Product.name) == query_text      # Exacto
                )
            ).limit(search.limit).all()
        else:
            # Búsqueda normal para palabras largas
            products = db.query(Product).filter(
                Product.store_id == current_user.store_id,
                Product.is_active == True,
                Product.name.ilike(f"%{query_text}%")
            ).limit(search.limit).all()
        
        result = [
            {
                "id": p.id,
                "name": p.name,
                "barcode": p.barcode or "",
                "sale_price": float(p.sale_price),
                "stock": p.stock,
                "unit": getattr(p, 'unit', 'unidad')
            }
            for p in products
        ]
        
        print(f"[Search] Query: '{query_text}' → {len(result)} productos")
        return result
        
    except Exception as e:
        print(f"[Search] ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/low-stock")
async def get_low_stock(
    threshold: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)  # ⬅️ User, no dict
):
    """Productos con stock bajo"""
    
    products = db.query(Product).filter(
        Product.store_id == current_user.store_id,  # ⬅️ .store_id directo
        Product.is_active == True,
        Product.stock <= threshold,
        Product.stock > 0
    ).order_by(Product.stock.asc()).all()
    
    return [
        {
            "id": p.id,
            "name": p.name,
            "sale_price": float(p.sale_price),
            "stock": p.stock,
            "unit": p.unit if hasattr(p, 'unit') else 'unidad'
        }
        for p in products
    ]


@router.get("/{product_id}")
async def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener un producto por ID"""
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id,
        Product.is_active == True
    ).first()
    
    if not product:
        raise HTTPException(404, detail="Producto no encontrado")
    
    return {
        "id": product.id,
        "name": product.name,
        "barcode": product.barcode or "",
        "sale_price": float(product.sale_price),
        "cost_price": float(product.cost_price) if product.cost_price else 0,
        "stock": product.stock,
        "unit": getattr(product, 'unit', 'unidad'),
        "category": product.category
    }