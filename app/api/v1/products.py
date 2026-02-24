"""
Router de Productos - QueVendi.pro / Metraes.com / Sirveme1.com
FUSIONADO: Endpoints existentes (POS/ventas) + Fase 2 (CRUD V2, catálogos, stats)

Prefix: /products (incluido en main.py con prefix="/api")

ENDPOINTS EXISTENTES (no tocar firmas - POS los usa):
  POST   /search              → Búsqueda POS (nombre)
  GET    /{id}                 → Detalle producto
  GET    /json                 → Lista JSON para wizard/sync
  GET    ""                    → Lista HTML (HTMX)
  POST   ""                    → Crear producto
  DELETE /{id}                 → Soft delete
  POST   /{id}/restore         → Restaurar
  POST   /load-sample-products → Carga prueba (temporal)
  POST   /deactivate-all       → Desactivar todos
  POST   /reset-catalog        → Reset para re-onboarding
  GET    /low-stock             → Stock bajo

ENDPOINTS NUEVOS (Fase 2):
  GET    /v2/list              → Lista con filtros + paginación (JSON)
  GET    /v2/search            → Búsqueda V2 nombre+aliases (POS+voz)
  GET    /v2/stats             → Estadísticas inventario
  GET    /v2/categories        → Categorías con conteo
  PUT    /v2/{id}              → Editar producto completo
  PUT    /v2/{id}/stock        → Ajustar stock
  PUT    /v2/{id}/price        → Cambio rápido precio
  PUT    /v2/{id}/toggle       → Activar/desactivar
  GET    /v2/catalogs/available  → Catálogos disponibles
  GET    /v2/catalogs/status     → Estado importación
  GET    /v2/catalogs/{nicho}/preview → Preview catálogo
  POST   /v2/import              → Importar catálogo V2
  DELETE /v2/catalog/{nicho}     → Eliminar catálogo
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, any_, desc
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.product import Product
from app.models.store import Store
from app.services.product_service import ProductService
from app.services.catalog_service import CatalogService


router = APIRouter(prefix="/products")


# ══════════════════════════════════════════════
# HELPERS DE AUTH
# ══════════════════════════════════════════════

def require_owner(current_user: User = Depends(get_current_user)):
    """Solo owners pueden gestionar configuración"""
    if current_user.role != "owner":
        raise HTTPException(403, detail="Solo los dueños pueden realizar esta acción")
    return current_user


# ══════════════════════════════════════════════
# SCHEMAS
# ══════════════════════════════════════════════

class ProductCreate(BaseModel):
    name: str
    category: str | None = None
    unit: str = "unidad"
    sale_price: float
    cost_price: float = 0.0
    stock: int = 0
    min_stock_alert: int = 0
    aliases: str | None = None
    is_active: bool = True


class ProductSearch(BaseModel):
    query: str
    limit: int = 20


# --- Schemas V2 ---

class ProductCreateV2(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: Optional[str] = None
    unit: str = "UND"
    brand: Optional[str] = None
    barcode: Optional[str] = None
    sku: Optional[str] = None
    image_url: Optional[str] = None
    description: Optional[str] = None
    cost_price: float = 0
    sale_price: float = Field(..., gt=0)
    stock: int = 0
    min_stock_alert: int = 5
    aliases: List[str] = []
    tags: List[str] = []
    mayoreo_cantidad_min: Optional[int] = None
    mayoreo_precio: Optional[float] = None
    mayoreo_nota: Optional[str] = None


class ProductUpdateV2(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    brand: Optional[str] = None
    barcode: Optional[str] = None
    sku: Optional[str] = None
    image_url: Optional[str] = None
    description: Optional[str] = None
    cost_price: Optional[float] = None
    sale_price: Optional[float] = None
    stock: Optional[int] = None
    min_stock_alert: Optional[int] = None
    aliases: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    complementarios: Optional[List[int]] = None
    sustitutos: Optional[List[int]] = None
    mayoreo_cantidad_min: Optional[int] = None
    mayoreo_precio: Optional[float] = None
    mayoreo_nota: Optional[str] = None
    is_active: Optional[bool] = None


class StockAdjust(BaseModel):
    quantity: int = Field(..., description="Positivo=entrada, negativo=salida")
    reason: str = Field(..., min_length=1, max_length=200)


class PriceUpdate(BaseModel):
    sale_price: float = Field(..., gt=0)
    cost_price: Optional[float] = None


class CatalogImport(BaseModel):
    nicho: str
    import_all: bool = True
    selected_products: Optional[List[str]] = None


# ══════════════════════════════════════════════════════════════
#
#  SECCIÓN 1: ENDPOINTS EXISTENTES (preservados tal cual)
#  El POS y el sistema de ventas los usan activamente.
#
# ══════════════════════════════════════════════════════════════

@router.post("/load-sample-products")
async def load_sample_products(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Carga productos de prueba. ENDPOINT TEMPORAL."""
    store_id = current_user.store_id

    existing = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_active == True
    ).count()

    if existing > 0:
        return {"message": f"Ya hay {existing} productos cargados", "loaded": 0}

    sample_products = [
        {"name": "Coca Cola 500ml", "category": "Bebidas", "sale_price": 3.50, "stock": 50, "aliases": ["coca", "cola", "gaseosa"]},
        {"name": "Coca Cola 1L", "category": "Bebidas", "sale_price": 5.50, "stock": 30, "aliases": ["coca grande"]},
        {"name": "Inca Kola 500ml", "category": "Bebidas", "sale_price": 3.50, "stock": 50, "aliases": ["inca", "inka", "kola"]},
        {"name": "Agua San Luis 625ml", "category": "Bebidas", "sale_price": 2.00, "stock": 100, "aliases": ["agua", "san luis"]},
        {"name": "Gatorade 500ml", "category": "Bebidas", "sale_price": 4.50, "stock": 30, "aliases": ["gatorade"]},
        {"name": "Cerveza Pilsen 620ml", "category": "Bebidas", "sale_price": 6.00, "stock": 48, "aliases": ["pilsen", "cerveza", "birra"]},
        {"name": "Arroz Costeño 1kg", "category": "Abarrotes", "sale_price": 5.50, "stock": 50, "aliases": ["arroz", "costeño"]},
        {"name": "Azúcar Rubia 1kg", "category": "Abarrotes", "sale_price": 4.50, "stock": 50, "aliases": ["azucar", "azúcar"]},
        {"name": "Aceite Primor 1L", "category": "Abarrotes", "sale_price": 12.00, "stock": 30, "aliases": ["aceite", "primor"]},
        {"name": "Fideos Don Vittorio 500g", "category": "Abarrotes", "sale_price": 3.50, "stock": 50, "aliases": ["fideos", "tallarines", "spaguetti"]},
        {"name": "Sal Marina 1kg", "category": "Abarrotes", "sale_price": 2.50, "stock": 40, "aliases": ["sal"]},
        {"name": "Leche Gloria 400ml", "category": "Abarrotes", "sale_price": 4.50, "stock": 48, "aliases": ["leche", "gloria", "tarro"]},
        {"name": "Atún Florida 170g", "category": "Abarrotes", "sale_price": 6.50, "stock": 30, "aliases": ["atun", "atún", "florida"]},
        {"name": "Pan Francés", "category": "Panadería", "sale_price": 0.20, "stock": 200, "aliases": ["pan", "frances"]},
        {"name": "Galletas Soda Field", "category": "Galletas", "sale_price": 2.50, "stock": 30, "aliases": ["galleta", "soda", "field"]},
        {"name": "Galletas Oreo", "category": "Galletas", "sale_price": 3.50, "stock": 30, "aliases": ["galleta", "oreo"]},
        {"name": "Galletas Casino", "category": "Galletas", "sale_price": 1.50, "stock": 50, "aliases": ["galleta", "casino"]},
        {"name": "Papitas Lays 42g", "category": "Snacks", "sale_price": 2.50, "stock": 50, "aliases": ["papitas", "lays", "papa"]},
        {"name": "Doritos 40g", "category": "Snacks", "sale_price": 2.50, "stock": 40, "aliases": ["doritos"]},
        {"name": "Sublime 30g", "category": "Snacks", "sale_price": 2.00, "stock": 40, "aliases": ["sublime", "chocolate"]},
        {"name": "Yogurt Gloria 1L", "category": "Lácteos", "sale_price": 8.50, "stock": 20, "aliases": ["yogurt", "gloria"]},
        {"name": "Queso Fresco 250g", "category": "Lácteos", "sale_price": 8.00, "stock": 15, "aliases": ["queso", "fresco"]},
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
    return {"success": True, "message": f"✅ {loaded} productos cargados", "loaded": loaded}


@router.get("/json")
async def get_products_json(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lista de productos JSON (para wizard, sync, etc)"""
    product_service = ProductService(db)
    products = product_service.get_products_by_store(current_user.store_id)

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


@router.get("/low-stock")
async def get_low_stock(
    threshold: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Productos con stock bajo"""
    products = db.query(Product).filter(
        Product.store_id == current_user.store_id,
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


@router.post("/search")
async def search_products(
    search: ProductSearch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Buscar productos por nombre (endpoint existente que usa el POS).
    MEJORADO: ahora también busca en aliases.
    """
    try:
        query_text = search.query.lower().strip()
        query_text = query_text.rstrip('.,;:!?¡¿')

        if len(query_text) < 2:
            return []

        # Búsqueda en nombre + aliases (MEJORA V2)
        if len(query_text) <= 3:
            # Palabras cortas: match exacto de palabras
            products = db.query(Product).filter(
                Product.store_id == current_user.store_id,
                Product.is_active == True,
                Product.deleted_at.is_(None),
                or_(
                    Product.name.ilike(f"{query_text} %"),
                    Product.name.ilike(f"% {query_text} %"),
                    Product.name.ilike(f"% {query_text}"),
                    func.lower(Product.name) == query_text,
                    # V2: buscar en aliases
                    query_text == any_(func.lower(func.unnest(Product.aliases)))
                )
            ).limit(search.limit).all()
        else:
            # Palabras largas: contiene
            products = db.query(Product).filter(
                Product.store_id == current_user.store_id,
                Product.is_active == True,
                Product.deleted_at.is_(None),
                or_(
                    Product.name.ilike(f"%{query_text}%"),
                    # V2: buscar en aliases con LIKE
                    Product.aliases.any(query_text)
                )
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
        raise HTTPException(500, detail=str(e))


@router.post("/deactivate-all")
async def deactivate_all_products(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Desactivar todos los productos (solo owners)"""
    if current_user.role != "owner":
        raise HTTPException(403, detail="Solo los dueños pueden realizar esta acción")

    updated = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True
    ).update({"is_active": False, "deleted_at": datetime.now(timezone.utc)})

    db.commit()
    return {"success": True, "message": f"{updated} productos desactivados"}


@router.post("/reset-catalog")
async def reset_catalog(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db)
):
    """Desactiva TODOS los productos para re-onboarding"""
    db.query(Product).filter(
        Product.store_id == current_user.store_id
    ).update({"is_active": False, "deleted_at": datetime.now(timezone.utc)})

    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    if store:
        store.onboarding_completed = False

    db.commit()
    return {"success": True, "message": "Catálogo restablecido. Puedes elegir uno nuevo."}


@router.get("", response_class=HTMLResponse)
async def get_products_html(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lista de productos HTML (HTMX)"""
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


@router.post("")
async def create_product(
    product_data: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Crear nuevo producto (endpoint existente)"""
    existing = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.name == product_data.name,
        Product.is_active == True
    ).first()

    if existing:
        raise HTTPException(400, detail="Ya existe un producto con ese nombre")

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
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id
    ).first()

    if not product:
        raise HTTPException(404, detail="Producto no encontrado")

    product.is_active = False
    product.deleted_at = datetime.now(timezone.utc)
    db.commit()

    return {"success": True, "message": "Producto eliminado correctamente"}


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
        raise HTTPException(404, detail="Producto no encontrado")

    product.is_active = True
    product.deleted_at = None
    db.commit()

    return {"success": True, "message": "Producto restaurado correctamente"}


@router.get("/{product_id}")
async def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener un producto por ID (endpoint existente que usa el POS)"""
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


# ══════════════════════════════════════════════════════════════
#
#  SECCIÓN 2: ENDPOINTS V2 (Fase 2 - Nuevos)
#  Prefijo /v2/ para no colisionar con endpoints existentes.
#  Cuando el frontend V2 esté listo, se pueden promover.
#
# ══════════════════════════════════════════════════════════════

# ─── LISTA Y BÚSQUEDA V2 ───

@router.get("/v2/list")
async def list_products_v2(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    category: Optional[str] = None,
    stock_status: Optional[str] = Query(None, pattern="^(normal|low|out)$"),
    is_active: Optional[bool] = None,
    catalog_origin: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = Query("name", pattern="^(name|sale_price|stock|category|created_at)$"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lista productos V2 con filtros, paginación y ordenamiento."""
    query = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.deleted_at.is_(None)
    )

    # Filtros
    if category:
        query = query.filter(Product.category == category)

    if is_active is not None:
        query = query.filter(Product.is_active == is_active)

    if catalog_origin:
        if catalog_origin == "manual":
            query = query.filter(Product.catalog_origin.is_(None))
        else:
            query = query.filter(Product.catalog_origin == catalog_origin)

    if stock_status == "low":
        query = query.filter(Product.stock > 0, Product.stock <= Product.min_stock_alert)
    elif stock_status == "out":
        query = query.filter(Product.stock <= 0)
    elif stock_status == "normal":
        query = query.filter(Product.stock > Product.min_stock_alert)

    if search:
        s = search.strip().lower()
        query = query.filter(
            or_(
                func.lower(Product.name).contains(s),
                Product.aliases.any(s)
            )
        )

    total = query.count()

    sort_column = getattr(Product, sort_by, Product.name)
    if sort_dir == "desc":
        query = query.order_by(desc(sort_column))
    else:
        query = query.order_by(sort_column)

    offset = (page - 1) * per_page
    products = query.offset(offset).limit(per_page).all()

    return {
        "products": [p.to_dict() for p in products],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page
        }
    }


