"""
Asistente Tributario SUNAT — zClaude-28.
Calcula impuestos según régimen (RUS / RER / RMT / RG), fechas
de vencimiento por último dígito del RUC y gastos operativos.
"""
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import extract, func, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.store import Store
from app.models.sale import Sale
from app.models.purchase import Purchase
from app.models.gasto_operativo import GastoOperativo
from app.models.incidente import PushSubscription


logger = logging.getLogger(__name__)
router = APIRouter(tags=["tributario"])


# ──────────────────────────────────────────────────────────────────────────
# Constantes SUNAT 2026
# ──────────────────────────────────────────────────────────────────────────
UIT_2026 = Decimal("5350")
LIMITE_RUS_CAT1 = Decimal("5000")    # S/ por mes
LIMITE_RUS_CAT2 = Decimal("8000")    # S/ por mes


# ──────────────────────────────────────────────────────────────────────────
# Helpers de configuración tributaria (store_config se maneja por SQL crudo)
# ──────────────────────────────────────────────────────────────────────────
def _get_config_tributaria(db: Session, store_id: int) -> dict:
    """Lee solo los campos tributarios de store_config."""
    row = db.execute(text("""
        SELECT regimen_tributario, categoria_rus,
               fecha_inicio_actividades, ultimo_digito_ruc, ruc
          FROM store_config
         WHERE store_id = :sid
    """), {"sid": store_id}).fetchone()

    if row:
        m = row._mapping
        return {
            "regimen_tributario": m.get("regimen_tributario") or "RUS",
            "categoria_rus": m.get("categoria_rus") or "1",
            "fecha_inicio_actividades": m.get("fecha_inicio_actividades"),
            "ultimo_digito_ruc": m.get("ultimo_digito_ruc"),
            "ruc": m.get("ruc"),
        }
    return {
        "regimen_tributario": "RUS",
        "categoria_rus": "1",
        "fecha_inicio_actividades": None,
        "ultimo_digito_ruc": None,
        "ruc": None,
    }


def _resolver_ultimo_digito(config: dict, store: Optional[Store]) -> int:
    if config.get("ultimo_digito_ruc") is not None:
        try:
            return int(config["ultimo_digito_ruc"]) % 10
        except (TypeError, ValueError):
            pass
    ruc = config.get("ruc") or (store.ruc if store else None)
    if ruc and str(ruc).strip():
        try:
            return int(str(ruc).strip()[-1])
        except ValueError:
            pass
    return 0


# ──────────────────────────────────────────────────────────────────────────
# Cálculo de impuesto y vencimiento
# ──────────────────────────────────────────────────────────────────────────
def calcular_impuesto(regimen: str, categoria_rus: Optional[str],
                       ventas: float, utilidad: float) -> float:
    if regimen == "RUS":
        return 20.0 if (categoria_rus or "1") == "1" else 50.0
    if regimen == "RER":
        return round(ventas * 0.015, 2)
    if regimen == "RMT":
        limite_1pct = float(UIT_2026) * 300 / 12  # 300 UIT anual → mensual
        if ventas <= limite_1pct:
            return round(ventas * 0.01, 2)
        return round(ventas * 0.015, 2)
    if regimen == "RG":
        return round(ventas * 0.015, 2)
    return 0.0


def calcular_vencimiento(mes: int, anio: int, ultimo_digito: int) -> date:
    """Cronograma SUNAT 2026 simplificado — vence en el mes siguiente."""
    if mes == 12:
        mes_vcto, anio_vcto = 1, anio + 1
    else:
        mes_vcto, anio_vcto = mes + 1, anio

    dias_vcto = {
        0: 10, 1: 11, 2: 12, 3: 13, 4: 14,
        5: 15, 6: 16, 7: 17, 8: 18, 9: 19,
    }
    dia = dias_vcto.get(ultimo_digito % 10, 15)
    return date(anio_vcto, mes_vcto, dia)


def detalle_calculo(regimen: str, ventas: float, impuesto: float) -> str:
    if regimen == "RUS":
        return f"Cuota fija mensual RUS: S/ {impuesto:.2f}"
    if regimen == "RER":
        return f"1.5% × S/ {ventas:.2f} ventas = S/ {impuesto:.2f}"
    if regimen == "RMT":
        return f"1% × S/ {ventas:.2f} ventas = S/ {impuesto:.2f}"
    if regimen == "RG":
        return f"Pago a cuenta 1.5% × S/ {ventas:.2f} = S/ {impuesto:.2f}"
    return ""


