"""
QueVendi — Gestión de Usuarios
==============================
Endpoints para gestión de usuarios del negocio.

Rutas:
  GET  /api/v1/users/me                    → Perfil del usuario actual
  POST /api/v1/users/avatar/upload         → Subir avatar
  DEL  /api/v1/users/avatar               → Eliminar avatar
  GET  /api/v1/users/store/list           → Listar usuarios del negocio (owner/admin)
  POST /api/v1/users/store/create         → Crear nuevo usuario (owner/admin)
  PUT  /api/v1/users/store/{user_id}      → Editar usuario (owner/admin)
  DEL  /api/v1/users/store/{user_id}      → Desactivar usuario (owner/admin)
  PUT  /api/v1/users/store/{user_id}/block-size → Configurar tamaño de bloque offline

Registrado en main.py:
  from app.api.v1 import users
  app.include_router(users.router, prefix="/api/v1", tags=["users"])
"""

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from app.core.database import get_db
from app.models.user import User
from app.models.store import Store
from app.api.dependencies import get_current_user
from app.services.upload_service import upload_service
from app.core.security import hash_password
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users")

# ════════════════════════════════════════════════
# SCHEMAS
# ════════════════════════════════════════════════

class UserCreate(BaseModel):
    full_name: str
    dni: str
    pin: str
    role: str = "seller"          # seller | cashier | admin
    tipo: str = "cajero"          # cajero | pedidos
    block_size: int = 100         # correlativos offline asignados

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    pin: Optional[str] = None
    role: Optional[str] = None
    tipo: Optional[str] = None
    is_active: Optional[bool] = None
    block_size: Optional[int] = None

class BlockSizeUpdate(BaseModel):
    block_size: int

# ════════════════════════════════════════════════
# TABLA AUXILIAR — block_size por usuario
# ════════════════════════════════════════════════

MIGRATION_SQL = """
ALTER TABLE users ADD COLUMN IF NOT EXISTS block_size INTEGER DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'cajero';
"""

def _ensure_columns(db: Session):
    try:
        db.execute(text(MIGRATION_SQL))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[Users] Migración: {e}")

# ════════════════════════════════════════════════
# ENDPOINTS EXISTENTES
# ════════════════════════════════════════════════

@router.post("/avatar/upload")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Sube o actualiza el avatar del usuario actual."""
    try:
        result = await upload_service.upload_avatar(
            file=file,
            user_id=current_user.id,
            dni=current_user.dni
        )
        current_user.avatar_url = result['url']
        db.commit()
        db.refresh(current_user)
        return {
            'message': 'Avatar actualizado exitosamente',
            'avatar_url': result['url'],
            'filename': result['filename'],
            'size': result['size']
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, detail=f"Error al subir avatar: {str(e)}")


@router.get("/me")
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Obtiene información del usuario actual incluyendo nombre del negocio."""
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    return {
        'id':          current_user.id,
        'dni':         current_user.dni,
        'full_name':   current_user.full_name,
        'username':    current_user.username,
        'role':        current_user.role,
        'avatar_url':  current_user.avatar_url,
        'store_id':    current_user.store_id,
        'store_name':  store.commercial_name if store else 'Mi Negocio',
        'store_ruc':   store.ruc             if store else '',
        'store_phone': store.phone           if store else '',
        'store_logo':  store.logo_url        if store else None,
    }


@router.delete("/avatar")
async def delete_avatar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Elimina el avatar del usuario actual."""
    if not current_user.avatar_url:
        raise HTTPException(404, "No tienes avatar para eliminar")
    filepath = f"app/static/uploads/avatars/{current_user.dni}.jpg"
    upload_service.delete_file(filepath)
    current_user.avatar_url = None
    db.commit()
    return {'message': 'Avatar eliminado exitosamente'}


# ════════════════════════════════════════════════
# GESTIÓN DE USUARIOS DEL NEGOCIO
# ════════════════════════════════════════════════

@router.get("/store/list")
async def listar_usuarios(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Listar todos los usuarios del negocio. Solo owner/admin."""
    if current_user.role not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Solo el dueño puede ver los usuarios")

    _ensure_columns(db)
    store_id = current_user.store_id

    usuarios = db.query(User).filter(User.store_id == store_id).order_by(User.id).all()

    result = []
    for u in usuarios:
        # Obtener block_size con fallback
        try:
            block_size = db.execute(
                text("SELECT block_size FROM users WHERE id = :id"),
                {"id": u.id}
            ).scalar() or 100
            tipo = db.execute(
                text("SELECT tipo FROM users WHERE id = :id"),
                {"id": u.id}
            ).scalar() or "cajero"
        except Exception:
            block_size = 100
            tipo = "cajero"

        result.append({
            "id":         u.id,
            "dni":        u.dni,
            "full_name":  u.full_name,
            "role":       u.role,
            "tipo":       tipo,
            "is_active":  u.is_active,
            "avatar_url": u.avatar_url,
            "block_size": block_size,
            "last_login": u.last_login.isoformat() if u.last_login else None,
        })

    return {"usuarios": result, "total": len(result)}


