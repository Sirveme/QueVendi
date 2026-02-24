"""
Endpoints de Onboarding - Wizard de configuración inicial
app/api/v1/onboarding.py
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.store import Store
from app.models.user import User
from app.services.catalog_service import catalog_service


router = APIRouter(prefix="/onboarding", tags=["onboarding"])


# ============================================
# SCHEMAS
# ============================================

class CompleteOnboardingRequest(BaseModel):
    """Datos para completar el onboarding"""
    commercial_name: str = Field(..., min_length=3, max_length=50)
    business_type: str
    department: str
    province: Optional[str] = None
    district: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    selected_products: List[str] = []


class ImportCatalogRequest(BaseModel):
    """Importar productos de un catálogo base"""
    nicho: str
    selected_products: List[str] = []
    import_all: bool = False


# ============================================
# ENDPOINTS
# ============================================

@router.get("/status")
async def get_onboarding_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Verifica el estado del onboarding de la tienda
    """
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tienda no encontrada"
        )
    
    # Obtener info de productos importados
    imported_info = catalog_service.get_imported_catalog_info(db, store.id)
    
    return {
        "onboarding_completed": store.onboarding_completed,
        "business_type": store.business_type,
        "commercial_name": store.commercial_name,
        "products_count": imported_info["total"],
        "categories": imported_info["categories"]
    }


@router.get("/catalogs")
async def get_available_catalogs():
    """
    Lista todos los catálogos base disponibles
    """
    catalogs = catalog_service.get_available_catalogs()
    return {"catalogs": catalogs}


@router.get("/catalogs/{nicho}")
async def get_catalog_products(nicho: str):
    """
    Obtiene los productos de un catálogo específico
    """
    catalog = catalog_service.load_catalog(nicho)
    
    if not catalog:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Catálogo '{nicho}' no encontrado"
        )
    
    return catalog


@router.get("/catalogs/{nicho}/categories")
async def get_catalog_categories(nicho: str):
    """
    Obtiene solo las categorías de un catálogo
    """
    categories = catalog_service.get_categories_for_nicho(nicho)
    
    if not categories:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Catálogo '{nicho}' no encontrado"
        )
    
    return {"categories": categories}


@router.post("/complete")
async def complete_onboarding(
    data: CompleteOnboardingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Completa el proceso de onboarding:
    1. Actualiza datos de la tienda
    2. Importa productos seleccionados (evitando duplicados)
    3. Marca onboarding como completado
    """
    
    # Obtener tienda del usuario
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tienda no encontrada"
        )
    
    # ==========================================
    # 1. ACTUALIZAR DATOS DE LA TIENDA
    # ==========================================
    
    store.commercial_name = data.commercial_name
    store.business_type = data.business_type
    store.department = data.department
    store.province = data.province
    store.district = data.district
    store.address = data.address
    
    if data.phone:
        store.phone = data.phone
        store.whatsapp = data.phone
    
    store.onboarding_completed = True
    store.updated_at = datetime.now(timezone.utc)
    
    # ==========================================
    # 2. IMPORTAR PRODUCTOS (usando catalog_service)
    # ==========================================
    
    import_stats = {"imported": 0, "skipped": 0, "errors": 0}
    
    if data.selected_products:
        import_stats = catalog_service.import_products_to_store(
            db=db,
            store_id=store.id,
            nicho=data.business_type,
            selected_products=data.selected_products
        )
    
    # ==========================================
    # 3. GUARDAR CAMBIOS
    # ==========================================
    
    try:
        db.commit()
        db.refresh(store)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al guardar: {str(e)}"
        )
    
    return {
        "message": "Onboarding completado",
        "store": {
            "id": store.id,
            "commercial_name": store.commercial_name,
            "business_type": store.business_type,
            "department": store.department,
            "onboarding_completed": store.onboarding_completed
        },
        "products": {
            "imported": import_stats["imported"],
            "skipped": import_stats["skipped"],
            "errors": import_stats["errors"]
        }
    }


@router.post("/import-catalog")
async def import_catalog_products(
    data: ImportCatalogRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Importar productos de un catálogo adicional.
    Útil para negocios mixtos (bodega + farmacia, etc.)
    Evita duplicados automáticamente.
    """
    
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tienda no encontrada"
        )
    
    # Importar productos
    import_stats = catalog_service.import_products_to_store(
        db=db,
        store_id=store.id,
        nicho=data.nicho,
        selected_products=data.selected_products if not data.import_all else None,
        import_all=data.import_all
    )
    
    return {
        "message": f"Catálogo '{data.nicho}' importado",
        "imported": import_stats["imported"],
        "skipped": import_stats["skipped"],
        "errors": import_stats["errors"],
        "note": f"{import_stats['skipped']} productos omitidos porque ya existían"
    }


@router.post("/reset")
async def reset_onboarding(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Resetear onboarding (solo owners).
    CUIDADO: Borra todos los productos.
    """
    from app.models.product import Product
    
    if current_user.role not in ["owner", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo owners/admins pueden resetear"
        )
    
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tienda no encontrada"
        )
    
    # Resetear flag
    store.onboarding_completed = False
    
    # Borrar todos los productos
    deleted_count = db.query(Product).filter(
        Product.store_id == store.id
    ).delete()
    
    db.commit()
    
    return {
        "message": "Onboarding reseteado",
        "products_deleted": deleted_count
    }