def alerta_limite_rus(categoria: str, ventas: float) -> Optional[str]:
    """Alerta si el RUS está cerca/sobre el límite del mes."""
    limite = float(LIMITE_RUS_CAT1) if (categoria or "1") == "1" else float(LIMITE_RUS_CAT2)
    if ventas >= limite:
        return f"Superaste el límite RUS Cat. {categoria}: S/ {limite:.0f} — debes cambiar de régimen."
    if ventas >= limite * 0.85:
        return f"Estás cerca del límite RUS Cat. {categoria}: S/ {limite:.0f}."
    return None


# ──────────────────────────────────────────────────────────────────────────
# Cálculo del resumen de un período
# ──────────────────────────────────────────────────────────────────────────
def _calcular_resumen(db: Session, store_id: int, mes: int, anio: int,
                      config: dict, store: Optional[Store]) -> dict:
    regimen = config["regimen_tributario"]
    categoria = config.get("categoria_rus") or "1"

    ventas_mes = db.query(func.coalesce(func.sum(Sale.total), 0)).filter(
        Sale.store_id == store_id,
        Sale.status != "cancelled",
        extract("month", Sale.sale_date) == mes,
        extract("year", Sale.sale_date) == anio,
    ).scalar() or 0

    compras_mes = db.query(func.coalesce(func.sum(Purchase.total), 0)).filter(
        Purchase.store_id == store_id,
        Purchase.estado != "anulado",
        extract("month", Purchase.fecha_emision) == mes,
        extract("year", Purchase.fecha_emision) == anio,
    ).scalar() or 0

    gastos_mes = db.query(func.coalesce(func.sum(GastoOperativo.monto), 0)).filter(
        GastoOperativo.store_id == store_id,
        extract("month", GastoOperativo.fecha) == mes,
        extract("year", GastoOperativo.fecha) == anio,
    ).scalar() or 0

    ventas_f = float(ventas_mes)
    compras_f = float(compras_mes)
    gastos_f = float(gastos_mes)
    total_gastos = compras_f + gastos_f
    utilidad = ventas_f - total_gastos

    impuesto = calcular_impuesto(regimen, categoria, ventas_f, utilidad)
    ultimo_digito = _resolver_ultimo_digito(config, store)
    fecha_vcto = calcular_vencimiento(mes, anio, ultimo_digito)
    dias_restantes = (fecha_vcto - date.today()).days

    return {
        "periodo": f"{mes:02d}/{anio}",
        "mes": mes,
        "anio": anio,
        "regimen": regimen,
        "categoria_rus": categoria if regimen == "RUS" else None,
        "ventas_mes": round(ventas_f, 2),
        "compras_mes": round(compras_f, 2),
        "gastos_operativos": round(gastos_f, 2),
        "total_gastos": round(total_gastos, 2),
        "utilidad_estimada": round(utilidad, 2),
        "impuesto_estimado": round(impuesto, 2),
        "fecha_vencimiento": fecha_vcto.isoformat(),
        "dias_restantes": dias_restantes,
        "alerta": dias_restantes <= 5,
        "detalle_calculo": detalle_calculo(regimen, ventas_f, impuesto),
        "alerta_rus": alerta_limite_rus(categoria, ventas_f) if regimen == "RUS" else None,
        "ultimo_digito_ruc": ultimo_digito,
    }


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────
class GastoOperativoIn(BaseModel):
    fecha: date
    categoria: str
    descripcion: str
    monto: Decimal
    comprobante_tipo: Optional[str] = None
    comprobante_numero: Optional[str] = None


class TributarioConfigIn(BaseModel):
    regimen_tributario: str
    categoria_rus: Optional[str] = "1"
    fecha_inicio_actividades: Optional[date] = None
    ultimo_digito_ruc: Optional[int] = None


