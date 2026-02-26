"""
QueVendi - Endpoints para Offline PWA
======================================
3 endpoints:
1. GET /api/v1/health          → Ping para verificar conexión
2. GET /api/v1/products/catalog → Catálogo para sync offline
3. GET /v/{code}               → Página pública verificación comprobante

Ya registrado en main.py:
    from app.api.offline import router as offline_router
    from app.api.offline import verification_router
    app.include_router(offline_router)
    app.include_router(verification_router)
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional
import logging

# ── Imports QueVendi ──
from app.core.database import get_db
from app.models.product import Product
from app.models.sale import Sale
from app.models.billing import Comprobante
from app.api.dependencies import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)

# ============================================
# ROUTER API (bajo /api/v1)
# ============================================

router = APIRouter(prefix="/api/v1", tags=["offline"])

# ──────────────────────────────────────────────
# 1. HEALTH CHECK
# ──────────────────────────────────────────────

@router.get("/health")
async def health_check():
    """
    Ping ligero para verificar conectividad.
    OfflineSync hace ping aquí cada 10-30 segundos.
    Sin autenticación.
    """
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "quevendi"
    }


# ──────────────────────────────────────────────
# 2. CATÁLOGO DE PRODUCTOS (sync offline)
# ──────────────────────────────────────────────

@router.get("/products/catalog")
async def get_product_catalog(
    since: Optional[str] = Query(
        None,
        description="ISO timestamp. Si se envía, solo devuelve productos modificados después de esta fecha."
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Catálogo de productos filtrado por store_id del usuario.
    - Sin `since`: catálogo completo (primera carga)
    - Con `since`: solo cambios desde esa fecha (sync incremental)
    """
    store_id = current_user.store_id

    if not store_id:
        raise HTTPException(
            status_code=400,
            detail="Usuario no asociado a una tienda"
        )

    server_time = datetime.utcnow().isoformat()

    try:
        # Query base: solo productos de ESTA tienda
        query = db.query(Product).filter(
            Product.store_id == store_id
        )

        deleted_ids = []

        if since:
            try:
                since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            except ValueError:
                since_dt = datetime.utcnow() - timedelta(days=30)

            # Solo productos modificados después de `since`
            if hasattr(Product, 'updated_at'):
                query = query.filter(Product.updated_at > since_dt)

            # Soft delete si existe campo active
            try:
                deleted_query = db.query(Product.id).filter(
                    Product.store_id == store_id,
                    Product.active == False,
                    Product.updated_at > since_dt
                )
                deleted_ids = [row.id for row in deleted_query.all()]
            except Exception:
                pass

        products = query.all()

        # Serializar
        product_list = []
        for p in products:
            product_list.append({
                "id": p.id,
                "name": p.name,
                "barcode": getattr(p, 'barcode', None) or getattr(p, 'code', None),
                "sale_price": float(p.sale_price) if p.sale_price else 0,
                "purchase_price": float(getattr(p, 'purchase_price', 0) or 0),
                "stock": float(p.stock) if p.stock else 0,
                "unit": getattr(p, 'unit', 'unidad') or 'unidad',
                "category": getattr(p, 'category', None),
                "image_url": getattr(p, 'image_url', None),
                "allow_fractional": getattr(p, 'allow_fractional', False),
                "min_stock": getattr(p, 'min_stock_alert', 0) or 0,
                "active": getattr(p, 'active', True),
                "updated_at": p.updated_at.isoformat() if hasattr(p, 'updated_at') and p.updated_at else server_time
            })

        logger.info(
            f"[Catalog] Store {store_id}: {len(product_list)} productos"
            f"{f' (desde {since})' if since else ' (completo)'}"
            f", {len(deleted_ids)} eliminados"
        )

        return {
            "products": product_list,
            "deleted_ids": deleted_ids,
            "server_time": server_time,
            "store_id": store_id,
            "total": len(product_list),
            "is_full_sync": since is None
        }

    except Exception as e:
        logger.error(f"[Catalog] Error store {store_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ROUTER PÚBLICO (sin /api/v1)
# ============================================

verification_router = APIRouter(tags=["verificacion"])

# ──────────────────────────────────────────────
# 3. PÁGINA DE VERIFICACIÓN DE COMPROBANTE
# ──────────────────────────────────────────────

@verification_router.get("/v/{code}", response_class=HTMLResponse)
async def verificar_comprobante(
    code: str,
    db: Session = Depends(get_db)
):
    """
    Página pública donde el cliente consulta su comprobante.
    
    1. Cliente compra en bodega sin internet
    2. Recibe ticket con URL: quevendi.pro/v/VNT-20260226103500XX
    3. Cuando tiene señal, abre la URL
    4. Si ya se sincronizó → ve su boleta/factura + Descargar PDF
    5. Si aún no → ve mensaje "en proceso"
    """

    comprobante = None
    sale = None

    # Buscar en comprobantes (ya emitidos)
    try:
        comprobante = db.query(Comprobante).filter(
            Comprobante.verification_code == code
        ).first()
    except Exception:
        pass

    if not comprobante:
        # Buscar en ventas
        try:
            sale = db.query(Sale).filter(
                Sale.verification_code == code
            ).first()
        except Exception:
            pass

    return HTMLResponse(content=_render_verification_page(code, comprobante, sale))


def _render_verification_page(code: str, comprobante, sale) -> str:
    """Genera el HTML de la página de verificación."""

    # ── CASO 1: Comprobante emitido ──
    if comprobante:
        numero_formato = getattr(comprobante, 'numero_formato', None)
        if not numero_formato:
            serie = getattr(comprobante, 'serie', '????')
            numero = getattr(comprobante, 'numero', 0)
            numero_formato = f"{serie}-{str(numero).zfill(8)}"

        tipo = getattr(comprobante, 'tipo', '03')
        tipo_label = "Factura" if tipo == "01" else "Boleta de Venta"
        
        fecha_emision = getattr(comprobante, 'created_at', None)
        fecha = fecha_emision.strftime("%d/%m/%Y") if fecha_emision else "—"
        
        total_val = getattr(comprobante, 'total', 0)
        total = f"S/. {float(total_val):,.2f}" if total_val else "—"
        
        cliente_nombre = getattr(comprobante, 'cliente_nombre', '') or 'CLIENTE VARIOS'
        
        pdf_url = getattr(comprobante, 'pdf_url', '') or '#'

        status_html = f"""
            <div class="status-icon success">✅</div>
            <h1>Comprobante Disponible</h1>
            <p class="subtitle">Tu comprobante electrónico ha sido emitido correctamente</p>
            
            <div class="doc-card">
                <div class="doc-type">{tipo_label}</div>
                <div class="doc-number">{numero_formato}</div>
                <div class="doc-detail">
                    <span>Fecha:</span> <strong>{fecha}</strong>
                </div>
                <div class="doc-detail">
                    <span>Total:</span> <strong class="total">{total}</strong>
                </div>
                <div class="doc-detail">
                    <span>Cliente:</span> <strong>{cliente_nombre}</strong>
                </div>
            </div>
            
            <div class="actions">
                <a href="{pdf_url}" class="btn primary" target="_blank">
                    📄 Descargar PDF
                </a>
            </div>
            
            <div class="sunat-badge">
                ✓ Documento válido ante SUNAT
            </div>
        """

    # ── CASO 2: Venta sincronizada, comprobante pendiente ──
    elif sale:
        fecha = sale.created_at.strftime("%d/%m/%Y %H:%M") if sale.created_at else "—"
        total = f"S/. {float(sale.total):,.2f}" if sale.total else "—"

        status_html = f"""
            <div class="status-icon processing">⏳</div>
            <h1>Comprobante en Proceso</h1>
            <p class="subtitle">
                Tu venta fue registrada. El comprobante electrónico 
                se emitirá en las próximas horas.
            </p>
            
            <div class="doc-card pending">
                <div class="doc-type">Venta Registrada</div>
                <div class="doc-detail">
                    <span>Fecha:</span> <strong>{fecha}</strong>
                </div>
                <div class="doc-detail">
                    <span>Total:</span> <strong class="total">{total}</strong>
                </div>
                <div class="doc-detail">
                    <span>Código:</span> <strong>{code}</strong>
                </div>
            </div>
            
            <div class="info-box">
                <strong>💡 ¿Qué hacer?</strong><br>
                Vuelve a esta página en unas horas. Cuando tu 
                comprobante esté listo, podrás descargarlo aquí.
            </div>
            
            <button class="btn secondary" onclick="location.reload()">
                🔄 Verificar nuevamente
            </button>
        """

    # ── CASO 3: Venta aún no sincronizada ──
    else:
        status_html = f"""
            <div class="status-icon waiting">📡</div>
            <h1>Pendiente de Sincronización</h1>
            <p class="subtitle">
                Tu compra fue registrada en el punto de venta pero 
                aún no se ha sincronizado con el servidor.
            </p>
            
            <div class="doc-card waiting">
                <div class="doc-type">Código de Verificación</div>
                <div class="doc-number">{code}</div>
            </div>
            
            <div class="info-box">
                <strong>💡 ¿Por qué pasa esto?</strong><br>
                El negocio donde compraste tiene conexión 
                intermitente. Tu comprobante se emitirá 
                automáticamente cuando el local se conecte a internet.
                Esto normalmente ocurre dentro de las próximas 24 horas.
            </div>
            
            <button class="btn secondary" onclick="location.reload()">
                🔄 Verificar nuevamente
            </button>
        """

    # ── HTML completo ──
    auto_refresh = "<meta http-equiv='refresh' content='60'>" if not comprobante else ""
    auto_refresh_note = "<div class='auto-refresh'>Esta página se actualiza automáticamente cada 60 segundos</div>" if not comprobante else ""

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verificar Comprobante - {code}</title>
    <link rel="icon" href="/static/img/icon-192.png" type="image/png">
    {auto_refresh}
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%);
            color: #e2e8f0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 24px 16px;
        }}
        
        .container {{
            max-width: 440px;
            width: 100%;
            text-align: center;
        }}
        
        .logo {{
            font-size: 22px;
            font-weight: 700;
            color: #ff6b35;
            margin-bottom: 32px;
        }}
        .logo span {{ color: white; }}
        
        .status-icon {{
            font-size: 56px;
            margin-bottom: 16px;
        }}
        .status-icon.processing {{ animation: pulse 2s ease-in-out infinite; }}
        .status-icon.waiting {{ animation: pulse 3s ease-in-out infinite; }}
        
        @keyframes pulse {{
            0%, 100% {{ opacity: 1; transform: scale(1); }}
            50% {{ opacity: 0.7; transform: scale(1.05); }}
        }}
        
        h1 {{
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 8px;
        }}
        
        .subtitle {{
            color: #94a3b8;
            font-size: 15px;
            line-height: 1.5;
            margin-bottom: 28px;
            max-width: 360px;
            margin-left: auto;
            margin-right: auto;
        }}
        
        .doc-card {{
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
            text-align: left;
        }}
        .doc-card.pending {{
            border-color: rgba(245, 158, 11, 0.3);
            background: rgba(245, 158, 11, 0.05);
        }}
        .doc-card.waiting {{
            border-color: rgba(59, 130, 246, 0.3);
            background: rgba(59, 130, 246, 0.05);
            text-align: center;
        }}
        
        .doc-type {{
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: #64748b;
            margin-bottom: 8px;
        }}
        
        .doc-number {{
            font-size: 22px;
            font-weight: 700;
            color: #ff6b35;
            margin-bottom: 16px;
        }}
        
        .doc-detail {{
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            font-size: 14px;
        }}
        .doc-detail:last-child {{ border-bottom: none; }}
        .doc-detail span {{ color: #64748b; }}
        .doc-detail .total {{ color: #10b981; font-size: 18px; }}
        
        .actions {{
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }}
        
        .btn {{
            flex: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 20px;
            border-radius: 12px;
            font-size: 15px;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            border: none;
            transition: transform 0.2s;
        }}
        .btn:active {{ transform: scale(0.97); }}
        
        .btn.primary {{
            background: linear-gradient(135deg, #ff6b35, #ff8c42);
            color: white;
        }}
        .btn.secondary {{
            background: rgba(255, 255, 255, 0.1);
            color: #e2e8f0;
            border: 1px solid rgba(255, 255, 255, 0.15);
        }}
        
        .sunat-badge {{
            display: inline-block;
            padding: 8px 20px;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 20px;
            color: #10b981;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 20px;
        }}
        
        .info-box {{
            background: rgba(59, 130, 246, 0.08);
            border: 1px solid rgba(59, 130, 246, 0.2);
            border-radius: 12px;
            padding: 16px;
            font-size: 14px;
            line-height: 1.6;
            color: #94a3b8;
            margin-bottom: 20px;
            text-align: left;
        }}
        .info-box strong {{ color: #e2e8f0; }}
        
        .footer {{
            margin-top: 40px;
            font-size: 12px;
            color: #475569;
        }}
        .footer a {{
            color: #ff6b35;
            text-decoration: none;
        }}
        
        .auto-refresh {{
            font-size: 11px;
            color: #475569;
            margin-top: 12px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">Que<span>Vendi</span></div>
        
        {status_html}
        
        <div class="footer">
            Verificación de comprobante electrónico<br>
            Powered by <a href="https://facturalo.pro">facturalo.pro</a>
            {auto_refresh_note}
        </div>
    </div>
</body>
</html>"""