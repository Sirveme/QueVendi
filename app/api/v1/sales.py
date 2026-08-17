"""
Endpoints de ventas para QueVendí
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.sale import SaleCreate, SaleResponse
from app.services.sale_service import SaleService
from app.services.voice_service import VoiceService
from app.services.product_service import ProductService
from app.api.dependencies import get_current_user
from app.core.tiempo import dia_operativo_peru, hoy_peru
from app.models.user import User
from sqlalchemy import func, or_
from typing import List
from datetime import datetime, date, timezone
from pydantic import BaseModel

from app.models.sale import Sale
from fastapi.responses import HTMLResponse

from fastapi import Header
from typing import Optional as Opt
from datetime import datetime as dt


router = APIRouter(prefix="/sales")

class VoiceCommandRequest(BaseModel):
    """Comando de voz"""
    text: str

@router.post("/voice/parse")
async def parse_voice_command(
    command: VoiceCommandRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Parsear comando de voz y procesar acción
    Soporta: ventas, agregar, cambiar, cancelar, confirmar, quitar
    """
    parsed = VoiceService.parse_command(command.text)
    
    if not parsed:
        raise HTTPException(
            status_code=400,
            detail="No se pudo entender el comando"
        )
    
    # Comandos simples
    if parsed['type'] in ['cancel', 'confirm']:
        return {
            "type": parsed['type'],
            "message": "Comando recibido"
        }
    
    # 🆕 AGREGAR: Consulta de total
    if parsed['type'] == 'query_total':
        return {
            "type": "query_total",
            "message": "¿Cuánto va?"
        }
    
    # 🆕 AGREGAR: Venta por precio objetivo
    if parsed['type'] == 'sale_by_price':
        product_service = ProductService(db)
        products = product_service.get_products_by_store(current_user.store_id)
        
        VoiceService._last_ambiguous_options = []
        product = VoiceService.find_product_fuzzy(parsed['product_query'], products)
        
        if product is None and VoiceService._last_ambiguous_options:
            return {
                "type": "ambiguous_sale_by_price",
                "product_query": parsed['product_query'],
                "target_amount": parsed['target_amount'],
                "options": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "price": p.sale_price,
                        "unit": getattr(p, 'unit', 'kg')
                    }
                    for p in VoiceService._last_ambiguous_options
                ],
                "message": f"¿Cuál {parsed['product_query']}?"
            }
        
        if not product:
            raise HTTPException(404, detail=f"No se encontró: {parsed['product_query']}")
        
        # Calcular cantidad basada en precio objetivo
        calculated_qty = parsed['target_amount'] / float(product.sale_price)
        unit = getattr(product, 'unit', 'kg')
        
        return {
            "type": "sale_by_price",
            "items": [{
                "product": {
                    "id": product.id,
                    "name": product.name,
                    "price": product.sale_price,
                    "unit": unit
                },
                "quantity": round(calculated_qty, 2),
                "subtotal": parsed['target_amount']
            }],
            "message": f"{round(calculated_qty, 2)} {unit} de {product.name} por S/. {parsed['target_amount']}"
        }

    # ========================================
    # COMANDO: REMOVE (quitar producto)
    # ========================================
    if parsed['type'] == 'remove':
        product_service = ProductService(db)
        products = product_service.get_products_by_store(current_user.store_id)
        
        # Limpiar opciones ambiguas previas
        VoiceService._last_ambiguous_options = []
        
        product = VoiceService.find_product_fuzzy(parsed['product_query'], products)
        
        # Verificar ambigüedad
        if product is None and VoiceService._last_ambiguous_options:
            return {
                "type": "ambiguous_remove",
                "product_query": parsed['product_query'],
                "options": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "price": p.sale_price
                    }
                    for p in VoiceService._last_ambiguous_options
                ],
                "message": f"¿Cuál {parsed['product_query']} quieres eliminar?"
            }
        
        if not product:
            raise HTTPException(
                status_code=404,
                detail=f"No se encontró: {parsed['product_query']}"
            )
        
        return {
            "type": "remove",
            "product": {
                "id": product.id,
                "name": product.name
            },
            "message": f"Eliminar {product.name} del carrito"
        }
    
    # ========================================
    # COMANDO: CHANGE_PRICE (cambiar precio)
    # ========================================
    if parsed['type'] == 'change_price':
        # 🔒 Validar owner
        if parsed.get('requires_owner') and current_user.role != 'owner':
            raise HTTPException(
                status_code=403,
                detail="Solo el dueño puede cambiar precios. Contacta al administrador."
            )
        
        product_service = ProductService(db)
        products = product_service.get_products_by_store(current_user.store_id)
        
        # 1. Limpiar opciones ambiguas ANTES de buscar
        VoiceService._last_ambiguous_options = []
        
        # 2. Buscar producto UNA SOLA VEZ
        product = VoiceService.find_product_fuzzy(parsed['product_query'], products)
        
        # 3. Logs DESPUÉS de buscar
        print(f"[API] Producto encontrado: {product.name if product else 'None'}")
        print(f"[API] Opciones ambiguas: {len(VoiceService._last_ambiguous_options)}")
        if VoiceService._last_ambiguous_options:
            print(f"[API] Nombres: {[p.name for p in VoiceService._last_ambiguous_options]}")
        
        # 4. Verificar ambigüedad
        if product is None and VoiceService._last_ambiguous_options:
            return {
                "type": "ambiguous_price",
                "product_query": parsed['product_query'],
                "new_price": parsed['new_price'],
                "options": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "price": p.sale_price
                    }
                    for p in VoiceService._last_ambiguous_options
                ],
                "message": f"¿A cuál {parsed['product_query']} cambiar el precio?"
            }
        
        # 5. Si no encontró nada
        if not product:
            raise HTTPException(
                status_code=404,
                detail=f"No se encontró: {parsed['product_query']}"
            )
        
        # 6. Retornar resultado
        return {
            "type": "change_price",
            "product": {
                "id": product.id,
                "name": product.name,
                "current_price": product.sale_price
            },
            "new_price": parsed['new_price']
        }
    
    # ========================================
    # COMANDO: CHANGE_PRODUCT (cambiar X por Y)
    # ========================================
    if parsed['type'] == 'change_product':
        product_service = ProductService(db)
        products = product_service.get_products_by_store(current_user.store_id)
        
        # Buscar producto viejo
        VoiceService._last_ambiguous_options = []
        old_product = VoiceService.find_product_fuzzy(parsed['old_product'], products)
        
        if old_product is None and VoiceService._last_ambiguous_options:
            return {
                "type": "ambiguous_change_old",
                "old_product_query": parsed['old_product'],
                "new_product_query": parsed['new_product'],
                "options": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "price": p.sale_price
                    }
                    for p in VoiceService._last_ambiguous_options
                ],
                "message": f"¿Cuál {parsed['old_product']} quieres cambiar?"
            }
        
        if not old_product:
            raise HTTPException(404, detail=f"No se encontró: {parsed['old_product']}")
        
        # Buscar producto nuevo
        VoiceService._last_ambiguous_options = []
        new_product = VoiceService.find_product_fuzzy(parsed['new_product'], products)
        
        if new_product is None and VoiceService._last_ambiguous_options:
            return {
                "type": "ambiguous_change_new",
                "old_product": {
                    "id": old_product.id,
                    "name": old_product.name
                },
                "new_product_query": parsed['new_product'],
                "options": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "price": p.sale_price
                    }
                    for p in VoiceService._last_ambiguous_options
                ],
                "message": f"¿Por cuál {parsed['new_product']} cambiar?"
            }
        
        if not new_product:
            raise HTTPException(404, detail=f"No se encontró: {parsed['new_product']}")
        
        return {
            "type": "change_product",
            "old_product": {
                "id": old_product.id,
                "name": old_product.name
            },
            "new_product": {
                "id": new_product.id,
                "name": new_product.name,
                "price": new_product.sale_price
            }
        }
    
    # ========================================
    # COMANDO: SALE / ADD (venta o agregar)
    # ========================================
    product_service = ProductService(db)
    products = product_service.get_products_by_store(current_user.store_id)

    # ⬇️⬇️⬇️ AGREGAR ESTE LOG ⬇️⬇️⬇️
    print(f"[API] Productos disponibles en tienda: {len(products)}")
    # ⬆️⬆️⬆️ FIN LOG ⬆️⬆️⬆️
    
    cart_items = []
    not_found = []
    ambiguous_items = []  # ✅ NUEVO: Lista de items ambiguos
    
    for item in parsed['items']:
        # ⬇️⬇️⬇️ AGREGAR ESTE LOG ⬇️⬇️⬇️
        print(f"[API] 🔍 Buscando: '{item['product_query']}'")
        # ⬆️⬆️⬆️ FIN LOG ⬆️⬆️⬆️

        # Limpiar opciones ambiguas previas antes de cada búsqueda
        VoiceService._last_ambiguous_options = []
        
        # ⬇️⬇️⬇️ AGREGAR ESTE LOG ⬇️⬇️⬇️
        print(f"[API] 📞 Llamando a find_product_fuzzy()...")
        # ⬆️⬆️⬆️ FIN LOG ⬆️⬆️⬆️

        product = VoiceService.find_product_fuzzy(item['product_query'], products)

         # ⬇️⬇️⬇️ AGREGAR ESTE LOG ⬇️⬇️⬇️
        print(f"[API] ✅ Retornó: {product.name if product else 'None'}")
        print(f"[API] 📋 Opciones ambiguas: {len(VoiceService._last_ambiguous_options)}")
        if VoiceService._last_ambiguous_options:
            print(f"[API] 📋 Nombres: {[p.name for p in VoiceService._last_ambiguous_options]}")
        # ⬆️⬆️⬆️ FIN LOG ⬆️⬆️⬆️
        
        # ✅ NUEVO: Verificar si hay ambigüedad
        if product is None and VoiceService._last_ambiguous_options:
            ambiguous_items.append({
                'query': item['product_query'],
                'quantity': item['quantity'],
                'options': [
                    {
                        'id': p.id,
                        'name': p.name,
                        'price': p.sale_price,
                        'stock': p.stock
                    }
                    for p in VoiceService._last_ambiguous_options
                ]
            })
            continue
        
        if not product:
            not_found.append(item['product_query'])
            continue
        
        # Verificar stock
        if product.stock < item['quantity']:
            raise HTTPException(
                status_code=400,
                detail=f"{product.name}: Stock insuficiente. Solo hay {product.stock}"
            )
        
        subtotal = product.sale_price * item['quantity']
        unit = getattr(product, 'unit', 'unidad')
        
        cart_items.append({
            "product": {
                "id": product.id,
                "name": product.name,
                "price": product.sale_price,
                "stock": product.stock,
                "category": product.category,
                "unit": unit
            },
            "quantity": item['quantity'],
            "subtotal": subtotal
        })
    
    # ✅ NUEVO: Si hay items ambiguos, devolver para que el usuario elija
    if ambiguous_items:
        return {
            "type": "ambiguous",
            "ambiguous_items": ambiguous_items,
            "found_items": cart_items,  # Items que sí se encontraron
            "message": "Hay varios productos que coinciden. ¿Cuál quieres?"
        }
    
    # Si no se encontró nada
    if not cart_items:
        raise HTTPException(
            status_code=404,
            detail=f"No se encontraron: {', '.join(not_found)}"
        )
    
    # Respuesta exitosa
    response = {
        "type": parsed['type'],
        "items": cart_items,
        "total": sum(item['subtotal'] for item in cart_items)
    }
    
    if not_found:
        response["warning"] = f"No se encontraron: {', '.join(not_found)}"
    
    return response

