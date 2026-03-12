"""
Endpoints de autenticación - Con registro completo y validación
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field
from typing import Optional

from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token
from app.api.dependencies import get_current_user
from app.models.store import Store
from app.models.user import User
from app.models.subscription import Subscription
from app.services.validation_service import validation_service


router = APIRouter(prefix="/auth")


# ============================================
# SCHEMAS
# ============================================

class RegisterRequest(BaseModel):
    # Documento
    document_type: str = Field(..., pattern="^(DNI|RUC)$")
    document_number: str = Field(..., min_length=8, max_length=11)
    
    # Datos del negocio (se autocompletan con validación)
    business_name: Optional[str] = None
    commercial_name: Optional[str] = None
    
    # Ubicación
    address: Optional[str] = None
    district: Optional[str] = None
    province: Optional[str] = None
    department: Optional[str] = None
    
    # Contacto
    phone: str = Field(..., min_length=9, max_length=15)
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    
    # Tipo de negocio
    business_type: str = Field(..., pattern="^(bodega|bazar|perfumeria|mercado|panaderia|minimarket)$")
    
    # Usuario owner
    owner_dni: str = Field(..., min_length=8, max_length=8)
    owner_name: Optional[str] = None  # Se autocompleta si es DNI
    owner_pin: str = Field(..., min_length=4, max_length=6)


class LoginRequest(BaseModel):
    dni: str = Field(..., min_length=8, max_length=8)
    pin: str = Field(..., min_length=4, max_length=6)


# ============================================
# ENDPOINTS
# ============================================

@router.post("/register")
async def register(
    data: RegisterRequest,
    db: Session = Depends(get_db)
):
    """
    Registro completo de tienda con validación de documentos
    
    Flujo:
    1. Validar documento (DNI/RUC) con APISNET
    2. Crear store
    3. Crear suscripción Freemium (30 días)
    4. Crear usuario owner
    5. Retornar token
    """
    
    # ==========================================
    # 1. VALIDAR DOCUMENTO
    # ==========================================
    
    if data.document_type == 'DNI':
        # Validar DNI con APISNET
        validation_result = validation_service.validate_dni(data.document_number)
        
        # Usar datos validados
        business_name = validation_result['full_name']
        commercial_name = data.commercial_name or business_name
        can_issue_invoices = False
        
    elif data.document_type == 'RUC':
        # Validar RUC con APISNET
        validation_result = validation_service.validate_ruc(data.document_number)
        
        # Usar datos validados
        business_name = validation_result['business_name']
        commercial_name = data.commercial_name or validation_result['commercial_name']
        can_issue_invoices = True
        
        # Si hay dirección en la validación y no la proporcionó el usuario
        if not data.address and validation_result.get('address'):
            data.address = validation_result['address']
    
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de documento inválido"
        )
    
    # Verificar que no exista ya
    existing_store = db.query(Store).filter(
        Store.document_number == data.document_number
    ).first()
    
    if existing_store:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya existe una tienda registrada con este {data.document_type}"
        )
    
    # ==========================================
    # 2. VALIDAR DNI DEL OWNER
    # ==========================================
    
    owner_validation = validation_service.validate_dni(data.owner_dni)
    owner_name = data.owner_name or owner_validation['full_name']
    
    # Verificar que el owner no exista ya
    existing_user = db.query(User).filter(User.dni == data.owner_dni).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este DNI ya está registrado como usuario"
        )
    
    # ==========================================
    # 3. CREAR STORE
    # ==========================================
    
    store = Store(
        ruc=data.document_number if data.document_type == 'RUC' else f"10{data.document_number}",
        business_name=business_name,
        commercial_name=commercial_name,
        
        document_type=data.document_type,
        document_number=data.document_number,
        verified=True,
        verification_data=validation_result['raw_data'],
        
        address=data.address,
        district=data.district,
        province=data.province,
        department=data.department,
        
        phone=data.phone,
        whatsapp=data.whatsapp or data.phone,
        email=data.email,
        
        business_type=data.business_type,
        business_mode='simple',
        
        can_issue_invoices=can_issue_invoices,
        
        plan='freemium',
        is_active=True,
        onboarding_completed=False
    )
    
    db.add(store)
    db.flush()  # Para obtener el store.id
    
    # ==========================================
    # 4. CREAR SUSCRIPCIÓN FREEMIUM (30 días)
    # ==========================================
    
    now = datetime.now(timezone.utc)
    trial_end = now + timedelta(days=30)
    
    subscription = Subscription(
        store_id=store.id,
        plan_code='freemium',
        status='trial',
        current_period_start=now,
        current_period_end=trial_end,
        trial_ends_at=trial_end,
        next_billing_date=trial_end,
        monthly_amount=0,
        extra_sellers=0,
        extra_cashiers=0
    )
    
    db.add(subscription)
    
    # ==========================================
    # 5. CREAR USUARIO OWNER
    # ==========================================
    
    # Generar username único
    username = f"{owner_name.lower().replace(' ', '_')}_{data.owner_dni}"
    
    user = User(
        dni=data.owner_dni,
        pin_hash=hash_password(data.owner_pin),
        full_name=owner_name,
        phone=data.phone,
        store_id=store.id,
        role='owner',
        username=username,
        
        # Permisos completos para owner
        can_register_purchases=True,
        can_view_analytics=True,
        can_modify_prices=True,
        can_cancel_sales=True,
        can_view_all_sales=True,
        can_manage_inventory=True,
        
        is_active=True
    )
    
    db.add(user)
    db.commit()
    db.refresh(user)
    db.refresh(store)
    
    # ==========================================
    # 6. GENERAR TOKEN Y RETORNAR
    # ==========================================
    
    access_token = create_access_token(
        data={
            "sub": str(user.id),       # ⬅️ AGREGADO
            "user_id": user.id,
            "dni": user.dni,
            "store_id": store.id,
            "role": user.role
        }
    )
    
    return {
        "message": "Registro exitoso",
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "dni": user.dni,
            "full_name": user.full_name,
            "username": user.username,
            "role": user.role,
            "store_id": store.id
        },
        "store": {
            "id": store.id,
            "business_name": store.business_name,
            "commercial_name": store.commercial_name,
            "document_type": store.document_type,
            "document_number": store.document_number,
            "can_issue_invoices": store.can_issue_invoices,
            "business_type": store.business_type
        },
        "subscription": {
            "plan": subscription.plan_code,
            "status": subscription.status,
            "trial_ends_at": subscription.trial_ends_at.isoformat()
        }
    }


@router.post("/login")
async def login(
    data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.dni == data.dni).first()

    if not user or not verify_password(data.pin, user.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DNI o PIN incorrectos"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo"
        )

    user.last_login = datetime.now(timezone.utc)
    db.commit()

    # ── Duración según rol ──────────────────────────────────────────
    if user.role == "demo_seller":
        expires = timedelta(hours=12)   # jornada de trabajo completa
    elif user.role in ("owner", "admin"):
        expires = timedelta(days=30)    # dueño no debe re-loguearse
    else:
        expires = timedelta(hours=10)   # cajero/vendedor normal

    access_token = create_access_token(
        data={
            "sub":      str(user.id),
            "user_id":  user.id,
            "dni":      user.dni,
            "store_id": user.store_id,
            "role":     user.role,
            "full_name": user.full_name,   # ← lo usa demo_selector.html
        },
        expires_delta=expires              # ← asegúrate que create_access_token lo acepte
    )

    # ── Redirect según rol ──────────────────────────────────────────
    if user.role == "demo_seller":
        redirect_url = "/demo/selector"
    elif getattr(user, 'first_login', False):
        redirect_url = "/bodegas/onboarding"
    else:
        redirect_url = "/bodegas/dashboard"

    response_data = {
        "access_token": access_token,
        "token_type":   "bearer",
        "first_login":  getattr(user, 'first_login', False),
        "redirect":     redirect_url,      # ← el JS del login lee esto
        "is_demo":      user.role == "demo_seller",
        "user": {
            "id":        user.id,
            "dni":       user.dni,
            "full_name": user.full_name,
            "username":  user.username,
            "role":      user.role,
            "avatar_url":user.avatar_url,
            "store_id":  user.store_id,
        }
    }

    response = JSONResponse(content=response_data)

    is_secure = (
        request.url.scheme == "https" or
        request.headers.get("x-forwarded-proto") == "https"
    )
    response.set_cookie(
        key="access_token",
        value=f"Bearer {access_token}",
        httponly=True,
        secure=is_secure,
        samesite="lax",
        max_age=int(expires.total_seconds()),  # ← consistente con el token
        path="/"
    )

    return response

"""
Endpoints adicionales de autenticación
Agregar a app/api/v1/auth.py
"""

# ============================================
# SCHEMAS ADICIONALES
# ============================================

class ChangePasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=20)


class RecoverPasswordRequest(BaseModel):
    dni: str = Field(..., min_length=8, max_length=8)


class ResetPasswordRequest(BaseModel):
    dni: str = Field(..., min_length=8, max_length=8)
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=6, max_length=20)


# ============================================
# ENDPOINTS ADICIONALES
# ============================================

@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Cambiar contraseña del usuario autenticado.
    Se usa para:
    - Cambio obligatorio en primer login
    - Cambio voluntario desde perfil
    """
    # Obtener usuario del token
    from app.core.security import get_current_user
    
    user = await get_current_user(request, db)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado"
        )
    
    # Verificar que la nueva clave no sea igual al DNI
    if data.new_password == user.dni:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La clave no puede ser igual a tu DNI"
        )
    
    # Verificar que no sea la misma clave actual
    if verify_password(data.new_password, user.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva clave debe ser diferente a la actual"
        )
    
    # Actualizar clave
    user.pin_hash = hash_password(data.new_password)
    user.first_login = False  # Ya no es primer login
    user.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    
    return {"message": "Clave actualizada correctamente"}


