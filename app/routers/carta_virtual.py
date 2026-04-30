"""
QueVendi — Carta Virtual (pública)
===================================
Catálogo público de productos accesible sin autenticación.
URL: /carta/{telefono}

Rutas:
  GET  /carta/{telefono}                        → Template HTML
  GET  /api/public/carta/{telefono}/productos   → JSON productos agrupados
  GET  /api/public/carta/{telefono}/info         → JSON info del negocio
  POST /api/public/carta/{telefono}/visita       → Registrar visita

Registrar en main.py:
  from app.routers.carta_virtual import router as carta_router
  app.include_router(carta_router)
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import logging

from app.core.database import get_db
from app.models.store import Store
from app.models.product import Product
from app.models.user import User
from app.api.dependencies import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

# ════════════════════════════════════════════════
# MIGRACIÓN
# ════════════════════════════════════════════════
MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS carta_visitantes (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id),
    device_fingerprint VARCHAR(64),
    installed_pwa BOOLEAN DEFAULT FALSE,
    first_visit TIMESTAMP DEFAULT NOW(),
    last_visit TIMESTAMP DEFAULT NOW(),
    visit_count INTEGER DEFAULT 1,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE carta_visitantes ADD COLUMN IF NOT EXISTS nombre VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_carta_visitantes_store ON carta_visitantes(store_id);
CREATE INDEX IF NOT EXISTS idx_carta_visitantes_fp ON carta_visitantes(device_fingerprint, store_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='carta_pedidos') THEN
    ALTER TABLE carta_pedidos ADD COLUMN IF NOT EXISTS tipo_entrega VARCHAR(20);
    ALTER TABLE carta_pedidos ADD COLUMN IF NOT EXISTS direccion VARCHAR(300);
    ALTER TABLE carta_pedidos ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20);
    ALTER TABLE carta_pedidos ADD COLUMN IF NOT EXISTS comprobante_pdf_url VARCHAR(500);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS chat_mensajes (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id),
    device_fingerprint VARCHAR(64),
    mensaje TEXT NOT NULL,
    remitente VARCHAR(10) DEFAULT 'cliente',
    leido BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_store ON chat_mensajes(store_id);
"""

def _ensure_tables(db: Session):
    try:
        db.execute(text(MIGRATION_SQL))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[Carta] Migración: {e}")


# ════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════
def _get_store_by_phone(db: Session, telefono: str) -> Optional[Store]:
    return db.query(Store).filter(Store.phone == telefono, Store.is_active == True).first()


def _get_store_logo(db: Session, store_id: int) -> Optional[str]:
    try:
        row = db.execute(text(
            "SELECT logo FROM store_config WHERE store_id = :sid"
        ), {"sid": store_id}).fetchone()
        return row[0] if row and row[0] else None
    except Exception:
        return None


# ════════════════════════════════════════════════
# RUTAS HTML
# ════════════════════════════════════════════════