# ──────────────────────────────────────────────────────────────────────────
# GET /tributario/resumen
# ──────────────────────────────────────────────────────────────────────────
@router.get("/tributario/resumen")
async def resumen_tributario(
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    if mes is None:
        mes = today.month
    if anio is None:
        anio = today.year

    config = _get_config_tributaria(db, current_user.store_id)
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    return _calcular_resumen(db, current_user.store_id, mes, anio, config, store)


# ──────────────────────────────────────────────────────────────────────────
# GET /tributario/historial
# ──────────────────────────────────────────────────────────────────────────
@router.get("/tributario/historial")
async def historial_tributario(
    meses: int = Query(6, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    config = _get_config_tributaria(db, current_user.store_id)
    store = db.query(Store).filter(Store.id == current_user.store_id).first()

    today = date.today()
    items: List[dict] = []
    mes, anio = today.month, today.year
    for _ in range(meses):
        r = _calcular_resumen(db, current_user.store_id, mes, anio, config, store)
        items.append({
            "periodo": r["periodo"],
            "mes": mes,
            "anio": anio,
            "ventas": r["ventas_mes"],
            "impuesto": r["impuesto_estimado"],
            "fecha_vencimiento": r["fecha_vencimiento"],
            "estado": "vencido" if r["dias_restantes"] < 0 else "pendiente",
        })
        # mes anterior
        if mes == 1:
            mes, anio = 12, anio - 1
        else:
            mes -= 1

    return {"historial": items}


# ──────────────────────────────────────────────────────────────────────────
# Gastos operativos
# ──────────────────────────────────────────────────────────────────────────
@router.post("/tributario/gastos")
async def registrar_gasto(
    data: GastoOperativoIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    gasto = GastoOperativo(
        store_id=current_user.store_id,
        fecha=data.fecha,
        categoria=data.categoria,
        descripcion=data.descripcion,
        monto=data.monto,
        comprobante_tipo=data.comprobante_tipo,
        comprobante_numero=data.comprobante_numero,
        user_id=current_user.id,
    )
    db.add(gasto)
    db.commit()
    db.refresh(gasto)
    return {"ok": True, "id": gasto.id}


@router.get("/tributario/gastos")
async def listar_gastos(
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    if mes is None:
        mes = today.month
    if anio is None:
        anio = today.year

    q = db.query(GastoOperativo).filter(
        GastoOperativo.store_id == current_user.store_id,
        extract("month", GastoOperativo.fecha) == mes,
        extract("year", GastoOperativo.fecha) == anio,
    )
    rows = q.order_by(GastoOperativo.fecha.desc(), GastoOperativo.id.desc()).all()

    totales: dict = {}
    total = 0.0
    for g in rows:
        cat = g.categoria or "otros"
        totales[cat] = totales.get(cat, 0.0) + float(g.monto or 0)
        total += float(g.monto or 0)

    return {
        "gastos": [
            {
                "id": g.id,
                "fecha": g.fecha.isoformat() if g.fecha else None,
                "categoria": g.categoria,
                "descripcion": g.descripcion,
                "monto": float(g.monto or 0),
                "comprobante_tipo": g.comprobante_tipo,
                "comprobante_numero": g.comprobante_numero,
            }
            for g in rows
        ],
        "totales_por_categoria": {k: round(v, 2) for k, v in totales.items()},
        "total": round(total, 2),
    }


@router.delete("/tributario/gastos/{gasto_id}")
async def eliminar_gasto(
    gasto_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    g = db.query(GastoOperativo).filter(
        GastoOperativo.id == gasto_id,
        GastoOperativo.store_id == current_user.store_id,
    ).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    db.delete(g)
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────
# Configuración tributaria (POST y GET)
# ──────────────────────────────────────────────────────────────────────────
@router.get("/tributario/config")
async def obtener_config_tributaria(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    config = _get_config_tributaria(db, current_user.store_id)
    fecha = config.get("fecha_inicio_actividades")
    return {
        "regimen_tributario": config["regimen_tributario"],
        "categoria_rus": config["categoria_rus"],
        "fecha_inicio_actividades": fecha.isoformat() if fecha else None,
        "ultimo_digito_ruc": config.get("ultimo_digito_ruc"),
    }


@router.post("/tributario/config")
async def configurar_tributario(
    data: TributarioConfigIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("owner", "admin", "demo_seller"):
        raise HTTPException(status_code=403,
                            detail="Solo el dueño puede configurar el régimen tributario")

    if data.regimen_tributario not in ("RUS", "RER", "RMT", "RG"):
        raise HTTPException(status_code=400, detail="Régimen inválido")

    store_id = current_user.store_id
    existing = db.execute(
        text("SELECT id FROM store_config WHERE store_id = :sid"),
        {"sid": store_id},
    ).fetchone()

    payload = {
        "sid": store_id,
        "regimen": data.regimen_tributario,
        "categoria": data.categoria_rus or "1",
        "fecha_inicio": data.fecha_inicio_actividades,
        "ultimo_digito": data.ultimo_digito_ruc,
    }

    if existing:
        db.execute(text("""
            UPDATE store_config
               SET regimen_tributario = :regimen,
                   categoria_rus = :categoria,
                   fecha_inicio_actividades = :fecha_inicio,
                   ultimo_digito_ruc = :ultimo_digito,
                   updated_at = NOW()
             WHERE store_id = :sid
        """), payload)
    else:
        db.execute(text("""
            INSERT INTO store_config
                (store_id, regimen_tributario, categoria_rus,
                 fecha_inicio_actividades, ultimo_digito_ruc)
            VALUES
                (:sid, :regimen, :categoria, :fecha_inicio, :ultimo_digito)
        """), payload)

    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────
# Notificación push (best-effort: si no hay pywebpush, queda en log/DB)
# ──────────────────────────────────────────────────────────────────────────
def _enviar_push(db: Session, user_ids: List[int], titulo: str, cuerpo: str,
                 url_accion: str = "/tributario") -> int:
    """Envía push web. Si pywebpush no está disponible, registra en log."""
    if not user_ids:
        return 0

    subs = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id.in_(user_ids),
            PushSubscription.activo == True,  # noqa: E712
        )
        .all()
    )
    if not subs:
        logger.info(f"[Tributario] Sin suscripciones push para users={user_ids}")
        return 0

    try:
        from pywebpush import webpush, WebPushException  # type: ignore
        import json
        import os
        vapid_private = os.getenv("VAPID_PRIVATE_KEY")
        vapid_claims_email = os.getenv("VAPID_CLAIMS_EMAIL", "mailto:soporte@quevendi.pe")
    except ImportError:
        logger.warning(f"[Tributario] pywebpush no instalado — {len(subs)} suscripciones omitidas. "
                       f"Mensaje: {titulo} — {cuerpo}")
        return 0

    if not vapid_private:
        logger.warning("[Tributario] VAPID_PRIVATE_KEY no configurado — push omitido.")
        return 0

    enviadas = 0
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps({"title": titulo, "body": cuerpo, "url": url_accion}),
                vapid_private_key=vapid_private,
                vapid_claims={"sub": vapid_claims_email},
            )
            enviadas += 1
        except WebPushException as e:  # type: ignore
            logger.warning(f"[Tributario] Push fallida sub={sub.id}: {e}")
        except Exception as e:
            logger.warning(f"[Tributario] Push error sub={sub.id}: {e}")
    return enviadas


@router.post("/tributario/notificar")
async def notificar_vencimiento(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    config = _get_config_tributaria(db, current_user.store_id)
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    resumen = _calcular_resumen(db, current_user.store_id, today.month, today.year, config, store)

    titulo = "⚠️ Vence tu pago SUNAT"
    cuerpo = (
        f"Tienes S/ {resumen['impuesto_estimado']:.2f} por pagar. "
        f"Vence el {resumen['fecha_vencimiento']}. "
        f"¡{resumen['dias_restantes']} días!"
    )

    enviadas = 0
    if resumen["dias_restantes"] <= 5:
        enviadas = _enviar_push(db, [current_user.id], titulo, cuerpo)

    return {
        "ok": True,
        "dias_restantes": resumen["dias_restantes"],
        "enviadas": enviadas,
        "mensaje": cuerpo,
    }


# ──────────────────────────────────────────────────────────────────────────
# Job diario: recorre todos los stores activos y notifica a sus owners
# ──────────────────────────────────────────────────────────────────────────
async def enviar_alertas_vencimiento() -> dict:
    """Llamado por la tarea de fondo en main.py (lifespan)."""
    from app.core.database import SessionLocal
    db = SessionLocal()
    enviados = 0
    revisados = 0
    try:
        today = date.today()
        stores = db.query(Store).filter(Store.is_active == True).all()  # noqa: E712
        for store in stores:
            try:
                config = _get_config_tributaria(db, store.id)
                r = _calcular_resumen(db, store.id, today.month, today.year, config, store)
                if r["dias_restantes"] > 5 or r["dias_restantes"] < 0:
                    continue
                # Notificar a owners de la tienda
                owner_ids = [
                    u.id for u in db.query(User).filter(
                        User.store_id == store.id,
                        User.role.in_(("owner", "admin")),
                        User.is_active == True,  # noqa: E712
                    ).all()
                ]
                titulo = "⚠️ Vence tu pago SUNAT"
                cuerpo = (f"Tienes S/ {r['impuesto_estimado']:.2f} por pagar. "
                          f"Vence el {r['fecha_vencimiento']}. "
                          f"¡{r['dias_restantes']} días!")
                enviados += _enviar_push(db, owner_ids, titulo, cuerpo)
                revisados += 1
            except Exception as e:
                logger.warning(f"[Tributario] Store {store.id} error: {e}")
    finally:
        db.close()
    logger.info(f"[Tributario] Cron diario: {revisados} stores revisados, {enviados} push enviadas")
    return {"revisados": revisados, "enviadas": enviados}