@router.post("/recover-password")
async def recover_password(
    data: RecoverPasswordRequest,
    db: Session = Depends(get_db)
):
    """
    Solicitar código de recuperación de contraseña.
    Envía código de 6 dígitos por WhatsApp.
    """
    import random
    
    # Buscar usuario
    user = db.query(User).filter(User.dni == data.dni).first()
    
    if not user:
        # Por seguridad, no revelamos si el DNI existe
        # Pero igual retornamos éxito
        return {"message": "Si el DNI existe, recibirás un código por WhatsApp"}
    
    # Generar código de 6 dígitos
    code = ''.join([str(random.randint(0, 9)) for _ in range(6)])
    
    # Guardar código con expiración (10 minutos)
    user.recovery_code = code
    user.recovery_code_expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.commit()
    
    # Enviar por WhatsApp (implementar según tu servicio)
    # Por ahora solo logueamos
    print(f"📱 Código de recuperación para {user.dni}: {code}")
    
    # TODO: Integrar con WhatsApp API
    # from app.services.whatsapp_service import send_recovery_code
    # await send_recovery_code(user.phone, code)
    
    return {"message": "Si el DNI existe, recibirás un código por WhatsApp"}


@router.post("/reset-password")
async def reset_password(
    data: ResetPasswordRequest,
    db: Session = Depends(get_db)
):
    """
    Restablecer contraseña usando código de recuperación.
    """
    # Buscar usuario
    user = db.query(User).filter(User.dni == data.dni).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código inválido o expirado"
        )
    
    # Verificar código
    if not user.recovery_code or user.recovery_code != data.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código inválido o expirado"
        )
    
    # Verificar expiración
    if user.recovery_code_expires and user.recovery_code_expires < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El código ha expirado. Solicita uno nuevo."
        )
    
    # Verificar que la nueva clave no sea igual al DNI
    if data.new_password == user.dni:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La clave no puede ser igual a tu DNI"
        )
    
    # Actualizar clave
    user.pin_hash = hash_password(data.new_password)
    user.recovery_code = None
    user.recovery_code_expires = None
    user.first_login = False
    user.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    
    return {"message": "Clave restablecida correctamente"}


