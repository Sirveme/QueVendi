# En app/api/v1/products.py (o crear si no existe)
# AGREGAR este endpoint

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.services.product_service import ProductService
from pydantic import BaseModel

#router = APIRouter(prefix="/products", tags=["products"])
router = APIRouter()

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
        Product.name == product_data.name
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