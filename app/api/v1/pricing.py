"""
Endpoints para Múltiples Precios y Combos.

Prefix: /pricing (montado en main.py con prefix="/api/v1")

Endpoints:
  Tipos de cliente (price_tiers)
    GET    /pricing/tiers
    POST   /pricing/tiers
    PUT    /pricing/tiers/{id}
    DELETE /pricing/tiers/{id}

  Precios por producto
    GET    /pricing/producto/{product_id}
    POST   /pricing/producto/{product_id}
    GET    /pricing/detectar?product_id=&cantidad=

  Combos
    GET    /pricing/combos
    POST   /pricing/combos
    PUT    /pricing/combos/{id}
    DELETE /pricing/combos/{id}
"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.product import Product
from app.models.pricing import PriceTier, ProductPrice, Combo, ComboItem


router = APIRouter(prefix="/pricing")


# ══════════════════════════════════════════════
# PRICE TIERS — Tipos de cliente
# ══════════════════════════════════════════════

@router.get("/tiers")
async def listar_tiers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tiers = db.query(PriceTier).filter_by(
        store_id=current_user.store_id,
        is_active=True
    ).order_by(PriceTier.orden).all()
    return {"tiers": [
        {
            "id": t.id,
            "nombre": t.nombre,
            "descripcion": t.descripcion,
            "color": t.color,
            "orden": t.orden,
        }
        for t in tiers
    ]}


@router.post("/tiers")
async def crear_tier(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tier = PriceTier(
        store_id=current_user.store_id,
        nombre=data["nombre"],
        descripcion=data.get("descripcion"),
        color=data.get("color", "#3b82f6"),
        orden=data.get("orden", 0),
        is_active=True,
    )
    db.add(tier)
    db.commit()
    db.refresh(tier)
    return {
        "ok": True,
        "tier": {
            "id": tier.id,
            "nombre": tier.nombre,
            "descripcion": tier.descripcion,
            "color": tier.color,
            "orden": tier.orden,
        }
    }


@router.put("/tiers/{tier_id}")
async def editar_tier(
    tier_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tier = db.query(PriceTier).filter_by(
        id=tier_id, store_id=current_user.store_id
    ).first()
    if not tier:
        raise HTTPException(404, "Tier no encontrado")

    if "nombre" in data:
        tier.nombre = data["nombre"]
    if "descripcion" in data:
        tier.descripcion = data["descripcion"]
    if "color" in data:
        tier.color = data["color"]
    if "orden" in data:
        tier.orden = data["orden"]

    db.commit()
    return {"ok": True}


@router.delete("/tiers/{tier_id}")
async def eliminar_tier(
    tier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tier = db.query(PriceTier).filter_by(
        id=tier_id, store_id=current_user.store_id
    ).first()
    if not tier:
        raise HTTPException(404, "Tier no encontrado")
    tier.is_active = False
    db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════
# PRECIOS POR PRODUCTO
# ══════════════════════════════════════════════

@router.get("/producto/{product_id}")
async def precios_producto(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    product = db.query(Product).filter_by(
        id=product_id,
        store_id=current_user.store_id
    ).first()
    if not product:
        raise HTTPException(404, "Producto no encontrado")

    precios = db.query(ProductPrice).filter_by(
        product_id=product_id,
        store_id=current_user.store_id,
        is_active=True
    ).all()

    return {
        "product_id": product_id,
        "precio_normal": float(product.sale_price),
        "precios": [{
            "tier_id": p.tier_id,
            "tier_nombre": p.tier.nombre if p.tier else '',
            "tier_color": p.tier.color if p.tier else '#3b82f6',
            "precio": float(p.precio),
            "cantidad_minima": float(p.cantidad_minima),
            "ahorro": round(
                float(product.sale_price) - float(p.precio), 2
            )
        } for p in precios]
    }


@router.post("/producto/{product_id}")
async def guardar_precios_producto(
    product_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    data = {"precios": [
        {"tier_id": 1, "precio": 7.50, "cantidad_minima": 6}
    ]}
    Borra los precios anteriores del producto y crea los nuevos.
    """
    db.query(ProductPrice).filter_by(
        product_id=product_id,
        store_id=current_user.store_id
    ).delete()

    for p in data.get("precios", []):
        db.add(ProductPrice(
            store_id=current_user.store_id,
            product_id=product_id,
            tier_id=p["tier_id"],
            precio=p["precio"],
            cantidad_minima=p.get("cantidad_minima", 1),
            is_active=True,
        ))
    db.commit()
    return {"ok": True}