# ============================================
# REFRESH TOKEN SIN PEDIR PIN DE NUEVO
# ============================================
@router.post("/refresh")
async def refresh_token(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Renueva el token sin pedir PIN de nuevo"""
    expires = timedelta(hours=12 if current_user.role == "demo_seller" else 10)
    new_token = create_access_token(
        data={
            "sub":       str(current_user.id),
            "user_id":   current_user.id,
            "dni":       current_user.dni,
            "store_id":  current_user.store_id,
            "role":      current_user.role,
            "full_name": current_user.full_name,
        },
        expires_delta=expires
    )
    return {"access_token": new_token, "token_type": "bearer"}

# ============================================
# MODIFICAR EL LOGIN EXISTENTE
# ============================================

# En el endpoint /login, agregar al response:
# "first_login": user.first_login if hasattr(user, 'first_login') else False

# Y en la respuesta JSON:
# response_data = {
#     ...
#     "first_login": getattr(user, 'first_login', False)
# }


# ============================================
# CAMPOS A AGREGAR AL MODELO USER
# ============================================

"""
Agregar estos campos al modelo User (app/models/user.py):

    # Control de primer login
    first_login = Column(Boolean, default=True)
    
    # Recuperación de contraseña
    recovery_code = Column(String(6), nullable=True)
    recovery_code_expires = Column(DateTime(timezone=True), nullable=True)

Luego crear migración:
    alembic revision --autogenerate -m "add first_login and recovery fields"
    alembic upgrade head
"""