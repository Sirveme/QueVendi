"""
Endpoints del portal Contador:
- Gestión de clientes (vínculo contador <> store)
- Permisos por store (configurados por owner)
- Libro de Ventas (comprobantes mensuales) + export CSV
- Resumen mensual
"""
import csv
import io
import re
import secrets
from datetime import datetime
from decimal import Decimal
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.store import Store
from app.models.billing import Comprobante
from app.models.sale import Sale, SaleItem
from app.models.product import Product
from app.models.contador import Contador, ContadorStore, ContadorPermiso
from app.routers.contador_auth import get_current_contador


router = APIRouter(tags=["contador"])


MESES_ES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────
def _ensure_owner_of_store(user: User, store_id: int):
    if user.store_id != store_id:
        raise HTTPException(status_code=403, detail="No autorizado para este store")
    if (user.role or "").lower() not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Solo el owner puede realizar esta acción")


def _ensure_contador_access(db: Session, contador_id: int, store_id: int) -> ContadorStore:
    cs = (
        db.query(ContadorStore)
        .filter(
            ContadorStore.contador_id == contador_id,
            ContadorStore.store_id == store_id,
            ContadorStore.estado == "activo",
        )
        .first()
    )
    if not cs:
        raise HTTPException(status_code=403, detail="Sin acceso a este store")
    return cs


def _to_float(x) -> float:
    if x is None:
        return 0.0
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────
class InvitarIn(BaseModel):
    email_o_whatsapp: str
    # mantenido para retrocompat con clientes viejos
    email_contador: Optional[EmailStr] = None