@router.get("/detectar")
async def detectar_precio(
    product_id: int,
    cantidad: float,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Busca el precio especial con mayor cantidad_minima
    que sea <= cantidad ingresada (el más favorable).
    """
    precios = db.query(ProductPrice).filter(
        ProductPrice.product_id == product_id,
        ProductPrice.store_id == current_user.store_id,
        ProductPrice.is_active == True,
        ProductPrice.cantidad_minima <= cantidad,
    ).order_by(
        ProductPrice.cantidad_minima.desc()
    ).all()

    product = db.query(Product).filter_by(
        id=product_id,
        store_id=current_user.store_id,
    ).first()
    if not product:
        raise HTTPException(404, "Producto no encontrado")

    if not precios:
        return {"aplica_especial": False}

    mejor = precios[0]
    return {
        "aplica_especial": True,
        "tier_id": mejor.tier_id,
        "tier_nombre": mejor.tier.nombre if mejor.tier else '',
        "tier_color": mejor.tier.color if mejor.tier else '#3b82f6',
        "precio_especial": float(mejor.precio),
        "precio_normal": float(product.sale_price),
        "cantidad_minima": float(mejor.cantidad_minima),
        "ahorro_unit": round(
            float(product.sale_price) - float(mejor.precio), 2
        ),
        "ahorro_total": round(
            (float(product.sale_price) - float(mejor.precio))
            * cantidad, 2
        ),
    }


# ══════════════════════════════════════════════
# COMBOS
# ══════════════════════════════════════════════

def _combo_dict(c: Combo) -> dict:
    ahorro = float(c.precio_normal or 0) - float(c.precio_combo or 0)
    return {
        "id": c.id,
        "nombre": c.nombre,
        "descripcion": c.descripcion,
        "precio_combo": float(c.precio_combo or 0),
        "precio_normal": float(c.precio_normal or 0),
        "ahorro": round(ahorro, 2),
        "imagen_url": c.imagen_url,
        "show_in_catalog": c.show_in_catalog,
        "fecha_inicio": c.fecha_inicio.isoformat() if c.fecha_inicio else None,
        "fecha_fin": c.fecha_fin.isoformat() if c.fecha_fin else None,
        "items": [{
            "product_id": i.product_id,
            "product_name": i.product.name if i.product else '',
            "quantity": float(i.quantity),
            "precio_unitario": float(i.precio_unitario or 0),
        } for i in c.items],
    }


@router.get("/combos")
async def listar_combos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    hoy = date.today()
    combos = db.query(Combo).filter(
        Combo.store_id == current_user.store_id,
        Combo.is_active == True,
        or_(Combo.fecha_fin == None, Combo.fecha_fin >= hoy),
    ).all()
    return {"combos": [_combo_dict(c) for c in combos]}


@router.post("/combos")
async def crear_combo(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    items_data = data.get("items", [])
    precio_normal = sum(
        float(i.get("precio_unitario", 0)) *
        float(i.get("quantity", 1))
        for i in items_data
    )

    combo = Combo(
        store_id=current_user.store_id,
        nombre=data["nombre"],
        descripcion=data.get("descripcion"),
        precio_combo=data["precio_combo"],
        precio_normal=precio_normal,
        imagen_url=data.get("imagen_url"),
        show_in_catalog=data.get("show_in_catalog", True),
        fecha_inicio=data.get("fecha_inicio"),
        fecha_fin=data.get("fecha_fin"),
        is_active=True,
    )
    db.add(combo)
    db.flush()

    for item in items_data:
        db.add(ComboItem(
            combo_id=combo.id,
            product_id=item["product_id"],
            quantity=item["quantity"],
            precio_unitario=item.get("precio_unitario"),
        ))

    db.commit()
    db.refresh(combo)
    return {"ok": True, "combo": _combo_dict(combo)}


@router.put("/combos/{combo_id}")
async def editar_combo(
    combo_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    combo = db.query(Combo).filter_by(
        id=combo_id, store_id=current_user.store_id
    ).first()
    if not combo:
        raise HTTPException(404, "Combo no encontrado")

    if "nombre" in data:
        combo.nombre = data["nombre"]
    if "descripcion" in data:
        combo.descripcion = data["descripcion"]
    if "precio_combo" in data:
        combo.precio_combo = data["precio_combo"]
    if "imagen_url" in data:
        combo.imagen_url = data["imagen_url"]
    if "show_in_catalog" in data:
        combo.show_in_catalog = data["show_in_catalog"]
    if "fecha_inicio" in data:
        combo.fecha_inicio = data["fecha_inicio"]
    if "fecha_fin" in data:
        combo.fecha_fin = data["fecha_fin"]

    if "items" in data:
        # Reemplazar items completamente
        db.query(ComboItem).filter_by(combo_id=combo.id).delete()
        precio_normal = 0
        for item in data["items"]:
            db.add(ComboItem(
                combo_id=combo.id,
                product_id=item["product_id"],
                quantity=item["quantity"],
                precio_unitario=item.get("precio_unitario"),
            ))
            precio_normal += (
                float(item.get("precio_unitario", 0)) *
                float(item.get("quantity", 1))
            )
        combo.precio_normal = precio_normal

    db.commit()
    db.refresh(combo)
    return {"ok": True, "combo": _combo_dict(combo)}


@router.delete("/combos/{combo_id}")
async def eliminar_combo(
    combo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    combo = db.query(Combo).filter_by(
        id=combo_id, store_id=current_user.store_id
    ).first()
    if not combo:
        raise HTTPException(404, "Combo no encontrado")
    combo.is_active = False
    db.commit()
    return {"ok": True}
