"""
Endpoints para gestión de usuarios
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.core.database import get_db
from app.models.user import User
from app.models.store import Store
from app.core.security import hash_password
from app.api.dependencies import get_current_user

#router = APIRouter(prefix="/users", tags=["users"])
router = APIRouter()

class UserCreate(BaseModel):
    store_id: int
    full_name: str
    dni: str
    pin: str
    role: str = "seller"  # seller o admin
    #email: str | None = None

@router.post("/add")
async def add_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Agregar usuario a una tienda existente
    Solo admins pueden agregar usuarios
    """
    # Verificar que el usuario actual sea admin
    if current_user.role != "admin":
        raise HTTPException(403, detail="Solo administradores pueden agregar usuarios")
    
    # Verificar que la tienda existe
    store = db.query(Store).filter(Store.id == user_data.store_id).first()
    if not store:
        raise HTTPException(404, detail="Tienda no encontrada")
    
    # Verificar que no exista usuario con el mismo DNI
    existing_user = db.query(User).filter(User.dni == user_data.dni).first()
    if existing_user:
        raise HTTPException(400, detail="Ya existe un usuario con este DNI")
    
    # Validar rol
    if user_data.role not in ["seller", "admin"]:
        raise HTTPException(400, detail="Rol inválido. Debe ser 'seller' o 'admin'")
    
    try:
        # Crear usuario
        hashed_pin = hash_password(user_data.pin)
        
        new_user = User(
            full_name=user_data.full_name,
            dni=user_data.dni,
            pin_hash=hashed_pin,
            #email=user_data.email,
            store_id=user_data.store_id,
            role=user_data.role,
            is_active=True
        )
        
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        
        print(f"[UserCreate] ✅ Usuario creado: {new_user.full_name} (DNI: {new_user.dni})")
        
        return {
            "id": new_user.id,
            "full_name": new_user.full_name,
            "dni": new_user.dni,
            "role": new_user.role,
            "store_id": new_user.store_id
        }
        
    except Exception as e:
        db.rollback()
        print(f"[UserCreate] ❌ Error: {e}")
        raise HTTPException(500, detail=f"Error al crear usuario: {str(e)}")