@router.get("/v2/search")
async def search_products_v2(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50),
    category: Optional[str] = None,
    in_stock: bool = False,
    for_pos: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Búsqueda V2 por nombre + aliases (para POS mejorado y voz).
    Si for_pos=true retorna formato ligero.
    """
    results = CatalogService.search_products(
        db, current_user.store_id, q,
        limit=limit, category=category, only_in_stock=in_stock
    )

    if for_pos:
        return {"products": [p.to_pos_dict() for p in results]}
    return {"products": [p.to_dict() for p in results]}


@router.get("/v2/low-stock")
async def get_low_stock_v2(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Productos bajo stock mínimo (V2 con más detalle)"""
    products = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True,
        Product.deleted_at.is_(None),
        Product.stock <= Product.min_stock_alert
    ).order_by(Product.stock).all()

    return {
        "products": [p.to_dict() for p in products],
        "total": len(products),
        "out_of_stock": sum(1 for p in products if p.stock <= 0)
    }


@router.get("/v2/stats")
async def get_product_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Estadísticas generales del inventario"""
    base = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.deleted_at.is_(None)
    )

    total = base.count()
    active = base.filter(Product.is_active == True).count()

    low_stock = base.filter(
        Product.is_active == True,
        Product.stock > 0,
        Product.stock <= Product.min_stock_alert
    ).count()

    out_of_stock = base.filter(
        Product.is_active == True,
        Product.stock <= 0
    ).count()

    inventory_value = base.filter(
        Product.is_active == True, Product.stock > 0
    ).with_entities(
        func.sum(Product.stock * Product.sale_price)
    ).scalar() or 0

    inventory_cost = base.filter(
        Product.is_active == True, Product.stock > 0, Product.cost_price > 0
    ).with_entities(
        func.sum(Product.stock * Product.cost_price)
    ).scalar() or 0

    categories = base.filter(Product.is_active == True).with_entities(
        Product.category, func.count(Product.id)
    ).group_by(Product.category).order_by(desc(func.count(Product.id))).all()

    return {
        "total": total,
        "active": active,
        "inactive": total - active,
        "low_stock": low_stock,
        "out_of_stock": out_of_stock,
        "inventory_value": round(float(inventory_value), 2),
        "inventory_cost": round(float(inventory_cost), 2),
        "estimated_profit": round(float(inventory_value - inventory_cost), 2),
        "categories": [
            {"name": cat or "Sin categoría", "count": count}
            for cat, count in categories
        ]
    }


@router.get("/v2/categories")
async def get_categories_v2(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lista de categorías con conteo"""
    categories = db.query(
        Product.category, func.count(Product.id)
    ).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True,
        Product.deleted_at.is_(None)
    ).group_by(Product.category).order_by(Product.category).all()

    return {
        "categories": [
            {"name": cat or "Sin categoría", "count": count}
            for cat, count in categories
        ]
    }


