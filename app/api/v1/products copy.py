"""
Endpoints de productos para QueVendí
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.product import ProductResponse, ProductCreate
from app.services.product_service import ProductService
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.product import Product
from typing import List

router = APIRouter(prefix="/products", tags=["products"])
templates = Jinja2Templates(directory="app/templates")


@router.get("/", response_model=List[ProductResponse])
async def get_products(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener todos los productos de la tienda"""
    product_service = ProductService(db)
    products = product_service.get_products_by_store(current_user.store_id)
    return products


@router.get("/search", response_model=List[ProductResponse])
async def search_products(
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Buscar productos por nombre"""
    product_service = ProductService(db)
    products = product_service.search_products(current_user.store_id, q)
    return products


@router.get("/manage", response_class=HTMLResponse)
async def manage_products_page(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Página de gestión de productos"""
    products = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True
    ).order_by(Product.name).all()
    
    return templates.TemplateResponse(
        "products.html",
        {
            "request": request,
            "user": current_user,
            "store": current_user.store,
            "products": products
        }
    )


@router.post("/add")
async def add_product(
    name: str = Form(...),
    category: str = Form(...),
    sale_price: float = Form(...),
    cost_price: float = Form(0),
    stock: int = Form(0),
    aliases: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Agregar nuevo producto"""
    
    # Verificar si ya existe
    existing = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.name.ilike(name.strip())
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Ya existe un producto con el nombre '{name}'"
        )
    
    # Procesar aliases
    aliases_list = []
    if aliases.strip():
        aliases_list = [a.strip() for a in aliases.split(',') if a.strip()]
    
    # Crear producto
    product = Product(
        store_id=current_user.store_id,
        name=name.strip(),
        category=category.strip() if category else None,
        sale_price=sale_price,
        cost_price=cost_price,
        stock=stock,
        aliases=aliases_list,
        is_active=True
    )
    
    db.add(product)
    db.commit()
    db.refresh(product)
    
    return {
        "success": True,
        "message": f"Producto '{product.name}' agregado exitosamente",
        "product": {
            "id": product.id,
            "name": product.name,
            "price": product.sale_price,
            "stock": product.stock
        }
    }


@router.post("/{product_id}/update-stock")
async def update_stock(
    product_id: int,
    stock: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Actualizar stock de un producto"""
    
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id
    ).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    product.stock = stock
    db.commit()
    
    return {
        "success": True,
        "message": f"Stock de '{product.name}' actualizado a {stock}"
    }


@router.post("/{product_id}/update-price")
async def update_price(
    product_id: int,
    sale_price: float = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Actualizar precio de un producto"""
    
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id
    ).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    product.sale_price = sale_price
    db.commit()
    
    return {
        "success": True,
        "message": f"Precio de '{product.name}' actualizado a S/ {sale_price:.2f}"
    }


@router.post("/{product_id}/delete")
async def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Eliminar (desactivar) un producto"""
    
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == current_user.store_id
    ).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    product.is_active = False
    db.commit()
    
    return {
        "success": True,
        "message": f"Producto '{product.name}' eliminado"
    }