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




def _nombre_tier(db, store_id, tier_id):
    """Nombre de la lista, para mostrarla en la caja."""
    if not tier_id:
        return ""
    from sqlalchemy import text as _t
    r = db.execute(_t("SELECT nombre FROM price_tiers WHERE id = :t AND store_id = :s"),
                   {"t": tier_id, "s": store_id}).fetchone()
    return r[0] if r else ""

@router.get("/detectar")
async def detectar_precio(
    product_id: int,
    cantidad: float,
    tier_id: int = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Precio a aplicar, combinando los dos ejes.

    Sin `tier_id` y con el multiprecio de cliente apagado, responde
    exactamente lo mismo que antes (precio por volumen), para no cambiar
    el comportamiento de las tiendas que ya lo usan.

    Con `tier_id` devuelve además el desglose: precio base, el de
    volumen, el de la lista del cliente, cuál ganó y por qué.
    """
    # ── Eje cliente: sólo si la tienda lo activó ──
    from app.services import precios_service as _ps
    _ps._ensure_tables(db)
    if tier_id and _ps.multiprecio_enabled(db, current_user.store_id):
        try:
            calc = _ps.calcular(db, current_user.store_id, product_id,
                                cantidad, tier_id)
        except LookupError:
            raise HTTPException(404, "Producto no encontrado")

        return {
            # Se mantienen las claves que el front ya lee.
            "aplica_especial": calc["precio_final"] < calc["precio_base"],
            "precio_especial": calc["precio_final"],
            "precio_normal": calc["precio_base"],
            "ahorro_unit": calc["ahorro_unit"],
            "ahorro_total": calc["ahorro_total"],
            "tier_id": calc["tier_id"],
            "tier_nombre": _nombre_tier(db, current_user.store_id, calc["tier_id"]),
            "tier_color": "#3b82f6",
            "cantidad_minima": 1,
            # Desglose nuevo
            "origen": calc["origen"],
            "precio_volumen": calc["precio_volumen"],
            "precio_cliente": calc["precio_cliente"],
            "acumulan": calc["acumulan"],
        }

    # ── Comportamiento original: sólo volumen ──
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
        # `precio_normal` va siempre: el front lo usa para restaurar el
        # precio cuando se vuelve a "Precio normal". Sin él, el carrito
        # se quedaba con la rebaja de la lista anterior.
        return {"aplica_especial": False,
                "precio_normal": float(product.sale_price)}

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


# ══════════════════════════════════════════════
# LISTAS POR TIPO DE CLIENTE (eje 'cliente')
# ══════════════════════════════════════════════
# Conviven con los tiers por volumen de arriba, que no se tocan.

from typing import Optional as _Opt
from pydantic import BaseModel as _BaseModel
from sqlalchemy import text as _text
from app.services import precios_service as ps


class ListaClienteIn(_BaseModel):
    nombre: str
    modo: str = "manual"
    descuento_pct: _Opt[float] = None
    descripcion: _Opt[str] = ""
    color: _Opt[str] = "#3b82f6"
    es_default: bool = False


class ListaClienteUpdate(_BaseModel):
    nombre: _Opt[str] = None
    modo: _Opt[str] = None
    descuento_pct: _Opt[float] = None
    descripcion: _Opt[str] = None
    color: _Opt[str] = None
    is_active: _Opt[bool] = None
    es_default: _Opt[bool] = None


class PrecioListaIn(_BaseModel):
    product_id: int
    precio: _Opt[float] = None


class AsignarListaClienteIn(_BaseModel):
    tier_id: _Opt[int] = None


@router.get("/estado")
async def estado_multiprecio(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Flags y listas disponibles. La caja lo consulta al cargar."""
    ps._ensure_tables(db)
    sid = current_user.store_id
    return {
        "enabled": ps.multiprecio_enabled(db, sid),
        "acumulan": ps.descuentos_acumulan(db, sid),
        "listas": ps.listar_tiers(db, sid, eje="cliente"),
        "default": ps.tier_default(db, sid),
        "tiers_volumen": ps.listar_tiers(db, sid, eje="volumen"),
    }


@router.get("/listas")
async def listar_listas_cliente(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ps._ensure_tables(db)
    return {"listas": ps.listar_tiers(db, current_user.store_id, eje="cliente")}


@router.post("/listas", status_code=201)
async def crear_lista_cliente(
    req: ListaClienteIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Crea una lista de precios por tipo de cliente. Sólo dueño/admin."""
    ps._ensure_tables(db)
    if getattr(current_user, "role", None) not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Sólo el dueño puede crear listas de precio")
    try:
        r = ps.crear_tier(db, current_user.store_id, req.nombre, req.modo,
                          req.descuento_pct, req.descripcion, req.color, req.es_default)
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(422, str(e))
    return {"success": True, "lista": r}


@router.put("/listas/{tier_id}")
async def editar_lista_cliente(
    tier_id: int,
    req: ListaClienteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ps._ensure_tables(db)
    if getattr(current_user, "role", None) not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Sólo el dueño puede editar listas de precio")
    try:
        r = ps.actualizar_tier(db, current_user.store_id, tier_id,
                               **req.dict(exclude_none=True))
        db.commit()
    except LookupError:
        db.rollback()
        raise HTTPException(404, "Lista no encontrada")
    except ValueError as e:
        db.rollback()
        raise HTTPException(422, str(e))
    return {"success": True, **r}


@router.delete("/listas/{tier_id}")
async def borrar_lista_cliente(
    tier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ps._ensure_tables(db)
    if getattr(current_user, "role", None) not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Sólo el dueño puede borrar listas de precio")
    try:
        ok = ps.borrar_tier(db, current_user.store_id, tier_id)
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(422, str(e))
    if not ok:
        raise HTTPException(404, "Lista no encontrada")
    return {"success": True}


@router.get("/listas/{tier_id}/precios")
async def precios_de_lista(
    tier_id: int,
    limite: int = 500,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Carga masiva: productos con su precio en la lista (o sin él)."""
    ps._ensure_tables(db)
    tier = db.execute(_text(
        "SELECT id FROM price_tiers WHERE id = :t AND store_id = :s"
    ), {"t": tier_id, "s": current_user.store_id}).fetchone()
    if not tier:
        raise HTTPException(404, "Lista no encontrada")

    filas = ps.precios_de_lista(db, current_user.store_id, tier_id, limite)
    return {
        "tier_id": tier_id,
        "productos": filas,
        "sin_precio": sum(1 for f in filas if f["sin_precio"]),
        "total": len(filas),
    }


@router.put("/listas/{tier_id}/precios")
async def fijar_precio_lista(
    tier_id: int,
    req: PrecioListaIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fija el precio de un producto en la lista. Precio vacío = quitarlo."""
    ps._ensure_tables(db)
    if getattr(current_user, "role", None) not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Sólo el dueño puede cambiar precios")
    try:
        r = ps.fijar_precio(db, current_user.store_id, tier_id,
                            req.product_id, req.precio)
        db.commit()
    except LookupError as e:
        db.rollback()
        raise HTTPException(404, str(e))
    except ValueError as e:
        db.rollback()
        raise HTTPException(422, str(e))
    return {"success": True, **r}


@router.put("/clientes/{customer_id}/lista")
async def asignar_lista_a_cliente(
    customer_id: int,
    req: AsignarListaClienteIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Asigna (o quita) la lista por defecto de un cliente."""
    ps._ensure_tables(db)

    cli = db.execute(_text(
        "SELECT id FROM customers WHERE id = :c AND store_id = :s"
    ), {"c": customer_id, "s": current_user.store_id}).fetchone()
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")

    if req.tier_id:
        t = db.execute(_text(
            "SELECT id FROM price_tiers WHERE id = :t AND store_id = :s "
            "AND COALESCE(eje,'volumen') = 'cliente'"
        ), {"t": req.tier_id, "s": current_user.store_id}).fetchone()
        if not t:
            raise HTTPException(404, "Lista no encontrada")

    db.execute(_text("UPDATE customers SET tier_id = :t WHERE id = :c AND store_id = :s"),
               {"t": req.tier_id, "c": customer_id, "s": current_user.store_id})
    db.commit()
    return {"success": True, "customer_id": customer_id, "tier_id": req.tier_id}


@router.get("/reporte/por-lista")
async def reporte_por_lista(
    desde: _Opt[str] = None,
    hasta: _Opt[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ventas agrupadas por lista de cliente en un rango de días de Lima."""
    from datetime import date as _date
    from app.core.tiempo import dia_operativo_peru, hoy_peru

    ps._ensure_tables(db)
    try:
        d_ini = _date.fromisoformat(desde) if desde else hoy_peru()
        d_fin = _date.fromisoformat(hasta) if hasta else d_ini
    except ValueError:
        raise HTTPException(422, "Fecha inválida (usa YYYY-MM-DD)")

    ini, _ = dia_operativo_peru(d_ini)
    _, fin = dia_operativo_peru(d_fin)

    return {
        "desde": d_ini.isoformat(),
        "hasta": d_fin.isoformat(),
        "listas": ps.ventas_por_lista(db, current_user.store_id, ini, fin),
    }