@router.post("/store/create")
async def crear_usuario(
    data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Crear nuevo usuario en el negocio. Solo owner/admin."""
    if current_user.role not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Solo el dueño puede crear usuarios")

    _ensure_columns(db)
    store_id = current_user.store_id

    # Validar DNI único
    existing = db.query(User).filter(User.dni == data.dni).first()
    if existing:
        raise HTTPException(400, f"Ya existe un usuario con DNI {data.dni}")

    # Verificar límite del plan
    from app.models.store import Store as StoreModel
    store = db.query(StoreModel).filter(StoreModel.id == store_id).first()
    plan = store.plan if store else "basico"
    PLAN_LIMITS = {"demo": 2, "freemium": 2, "basico": 3, "crece": 5, "pro": 999}
    max_users = PLAN_LIMITS.get(plan, 3)
    current_count = db.query(User).filter(
        User.store_id == store_id,
        User.is_active == True
    ).count()

    if current_count >= max_users:
        raise HTTPException(400, f"Límite de usuarios alcanzado ({current_count}/{max_users}) para el plan {plan}")

    try:
        new_user = User(
            full_name=data.full_name.upper(),
            dni=data.dni,
            pin_hash=hash_password(data.pin),
            store_id=store_id,
            role=data.role,
            username=data.dni,
            is_active=True,
        )
        db.add(new_user)
        db.flush()

        # Guardar tipo y block_size
        db.execute(text("""
            UPDATE users SET tipo = :tipo, block_size = :bs WHERE id = :id
        """), {"tipo": data.tipo, "bs": data.block_size, "id": new_user.id})

        db.commit()
        logger.info(f"[Users] Nuevo usuario {new_user.full_name} (DNI:{data.dni}) en store {store_id}")

        return {
            "success":   True,
            "user_id":   new_user.id,
            "full_name": new_user.full_name,
            "dni":       new_user.dni,
            "role":      new_user.role,
            "tipo":      data.tipo,
            "block_size": data.block_size,
            "message":   f"Usuario {new_user.full_name} creado correctamente"
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"[Users] Error creando usuario: {e}")
        raise HTTPException(500, str(e))


@router.put("/store/{user_id}")
async def editar_usuario(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Editar usuario del negocio. Solo owner/admin."""
    if current_user.role not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "No autorizado")

    user = db.query(User).filter(
        User.id == user_id,
        User.store_id == current_user.store_id
    ).first()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    # No permitir editar al propio owner
    if user.role == "owner" and current_user.id != user.id:
        raise HTTPException(403, "No puedes editar al dueño del negocio")

    if data.full_name:
        user.full_name = data.full_name.upper()
    if data.pin:
        user.pin_hash = hash_password(data.pin)
    if data.role:
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active

    db.flush()

    # Actualizar tipo y block_size
    updates = {}
    if data.tipo:
        updates["tipo"] = data.tipo
    if data.block_size:
        updates["block_size"] = data.block_size

    if updates:
        set_clauses = ", ".join([f"{k} = :{k}" for k in updates])
        updates["id"] = user_id
        db.execute(text(f"UPDATE users SET {set_clauses} WHERE id = :id"), updates)

    db.commit()
    logger.info(f"[Users] Usuario {user_id} actualizado por {current_user.full_name}")

    return {"success": True, "message": f"Usuario {user.full_name} actualizado"}


@router.delete("/store/{user_id}")
async def desactivar_usuario(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Desactivar usuario (soft delete). Solo owner/admin."""
    if current_user.role not in ("owner", "admin"):
        raise HTTPException(403, "No autorizado")

    user = db.query(User).filter(
        User.id == user_id,
        User.store_id == current_user.store_id
    ).first()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    if user.role == "owner":
        raise HTTPException(400, "No puedes desactivar al dueño del negocio")

    if user.id == current_user.id:
        raise HTTPException(400, "No puedes desactivarte a ti mismo")

    user.is_active = False
    db.commit()
    logger.info(f"[Users] Usuario {user_id} desactivado por {current_user.full_name}")

    return {"success": True, "message": f"Usuario {user.full_name} desactivado"}


@router.put("/store/{user_id}/block-size")
async def actualizar_block_size(
    user_id: int,
    data: BlockSizeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Configurar tamaño de bloque de correlativos offline para un usuario."""
    if current_user.role not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "No autorizado")

    _ensure_columns(db)

    user = db.query(User).filter(
        User.id == user_id,
        User.store_id == current_user.store_id
    ).first()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    if data.block_size < 10 or data.block_size > 500:
        raise HTTPException(400, "El bloque debe ser entre 10 y 500 correlativos")

    db.execute(text("UPDATE users SET block_size = :bs WHERE id = :id"),
               {"bs": data.block_size, "id": user_id})
    db.commit()

    return {
        "success":    True,
        "user_id":    user_id,
        "block_size": data.block_size,
        "message":    f"Bloque configurado: {data.block_size} correlativos offline"
    }