# ─── CRUD V2 ───

@router.post("/v2/create", status_code=201)
async def create_product_v2(
    data: ProductCreateV2,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Crear producto V2 (con todos los campos enriquecidos)"""
    exists = db.query(Product.id).filter(
        Product.store_id == current_user.store_id,
        func.lower(Product.name) == data.name.lower(),
        Product.deleted_at.is_(None)
    ).first()

    if exists:
        raise HTTPException(400, f"Ya existe un producto con el nombre '{data.name}'")

    product = Product(
        store_id=current_user.store_id,
        name=data.name,
        category=data.category,
        unit=data.unit,
        brand=data.brand,
        barcode=data.barcode,
        sku=data.sku,
        image_url=data.image_url,
        description=data.description,
        cost_price=data.cost_price,
        sale_price=data.sale_price,
        stock=data.stock,
        min_stock_alert=data.min_stock_alert,
        aliases=data.aliases,
        tags=data.tags,
        mayoreo_cantidad_min=data.mayoreo_cantidad_min,
        mayoreo_precio=data.mayoreo_precio,
        mayoreo_nota=data.mayoreo_nota,
        catalog_origin=None,
        is_active=True,
        created_at=datetime.now(timezone.utc)
    )

    db.add(product)
    db.commit()
    db.refresh(product)

    return {"product": product.to_dict(), "message": "Producto creado"}


@router.get("/v2/{product_id}")
async def get_product_v2(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Detalle V2 con relaciones resueltas"""
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id,
        Product.deleted_at.is_(None)
    ).first()

    if not product:
        raise HTTPException(404, "Producto no encontrado")

    result = product.to_dict()

    # Resolver complementarios
    if product.complementarios:
        comps = db.query(Product.id, Product.name, Product.sale_price, Product.image_url).filter(
            Product.id.in_(product.complementarios),
            Product.deleted_at.is_(None)
        ).all()
        result["complementarios_detail"] = [
            {"id": c.id, "name": c.name, "price": c.sale_price, "image": c.image_url}
            for c in comps
        ]

    # Resolver sustitutos
    if product.sustitutos:
        susts = db.query(Product.id, Product.name, Product.sale_price, Product.stock, Product.image_url).filter(
            Product.id.in_(product.sustitutos),
            Product.deleted_at.is_(None)
        ).all()
        result["sustitutos_detail"] = [
            {"id": s.id, "name": s.name, "price": s.sale_price, "stock": s.stock, "image": s.image_url}
            for s in susts
        ]

    return {"product": result}