def _es_email(s: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", s or ""))


def _normaliza_whatsapp(s: str) -> str:
    """Devuelve solo dígitos. Si vienen menos de 11 asume Perú y antepone 51."""
    digitos = re.sub(r"\D", "", s or "")
    if not digitos:
        return ""
    if len(digitos) == 9:  # 9XXXXXXXX → 51 9XXXXXXXX
        digitos = "51" + digitos
    return digitos


class PermisosIn(BaseModel):
    puede_notas: bool = False
    puede_ver_planilla: bool = False
    puede_modificar: bool = False
    puede_ver_bancario: bool = False
    notificar_owner: bool = True


# ──────────────────────────────────────────────────────────────────────────
# Gestión de clientes
# ──────────────────────────────────────────────────────────────────────────
@router.get("/clientes")
async def listar_clientes(
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
        "clientes": [
            {
                "store_id": s.id,
                "name": getattr(s, "commercial_name", None) or getattr(s, "business_name", None) or f"Store {s.id}",
                "estado": cs.estado,
                "invited_at": cs.invited_at.isoformat() if cs.invited_at else None,
                "accepted_at": cs.accepted_at.isoformat() if cs.accepted_at else None,
            }
            for cs, s in vinculos
        ]
    }


@router.get("/store/{store_id}/contadores")
async def listar_contadores_del_store(
    store_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Para el owner: lista los contadores vinculados a su store."""
    _ensure_owner_of_store(current_user, store_id)
    rows = (
        db.query(ContadorStore, Contador)
        .join(Contador, ContadorStore.contador_id == Contador.id)
        .filter(ContadorStore.store_id == store_id)
        .all()
    )
    return {
        "contadores": [
            {
                "contador_id": c.id,
                "email": c.email,
                "full_name": c.full_name,
                "ruc": c.ruc,
                "estado": cs.estado,
                "invited_at": cs.invited_at.isoformat() if cs.invited_at else None,
                "accepted_at": cs.accepted_at.isoformat() if cs.accepted_at else None,
            }
            for cs, c in rows
        ]
    }


@router.post("/clientes/invitar/{store_id}")
async def invitar_contador(
    store_id: int,
    payload: InvitarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Owner invita por email o WhatsApp. Genera link único con token."""
    _ensure_owner_of_store(current_user, store_id)

    contacto = (payload.email_o_whatsapp or payload.email_contador or "").strip()
    if not contacto:
        raise HTTPException(status_code=400, detail="Falta email o WhatsApp del contador")

    es_email = _es_email(contacto)
    whatsapp = "" if es_email else _normaliza_whatsapp(contacto)
    email = contacto.lower() if es_email else None

    if not es_email and not whatsapp:
        raise HTTPException(status_code=400, detail="Contacto inválido")

    # Buscar contador existente por email o whatsapp
    contador: Optional[Contador] = None
    if email:
        contador = db.query(Contador).filter(Contador.email == email).first()
    if not contador and whatsapp:
        contador = db.query(Contador).filter(Contador.whatsapp == whatsapp).first()

    # Si no existe → crear registro pendiente sin pin_hash
    if not contador:
        contador = Contador(
            email=email,
            whatsapp=whatsapp or None,
            full_name=email or whatsapp or "Contador invitado",
            is_active=True,
        )
        db.add(contador)
        db.flush()  # asegurar id sin commit

    # Vínculo con el store
    cs = (
        db.query(ContadorStore)
        .filter(
            ContadorStore.contador_id == contador.id,
            ContadorStore.store_id == store_id,
        )
        .first()
    )

    invitation_token = secrets.token_urlsafe(32)

    if cs:
        cs.estado = "pendiente" if cs.estado != "activo" else cs.estado
        cs.invitation_token = invitation_token if cs.estado != "activo" else cs.invitation_token
        if cs.estado != "activo":
            cs.invited_at = datetime.utcnow()
            cs.accepted_at = None
    else:
        cs = ContadorStore(
            contador_id=contador.id,
            store_id=store_id,
            estado="pendiente",
            invitation_token=invitation_token,
        )
        db.add(cs)

    # Permisos por defecto si no existen
    perm = (
        db.query(ContadorPermiso)
        .filter(
            ContadorPermiso.contador_id == contador.id,
            ContadorPermiso.store_id == store_id,
        )
        .first()
    )
    if not perm:
        db.add(ContadorPermiso(contador_id=contador.id, store_id=store_id))

    db.commit()

    # Construir respuesta con link + WhatsApp deep-link
    base_url = str(request.base_url).rstrip("/")
    # Preferir dominio público si está accediendo localmente
    host = request.headers.get("host", "")
    if "localhost" in host or "127.0.0.1" in host:
        base_url = "https://quevendi.pro"

    link = f"{base_url}/contador/aceptar?token={cs.invitation_token}"

    store = db.query(Store).filter(Store.id == store_id).first()
    nombre_negocio = (
        getattr(store, "commercial_name", None)
        or getattr(store, "business_name", None)
        or "mi negocio"
    ) if store else "mi negocio"

    mensaje_wa = (
        f"Hola! Te invito a ver los reportes de {nombre_negocio} en QueVendi. "
        f"Acepta aquí: {link}"
    )
    whatsapp_url = (
        f"https://wa.me/{whatsapp}?text={quote(mensaje_wa)}"
        if whatsapp
        else f"https://wa.me/?text={quote(mensaje_wa)}"
    )

    return {
        "ok": True,
        "estado": cs.estado,
        "contador_id": contador.id,
        "link": link,
        "mensaje_wa": mensaje_wa,
        "whatsapp_url": whatsapp_url,
    }


@router.post("/aceptar/{store_id}")
async def aceptar_invitacion(
    store_id: int,
    db: Session = Depends(get_db),
    contador: Contador = Depends(get_current_contador),
):
    cs = (
        db.query(ContadorStore)
        .filter(
            ContadorStore.contador_id == contador.id,
            ContadorStore.store_id == store_id,
        )
        .first()
    )
    if not cs:
        raise HTTPException(status_code=404, detail="Invitación no encontrada")
    cs.estado = "activo"
    cs.accepted_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "estado": "activo"}


# ──────────────────────────────────────────────────────────────────────────
# Aceptar invitación por link (sin auth: el token es la credencial temporal)
# ──────────────────────────────────────────────────────────────────────────
class CompletarInvitacionIn(BaseModel):
    token: str
    dni: Optional[str] = None  # requerido si el contador aún no tiene cuenta
    full_name: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[EmailStr] = None
    pin: Optional[str] = None  # requerido si el contador aún no tiene cuenta


def _info_invitacion(db: Session, token: str) -> dict:
    cs = db.query(ContadorStore).filter(ContadorStore.invitation_token == token).first()
    if not cs:
        raise HTTPException(status_code=404, detail="Invitación inválida o expirada")
    contador = db.query(Contador).filter(Contador.id == cs.contador_id).first()
    store = db.query(Store).filter(Store.id == cs.store_id).first()
    if not contador or not store:
        raise HTTPException(status_code=404, detail="Invitación inconsistente")

    nombre_negocio = (
        getattr(store, "commercial_name", None)
        or getattr(store, "business_name", None)
        or f"Store {store.id}"
    )
    tiene_cuenta = bool(contador.pin_hash)
    return {
        "store_id": store.id,
        "negocio": nombre_negocio,
        "ruc_negocio": getattr(store, "ruc", None),
        "estado": cs.estado,
        "tiene_cuenta": tiene_cuenta,
        "contador": {
            "id": contador.id,
            "dni": contador.dni,
            "email": contador.email,
            "whatsapp": contador.whatsapp,
            "full_name": contador.full_name if tiene_cuenta else None,
        },
    }


@router.get("/invitacion/{token}")
async def info_invitacion(token: str, db: Session = Depends(get_db)):
    return _info_invitacion(db, token)


@router.post("/aceptar-invitacion")
async def aceptar_invitacion_token(
    payload: CompletarInvitacionIn,
    db: Session = Depends(get_db),
):
    """
    Acepta invitación usando el token único:
    - Si el contador ya tiene pin_hash → solo activa el vínculo
    - Si no → completa nombre/whatsapp/email/pin y activa
    Devuelve access_token de contador.
    """
    from app.core.security import get_pin_hash, verify_pin
    from app.routers.contador_auth import _build_token

    cs = db.query(ContadorStore).filter(ContadorStore.invitation_token == payload.token).first()
    if not cs:
        raise HTTPException(status_code=404, detail="Invitación inválida o expirada")

    contador = db.query(Contador).filter(Contador.id == cs.contador_id).first()
    if not contador:
        raise HTTPException(status_code=404, detail="Contador no encontrado")

    if not contador.pin_hash:
        # Registro nuevo: requiere DNI, pin y full_name
        dni = (payload.dni or "").strip()
        if not re.match(r"^\d{8}$", dni):
            raise HTTPException(status_code=400, detail="DNI inválido (8 dígitos)")
        if not payload.pin or len(payload.pin) < 4:
            raise HTTPException(status_code=400, detail="PIN requerido (mín 4 dígitos)")
        if not payload.full_name or len(payload.full_name.strip()) < 2:
            raise HTTPException(status_code=400, detail="Nombre completo requerido")

        # Verificar DNI no esté tomado por otro contador
        ya = db.query(Contador).filter(Contador.dni == dni, Contador.id != contador.id).first()
        if ya:
            raise HTTPException(status_code=409, detail="DNI ya registrado")

        contador.dni = dni
        contador.full_name = payload.full_name.strip()
        if payload.email and not contador.email:
            contador.email = str(payload.email).lower()
        if payload.whatsapp and not contador.whatsapp:
            contador.whatsapp = _normaliza_whatsapp(payload.whatsapp)
        contador.pin_hash = get_pin_hash(payload.pin)
        contador.is_active = True
    else:
        # Cuenta existente: si mandó pin lo verificamos como login
        if payload.pin and not verify_pin(payload.pin, contador.pin_hash):
            raise HTTPException(status_code=401, detail="PIN incorrecto")

    cs.estado = "activo"
    cs.accepted_at = datetime.utcnow()
    cs.invitation_token = None  # invalidar token tras uso
    db.commit()
    db.refresh(contador)

    access_token = _build_token(contador)
    return {
        "ok": True,
        "access_token": access_token,
        "token_type": "bearer",
        "contador": {
            "id": contador.id,
            "email": contador.email,
            "full_name": contador.full_name,
            "whatsapp": contador.whatsapp,
        },
        "store_id": cs.store_id,
    }


@router.delete("/clientes/{store_id}")
async def revocar_acceso(
    store_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """Owner o contador pueden revocar el vínculo."""
    # Permitir a owner (token de usuario) o contador (token de contador)
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    from app.core.security import decode_token
    token = auth[7:] if auth.lower().startswith("bearer ") else None
    if not token:
        cookie = request.cookies.get("access_token", "") or request.cookies.get("contador_token", "")
        if cookie.startswith("Bearer "):
            token = cookie[7:]
        elif cookie:
            token = cookie
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado")

    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")

    cs = (
        db.query(ContadorStore)
        .filter(ContadorStore.store_id == store_id)
        .all()
    )

    if payload.get("tipo") == "contador":
        contador_id = int(payload.get("contador_id"))
        target = next((x for x in cs if x.contador_id == contador_id), None)
    else:
        user_id = int(payload.get("user_id") or payload.get("sub"))
        user = db.query(User).filter(User.id == user_id).first()
        if not user or user.store_id != store_id or (user.role or "").lower() not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="No autorizado")
        contador_id_param = request.query_params.get("contador_id")
        if not contador_id_param:
            raise HTTPException(status_code=400, detail="Falta contador_id en query")
        target = next((x for x in cs if x.contador_id == int(contador_id_param)), None)

    if not target:
        raise HTTPException(status_code=404, detail="Vínculo no encontrado")

    target.estado = "revocado"
    db.commit()
    return {"ok": True, "estado": "revocado"}


# ──────────────────────────────────────────────────────────────────────────
# Permisos (owner configura)
# ──────────────────────────────────────────────────────────────────────────
def _permiso_to_dict(p: Optional[ContadorPermiso]) -> dict:
    if not p:
        return {
            "puede_notas": False,
            "puede_ver_planilla": False,
            "puede_modificar": False,
            "puede_ver_bancario": False,
            "notificar_owner": True,
        }
    return {
        "puede_notas": bool(p.puede_notas),
        "puede_ver_planilla": bool(p.puede_ver_planilla),
        "puede_modificar": bool(p.puede_modificar),
        "puede_ver_bancario": bool(p.puede_ver_bancario),
        "notificar_owner": bool(p.notificar_owner),
    }


@router.get("/permisos/{store_id}")
async def ver_permisos(
    store_id: int,
    contador_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_owner_of_store(current_user, store_id)
    p = (
        db.query(ContadorPermiso)
        .filter(
            ContadorPermiso.contador_id == contador_id,
            ContadorPermiso.store_id == store_id,
        )
        .first()
    )
    return {"contador_id": contador_id, "store_id": store_id, **_permiso_to_dict(p)}


@router.put("/permisos/{store_id}")
async def actualizar_permisos(
    store_id: int,
    payload: PermisosIn,
    contador_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_owner_of_store(current_user, store_id)

    p = (
        db.query(ContadorPermiso)
        .filter(
            ContadorPermiso.contador_id == contador_id,
            ContadorPermiso.store_id == store_id,
        )
        .first()
    )
    if not p:
        p = ContadorPermiso(contador_id=contador_id, store_id=store_id)
        db.add(p)

    p.puede_notas = payload.puede_notas
    p.puede_ver_planilla = payload.puede_ver_planilla
    p.puede_modificar = payload.puede_modificar
    p.puede_ver_bancario = payload.puede_ver_bancario
    p.notificar_owner = payload.notificar_owner
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return {"ok": True, **_permiso_to_dict(p)}


# ──────────────────────────────────────────────────────────────────────────
# Libro de Ventas
# ──────────────────────────────────────────────────────────────────────────
def _query_libro_ventas(db: Session, store_id: int, mes: int, anio: int):
    """Comprobantes del store en el mes/año dados."""
    return (
        db.query(Comprobante)
        .filter(
            Comprobante.store_id == store_id,
            func.extract("month", Comprobante.fecha_emision) == mes,
            func.extract("year", Comprobante.fecha_emision) == anio,
        )
        .order_by(Comprobante.fecha_emision.asc(), Comprobante.serie.asc(), Comprobante.numero.asc())
        .all()
    )


def _comprobante_dict(c: Comprobante) -> dict:
    total = _to_float(c.total)
    igv = _to_float(c.igv)
    subtotal = _to_float(c.subtotal)
    return {
        "id": c.id,
        "numero_comprobante": f"{c.serie}-{str(c.numero).zfill(8)}",
        "tipo_documento": c.tipo,
        "fecha_emision": c.fecha_emision.isoformat() if c.fecha_emision else None,
        "ruc_cliente": c.cliente_num_doc,
        "razon_social": c.cliente_nombre,
        "monto_total": total,
        "igv": igv,
        "base_imponible": subtotal,
        "estado": (c.status or "pending"),
    }


@router.get("/libro-ventas/{store_id}")
async def libro_ventas(
    store_id: int,
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2000, le=2100),
    db: Session = Depends(get_db),
    contador: Contador = Depends(get_current_contador),
):
    _ensure_contador_access(db, contador.id, store_id)
    comprobantes = _query_libro_ventas(db, store_id, mes, anio)

    rows = [_comprobante_dict(c) for c in comprobantes]
    total_ventas = sum(r["monto_total"] for r in rows)
    total_igv = sum(r["igv"] for r in rows)
    total_exonerado = sum(r["monto_total"] - r["igv"] - r["base_imponible"] for r in rows if r["igv"] == 0)
    if total_exonerado < 0:
        total_exonerado = sum(r["monto_total"] for r in rows if r["igv"] == 0)

    return {
        "periodo": f"{MESES_ES[mes - 1]} {anio}",
        "comprobantes": rows,
        "resumen": {
            "total_ventas": round(total_ventas, 2),
            "total_igv": round(total_igv, 2),
            "total_exonerado": round(total_exonerado, 2),
            "num_comprobantes": len(rows),
        },
    }


@router.get("/libro-ventas/{store_id}/export")
async def libro_ventas_export(
    store_id: int,
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2000, le=2100),
    formato: str = Query("csv"),
    db: Session = Depends(get_db),
    contador: Contador = Depends(get_current_contador),
):
    """Descarga CSV formato PLE SUNAT 14.1 (Registro de Ventas)."""
    _ensure_contador_access(db, contador.id, store_id)
    comprobantes = _query_libro_ventas(db, store_id, mes, anio)

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter="|", quoting=csv.QUOTE_MINIMAL)

    periodo = f"{anio}{str(mes).zfill(2)}00"
    for idx, c in enumerate(comprobantes, start=1):
        fecha = c.fecha_emision.strftime("%d/%m/%Y") if c.fecha_emision else ""
        tipo_doc_cliente = "1" if (c.cliente_num_doc and len(c.cliente_num_doc) == 8) else (
            "6" if c.cliente_num_doc and len(c.cliente_num_doc) == 11 else "0"
        )
        base = _to_float(c.subtotal)
        igv = _to_float(c.igv)
        total = _to_float(c.total)
        exonerado = total - base - igv
        if exonerado < 0:
            exonerado = 0.0

        writer.writerow([
            periodo,                          # 1  Periodo
            f"M{idx:09d}",                    # 2  CUO
            "M1",                             # 3  Correlativo
            fecha,                            # 4  Fecha emisión
            "",                               # 5  Fecha vencimiento
            c.tipo or "",                     # 6  Tipo CDP
            c.serie or "",                    # 7  Serie
            "",                               # 8  Año emisión DUA
            str(c.numero or ""),              # 9  Número
            "",                               # 10 Final rango
            tipo_doc_cliente,                 # 11 Tipo doc cliente
            c.cliente_num_doc or "",          # 12 Número doc cliente
            c.cliente_nombre or "",           # 13 Razón social
            f"{base:.2f}",                    # 14 Base imponible gravada
            "0.00",                           # 15 Descuento BI
            f"{igv:.2f}",                     # 16 IGV
            "0.00",                           # 17 Descuento IGV
            "0.00",                           # 18 Base imponible exportación
            f"{exonerado:.2f}",               # 19 Exonerada
            "0.00",                           # 20 Inafecta
            "0.00",                           # 21 ISC
            "0.00",                           # 22 ICBPER
            "0.00",                           # 23 Otros tributos
            f"{total:.2f}",                   # 24 Importe total
            (c.moneda or "PEN"),              # 25 Moneda
            "1.000",                          # 26 Tipo cambio
            "", "", "", "", "",               # 27-31 modificación referencia
            "1",                              # 32 Estado
        ])

    csv_bytes = buf.getvalue().encode("utf-8-sig")
    filename = f"LE{periodo}_14010000_{store_id}.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ──────────────────────────────────────────────────────────────────────────
