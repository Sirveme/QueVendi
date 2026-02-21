# app/api/v1/billing.py
"""
Router de Facturación Electrónica - QueVendí
Endpoints para emisión de comprobantes vía facturalo.pro
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, List
from decimal import Decimal

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.billing import StoreBillingConfig, Comprobante
from app.services.billing_service import BillingService

router = APIRouter(prefix="/billing", tags=["billing"])


# ============================================
# SCHEMAS
# ============================================

class BillingConfigCreate(BaseModel):
    """Configuración de facturación"""
    ruc: str = Field(..., min_length=11, max_length=11)
    razon_social: str
    nombre_comercial: Optional[str] = None
    direccion: Optional[str] = None
    facturalo_url: str = "https://facturalo.pro/api/v1"
    facturalo_token: str
    facturalo_secret: str
    serie_boleta: str = "B001"
    serie_factura: str = "F001"
    tipo_afectacion_igv: str = "20"  # 10=Gravado, 20=Exonerado


class BillingConfigResponse(BaseModel):
    id: int
    store_id: int
    ruc: Optional[str]
    razon_social: Optional[str]
    nombre_comercial: Optional[str]
    serie_boleta: str
    serie_factura: str
    ultimo_numero_boleta: int
    ultimo_numero_factura: int
    is_active: bool
    is_verified: bool

    class Config:
        from_attributes = True


class EmitirComprobanteRequest(BaseModel):
    """Request para emitir comprobante"""
    sale_id: int
    tipo: str = "03"  # 03=Boleta, 01=Factura
    cliente_tipo_doc: str = "0"  # 0=Sin doc, 1=DNI, 6=RUC
    cliente_num_doc: str = "00000000"
    cliente_nombre: str = "CLIENTE VARIOS"
    cliente_direccion: Optional[str] = None
    cliente_email: Optional[str] = None


class ComprobanteResponse(BaseModel):
    id: int
    sale_id: int
    tipo: str
    serie: str
    numero: int
    numero_formato: str
    total: Decimal
    cliente_nombre: str
    status: str
    pdf_url: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


# ============================================
# ENDPOINTS - CONFIGURACIÓN
# ============================================

@router.get("/config")
async def get_billing_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener configuración de facturación de la tienda"""
    config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == current_user.store_id
    ).first()

    if not config:
        return {
            "configured": False,
            "message": "Facturación no configurada"
        }

    return {
        "configured": True,
        "config": {
            "id": config.id,
            "ruc": config.ruc,
            "razon_social": config.razon_social,
            "serie_boleta": config.serie_boleta,
            "serie_factura": config.serie_factura,
            "ultimo_numero_boleta": config.ultimo_numero_boleta,
            "ultimo_numero_factura": config.ultimo_numero_factura,
            "is_active": config.is_active,
            "is_verified": config.is_verified
        }
    }


