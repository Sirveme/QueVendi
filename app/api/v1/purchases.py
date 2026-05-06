"""
Registro de Compras.
Endpoints para listar/crear/anular compras + OCR (foto/PDF) y
parseo de Excel/CSV. Genera inventory_movements automáticamente.
"""
import base64
import io
import json
import re
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, extract, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.product import Product
from app.models.supplier import Supplier
from app.models.purchase import Purchase, PurchaseItem
from app.models.inventory import InventoryMovement


router = APIRouter(tags=["purchases"])


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────
class PurchaseItemIn(BaseModel):
    product_id: Optional[int] = None
    product_name: str
    quantity: Decimal
    unit: Optional[str] = None
    cost_price: Decimal
    subtotal: Decimal


class PurchaseCreateIn(BaseModel):
    supplier_ruc: str
    supplier_name: str
    tipo_documento: str = "FACTURA"
    serie: Optional[str] = None
    numero: str
    fecha_emision: date
    fecha_vencimiento: Optional[date] = None
    subtotal: Decimal = Decimal("0")
    igv: Decimal = Decimal("0")
    total: Decimal
    items: List[PurchaseItemIn] = Field(default_factory=list)
    payment_method: Optional[str] = "contado"
    notes: Optional[str] = None
    ocr_raw: Optional[dict] = None


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────
def _to_float(x) -> float:
    if x is None:
        return 0.0
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _generar_purchase_number(db: Session, store_id: int) -> str:
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"PO-{store_id}-{today}-"
    correlativo = (
        db.query(Purchase)
        .filter(
            Purchase.store_id == store_id,
            Purchase.purchase_number.like(f"{prefix}%"),
        )
        .count()
    )
    return f"{prefix}{correlativo + 1:04d}"


def _resolver_supplier(db: Session, store_id: int, ruc: str, nombre: str) -> Supplier:
    """Busca por RUC en el store o crea uno nuevo."""
    ruc_clean = (ruc or "").strip()
    nombre_clean = (nombre or "").strip()

    if ruc_clean:
        existing = (
            db.query(Supplier)
            .filter(Supplier.store_id == store_id, Supplier.ruc == ruc_clean)
            .first()
        )
        if existing:
            return existing

    supplier = Supplier(
        store_id=store_id,
        ruc=ruc_clean or None,
        name=nombre_clean or "Proveedor sin nombre",
        is_active=True,
    )
    db.add(supplier)
    db.flush()
    return supplier