# Resumen del cliente
# ──────────────────────────────────────────────────────────────────────────
@router.get("/resumen/{store_id}")
async def resumen_cliente(
    store_id: int,
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2000, le=2100),
    db: Session = Depends(get_db),
    contador: Contador = Depends(get_current_contador),
):
    _ensure_contador_access(db, contador.id, store_id)

    comprobantes = _query_libro_ventas(db, store_id, mes, anio)

    ventas_mes = sum(_to_float(c.total) for c in comprobantes)
    emitidos = len(comprobantes)
    pendientes = sum(1 for c in comprobantes if (c.status or "").lower() != "aceptado")

    # Ventas por día
    por_dia: dict = {}
    for c in comprobantes:
        if not c.fecha_emision:
            continue
        dia = c.fecha_emision.day
        por_dia[dia] = por_dia.get(dia, 0.0) + _to_float(c.total)
    ventas_por_dia = [{"dia": d, "total": round(por_dia[d], 2)} for d in sorted(por_dia)]

    # Top productos del periodo (vía sales/sale_items)
    top_rows = (
        db.query(
            Product.name.label("name"),
            func.sum(SaleItem.quantity).label("qty"),
            func.sum(SaleItem.subtotal).label("total"),
        )
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(Product, Product.id == SaleItem.product_id)
        .filter(
            Sale.store_id == store_id,
            func.extract("month", Sale.created_at) == mes,
            func.extract("year", Sale.created_at) == anio,
        )
        .group_by(Product.name)
        .order_by(func.sum(SaleItem.subtotal).desc())
        .limit(5)
        .all()
    )
    top_productos = [
        {"name": r.name, "qty": _to_float(r.qty), "total": round(_to_float(r.total), 2)}
        for r in top_rows
    ]

    return {
        "periodo": f"{MESES_ES[mes - 1]} {anio}",
        "ventas_mes": round(ventas_mes, 2),
        "comprobantes_emitidos": emitidos,
        "comprobantes_pendientes": pendientes,
        "ventas_por_dia": ventas_por_dia,
        "top_productos": top_productos,
    }