@router.put("/v2/{product_id}")
async def update_product_v2(
    product_id: int,
    data: ProductUpdateV2,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Editar producto V2 (solo campos enviados)"""
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id,
        Product.deleted_at.is_(None)
    ).first()

    if not product:
        raise HTTPException(404, "Producto no encontrado")

    if data.name and data.name.lower() != product.name.lower():
        exists = db.query(Product.id).filter(
            Product.store_id == current_user.store_id,
            func.lower(Product.name) == data.name.lower(),
            Product.id != product_id,
            Product.deleted_at.is_(None)
        ).first()
        if exists:
            raise HTTPException(400, f"Ya existe un producto con el nombre '{data.name}'")

    update_data = data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(product, field, value)

    product.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(product)

    return {"product": product.to_dict(), "message": "Producto actualizado"}


# ─── ACCIONES RÁPIDAS V2 ───

@router.put("/v2/{product_id}/stock")
async def adjust_stock_v2(
    product_id: int,
    data: StockAdjust,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Ajustar stock (+entrada, -salida)"""
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id,
        Product.deleted_at.is_(None)
    ).first()

    if not product:
        raise HTTPException(404, "Producto no encontrado")

    old_stock = product.stock
    new_stock = old_stock + data.quantity

    if new_stock < 0:
        raise HTTPException(400, f"Stock insuficiente. Actual: {old_stock}")

    product.stock = new_stock
    product.updated_at = datetime.now(timezone.utc)

    # TODO: Registrar en inventory_movements
    # TODO: Evento comunicación si stock < min_stock_alert

    db.commit()

    was_normal = old_stock > product.min_stock_alert
    is_now_low = new_stock <= product.min_stock_alert

    return {
        "product_id": product_id,
        "name": product.name,
        "stock_before": old_stock,
        "stock_after": new_stock,
        "adjustment": data.quantity,
        "reason": data.reason,
        "alert": "stock_bajo" if was_normal and is_now_low else None,
        "message": f"Stock: {old_stock} → {new_stock}"
    }


