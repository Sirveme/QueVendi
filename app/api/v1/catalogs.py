# app/api/v1/catalogs.py (NUEVO ARCHIVO)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.product import Product
from app.models.user import User
from app.api.dependencies import get_current_user

router = APIRouter(prefix="/api/v1/catalogs", tags=["Catalogs"])

@router.get("/available")
async def get_available_catalogs():
    """
    Lista catálogos disponibles para copiar
    """
    return {
        "catalogs": [
            {
                "code": "bodega_estandar",
                "name": "Bodega Estándar",
                "description": "Productos básicos: bebidas, abarrotes, snacks, limpieza",
                "icon": "🏪",
                "estimated_products": 200
            },
            {
                "code": "bodega_frutas_verduras",
                "name": "Bodega + Frutas/Verduras",
                "description": "Bodega con sección de productos frescos",
                "icon": "🍎",
                "estimated_products": 200
            },
            {
                "code": "minimarket",
                "name": "Minimarket",
                "description": "Variedad amplia de productos",
                "icon": "🛒",
                "estimated_products": 250
            },
            {
                "code": "bazar_perfumeria",
                "name": "Bazar y Perfumería",
                "description": "Artículos de bazar, cosméticos y útiles",
                "icon": "💄",
                "estimated_products": 200
            }
        ]
    }


@router.post("/copy/{catalog_code}")
async def copy_catalog_to_store(
    catalog_code: str,
    initial_stock: int = 200,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Copia un catálogo maestro a la tienda del usuario actual
    
    - **catalog_code**: Código del catálogo a copiar
    - **initial_stock**: Stock inicial para todos los productos (default: 200)
    """
    try:
        # Obtener productos maestros del catálogo
        master_products = db.query(Product).filter(
            Product.store_id == 0,
            Product.catalog_code == catalog_code
        ).all()
        
        if not master_products:
            raise HTTPException(
                status_code=404, 
                detail=f"Catálogo '{catalog_code}' no encontrado"
            )
        
        # Copiar productos a la tienda del usuario
        inserted = 0
        skipped = 0
        
        for master in master_products:
            # Verificar si ya existe
            existing = db.query(Product).filter(
                Product.store_id == current_user.store_id,
                Product.name == master.name,
                Product.category == master.category
            ).first()
            
            if existing:
                skipped += 1
                continue
            
            # Crear copia
            new_product = Product(
                store_id=current_user.store_id,
                name=master.name,
                aliases=master.aliases.copy() if master.aliases else [],
                category=master.category,
                unit=master.unit,
                brand=master.brand,
                barcode=master.barcode,
                sale_price=master.sale_price,
                cost_price=master.cost_price,
                stock=initial_stock,
                min_stock_alert=5,
                is_active=True,
                is_featured=False
            )
            
            db.add(new_product)
            inserted += 1
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Catálogo '{catalog_code}' copiado exitosamente",
            "products_added": inserted,
            "products_skipped": skipped,
            "total_processed": len(master_products)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/my-products/stats")
async def get_my_products_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Estadísticas de productos de la tienda actual
    """
    from sqlalchemy import func
    
    # Total productos
    total = db.query(func.count(Product.id)).filter(
        Product.store_id == current_user.store_id
    ).scalar()
    
    # Por categoría
    by_category = db.query(
        Product.category,
        func.count(Product.id).label('count')
    ).filter(
        Product.store_id == current_user.store_id
    ).group_by(Product.category).all()
    
    return {
        "total_products": total,
        "has_products": total > 0,
        "by_category": [
            {"category": cat or "Sin categoría", "count": count} 
            for cat, count in by_category
        ]
    }