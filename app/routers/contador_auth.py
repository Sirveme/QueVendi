"""
Auth del portal Contador.
Endpoints: registro, login, mis-clientes.
Token JWT con claim tipo='contador'.
"""
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    create_contador_token,
    decode_token,
    get_pin_hash,
    verify_pin,
)
from app.core.config import settings
from app.models.contador import Contador, ContadorStore
from app.models.store import Store


router = APIRouter(tags=["contador-auth"])


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────
class ContadorRegistroIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=150)
    phone: Optional[str] = None
    ruc: Optional[str] = Field(default=None, max_length=11)
    firma_contable: Optional[str] = None
    pin: str = Field(min_length=4, max_length=12)


class ContadorLoginIn(BaseModel):
    email: EmailStr
    pin: str


class ContadorOut(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    phone: Optional[str] = None
    ruc: Optional[str] = None
    firma_contable: Optional[str] = None

    class Config:
        from_attributes = True


# ──────────────────────────────────────────────────────────────────────────
# Dependencia: contador autenticado
# ──────────────────────────────────────────────────────────────────────────
def get_current_contador(
    request: Request,
    db: Session = Depends(get_db),
) -> Contador:
    """Extrae token Bearer (header o cookie) y valida claim tipo='contador'."""
    token = None
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:]
    if not token:
        token = request.query_params.get("token")
    if not token:
        cookie = request.cookies.get("contador_token", "")
        if cookie.startswith("Bearer "):
            token = cookie[7:]
        elif cookie:
            token = cookie

    if not token:
        raise HTTPException(status_code=401, detail="No autenticado")

    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")
    if payload.get("tipo") != "contador":
        raise HTTPException(status_code=403, detail="No autorizado")

    contador_id = payload.get("contador_id")
    if not contador_id:
        raise HTTPException(status_code=401, detail="Token sin contador_id")

    contador = (
        db.query(Contador)
        .filter(Contador.id == int(contador_id), Contador.is_active == True)  # noqa: E712
        .first()
    )
    if not contador:
        raise HTTPException(status_code=401, detail="Contador no encontrado")
    return contador


def _build_token(contador: Contador) -> str:
    return create_contador_token(
        {
            "contador_id": contador.id,
            "email": contador.email,
            "full_name": contador.full_name,
        },
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


# ──────────────────────────────────────────────────────────────────────────
# POST /contador/registro
# ──────────────────────────────────────────────────────────────────────────
@router.post("/registro")
async def registro_contador(payload: ContadorRegistroIn, db: Session = Depends(get_db)):
    existing = db.query(Contador).filter(Contador.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email ya registrado")

    contador = Contador(
        email=payload.email,
        full_name=payload.full_name,
        phone=payload.phone,
        ruc=payload.ruc,
        firma_contable=payload.firma_contable,
        pin_hash=get_pin_hash(payload.pin),
    )
    db.add(contador)
    db.commit()
    db.refresh(contador)

    return {
        "access_token": _build_token(contador),
        "token_type": "bearer",
        "contador": ContadorOut.model_validate(contador),
    }


# ──────────────────────────────────────────────────────────────────────────
# POST /contador/login
# ──────────────────────────────────────────────────────────────────────────
@router.post("/login")
async def login_contador(payload: ContadorLoginIn, db: Session = Depends(get_db)):
    contador = (
        db.query(Contador)
        .filter(Contador.email == payload.email, Contador.is_active == True)  # noqa: E712
        .first()
    )
    if not contador or not verify_pin(payload.pin, contador.pin_hash):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    vinculos = (
        db.query(ContadorStore, Store)
        .join(Store, ContadorStore.store_id == Store.id)
        .filter(ContadorStore.contador_id == contador.id)
        .all()
    )
    stores = [
        {
            "id": s.id,
            "name": getattr(s, "commercial_name", None) or getattr(s, "business_name", None) or f"Store {s.id}",
            "estado": cs.estado,
        }
        for cs, s in vinculos
    ]

    return {
        "access_token": _build_token(contador),
        "token_type": "bearer",
        "contador": ContadorOut.model_validate(contador),
        "stores": stores,
    }


# ──────────────────────────────────────────────────────────────────────────
# GET /contador/mis-clientes
# ──────────────────────────────────────────────────────────────────────────
@router.get("/mis-clientes")
async def mis_clientes(
    db: Session = Depends(get_db),
    contador: Contador = Depends(get_current_contador),
):
    vinculos = (
        db.query(ContadorStore, Store)
        .join(Store, ContadorStore.store_id == Store.id)
        .filter(ContadorStore.contador_id == contador.id)
        .all()
    )
    return {
        "stores": [
            {
                "id": s.id,
                "name": getattr(s, "commercial_name", None) or getattr(s, "business_name", None) or f"Store {s.id}",
                "estado": cs.estado,
                "invited_at": cs.invited_at.isoformat() if cs.invited_at else None,
                "accepted_at": cs.accepted_at.isoformat() if cs.accepted_at else None,
            }
            for cs, s in vinculos
        ]
    }