@router.put("/v2/{product_id}/price")
async def update_price_v2(
    product_id: int,
    data: PriceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Cambio rápido de precio"""
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id,
        Product.deleted_at.is_(None)
    ).first()

    if not product:
        raise HTTPException(404, "Producto no encontrado")

    old_price = product.sale_price
    product.sale_price = data.sale_price
    if data.cost_price is not None:
        product.cost_price = data.cost_price

    product.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "product_id": product_id,
        "name": product.name,
        "price_before": old_price,
        "price_after": data.sale_price,
        "message": f"Precio: S/ {old_price:.2f} → S/ {data.sale_price:.2f}"
    }


@router.put("/v2/{product_id}/toggle")
async def toggle_product_v2(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Activar/desactivar producto"""
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id,
        Product.deleted_at.is_(None)
    ).first()

    if not product:
        raise HTTPException(404, "Producto no encontrado")

    product.is_active = not product.is_active
    product.updated_at = datetime.now(timezone.utc)
    db.commit()

    status = "activado" if product.is_active else "desactivado"
    return {
        "product_id": product_id,
        "name": product.name,
        "is_active": product.is_active,
        "message": f"Producto {status}"
    }


# ─── CATÁLOGOS V2 ───

@router.get("/v2/catalogs/available")
async def get_available_catalogs():
    """Catálogos JSON disponibles para importar"""
    catalogs = CatalogService.get_available_catalogs()
    return {"catalogs": catalogs}


