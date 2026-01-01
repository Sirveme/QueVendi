"""
Endpoints para gestión de tiendas
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.core.database import get_db
from app.models.store import Store
from app.models.user import User
from app.models.product import Product
from app.core.security import hash_password
from app.api.dependencies import get_current_user

router = APIRouter(prefix="/stores")

class AdminUserCreate(BaseModel):
    full_name: str
    dni: str
    pin: str
    email: str | None = None

class StoreRegister(BaseModel):
    commercial_name: str
    ruc: str
    phone: str | None = None
    address: str | None = None
    admin_user: AdminUserCreate

@router.post("/register")
async def register_store(
    data: StoreRegister,
    db: Session = Depends(get_db)
):
    """
    Registrar nueva tienda con usuario administrador
    
    Este endpoint NO requiere autenticación para permitir registro rápido
    """
    # Validar que no exista tienda con el mismo RUC
    existing_store = db.query(Store).filter(Store.ruc == data.ruc).first()
    if existing_store:
        raise HTTPException(400, detail="Ya existe una tienda con este RUC")
    
    # Validar que no exista usuario con el mismo DNI
    existing_user = db.query(User).filter(User.dni == data.admin_user.dni).first()
    if existing_user:
        raise HTTPException(400, detail="Ya existe un usuario con este DNI")
    
    try:
        # 1. Crear tienda
        new_store = Store(
            commercial_name=data.commercial_name,
            ruc=data.ruc,
            phone=data.phone,
            address=data.address,
            is_active=True
        )
        db.add(new_store)
        db.flush()  # Para obtener el ID sin hacer commit
        
        # 2. Crear usuario administrador
        hashed_pin = hash_password(data.admin_user.pin)
        
        new_user = User(
            full_name=data.admin_user.full_name,
            dni=data.admin_user.dni,
            pin_hash=hashed_pin,
            email=data.admin_user.email,
            store_id=new_store.id,
            role="admin",
            is_active=True
        )
        db.add(new_user)
        
        # 3. Commit
        db.commit()
        db.refresh(new_store)
        db.refresh(new_user)
        
        print(f"[StoreRegister] ✅ Tienda creada: {new_store.commercial_name} (ID: {new_store.id})")
        print(f"[StoreRegister] ✅ Admin creado: {new_user.full_name} (DNI: {new_user.dni})")
        
        return {
            "message": "Tienda registrada exitosamente",
            "store": {
                "id": new_store.id,
                "commercial_name": new_store.commercial_name,
                "ruc": new_store.ruc
            },
            "admin": {
                "id": new_user.id,
                "full_name": new_user.full_name,
                "dni": new_user.dni
            }
        }
        
    except Exception as e:
        db.rollback()
        print(f"[StoreRegister] ❌ Error: {e}")
        raise HTTPException(500, detail=f"Error al registrar tienda: {str(e)}")

# Agregar en main.py:
# from app.api.v1 import stores
# app.include_router(stores.router, prefix="/api")

@router.get("/list")
async def list_stores(
    db: Session = Depends(get_db)
):
    """Listar todas las tiendas activas"""
    stores = db.query(Store).filter(Store.is_active == True).all()
    
    return [
        {
            "id": store.id,
            "commercial_name": store.commercial_name,
            "ruc": store.ruc
        }
        for store in stores
    ]


@router.get("/{store_id}")
async def get_store(
    store_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener información de una tienda"""
    store = db.query(Store).filter(Store.id == store_id).first()
    
    if not store:
        raise HTTPException(status_code=404, detail="Tienda no encontrada")
    
    return {
        "id": store.id,
        "commercial_name": store.commercial_name,
        "ruc": store.ruc,
        "address": store.address
    }



@router.get("/me/onboarding-status")
async def check_onboarding_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verifica si el usuario completó onboarding"""
    from sqlalchemy import func
    
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    
    # Contar SOLO productos ACTIVOS
    products_count = db.query(func.count(Product.id)).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True  # ⬅️ CRÍTICO: solo activos
    ).scalar()
    
    return {
        "needs_onboarding": products_count == 0,
        "onboarding_completed": store.onboarding_completed if store else False,
        "products_count": products_count
    }


@router.post("/me/complete-onboarding")
async def complete_onboarding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Marca onboarding como completado"""
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    
    if store:
        store.onboarding_completed = True
        db.commit()
    
    return {"success": True}


@router.post("/me/reset-onboarding")
async def reset_onboarding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Resetear onboarding y borrar todos los productos (solo owners)"""
    
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Solo owners pueden resetear")
    
    # 1. Resetear flag de onboarding
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Tienda no encontrada")
    
    store.onboarding_completed = False
    
    # 2. BORRAR TODOS LOS PRODUCTOS del servidor
    deleted_count = db.query(Product).filter(
        Product.store_id == current_user.store_id
    ).delete()
    
    db.commit()
    
    return {
        "success": True,
        "message": f"Onboarding reseteado. {deleted_count} productos eliminados.",
        "onboarding_completed": False,
        "products_deleted": deleted_count
    }