@router.post("/config")
async def create_or_update_billing_config(
    config_data: BillingConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Crear o actualizar configuración de facturación"""
    # Solo owners pueden configurar
    if current_user.role not in ["owner", "admin"]:
        raise HTTPException(403, "Solo el dueño puede configurar facturación")

    config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == current_user.store_id
    ).first()

    if config:
        # Actualizar existente
        config.ruc = config_data.ruc
        config.razon_social = config_data.razon_social
        config.nombre_comercial = config_data.nombre_comercial
        config.direccion = config_data.direccion
        config.facturalo_url = config_data.facturalo_url
        config.facturalo_token = config_data.facturalo_token
        config.facturalo_secret = config_data.facturalo_secret
        config.serie_boleta = config_data.serie_boleta
        config.serie_factura = config_data.serie_factura
        config.tipo_afectacion_igv = config_data.tipo_afectacion_igv
        config.is_active = True
        config.is_verified = False
    else:
        # Crear nuevo
        config = StoreBillingConfig(
            store_id=current_user.store_id,
            ruc=config_data.ruc,
            razon_social=config_data.razon_social,
            nombre_comercial=config_data.nombre_comercial,
            direccion=config_data.direccion,
            facturalo_url=config_data.facturalo_url,
            facturalo_token=config_data.facturalo_token,
            facturalo_secret=config_data.facturalo_secret,
            serie_boleta=config_data.serie_boleta,
            serie_factura=config_data.serie_factura,
            tipo_afectacion_igv=config_data.tipo_afectacion_igv,
            is_active=True
        )
        db.add(config)

    db.commit()
    db.refresh(config)

    return {
        "success": True,
        "message": "Configuración guardada",
        "config_id": config.id
    }


@router.post("/config/verify")
async def verify_billing_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Verificar conexión con facturalo.pro"""
    service = BillingService(db, current_user.store_id)
    result = await service.verificar_conexion()

    if result["success"]:
        return {
            "success": True,
            "message": "Conexión exitosa",
            "empresa": result.get("empresa"),
            "ruc": result.get("ruc")
        }
    else:
        raise HTTPException(400, f"Error de conexión: {result.get('error')}")


# ============================================
# ENDPOINTS - EMISIÓN DE COMPROBANTES
# ============================================

@router.post("/emitir")
async def emitir_comprobante(
    request: EmitirComprobanteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Emitir comprobante electrónico para una venta"""
    service = BillingService(db, current_user.store_id)

    if not service.esta_configurado():
        raise HTTPException(400, "Facturación no configurada. Ve a Configuración > Facturación")

    result = await service.emitir_comprobante(
        sale_id=request.sale_id,
        tipo=request.tipo,
        cliente_tipo_doc=request.cliente_tipo_doc,
        cliente_num_doc=request.cliente_num_doc,
        cliente_nombre=request.cliente_nombre,
        cliente_direccion=request.cliente_direccion,
        cliente_email=request.cliente_email
    )

    if result["success"]:
        return {
            "success": True,
            "comprobante_id": result["comprobante_id"],
            "numero_formato": result["numero_formato"],
            "pdf_url": result["pdf_url"],
            "message": f"Comprobante {result['numero_formato']} emitido correctamente"
        }
    else:
        raise HTTPException(400, result.get("error", "Error al emitir comprobante"))


@router.post("/emitir/boleta/{sale_id}")
async def emitir_boleta_rapida(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Emitir boleta rápida (cliente genérico)"""
    try:
        service = BillingService(db, current_user.store_id)

        if not service.esta_configurado():
            raise HTTPException(400, "Facturación no configurada")

        result = await service.emitir_comprobante(sale_id, tipo="03")

        if result["success"]:
            return result
        else:
            raise HTTPException(400, result.get("error"))
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"[Billing] Error emitir boleta sale_id={sale_id}: {e}")
        raise HTTPException(500, f"Error interno al emitir boleta: {str(e)}")


@router.get("/comprobantes")
async def listar_comprobantes(
    limit: int = 50,
    offset: int = 0,
    tipo: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Listar comprobantes emitidos"""
    service = BillingService(db, current_user.store_id)
    comprobantes = service.listar_comprobantes(limit=limit, offset=offset, tipo=tipo)

    return {
        "count": len(comprobantes),
        "comprobantes": [
            {
                "id": c.id,
                "sale_id": c.sale_id,
                "tipo": c.tipo,
                "tipo_nombre": "Factura" if c.tipo == "01" else "Boleta",
                "numero_formato": c.numero_formato,
                "total": float(c.total),
                "cliente_nombre": c.cliente_nombre,
                "status": c.status,
                "pdf_url": c.pdf_url,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in comprobantes
        ]
    }


@router.get("/comprobante/{comprobante_id}")
async def get_comprobante(
    comprobante_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener detalle de un comprobante"""
    service = BillingService(db, current_user.store_id)
    comprobante = service.obtener_comprobante(comprobante_id)

    if not comprobante:
        raise HTTPException(404, "Comprobante no encontrado")

    return {
        "id": comprobante.id,
        "sale_id": comprobante.sale_id,
        "tipo": comprobante.tipo,
        "tipo_nombre": "Factura" if comprobante.tipo == "01" else "Boleta",
        "serie": comprobante.serie,
        "numero": comprobante.numero,
        "numero_formato": comprobante.numero_formato,
        "fecha_emision": comprobante.fecha_emision.isoformat() if comprobante.fecha_emision else None,
        "subtotal": float(comprobante.subtotal),
        "igv": float(comprobante.igv),
        "total": float(comprobante.total),
        "cliente": {
            "tipo_doc": comprobante.cliente_tipo_doc,
            "num_doc": comprobante.cliente_num_doc,
            "nombre": comprobante.cliente_nombre,
            "direccion": comprobante.cliente_direccion,
            "email": comprobante.cliente_email
        },
        "items": comprobante.items,
        "status": comprobante.status,
        "sunat_code": comprobante.sunat_response_code,
        "sunat_description": comprobante.sunat_response_description,
        "pdf_url": comprobante.pdf_url,
        "xml_url": comprobante.xml_url
    }


@router.get("/comprobante/{comprobante_id}/pdf")
async def proxy_comprobante_pdf(
    comprobante_id: int,
    formato: str = "A4",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Proxy para descargar PDF de facturalo.pro con autenticación.
    formato: A4, A5, TICKET
    """
    import httpx

    comprobante = db.query(Comprobante).filter(
        Comprobante.id == comprobante_id,
        Comprobante.store_id == current_user.store_id
    ).first()

    if not comprobante or not comprobante.pdf_url:
        raise HTTPException(404, "Comprobante o PDF no encontrado")

    config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == current_user.store_id
    ).first()

    if not config:
        raise HTTPException(400, "Configuración de facturación no encontrada")

    # Agregar formato a la URL de facturalo
    pdf_url = comprobante.pdf_url
    separator = "&" if "?" in pdf_url else "?"
    pdf_url_with_format = f"{pdf_url}{separator}formato={formato.upper()}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                pdf_url_with_format,
                headers={
                    "X-API-Key": config.facturalo_token,
                    "X-API-Secret": config.facturalo_secret
                }
            )

        if response.status_code != 200:
            raise HTTPException(502, "Error al obtener PDF de facturalo.pro")

        # Nombre: {RUC}_{SERIE}-{CORRELATIVO}_{FECHA}.pdf
        ruc = config.ruc or "00000000000"
        fecha_str = ""
        if comprobante.fecha_emision:
            fecha_str = comprobante.fecha_emision.strftime("%Y%m%d")
        elif comprobante.created_at:
            fecha_str = comprobante.created_at.strftime("%Y%m%d")
        filename = f"{ruc}_{comprobante.numero_formato}_{fecha_str}.pdf"

        return Response(
            content=response.content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{filename}"'
            }
        )
    except httpx.RequestError as e:
        raise HTTPException(502, f"Error de conexión con facturalo.pro: {str(e)}")


@router.get("/venta/{sale_id}/comprobante")
async def get_comprobante_por_venta(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Verificar si una venta tiene comprobante emitido"""
    service = BillingService(db, current_user.store_id)
    comprobante = service.obtener_comprobante_por_venta(sale_id)

    if not comprobante:
        return {"tiene_comprobante": False}

    return {
        "tiene_comprobante": True,
        "comprobante_id": comprobante.id,
        "numero_formato": comprobante.numero_formato,
        "tipo": comprobante.tipo,
        "pdf_url": comprobante.pdf_url,
        "status": comprobante.status
    }


# ============================================
# CONSULTA RUC/DNI
# ============================================

@router.get("/consulta/ruc/{ruc}")
async def consulta_ruc(
    ruc: str,
    current_user: User = Depends(get_current_user)
):
    """Consulta datos de empresa por RUC via SUNAT"""
    from app.services.validation_service import validation_service
    try:
        data = validation_service.validate_ruc(ruc)
        return {
            "success": True,
            "ruc": ruc,
            "razon_social": data.get("business_name", ""),
            "direccion": data.get("address", "")
        }
    except HTTPException as e:
        return {"success": False, "error": e.detail}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/consulta/dni/{dni}")
async def consulta_dni(
    dni: str,
    current_user: User = Depends(get_current_user)
):
    """Consulta datos de persona por DNI via RENIEC"""
    from app.services.validation_service import validation_service
    try:
        data = validation_service.validate_dni(dni)
        return {
            "success": True,
            "dni": dni,
            "nombre": data.get("full_name", "")
        }
    except HTTPException as e:
        return {"success": False, "error": e.detail}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# ENDPOINTS HTML (HTMX)
# ============================================

@router.get("/config/html", response_class=HTMLResponse)
async def billing_config_form(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Formulario de configuración de facturación (HTMX)"""
    config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == current_user.store_id
    ).first()

    if config:
        return HTMLResponse(f"""
        <div class="billing-config-card">
            <div class="config-header">
                <h3>⚡ Facturación Electrónica</h3>
                <span class="status-badge {'active' if config.is_active else 'inactive'}">
                    {'✓ Activo' if config.is_active else '○ Inactivo'}
                </span>
            </div>
            <div class="config-details">
                <p><strong>RUC:</strong> {config.ruc or 'No configurado'}</p>
                <p><strong>Razón Social:</strong> {config.razon_social or 'No configurado'}</p>
                <p><strong>Serie Boleta:</strong> {config.serie_boleta} (Último: {config.ultimo_numero_boleta})</p>
                <p><strong>Serie Factura:</strong> {config.serie_factura} (Último: {config.ultimo_numero_factura})</p>
            </div>
            <button class="btn-edit-config"
                    hx-get="/api/v1/billing/config/edit-form"
                    hx-target="#billing-config-container">
                ✏️ Editar configuración
            </button>
        </div>
        """)
    else:
        return HTMLResponse("""
        <div class="billing-config-empty">
            <div class="empty-icon">📄</div>
            <h3>Facturación no configurada</h3>
            <p>Configura tu conexión con facturalo.pro para emitir boletas y facturas electrónicas</p>
            <button class="btn-setup-billing"
                    hx-get="/api/v1/billing/config/setup-form"
                    hx-target="#billing-config-container">
                ⚙️ Configurar facturación
            </button>
        </div>
        """)
