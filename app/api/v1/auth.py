"""
Endpoints de autenticación - Con registro completo y validación
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field
from typing import Optional

from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token
from app.models.store import Store
from app.models.user import User
from app.models.subscription import Subscription
from app.services.validation_service import validation_service


router = APIRouter(prefix="/auth", tags=["auth"])


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
    db: Session = Depends(get_db)
):
    """Login de usuario"""
    
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
    
    # Actualizar último login
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    
    # Generar token
    access_token = create_access_token(
        data={
            "sub": str(user.id),       # ⬅️ AGREGADO: Estándar JWT
            "user_id": user.id,        # Mantenemos por compatibilidad temporal
            "dni": user.dni,
            "store_id": user.store_id,
            "role": user.role
        }
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "dni": user.dni,
            "full_name": user.full_name,
            "username": user.username,
            "role": user.role,
            "avatar_url": user.avatar_url,
            "store_id": user.store_id
        }
    }