def _serialize_purchase(p: Purchase, supplier_name: Optional[str], num_items: int) -> dict:
    return {
        "id": p.id,
        "purchase_number": p.purchase_number,
        "fecha_emision": p.fecha_emision.isoformat() if p.fecha_emision else None,
        "fecha_vencimiento": p.fecha_vencimiento.isoformat() if p.fecha_vencimiento else None,
        "tipo_documento": p.tipo_documento,
        "serie": p.serie,
        "numero": p.numero,
        "doc_completo": f"{p.serie or ''}-{p.numero or ''}".strip("-"),
        "supplier_id": p.supplier_id,
        "supplier_name": supplier_name,
        "subtotal": _to_float(p.subtotal),
        "igv": _to_float(p.igv),
        "total": _to_float(p.total),
        "estado": p.estado,
        "payment_method": p.payment_method,
        "num_items": num_items,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


# ──────────────────────────────────────────────────────────────────────────
# GET /purchases
# ──────────────────────────────────────────────────────────────────────────
@router.get("/purchases")
async def listar_compras(
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
    supplier_id: Optional[int] = None,
    tipo_documento: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    store_id = current_user.store_id

    q = (
        db.query(Purchase, Supplier.name, func.count(PurchaseItem.id))
        .outerjoin(Supplier, Supplier.id == Purchase.supplier_id)
        .outerjoin(PurchaseItem, PurchaseItem.purchase_id == Purchase.id)
        .filter(Purchase.store_id == store_id)
        .group_by(Purchase.id, Supplier.name)
    )
    if mes:
        q = q.filter(extract("month", Purchase.fecha_emision) == mes)
    if anio:
        q = q.filter(extract("year", Purchase.fecha_emision) == anio)
    if supplier_id:
        q = q.filter(Purchase.supplier_id == supplier_id)
    if tipo_documento:
        q = q.filter(Purchase.tipo_documento == tipo_documento)

    rows = q.order_by(Purchase.fecha_emision.desc(), Purchase.id.desc()).all()
    return {"compras": [_serialize_purchase(p, name, n) for p, name, n in rows]}


# ──────────────────────────────────────────────────────────────────────────
# GET /purchases/{id}
# ──────────────────────────────────────────────────────────────────────────
@router.get("/purchases/{purchase_id}")
async def detalle_compra(
    purchase_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = (
        db.query(Purchase)
        .filter(Purchase.id == purchase_id, Purchase.store_id == current_user.store_id)
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Compra no encontrada")

    supplier = db.query(Supplier).filter(Supplier.id == p.supplier_id).first() if p.supplier_id else None
    items = db.query(PurchaseItem).filter(PurchaseItem.purchase_id == p.id).all()

    return {
        **_serialize_purchase(p, supplier.name if supplier else None, len(items)),
        "supplier": {
            "id": supplier.id,
            "ruc": supplier.ruc,
            "name": supplier.name,
            "address": supplier.address,
            "phone": supplier.phone,
        } if supplier else None,
        "items": [
            {
                "id": it.id,
                "product_id": it.product_id,
                "product_name": it.product_name,
                "quantity": _to_float(it.quantity),
                "unit": it.unit,
                "cost_price": _to_float(it.cost_price),
                "subtotal": _to_float(it.subtotal),
            }
            for it in items
        ],
        "notes": p.notes,
    }


# ──────────────────────────────────────────────────────────────────────────
# POST /purchases
# ──────────────────────────────────────────────────────────────────────────
@router.post("/purchases")
async def crear_compra(
    data: PurchaseCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    store_id = current_user.store_id

    if not data.items:
        raise HTTPException(status_code=400, detail="La compra debe tener al menos un item")

    supplier = _resolver_supplier(db, store_id, data.supplier_ruc, data.supplier_name)

    purchase = Purchase(
        store_id=store_id,
        supplier_id=supplier.id,
        user_id=current_user.id,
        created_by=current_user.id,
        purchase_number=_generar_purchase_number(db, store_id),
        tipo_documento=data.tipo_documento,
        serie=data.serie,
        numero=data.numero,
        fecha_emision=data.fecha_emision,
        fecha_vencimiento=data.fecha_vencimiento,
        purchase_date=data.fecha_emision,
        due_date=data.fecha_vencimiento,
        supplier_invoice_series=data.serie,
        supplier_invoice_number=data.numero,
        subtotal=data.subtotal,
        igv=data.igv,
        total=data.total,
        payment_method=data.payment_method or "contado",
        notes=data.notes,
        ocr_raw=data.ocr_raw,
        estado="registrado",
    )
    db.add(purchase)
    db.flush()

    for item_in in data.items:
        # Resolver producto: por id si llega, si no por nombre exacto en el store
        product: Optional[Product] = None
        if item_in.product_id:
            product = (
                db.query(Product)
                .filter(Product.id == item_in.product_id, Product.store_id == store_id)
                .first()
            )
        if not product and item_in.product_name:
            product = (
                db.query(Product)
                .filter(
                    Product.store_id == store_id,
                    func.lower(Product.name) == item_in.product_name.strip().lower(),
                )
                .first()
            )

        pi = PurchaseItem(
            purchase_id=purchase.id,
            store_id=store_id,
            product_id=product.id if product else None,
            product_name=item_in.product_name,
            quantity=item_in.quantity,
            unit=item_in.unit,
            cost_price=item_in.cost_price,
            subtotal=item_in.subtotal,
        )
        db.add(pi)

        # Trigger Kardex: actualizar stock y crear inventory_movement
        if product:
            qty = Decimal(str(item_in.quantity))
            cost = Decimal(str(item_in.cost_price))
            stock_before = Decimal(str(product.stock or 0))
            product.stock = stock_before + qty

            db.add(InventoryMovement(
                store_id=store_id,
                product_id=product.id,
                user_id=current_user.id,
                movement_type="entrada_compra",
                quantity=qty,
                cost_price=cost,
                costo_total=cost * qty,
                reference_type="purchase",
                reference_id=purchase.id,
                doc_tipo=purchase.tipo_documento,
                doc_numero=f"{purchase.serie or ''}-{purchase.numero or ''}".strip("-"),
                glosa=f"Compra a {supplier.name}",
                user_name=getattr(current_user, "full_name", None),
                stock_before=stock_before,
                stock_after=product.stock,
                notes=f"Compra #{purchase.purchase_number}",
            ))

    db.commit()
    db.refresh(purchase)

    return {
        "ok": True,
        "purchase_id": purchase.id,
        "purchase_number": purchase.purchase_number,
        "estado": purchase.estado,
    }


# ──────────────────────────────────────────────────────────────────────────
# DELETE /purchases/{id}  — anula (genera salida_ajuste)
# ──────────────────────────────────────────────────────────────────────────
@router.delete("/purchases/{purchase_id}")
async def anular_compra(
    purchase_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    purchase = (
        db.query(Purchase)
        .filter(Purchase.id == purchase_id, Purchase.store_id == current_user.store_id)
        .first()
    )
    if not purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")
    if purchase.estado == "anulado":
        return {"ok": True, "estado": "anulado", "ya_anulada": True}

    supplier = db.query(Supplier).filter(Supplier.id == purchase.supplier_id).first() if purchase.supplier_id else None
    items = db.query(PurchaseItem).filter(PurchaseItem.purchase_id == purchase.id).all()

    for it in items:
        if not it.product_id:
            continue
        product = db.query(Product).filter(Product.id == it.product_id).first()
        if not product:
            continue
        qty = Decimal(str(it.quantity))
        cost = Decimal(str(it.cost_price or 0))
        stock_before = Decimal(str(product.stock or 0))
        product.stock = stock_before - qty

        db.add(InventoryMovement(
            store_id=purchase.store_id,
            product_id=product.id,
            user_id=current_user.id,
            movement_type="salida_ajuste",
            quantity=-qty,
            cost_price=cost,
            costo_total=cost * qty,
            reference_type="purchase_delete",
            reference_id=purchase.id,
            doc_tipo="ANULACIÓN",
            doc_numero=f"ANUL-{purchase.purchase_number}",
            glosa=f"Anulación compra #{purchase.purchase_number}" + (f" a {supplier.name}" if supplier else ""),
            user_name=getattr(current_user, "full_name", None),
            stock_before=stock_before,
            stock_after=product.stock,
            notes=f"Anulación compra #{purchase.purchase_number}",
        ))

    purchase.estado = "anulado"
    purchase.status = "cancelled"
    db.commit()
    return {"ok": True, "estado": "anulado"}


# ──────────────────────────────────────────────────────────────────────────
# POST /purchases/ocr  — OpenAI vision (gpt-4o-mini)
# ──────────────────────────────────────────────────────────────────────────
def _enriquecer_ruc(datos: dict) -> dict:
    ruc = (datos or {}).get("proveedor_ruc")
    if not ruc:
        return datos
    try:
        from app.services.validation_service import validation_service
        info = validation_service.validate_ruc(str(ruc))
        if info and info.get("valid"):
            datos["proveedor_nombre"] = info.get("business_name") or datos.get("proveedor_nombre")
            datos["proveedor_direccion"] = info.get("address") or datos.get("proveedor_direccion")
    except Exception:
        # Si APISNET falla, devolvemos lo que tenemos del OCR
        pass
    return datos


def _parse_json_lax(texto: str) -> dict:
    """Extrae el primer bloque JSON aunque venga con backticks o texto extra."""
    if not texto:
        raise HTTPException(status_code=502, detail="OCR no devolvió contenido")
    t = texto.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?", "", t).rstrip("`").strip()
    # Tomar desde el primer { hasta el último }
    i, j = t.find("{"), t.rfind("}")
    if i != -1 and j != -1 and j > i:
        t = t[i:j + 1]
    try:
        return json.loads(t)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"OCR devolvió JSON inválido: {e}")


@router.post("/purchases/ocr")
async def ocr_documento(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY no configurado")

    try:
        import openai
    except ImportError:
        raise HTTPException(status_code=503, detail="Paquete openai no instalado")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Archivo vacío")

    media_type = file.content_type or "image/jpeg"
    if media_type == "application/pdf":
        # Para PDF mandamos también como image_url; gpt-4o-mini soporta PDFs vía files API
        # pero acá usamos fallback simple: se espera que el cliente envíe imágenes (foto del PDF)
        # o un PDF de una página convertible a imagen.
        pass

    b64 = base64.b64encode(content).decode()

    prompt = (
        "Extrae los datos de este documento de compra peruano. "
        "Retorna SOLO JSON con esta estructura exacta:\n"
        "{\n"
        '  "tipo_documento": "FACTURA|BOLETA|GUIA|NOTA_ALMACEN",\n'
        '  "serie": "F001",\n'
        '  "numero": "00001234",\n'
        '  "fecha_emision": "2026-05-06",\n'
        '  "proveedor_ruc": "20123456789",\n'
        '  "proveedor_nombre": "DISTRIBUIDORA XYZ SAC",\n'
        '  "subtotal": 100.00,\n'
        '  "igv": 18.00,\n'
        '  "total": 118.00,\n'
        '  "items": [\n'
        '    {"descripcion": "Nombre", "cantidad": 10, "unidad": "UND", '
        '"precio_unitario": 10.00, "subtotal": 100.00}\n'
        "  ]\n"
        "}\n"
        "Si no puedes leer un campo, usa null. NO incluyas texto adicional, solo el JSON."
    )

    try:
        client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
            max_tokens=1500,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a OpenAI: {e}")

    texto = response.choices[0].message.content if response.choices else ""
    datos = _parse_json_lax(texto)
    datos = _enriquecer_ruc(datos)

    return {"ok": True, "ocr": datos}


# ──────────────────────────────────────────────────────────────────────────
# POST /purchases/ocr-excel
# ──────────────────────────────────────────────────────────────────────────
@router.post("/purchases/ocr-excel")
async def procesar_excel(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="pandas no está instalado. Agrega pandas y openpyxl a requirements.txt",
        )

    content = await file.read()
    fname = (file.filename or "").lower()

    try:
        if fname.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {e}")

    df.columns = [str(c).lower().strip() for c in df.columns]

    col_map = {
        "producto": ["producto", "descripcion", "descripción", "item", "nombre"],
        "cantidad": ["cantidad", "qty", "cant", "unidades"],
        "precio": ["precio", "costo", "p_unit", "precio_unitario", "cost"],
        "subtotal": ["subtotal", "total", "importe"],
        "unidad": ["unidad", "und", "unit", "um"],
    }

    items: list = []
    for _, row in df.iterrows():
        item: dict = {}
        for key, variants in col_map.items():
            for v in variants:
                if v in df.columns:
                    val = row.get(v)
                    try:
                        if pd.notna(val):
                            item[key] = val
                            break
                    except Exception:
                        if val is not None:
                            item[key] = val
                            break

        if item.get("producto") and item.get("cantidad"):
            try:
                cant = float(item.get("cantidad") or 0)
                precio = float(item.get("precio") or 0)
                sub = float(item.get("subtotal") or (cant * precio))
            except (TypeError, ValueError):
                continue
            items.append({
                "descripcion": str(item["producto"]).strip(),
                "cantidad": cant,
                "unidad": str(item.get("unidad", "UND") or "UND").strip(),
                "precio_unitario": precio,
                "subtotal": sub,
            })

    return {"ok": True, "items": items, "total_filas": len(items)}


# ──────────────────────────────────────────────────────────────────────────
# GET /suppliers/buscar
# ──────────────────────────────────────────────────────────────────────────
@router.get("/suppliers/buscar")
async def buscar_proveedor(
    ruc: Optional[str] = None,
    nombre: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    store_id = current_user.store_id

    if ruc:
        ruc = ruc.strip()
        local = (
            db.query(Supplier)
            .filter(Supplier.store_id == store_id, Supplier.ruc == ruc)
            .first()
        )
        if local:
            return {
                "ok": True,
                "fuente": "local",
                "proveedor": {
                    "id": local.id,
                    "ruc": local.ruc,
                    "name": local.name,
                    "address": local.address,
                    "phone": local.phone,
                    "email": local.email,
                },
            }
        # Consultar APISNET
        try:
            from app.services.validation_service import validation_service
            info = validation_service.validate_ruc(ruc)
            if info and info.get("valid"):
                return {
                    "ok": True,
                    "fuente": "apisnet",
                    "nuevo": True,
                    "proveedor": {
                        "ruc": ruc,
                        "name": info.get("business_name"),
                        "address": info.get("address"),
                    },
                }
        except HTTPException as e:
            return {"ok": False, "fuente": None, "detail": e.detail}
        except Exception as e:
            return {"ok": False, "fuente": None, "detail": str(e)}

    if nombre:
        like = f"%{nombre.strip()}%"
        rows = (
            db.query(Supplier)
            .filter(Supplier.store_id == store_id, Supplier.name.ilike(like))
            .order_by(Supplier.name.asc())
            .limit(20)
            .all()
        )
        return {
            "ok": True,
            "fuente": "local",
            "proveedores": [
                {"id": s.id, "ruc": s.ruc, "name": s.name, "address": s.address}
                for s in rows
            ],
        }

    raise HTTPException(status_code=400, detail="Falta ?ruc= o ?nombre=")