@router.post("", response_model=SaleResponse)
async def create_sale(
    sale_data: SaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    # Headers opcionales para ventas offline
    x_offline_sale: Opt[str] = Header(None),
    x_verification_code: Opt[str] = Header(None),
    x_created_at: Opt[str] = Header(None),
    x_local_id: Opt[str] = Header(None),
):
    """Crear venta (normal u offline sincronizada)"""
    
    # ── Detectar duplicados offline ──
    if x_verification_code:
        existing = db.query(Sale).filter(
            Sale.verification_code == x_verification_code
        ).first()
        if existing:
            # Ya se sincronizó antes → retornar la existente (idempotente)
            sale_service = SaleService(db)
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "Venta ya sincronizada",
                    "sale_id": existing.id,
                    "verification_code": x_verification_code
                }
            )
    
    # ── Crear venta normal ──
    sale_service = SaleService(db)
    sale = sale_service.create_sale(sale_data, current_user.id, current_user.store_id)
    
    # ── Si es venta offline, guardar campos extra ──
    if x_offline_sale == "true" and x_verification_code:
        sale.is_offline = True
        sale.verification_code = x_verification_code
        
        if x_created_at:
            try:
                sale.offline_created_at = dt.fromisoformat(x_created_at.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                sale.offline_created_at = None
        
        db.commit()
        db.refresh(sale)
        print(f"[Sales] ✅ Venta offline sincronizada: ID {sale.id}, code={x_verification_code}")
    
    return sale_service.to_response(sale)


# ════════════════════════════════════════════════
# PAGOS MÚLTIPLES POR VENTA
# ════════════════════════════════════════════════

class PagoIn(BaseModel):
    metodo: str
    monto: float
    referencia: Opt[str] = None


@router.get("/{sale_id}/pagos")
async def listar_pagos_venta(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Pagos de la venta, con total pagado y saldo pendiente."""
    from app.services import sale_pagos_service as sps
    from app.services.comanda_service import _ensure_tables
    _ensure_tables(db)

    data = sps.resumen(db, sale_id, current_user.store_id)
    if data is None:
        raise HTTPException(404, "Venta no encontrada")
    return data


@router.post("/{sale_id}/pagos", status_code=201)
async def agregar_pago_venta(
    sale_id: int,
    req: PagoIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Registra un pago parcial. Se llama una vez por método hasta cubrir
    el total (Yape S/40 → efectivo S/20 → tarjeta S/12).
    """
    from app.services import sale_pagos_service as sps
    from app.services.comanda_service import _ensure_tables
    _ensure_tables(db)

    try:
        pago = sps.agregar(db, sale_id, current_user.store_id,
                           req.metodo, req.monto, req.referencia)
        db.commit()
    except LookupError:
        db.rollback()
        raise HTTPException(404, "Venta no encontrada")
    except ValueError as e:
        db.rollback()
        raise HTTPException(422, str(e))
    except Exception as e:
        db.rollback()
        print(f"[Sales] Error agregando pago: {e}")
        raise HTTPException(500, "No se pudo registrar el pago")

    return {"success": True, "pago": pago,
            "resumen": sps.resumen(db, sale_id, current_user.store_id)}


@router.delete("/{sale_id}/pagos/{pago_id}")
async def eliminar_pago_venta(
    sale_id: int,
    pago_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Borra un pago mal registrado. Sólo dueño o administrador."""
    from app.services import sale_pagos_service as sps
    from app.services.comanda_service import _ensure_tables
    _ensure_tables(db)

    if getattr(current_user, "role", None) not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Sólo el dueño puede eliminar un pago")

    try:
        ok = sps.eliminar(db, sale_id, current_user.store_id, pago_id)
        db.commit()
    except LookupError:
        db.rollback()
        raise HTTPException(404, "Venta no encontrada")

    if not ok:
        raise HTTPException(404, "Pago no encontrado")
    return {"success": True,
            "resumen": sps.resumen(db, sale_id, current_user.store_id)}


@router.get("/today", response_model=List[SaleResponse])
async def get_today_sales(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Ventas del día"""
    sale_service = SaleService(db)
    sales = sale_service.get_sales_by_date(current_user.store_id)
    return [sale_service.to_response(sale) for sale in sales]

@router.get("/today/total")
async def get_today_total(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Total del día"""
    sale_service = SaleService(db)
    sales = sale_service.get_sales_by_date(current_user.store_id)
    
    total = sum(sale.total for sale in sales)
    
    return {
        "total": round(total, 2),
        "count": len(sales),
        "date": hoy_peru().isoformat()
    }

@router.get("/stats/today")
async def get_today_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Estadísticas del día para alertas"""
    sale_service = SaleService(db)
    product_service = ProductService(db)
    
    sales = sale_service.get_sales_by_date(current_user.store_id)
    products = product_service.get_products_by_store(current_user.store_id)
    
    # Productos agotados o cerca
    low_stock = []
    for p in products:
        if p.stock == 0:
            low_stock.append({"name": p.name, "stock": 0})
        elif p.min_stock_alert and p.stock <= p.min_stock_alert:
            low_stock.append({"name": p.name, "stock": p.stock})
    
    return {
        "sales_count": len(sales),
        "total": sum(s.total for s in sales),
        "low_stock": low_stock,
        "last_sale": sales[0].created_at if sales else None
    }

"""
Endpoints de ventas para QueVendí
AGREGAR estos nuevos endpoints HTML al archivo sales.py existente
"""

@router.get("/today/html", response_class=HTMLResponse)
async def get_today_sales_html(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Ventas del día en formato HTML para HTMX
    """
    sale_service = SaleService(db)
    sales = sale_service.get_sales_by_date(current_user.store_id)
    
    # ✅ SI NO HAY VENTAS
    if not sales or len(sales) == 0:
        return HTMLResponse(content="""
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <div class="empty-title">No hay ventas hoy</div>
                <div class="empty-subtitle">Las ventas aparecerán aquí automáticamente</div>
            </div>
        """)
    
    # ✅ SI HAY VENTAS
    html_items = []
    for sale in sales:
        items_text = ", ".join([
            f"{item.quantity}x {item.product.name}" 
            for item in sale.items
        ])
        
        payment_data = {
            'efectivo': {'text': 'Efectivo', 'color': '#10b981', 'bg': 'rgba(16, 185, 129, 0.15)'},
            'yape': {'text': 'Yape', 'color': '#8b5cf6', 'bg': 'rgba(139, 92, 246, 0.15)'},
            'plin': {'text': 'Plin', 'color': '#3b82f6', 'bg': 'rgba(59, 130, 246, 0.15)'}
        }.get(sale.payment_method.lower(), {'text': 'Otro', 'color': '#64748b', 'bg': 'rgba(100, 116, 139, 0.15)'})
        
        time_str = sale.created_at.strftime('%H:%M')
        
        html_items.append(f"""
            <div class="sale-card">
                <div class="sale-header">
                    <span class="sale-time">{time_str}</span>
                    <span class="payment-badge-{sale.id}">{payment_data['text']}</span>
                    <span class="sale-total">S/. {sale.total:.2f}</span>
                </div>
                <div class="sale-items">{items_text}</div>
            </div>
            <style>
                .payment-badge-{sale.id} {{
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    background: {payment_data['bg']} !important;
                    color: {payment_data['color']} !important;
                    padding: 4px 10px !important;
                    border-radius: 6px !important;
                    font-size: 12px !important;
                    font-weight: 600 !important;
                    border: 1px solid {payment_data['color']}40 !important;
                    text-transform: uppercase !important;
                    letter-spacing: 0.5px !important;
                    min-width: 60px !important;
                }}
                .payment-badge-{sale.id}::before,
                .payment-badge-{sale.id}::after {{
                    content: none !important;
                    display: none !important;
                    background-image: none !important;
                }}
            </style>
        """)
    
    return HTMLResponse(content="\n".join(html_items))


@router.get("/today/total/html", response_class=HTMLResponse)
async def get_today_total_html(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Resumen del día en formato HTML para HTMX
    """
    sale_service = SaleService(db)
    sales = sale_service.get_sales_by_date(current_user.store_id)
    
    count = len(sales)
    total = sum(sale.total for sale in sales) if sales else 0.0
    
    return HTMLResponse(content=f"""
        <div class="summary-item">
            <div class="summary-label">Ventas</div>
            <div class="summary-value">{count}</div>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-item">
            <div class="summary-label">Total</div>
            <div class="summary-value">S/. {total:.2f}</div>
        </div>
    """)


@router.get("/voice/settings")
async def get_voice_settings(
    current_user: User = Depends(get_current_user)
):
    """Obtener configuración de voz del usuario"""
    # Por ahora retornar configuración por defecto
    return {
        "voice": "es-PE-Standard-A",
        "speed": 1.0,
        "enabled": True
    }

@router.post("/voice/settings")
async def save_voice_settings(
    settings: dict,
    current_user: User = Depends(get_current_user)
):
    """Guardar configuración de voz"""
    # Por ahora solo retornar éxito
    return {"message": "Configuración guardada", "settings": settings}


@router.get("/today/summary")  # ⬅️ SIN /sales
async def get_today_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Resumen de ventas del día"""
    today = hoy_peru()
    try:
        from app.models.sale import Sale

        # Ventana del día operativo de Lima (el servidor corre en UTC).
        dia_inicio, dia_fin = dia_operativo_peru(today)

        sales = db.query(Sale).filter(
            Sale.store_id == current_user.store_id,
            Sale.created_at >= dia_inicio,
            Sale.created_at < dia_fin
        ).all()

        total = sum(float(sale.total) for sale in sales)

        return {
            "count": len(sales),
            "total": total,
            "date": today.isoformat()
        }
    except Exception as e:
        print(f"[Sales Summary] ERROR: {str(e)}")
        return {"count": 0, "total": 0.0, "date": today.isoformat()}
    


@router.post("/{sale_id}/void")
async def void_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Anular una venta"""
    sale = db.query(Sale).filter(
        Sale.id == sale_id,
        Sale.store_id == current_user.store_id
    ).first()
    
    if not sale:
        raise HTTPException(404, "Venta no encontrada")

    if sale.status == "cancelled":
        return {"message": "La venta ya estaba anulada", "sale_id": sale_id}

    # El modelo usa status/cancelled_at/cancelled_by. Antes se asignaban
    # `voided`, `voided_at` y `voided_by`, que no son columnas: SQLAlchemy
    # aceptaba el atributo sin guardarlo, así que el endpoint respondía
    # 200 y la venta seguía activa.
    sale.status = "cancelled"
    sale.cancelled_at = datetime.now(timezone.utc)
    sale.cancelled_by = current_user.id
    db.commit()

    return {"message": "Venta anulada", "sale_id": sale_id}