@router.get("/carta/{telefono}", response_class=HTMLResponse)
async def carta_virtual_page(
    telefono: str,
    request: Request,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        return HTMLResponse(content=f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>No encontrado — QueVendi</title>
<style>body{{font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;color:#334155;text-align:center}}
.box{{max-width:400px;padding:40px}}.box h1{{font-size:3rem;margin-bottom:8px;color:#ef4444}}.box p{{color:#64748b;margin-bottom:20px}}
a{{color:#10b981;text-decoration:none;font-weight:600}}</style></head>
<body><div class="box"><h1>404</h1><h2>Negocio no encontrado</h2>
<p>El numero <strong>{telefono}</strong> no tiene carta virtual activa.</p>
<a href="https://quevendi.pro">Crear mi carta en QueVendi.pro</a></div></body></html>""", status_code=404)

    from fastapi.templating import Jinja2Templates
    templates = Jinja2Templates(directory="app/templates")
    return templates.TemplateResponse("carta_virtual.html", {
        "request": request,
        "telefono": telefono,
        "store_name": store.commercial_name or store.business_name,
        "store_id": store.id,
    })


# ════════════════════════════════════════════════
# API PÚBLICA (sin JWT)
# ════════════════════════════════════════════════

@router.get("/api/public/carta/{telefono}/productos")
async def carta_productos(telefono: str, db: Session = Depends(get_db)):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    products = db.query(Product).filter(
        Product.store_id == store.id,
        Product.is_active == True
    ).order_by(Product.category, Product.name).all()

    # Agrupar por categoría
    categorias = {}
    for p in products:
        cat = p.category or "Otros"
        if cat not in categorias:
            categorias[cat] = []
        categorias[cat].append({
            "id": p.id,
            "name": p.name,
            "price": float(p.sale_price),
            "category": cat,
            "description": p.description if hasattr(p, 'description') else None,
            "stock": p.stock,
        })

    return {"categorias": categorias, "total": len(products)}


@router.get("/api/public/carta/{telefono}/info")
async def carta_info(telefono: str, db: Session = Depends(get_db)):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    logo = _get_store_logo(db, store.id)

    # Dirección y datos extra de store_config
    extra = {}
    modo_gratuito = False
    modo_gratuito_limite = 1
    modo_gratuito_mensaje = "🎉 ¡Producto de cortesía en nuestra inauguración!"
    delivery_contraentrega = False
    try:
        row = db.execute(text(
            "SELECT direccion, distrito, provincia, departamento, giro, slogan, "
            "modo_gratuito, modo_gratuito_limite, modo_gratuito_mensaje, "
            "delivery_pago_contraentrega "
            "FROM store_config WHERE store_id = :sid"
        ), {"sid": store.id}).fetchone()
        if row:
            extra = {
                "direccion": row[0] or store.address,
                "distrito": row[1],
                "provincia": row[2],
                "departamento": row[3],
                "giro": row[4],
                "slogan": row[5],
            }
            if row[6] is not None:
                modo_gratuito = bool(row[6])
            if row[7] is not None:
                modo_gratuito_limite = int(row[7])
            if row[8]:
                modo_gratuito_mensaje = row[8]
            if row[9] is not None:
                delivery_contraentrega = bool(row[9])
    except Exception:
        pass

    return {
        "nombre": store.commercial_name or store.business_name,
        "razon_social": store.business_name,
        "direccion": extra.get("direccion") or store.address or "",
        "distrito": extra.get("distrito") or "",
        "telefono": store.phone,
        "logo": logo,
        "giro": extra.get("giro") or "",
        "slogan": extra.get("slogan") or "",
        "modo_gratuito": modo_gratuito,
        "modo_gratuito_limite": modo_gratuito_limite,
        "modo_gratuito_mensaje": modo_gratuito_mensaje,
        "delivery_contraentrega": delivery_contraentrega,
    }


# ════════════════════════════════════════════════
# REGISTRO DE VISITAS
# ════════════════════════════════════════════════

class VisitaRequest(BaseModel):
    device_fingerprint: str
    installed_pwa: bool = False

@router.post("/api/public/carta/{telefono}/visita")
async def registrar_visita(
    telefono: str,
    data: VisitaRequest,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    _ensure_tables(db)

    existing = db.execute(text("""
        SELECT id, visit_count FROM carta_visitantes
        WHERE store_id = :sid AND device_fingerprint = :fp
    """), {"sid": store.id, "fp": data.device_fingerprint}).fetchone()

    if existing:
        db.execute(text("""
            UPDATE carta_visitantes
            SET last_visit = NOW(), visit_count = visit_count + 1,
                installed_pwa = :pwa
            WHERE id = :id
        """), {"pwa": data.installed_pwa, "id": existing.id})
    else:
        db.execute(text("""
            INSERT INTO carta_visitantes (store_id, device_fingerprint, installed_pwa)
            VALUES (:sid, :fp, :pwa)
        """), {"sid": store.id, "fp": data.device_fingerprint, "pwa": data.installed_pwa})

    db.commit()
    return {"ok": True}


# ════════════════════════════════════════════════
# CHAT DE PEDIDOS
# ════════════════════════════════════════════════

class ChatRequest(BaseModel):
    device_fingerprint: str
    mensaje: str

@router.post("/api/public/carta/{telefono}/pedido-chat")
async def pedido_chat(
    telefono: str,
    data: ChatRequest,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    _ensure_tables(db)

    # Guardar mensaje del cliente
    db.execute(text("""
        INSERT INTO chat_mensajes (store_id, device_fingerprint, mensaje, remitente)
        VALUES (:sid, :fp, :msg, 'cliente')
    """), {"sid": store.id, "fp": data.device_fingerprint, "msg": data.mensaje})

    # Detectar si es número de teléfono (9 dígitos)
    clean = data.mensaje.strip().replace(" ", "")
    if clean.isdigit() and len(clean) == 9:
        # Guardar teléfono del visitante
        db.execute(text("""
            UPDATE carta_visitantes SET phone = :phone
            WHERE store_id = :sid AND device_fingerprint = :fp
        """), {"phone": clean, "sid": store.id, "fp": data.device_fingerprint})
        db.commit()

        respuesta = f"📱 Perfecto, te contactamos al {clean}. ¡Gracias!"
    else:
        respuesta = "✅ ¡Recibido! Procesamos tu pedido.\n¿A qué número te avisamos cuando esté listo?"

    # Guardar respuesta automática
    db.execute(text("""
        INSERT INTO chat_mensajes (store_id, device_fingerprint, mensaje, remitente)
        VALUES (:sid, :fp, :msg, 'bot')
    """), {"sid": store.id, "fp": data.device_fingerprint, "msg": respuesta})
    db.commit()

    return {"respuesta": respuesta}


# ════════════════════════════════════════════════
# MODO GRATUITO — INAUGURACIÓN
# ════════════════════════════════════════════════

class IdentificarRequest(BaseModel):
    celular: str
    nombre: str
    device_fingerprint: Optional[str] = None


@router.post("/api/public/carta/{telefono}/identificar")
async def identificar_cliente(
    telefono: str,
    data: IdentificarRequest,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    celular = (data.celular or "").strip().replace(" ", "")
    nombre = (data.nombre or "").strip()
    if not celular.isdigit() or len(celular) != 9:
        raise HTTPException(400, "Celular inválido (9 dígitos)")
    if len(nombre) < 2:
        raise HTTPException(400, "Nombre inválido")

    _ensure_tables(db)

    fp = data.device_fingerprint or ""
    cliente_id = None

    if fp:
        row = db.execute(text("""
            SELECT id FROM carta_visitantes
            WHERE store_id = :sid AND device_fingerprint = :fp
        """), {"sid": store.id, "fp": fp}).fetchone()
        if row:
            cliente_id = row[0]
            db.execute(text("""
                UPDATE carta_visitantes
                SET phone = :ph, nombre = :nm, last_visit = NOW()
                WHERE id = :id
            """), {"ph": celular, "nm": nombre, "id": cliente_id})
        else:
            ins = db.execute(text("""
                INSERT INTO carta_visitantes (store_id, device_fingerprint, phone, nombre)
                VALUES (:sid, :fp, :ph, :nm) RETURNING id
            """), {"sid": store.id, "fp": fp, "ph": celular, "nm": nombre})
            cliente_id = ins.fetchone()[0]
    db.commit()

    # Pedidos previos del celular en esta tienda
    try:
        pedidos_count = db.execute(text("""
            SELECT COUNT(*) FROM carta_pedidos
            WHERE store_id = :sid AND cliente_celular = :cel
        """), {"sid": store.id, "cel": celular}).scalar() or 0
    except Exception:
        pedidos_count = 0

    # Límite de modo gratuito
    limite = 1
    try:
        r = db.execute(text(
            "SELECT modo_gratuito_limite FROM store_config WHERE store_id = :sid"
        ), {"sid": store.id}).fetchone()
        if r and r[0] is not None:
            limite = int(r[0])
    except Exception:
        pass

    return {
        "cliente_id": cliente_id,
        "celular": celular,
        "nombre": nombre,
        "pedidos_realizados": int(pedidos_count),
        "limite": limite,
    }


class PedirGratisRequest(BaseModel):
    celular: str
    nombre: str
    producto_id: int
    cantidad: int = 1
    tipo_entrega: Optional[str] = None  # 'recojo' | 'delivery'
    direccion: Optional[str] = None
    device_fingerprint: Optional[str] = None


@router.post("/api/public/carta/{telefono}/pedir-gratis")
async def pedir_gratis(
    telefono: str,
    data: PedirGratisRequest,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    celular = (data.celular or "").strip().replace(" ", "")
    nombre = (data.nombre or "").strip()
    if not celular.isdigit() or len(celular) != 9:
        raise HTTPException(400, "Celular inválido")
    if not nombre:
        raise HTTPException(400, "Nombre requerido")
    if data.cantidad < 1:
        raise HTTPException(400, "Cantidad inválida")

    _ensure_tables(db)

    # Verificar modo gratuito + límite
    cfg = db.execute(text("""
        SELECT COALESCE(modo_gratuito, FALSE),
               COALESCE(modo_gratuito_limite, 1)
        FROM store_config WHERE store_id = :sid
    """), {"sid": store.id}).fetchone()
    if not cfg or not cfg[0]:
        return {"ok": False, "mensaje": "Esta tienda no tiene cortesía activa en este momento."}
    limite = int(cfg[1])

    pedidos_prev = db.execute(text("""
        SELECT COUNT(*) FROM carta_pedidos
        WHERE store_id = :sid AND cliente_celular = :cel
    """), {"sid": store.id, "cel": celular}).scalar() or 0
    if int(pedidos_prev) >= limite:
        return {"ok": False, "mensaje": "Ya alcanzaste tu límite de cortesía 😊"}

    # Verificar producto + stock
    prod = db.query(Product).filter(
        Product.id == data.producto_id,
        Product.store_id == store.id,
        Product.is_active == True,
    ).first()
    if not prod:
        return {"ok": False, "mensaje": "Producto no disponible"}
    if prod.stock < data.cantidad:
        return {"ok": False, "mensaje": "Se agotó este producto"}

    # Insertar pedido (sin descontar stock)
    tipo_entrega = (data.tipo_entrega or "").strip().lower() or None
    if tipo_entrega and tipo_entrega not in ("recojo", "delivery"):
        tipo_entrega = None
    direccion = (data.direccion or "").strip() or None
    ins = db.execute(text("""
        INSERT INTO carta_pedidos
            (store_id, cliente_celular, cliente_nombre, producto_id, producto_nombre,
             cantidad, tipo, estado, tipo_entrega, direccion)
        VALUES (:sid, :cel, :nm, :pid, :pname, :cant, 'gratuito', 'pendiente', :te, :dir)
        RETURNING id
    """), {
        "sid": store.id, "cel": celular, "nm": nombre,
        "pid": prod.id, "pname": prod.name, "cant": data.cantidad,
        "te": tipo_entrega, "dir": direccion,
    })
    pedido_id = ins.fetchone()[0]

    # Actualizar visitante con celular/nombre si tenemos fp
    fp = data.device_fingerprint or ""
    if fp:
        db.execute(text("""
            UPDATE carta_visitantes
            SET phone = :ph, nombre = :nm, last_visit = NOW()
            WHERE store_id = :sid AND device_fingerprint = :fp
        """), {"ph": celular, "nm": nombre, "sid": store.id, "fp": fp})

    db.commit()

    pedidos_restantes = max(limite - int(pedidos_prev) - 1, 0)
    return {
        "ok": True,
        "pedido_id": pedido_id,
        "mensaje": "✅ ¡Pedido recibido! Te avisamos cuando esté listo.",
        "pedidos_restantes": pedidos_restantes,
    }


# ─── Pedido pagado (Ropa o cuando modo gratuito apagado) ───
class PedirPagoRequest(BaseModel):
    celular: str
    nombre: str
    producto_id: int
    cantidad: int = 1
    metodo_pago: Optional[str] = None  # 'yape' | 'transferencia' | 'efectivo'
    tipo_entrega: Optional[str] = None  # 'recojo' | 'delivery'
    direccion: Optional[str] = None
    device_fingerprint: Optional[str] = None


@router.post("/api/public/carta/{telefono}/pedir-pago")
async def pedir_pago(
    telefono: str,
    data: PedirPagoRequest,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    celular = (data.celular or "").strip().replace(" ", "")
    nombre = (data.nombre or "").strip()
    if not celular.isdigit() or len(celular) != 9:
        raise HTTPException(400, "Celular inválido")
    if not nombre:
        raise HTTPException(400, "Nombre requerido")
    if data.cantidad < 1:
        raise HTTPException(400, "Cantidad inválida")

    metodo_pago = (data.metodo_pago or "").strip().lower() or None
    if metodo_pago and metodo_pago not in ("yape", "transferencia", "efectivo"):
        return {"ok": False, "mensaje": "Método de pago inválido"}

    tipo_entrega = (data.tipo_entrega or "").strip().lower() or None
    if tipo_entrega and tipo_entrega not in ("recojo", "delivery"):
        tipo_entrega = None
    direccion = (data.direccion or "").strip() or None
    if tipo_entrega == "delivery" and not direccion:
        return {"ok": False, "mensaje": "Falta la dirección de entrega"}

    _ensure_tables(db)

    prod = db.query(Product).filter(
        Product.id == data.producto_id,
        Product.store_id == store.id,
        Product.is_active == True,
    ).first()
    if not prod:
        return {"ok": False, "mensaje": "Producto no disponible"}
    if prod.stock < data.cantidad:
        return {"ok": False, "mensaje": "Se agotó este producto"}

    ins = db.execute(text("""
        INSERT INTO carta_pedidos
            (store_id, cliente_celular, cliente_nombre, producto_id, producto_nombre,
             cantidad, tipo, estado, tipo_entrega, direccion, metodo_pago)
        VALUES (:sid, :cel, :nm, :pid, :pname, :cant, 'pago', 'pendiente', :te, :dir, :mp)
        RETURNING id
    """), {
        "sid": store.id, "cel": celular, "nm": nombre,
        "pid": prod.id, "pname": prod.name, "cant": data.cantidad,
        "te": tipo_entrega, "dir": direccion, "mp": metodo_pago,
    })
    pedido_id = ins.fetchone()[0]

    fp = data.device_fingerprint or ""
    if fp:
        db.execute(text("""
            UPDATE carta_visitantes
            SET phone = :ph, nombre = :nm, last_visit = NOW()
            WHERE store_id = :sid AND device_fingerprint = :fp
        """), {"ph": celular, "nm": nombre, "sid": store.id, "fp": fp})

    db.commit()
    return {
        "ok": True,
        "pedido_id": pedido_id,
        "mensaje": "✅ ¡Pedido recibido! Te contactamos pronto.",
    }


@router.get("/api/public/carta/{telefono}/mis-pedidos/{celular}")
async def mis_pedidos(
    telefono: str,
    celular: str,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    celular = (celular or "").strip().replace(" ", "")
    if not celular.isdigit() or len(celular) != 9:
        raise HTTPException(400, "Celular inválido")

    try:
        rows = db.execute(text("""
            SELECT id, producto_nombre, cantidad, estado, tipo, created_at, confirmado_at
            FROM carta_pedidos
            WHERE store_id = :sid AND cliente_celular = :cel
            ORDER BY created_at DESC
            LIMIT 50
        """), {"sid": store.id, "cel": celular}).fetchall()
    except Exception:
        return {"pedidos": []}

    pedidos = [{
        "id": r[0],
        "producto_nombre": r[1],
        "cantidad": r[2],
        "estado": r[3],
        "tipo": r[4],
        "created_at": r[5].isoformat() if r[5] else None,
        "confirmado_at": r[6].isoformat() if r[6] else None,
    } for r in rows]
    return {"pedidos": pedidos}


# ════════════════════════════════════════════════
# QR DESCARGABLE PARA INAUGURACIÓN
# ════════════════════════════════════════════════

@router.get("/carta/{telefono}/qr", response_class=HTMLResponse)
async def carta_qr(
    telefono: str,
    request: Request,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    nombre = store.commercial_name or store.business_name
    logo = _get_store_logo(db, store.id) or ""
    base = str(request.base_url).rstrip("/")
    carta_url = f"{base}/carta/{telefono}"
    iniciales = "".join(w[0] for w in nombre.split()[:2]).upper() or "QV"

    if logo:
        logo_html = f'<img class="logo" src="{logo}" alt="{nombre}">'
    else:
        logo_html = f'<div class="logo-ph">{iniciales}</div>'

    html = f"""<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>QR — {nombre}</title>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Segoe UI',sans-serif;background:#F0F4F0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#1A1A2E}}
.card{{background:#fff;border-radius:24px;padding:40px 32px;text-align:center;max-width:480px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.08)}}
.logo{{width:96px;height:96px;border-radius:50%;object-fit:cover;margin:0 auto 14px;display:block;border:3px solid #00C853}}
.logo-ph{{width:96px;height:96px;border-radius:50%;background:#E8F5E9;color:#00C853;font-size:2.2rem;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}}
.name{{font-size:1.5rem;font-weight:800;margin-bottom:4px}}
.tag{{font-size:.85rem;color:#6B7280;margin-bottom:24px}}
#qr{{display:flex;justify-content:center;margin:0 auto 24px;background:#fff;padding:14px;border-radius:16px;border:2px solid #E5E7EB;width:fit-content}}
.cta{{font-size:1.15rem;font-weight:700;color:#00C853;margin-bottom:6px}}
.url{{font-size:.78rem;color:#94A3B8;word-break:break-all;margin-bottom:24px}}
.btn{{background:#00C853;color:#fff;border:none;padding:14px 32px;border-radius:50px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit}}
.btn:hover{{background:#00962E}}
@media print{{
  body{{background:#fff;padding:0}}
  .card{{box-shadow:none;border:none;padding:30px;max-width:100%}}
  .btn,.no-print{{display:none !important}}
  #qr{{border:none}}
}}
</style></head>
<body>
<div class="card">
  {logo_html}
  <div class="name">{nombre}</div>
  <div class="tag">Carta Virtual</div>
  <div id="qr"></div>
  <div class="cta">📱 Escanea y pide tu cortesía 🎉</div>
  <div class="url">{carta_url}</div>
  <button class="btn no-print" onclick="window.print()">🖨️ Imprimir</button>
</div>
<script>
new QRCode(document.getElementById('qr'), {{
  text: {carta_url!r},
  width: 280,
  height: 280,
  colorDark: '#1A1A2E',
  colorLight: '#FFFFFF',
  correctLevel: QRCode.CorrectLevel.H
}});
</script>
</body></html>"""
    return HTMLResponse(content=html)


# ════════════════════════════════════════════════
# DASHBOARD — GESTIÓN DE PEDIDOS (con JWT)
# ════════════════════════════════════════════════

def _verificar_pedido_propio(db: Session, pedido_id: int, store_id: int):
    row = db.execute(text("""
        SELECT id, producto_id, cantidad, estado FROM carta_pedidos
        WHERE id = :pid AND store_id = :sid
    """), {"pid": pedido_id, "sid": store_id}).fetchone()
    if not row:
        raise HTTPException(404, "Pedido no encontrado")
    return row


@router.get("/api/v1/carta/pedidos/pendientes")
async def listar_pedidos_panel(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pedidos activos del store (pendiente + confirmado + listo de últimas 24h)."""
    try:
        rows = db.execute(text("""
            SELECT id, cliente_nombre, cliente_celular, producto_id, producto_nombre,
                   cantidad, estado, tipo, created_at, confirmado_at,
                   EXTRACT(EPOCH FROM (NOW() - created_at))/60 AS minutos_esperando,
                   tipo_entrega, direccion, metodo_pago, comprobante_numero
            FROM carta_pedidos
            WHERE store_id = :sid
              AND (
                estado IN ('pendiente', 'confirmado')
                OR (estado = 'listo' AND created_at > NOW() - INTERVAL '24 hours')
              )
            ORDER BY created_at DESC
            LIMIT 100
        """), {"sid": current_user.store_id}).fetchall()
    except Exception as e:
        logger.warning(f"[Pedidos panel] {e}")
        return {"pedidos": []}

    pedidos = [{
        "id": r[0],
        "cliente_nombre": r[1],
        "cliente_celular": r[2],
        "producto_id": r[3],
        "producto_nombre": r[4],
        "cantidad": r[5],
        "estado": r[6],
        "tipo": r[7],
        "created_at": r[8].isoformat() if r[8] else None,
        "confirmado_at": r[9].isoformat() if r[9] else None,
        "minutos_esperando": int(r[10] or 0),
        "tipo_entrega": r[11],
        "direccion": r[12],
        "metodo_pago": r[13],
        "comprobante_numero": r[14],
    } for r in rows]
    return {"pedidos": pedidos}


@router.post("/api/v1/carta/pedidos/{pedido_id}/confirmar")
async def confirmar_pedido(
    pedido_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pedido = _verificar_pedido_propio(db, pedido_id, current_user.store_id)
    if pedido[3] != "pendiente":
        raise HTTPException(400, f"Pedido ya está en estado '{pedido[3]}'")

    prod = db.execute(text(
        "SELECT stock FROM products WHERE id = :pid AND store_id = :sid"
    ), {"pid": pedido[1], "sid": current_user.store_id}).fetchone()
    if not prod:
        raise HTTPException(400, "Producto no existe")
    if int(prod[0] or 0) < int(pedido[2]):
        raise HTTPException(400, "Stock insuficiente para confirmar")

    db.execute(text("""
        UPDATE products SET stock = stock - :cant
        WHERE id = :pid AND store_id = :sid
    """), {"cant": pedido[2], "pid": pedido[1], "sid": current_user.store_id})
    db.execute(text("""
        UPDATE carta_pedidos
        SET estado = 'confirmado', confirmado_por = :uid, confirmado_at = NOW()
        WHERE id = :pid
    """), {"uid": current_user.id, "pid": pedido_id})
    db.commit()
    return {"ok": True, "pedido_id": pedido_id, "estado": "confirmado"}


@router.post("/api/v1/carta/pedidos/{pedido_id}/listo")
async def marcar_listo(
    pedido_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pedido = _verificar_pedido_propio(db, pedido_id, current_user.store_id)
    if pedido[3] not in ("confirmado", "pendiente"):
        raise HTTPException(400, f"No se puede marcar listo desde '{pedido[3]}'")
    db.execute(text("""
        UPDATE carta_pedidos SET estado = 'listo' WHERE id = :pid
    """), {"pid": pedido_id})
    db.commit()
    return {"ok": True, "pedido_id": pedido_id, "estado": "listo"}


@router.post("/api/v1/carta/pedidos/{pedido_id}/rechazar")
async def rechazar_pedido(
    pedido_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pedido = _verificar_pedido_propio(db, pedido_id, current_user.store_id)
    if pedido[3] in ("rechazado", "listo"):
        raise HTTPException(400, f"Pedido ya cerrado: '{pedido[3]}'")
    # Si estaba confirmado, devolver stock (se había descontado al confirmar)
    if pedido[3] == "confirmado":
        db.execute(text("""
            UPDATE products SET stock = stock + :cant
            WHERE id = :pid AND store_id = :sid
        """), {"cant": pedido[2], "pid": pedido[1], "sid": current_user.store_id})
    db.execute(text("""
        UPDATE carta_pedidos SET estado = 'rechazado' WHERE id = :pid
    """), {"pid": pedido_id})
    db.commit()
    return {"ok": True, "pedido_id": pedido_id, "estado": "rechazado"}


@router.get("/api/v1/carta/pedidos/stats")
async def stats_pedidos(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Estadísticas del día (sólo del store del usuario) + producto top de la semana."""
    try:
        row = db.execute(text("""
            SELECT
              COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS total_hoy,
              COUNT(*) FILTER (WHERE estado='confirmado' AND created_at::date = CURRENT_DATE) AS confirmados_hoy,
              COUNT(*) FILTER (WHERE estado='rechazado' AND created_at::date = CURRENT_DATE) AS rechazados_hoy,
              COUNT(*) FILTER (WHERE estado='listo' AND created_at::date = CURRENT_DATE) AS listos_hoy
            FROM carta_pedidos
            WHERE store_id = :sid
        """), {"sid": current_user.store_id}).fetchone()
        top = db.execute(text("""
            SELECT producto_nombre, COUNT(*) AS n
            FROM carta_pedidos
            WHERE store_id = :sid AND created_at > NOW() - INTERVAL '7 days'
            GROUP BY producto_nombre
            ORDER BY n DESC LIMIT 1
        """), {"sid": current_user.store_id}).fetchone()
    except Exception:
        return {
            "total_hoy": 0, "confirmados_hoy": 0,
            "rechazados_hoy": 0, "listos_hoy": 0,
            "producto_top": None,
        }
    return {
        "total_hoy": int(row[0] or 0),
        "confirmados_hoy": int(row[1] or 0),
        "rechazados_hoy": int(row[2] or 0),
        "listos_hoy": int(row[3] or 0),
        "producto_top": top[0] if top else None,
    }


# ─── Configuración modo gratuito ───
@router.get("/api/v1/carta/config/gratuito")
async def get_config_gratuito(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "owner":
        raise HTTPException(403, "Solo el dueño puede ver esta configuración")
    try:
        row = db.execute(text("""
            SELECT modo_gratuito, modo_gratuito_limite, modo_gratuito_mensaje,
                   delivery_pago_contraentrega
            FROM store_config WHERE store_id = :sid
        """), {"sid": current_user.store_id}).fetchone()
    except Exception:
        row = None
    if not row:
        return {
            "modo_gratuito": False,
            "modo_gratuito_limite": 1,
            "modo_gratuito_mensaje": "🎉 ¡Producto de cortesía en nuestra inauguración!",
            "delivery_pago_contraentrega": False,
        }
    return {
        "modo_gratuito": bool(row[0]) if row[0] is not None else False,
        "modo_gratuito_limite": int(row[1]) if row[1] is not None else 1,
        "modo_gratuito_mensaje": row[2] or "🎉 ¡Producto de cortesía en nuestra inauguración!",
        "delivery_pago_contraentrega": bool(row[3]) if row[3] is not None else False,
    }


# ─── Configuración delivery ───
class ConfigDeliveryRequest(BaseModel):
    delivery_pago_contraentrega: bool


@router.put("/api/v1/carta/config/delivery")
async def set_config_delivery(
    data: ConfigDeliveryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "owner":
        raise HTTPException(403, "Solo el dueño puede modificar esta configuración")
    try:
        existing = db.execute(text(
            "SELECT id FROM store_config WHERE store_id = :sid"
        ), {"sid": current_user.store_id}).fetchone()
        if existing:
            db.execute(text("""
                UPDATE store_config
                SET delivery_pago_contraentrega = :val,
                    updated_at = NOW()
                WHERE store_id = :sid
            """), {"val": data.delivery_pago_contraentrega, "sid": current_user.store_id})
        else:
            db.execute(text("""
                INSERT INTO store_config (store_id, delivery_pago_contraentrega)
                VALUES (:sid, :val)
            """), {"sid": current_user.store_id, "val": data.delivery_pago_contraentrega})
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Error guardando configuración: {e}")

    return {"ok": True, "delivery_pago_contraentrega": data.delivery_pago_contraentrega}


class ConfigGratuitoRequest(BaseModel):
    modo_gratuito: bool
    modo_gratuito_limite: int = 1
    modo_gratuito_mensaje: Optional[str] = None


@router.put("/api/v1/carta/config/gratuito")
async def set_config_gratuito(
    data: ConfigGratuitoRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "owner":
        raise HTTPException(403, "Solo el dueño puede modificar esta configuración")
    if data.modo_gratuito_limite < 1 or data.modo_gratuito_limite > 5:
        raise HTTPException(400, "Límite debe estar entre 1 y 5")

    try:
        existing = db.execute(text(
            "SELECT id FROM store_config WHERE store_id = :sid"
        ), {"sid": current_user.store_id}).fetchone()
        if existing:
            db.execute(text("""
                UPDATE store_config
                SET modo_gratuito = :mg,
                    modo_gratuito_limite = :lim,
                    modo_gratuito_mensaje = COALESCE(:msg, modo_gratuito_mensaje),
                    updated_at = NOW()
                WHERE store_id = :sid
            """), {
                "mg": data.modo_gratuito,
                "lim": data.modo_gratuito_limite,
                "msg": data.modo_gratuito_mensaje,
                "sid": current_user.store_id,
            })
        else:
            db.execute(text("""
                INSERT INTO store_config (store_id, modo_gratuito, modo_gratuito_limite, modo_gratuito_mensaje)
                VALUES (:sid, :mg, :lim, COALESCE(:msg, '🎉 ¡Producto de cortesía en nuestra inauguración!'))
            """), {
                "sid": current_user.store_id,
                "mg": data.modo_gratuito,
                "lim": data.modo_gratuito_limite,
                "msg": data.modo_gratuito_mensaje,
            })
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Error guardando configuración: {e}")

    return {
        "ok": True,
        "modo_gratuito": data.modo_gratuito,
        "modo_gratuito_limite": data.modo_gratuito_limite,
        "modo_gratuito_mensaje": data.modo_gratuito_mensaje,
    }


# ════════════════════════════════════════════════
# COMPROBANTE SUNAT — Pedidos de carta
# ════════════════════════════════════════════════
# Llama directamente a facturalo.pro porque BillingService.emitir_comprobante
# requiere un sale_id real (carta_pedidos no genera ventas en la tabla sales).

@router.post("/api/v1/carta/pedidos/{pedido_id}/emitir-comprobante")
async def emitir_comprobante_pedido(
    pedido_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    import httpx
    from datetime import datetime, timezone, timedelta
    from app.models.billing import StoreBillingConfig

    TZ_PERU = timezone(timedelta(hours=-5))

    pedido = db.execute(text("""
        SELECT id, producto_id, producto_nombre, cantidad, tipo, estado,
               cliente_nombre, cliente_celular, comprobante_numero
        FROM carta_pedidos
        WHERE id = :pid AND store_id = :sid
    """), {"pid": pedido_id, "sid": current_user.store_id}).fetchone()
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado")
    if pedido[8]:
        raise HTTPException(400, f"Boleta ya emitida: {pedido[8]}")
    if pedido[5] not in ("confirmado", "listo"):
        raise HTTPException(400, f"No se puede emitir desde estado '{pedido[5]}'")

    prod = db.query(Product).filter(
        Product.id == pedido[1],
        Product.store_id == current_user.store_id,
    ).first()
    if not prod:
        raise HTTPException(400, "Producto no existe")

    config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == current_user.store_id,
        StoreBillingConfig.is_active == True
    ).first()
    if not config or not config.facturalo_token:
        raise HTTPException(400, "Facturación no configurada")

    cantidad = int(pedido[3])
    sale_price = float(prod.sale_price or 0)
    tipo_pedido = pedido[4]
    serie = config.serie_boleta
    ahora = datetime.now(TZ_PERU)

    if tipo_pedido == "gratuito":
        item = {
            "descripcion": pedido[2],
            "cantidad": cantidad,
            "unidad_medida": "NIU",
            "valor_unitario": round(sale_price, 2),
            "precio_unitario": round(sale_price, 2),
            "descuento": round(sale_price, 2),
            "tipo_afectacion_igv": config.tipo_afectacion_igv,
        }
        leyenda = [{"codigo": "2001", "valor": "TRANSFERENCIA GRATUITA"}]
        tipo_operacion = "0111"
        observaciones = "TRANSFERENCIA GRATUITA - Cortesía de inauguración"
    else:
        item = {
            "descripcion": pedido[2],
            "cantidad": cantidad,
            "unidad_medida": "NIU",
            "precio_unitario": round(sale_price, 2),
            "tipo_afectacion_igv": config.tipo_afectacion_igv,
        }
        leyenda = None
        tipo_operacion = "0101"
        observaciones = f"Pedido de carta virtual #{pedido_id}"

    payload = {
        "tipo_comprobante": "03",
        "serie": serie,
        "fecha_emision": ahora.strftime("%Y-%m-%d"),
        "hora_emision": ahora.strftime("%H:%M:%S"),
        "moneda": "PEN",
        "forma_pago": "Gratuito" if tipo_pedido == "gratuito" else "Contado",
        "tipo_operacion": tipo_operacion,
        "cliente": {
            "tipo_documento": "0",
            "numero_documento": "00000000",
            "razon_social": "CLIENTE VARIOS",
        },
        "items": [item],
        "enviar_email": False,
        "referencia_externa": f"QUEVENDI-CARTA-PEDIDO-{pedido_id}",
        "observaciones": observaciones,
    }
    if leyenda:
        payload["leyenda"] = leyenda

    api_url = f"{config.facturalo_url}/comprobantes"
    import json
    logger.info(f"[Carta-Boleta] pedido={pedido_id} tipo={tipo_pedido} → {api_url}")
    logger.info(f"[Carta-Boleta] Payload Facturalo: {json.dumps(payload, default=str)}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                api_url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-API-Key": config.facturalo_token,
                    "X-API-Secret": config.facturalo_secret,
                },
            )
            logger.info(f"[Carta-Boleta] Status: {response.status_code}")
            logger.info(f"[Carta-Boleta] Response: {response.text}")
            try:
                data = response.json()
            except Exception:
                raise HTTPException(502, f"Facturalo.pro respondió formato inválido (HTTP {response.status_code})")

            if response.status_code in (200, 201) and data.get("exito"):
                comp = data.get("comprobante", {}) or {}
                archivos = data.get("archivos", {}) or {}
                numero_formato = comp.get("numero_formato") or f"{serie}-{str(comp.get('numero', 0)).zfill(8)}"
                pdf_url = archivos.get("pdf_url")

                db.execute(text("""
                    UPDATE carta_pedidos
                    SET comprobante_numero = :cnum,
                        comprobante_pdf_url = :purl
                    WHERE id = :pid
                """), {
                    "cnum": numero_formato,
                    "purl": pdf_url,
                    "pid": pedido_id,
                })
                if comp.get("numero"):
                    config.ultimo_numero_boleta = int(comp["numero"])
                db.commit()

                return {
                    "ok": True,
                    "comprobante_numero": numero_formato,
                    "pdf_url": pdf_url,
                }

            error_msg = (
                data.get("mensaje")
                or data.get("error")
                or (data.get("detail") if isinstance(data.get("detail"), str) else None)
                or f"Error HTTP {response.status_code}"
            )
            logger.error(f"[Carta-Boleta] facturalo rechazó: {data}")
            raise HTTPException(400, error_msg)

    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(502, "Timeout conectando a facturalo.pro")
    except httpx.RequestError as e:
        raise HTTPException(502, f"Error de conexión con facturalo.pro: {e}")


@router.get("/api/v1/carta/pedidos/{pedido_id}/pdf")
async def proxy_pdf_pedido(
    pedido_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Proxy del PDF del comprobante en Facturalo.pro.

    Descarga el PDF con auth de la tienda y lo sirve al navegador,
    evitando exponer credenciales o requerir headers en el cliente.
    """
    import httpx
    from app.models.billing import StoreBillingConfig

    row = db.execute(text("""
        SELECT comprobante_numero, comprobante_pdf_url
        FROM carta_pedidos
        WHERE id = :pid AND store_id = :sid
    """), {"pid": pedido_id, "sid": current_user.store_id}).fetchone()
    if not row:
        raise HTTPException(404, "Pedido no encontrado")
    if not row[0] or not row[1]:
        raise HTTPException(404, "El pedido no tiene comprobante emitido")

    numero_formato = row[0]
    pdf_url = row[1]

    config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == current_user.store_id,
        StoreBillingConfig.is_active == True,
    ).first()
    if not config or not config.facturalo_token:
        raise HTTPException(400, "Facturación no configurada")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                pdf_url,
                headers={
                    "X-API-Key": config.facturalo_token,
                    "X-API-Secret": config.facturalo_secret,
                },
            )
        if response.status_code != 200:
            logger.error(f"[Carta-PDF] facturalo respondió {response.status_code}: {response.text[:200]}")
            raise HTTPException(502, "Error al obtener PDF de facturalo.pro")

        filename = f"{numero_formato}.pdf"
        return Response(
            content=response.content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(502, "Timeout descargando PDF")
    except httpx.RequestError as e:
        raise HTTPException(502, f"Error de conexión con facturalo.pro: {e}")