@router.get("/v2/catalogs/status")
async def get_catalog_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Estado de catálogos importados en la tienda"""
    info = CatalogService.get_imported_catalog_info(db, current_user.store_id)
    available = CatalogService.get_available_catalogs()

    imported_nichos = {c["nicho"] for c in info["catalogs"]}
    for cat in available:
        cat["imported"] = cat["nicho"] in imported_nichos
        imported = next((c for c in info["catalogs"] if c["nicho"] == cat["nicho"]), None)
        cat["imported_count"] = imported["count"] if imported else 0

    return {"available": available, "imported_info": info}


@router.get("/v2/catalogs/{nicho}/preview")
async def preview_catalog(nicho: str):
    """Preview de un catálogo antes de importar"""
    categories = CatalogService.get_categories_for_nicho(nicho)
    if not categories:
        raise HTTPException(404, f"Catálogo '{nicho}' no encontrado")

    products = CatalogService.get_catalog_products(nicho)
    combos = CatalogService.get_combos_for_nicho(nicho)

    return {
        "nicho": nicho,
        "categories": categories,
        "total_products": len(products),
        "sample_products": products[:10],
        "combos": combos
    }


@router.post("/v2/import")
async def import_catalog_v2(
    data: CatalogImport,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_owner)
):
    """Importar productos de un catálogo V2 a la tienda"""
    stats = CatalogService.import_products_to_store(
        db=db,
        store_id=current_user.store_id,
        nicho=data.nicho,
        selected_products=data.selected_products,
        import_all=data.import_all
    )

    if stats["imported"] == 0 and stats["errors"] == 0:
        if stats["skipped"] > 0:
            return {"stats": stats, "message": f"Todos los productos ya existen ({stats['skipped']} omitidos)"}
        raise HTTPException(400, f"No se encontraron productos en el catálogo '{data.nicho}'")

    return {"stats": stats, "message": f"Importados {stats['imported']} productos del catálogo '{data.nicho}'"}


@router.delete("/v2/catalog/{nicho}")
async def remove_catalog_v2(
    nicho: str,
    hard_delete: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_owner)
):
    """Eliminar todos los productos de un catálogo"""
    stats = CatalogService.remove_catalog_from_store(
        db=db,
        store_id=current_user.store_id,
        nicho=nicho,
        hard_delete=hard_delete
    )

    if stats["deleted"] == 0:
        raise HTTPException(404, f"No se encontraron productos del catálogo '{nicho}'")

    return {"stats": stats, "message": f"Eliminados {stats['deleted']} productos del catálogo '{nicho}'"}