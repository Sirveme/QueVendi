# ============================================
# FIADOS - FastAPI Router (SQLAlchemy)
# Ruta: app/api/v1/fiados.py
# ============================================

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import get_current_user

router = APIRouter(prefix="/fiados")

# ============================================
# MODELOS PYDANTIC
# ============================================

class FiadoCreate(BaseModel):
    customer_id: int
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    due_date: date
    sale_id: Optional[int] = None
    notes: Optional[str] = None

class PagoCreate(BaseModel):
    credit_request_id: int
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    payment_method: str = "cash"
    notes: Optional[str] = None

class FiadoRegistrarFromSale(BaseModel):
    """Schema para registrar fiado desde el POS (dashboard_principal.js)"""
    customer_name: str
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    customer_dni: Optional[str] = None
    sale_id: int
    total_amount: float
    credit_days: int = 7
    reference_number: Optional[str] = None
    notes: Optional[str] = None

# ============================================
# ENDPOINTS
# ============================================

@router.post("/registrar")
def registrar_fiado(
    data: FiadoRegistrarFromSale,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Registrar fiado desde el POS"""
    from app.models.sale import Sale
    
    store_id = current_user.store_id if hasattr(current_user, 'store_id') else current_user.get("store_id")
    
    # Verificar que la venta existe
    sale = db.query(Sale).filter(
        Sale.id == data.sale_id,
        Sale.store_id == store_id
    ).first()
    
    if not sale:
        raise HTTPException(404, "Venta no encontrada")
    
    # Actualizar venta con datos de fiado
    sale.customer_name = data.customer_name
    sale.is_credit = True
    sale.payment_status = "pending"
    
    if data.customer_dni:
        sale.customer_dni = data.customer_dni
    if data.customer_phone:
        sale.customer_phone = data.customer_phone
    
    # Calcular vencimiento
    from datetime import timedelta
    due_date = datetime.now() + timedelta(days=data.credit_days)
    
    # Intentar crear Credit si la función SQL existe
    try:
        query = text("""
            SELECT * FROM fiado_registrar(
                p_store_id := :store_id,
                p_customer_id := NULL,
                p_amount := :amount,
                p_due_date := :due_date,
                p_sale_id := :sale_id,
                p_notes := :notes
            )
        """)
        result = db.execute(query, {
            "store_id": store_id,
            "amount": data.total_amount,
            "due_date": due_date.date(),
            "sale_id": data.sale_id,
            "notes": f"{data.customer_name} | Tel: {data.customer_phone or 'N/A'} | {data.notes or ''}"
        })
        db.commit()
        row = result.fetchone()
        credit_id = row[0] if row else None
    except Exception as e:
        db.rollback()
        # Si la función SQL no existe, solo guardar en la venta
        print(f"[Fiados] Función SQL no disponible: {e}")
        db.commit()
        credit_id = None
    
    return {
        "success": True,
        "credit_id": credit_id,
        "sale_id": sale.id,
        "customer_name": data.customer_name,
        "total": data.total_amount,
        "credit_days": data.credit_days,
        "due_date": due_date.isoformat()
    }


@router.post("/pagar")
def registrar_pago(
    pago: PagoCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Registrar un pago de fiado"""
    try:
        query = text("""
            SELECT * FROM fiado_registrar_pago(
                p_credit_request_id := :credit_request_id,
                p_amount := :amount,
                p_payment_method := :payment_method,
                p_notes := :notes
            )
        """)
        
        result = db.execute(
            query,
            {
                "credit_request_id": pago.credit_request_id,
                "amount": float(pago.amount),
                "payment_method": pago.payment_method,
                "notes": pago.notes
            }
        )
        
        db.commit()
        
        row = result.fetchone()
        
        if not row:
            raise HTTPException(status_code=400, detail="No se pudo registrar el pago")
        
        return {
            "payment_id": row[0],
            "credit_id": row[1],
            "amount_paid": float(row[2]),
            "remaining_balance": float(row[3]),
            "new_status": row[4]
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/cliente/{customer_id}")
def consultar_deuda_cliente(
    customer_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Consultar deuda de un cliente"""
    query = text("SELECT * FROM fiado_consultar_deuda(:customer_id)")
    
    result = db.execute(query, {"customer_id": customer_id})
    rows = result.fetchall()
    
    return [
        {
            "credit_id": row[0],
            "sale_id": row[1],
            "amount": float(row[2]),
            "amount_paid": float(row[3]),
            "balance": float(row[4]),
            "due_date": row[5],
            "days_overdue": row[6],
            "status": row[7],
            "notes": row[8]
        }
        for row in rows
    ]


@router.get("/reporte")
def reporte_fiados_tienda(
    status: Optional[str] = None,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reporte de fiados por tienda"""
    query = text("""
        SELECT * FROM fiado_reporte_tienda(
            p_store_id := :store_id,
            p_status := :status
        )
    """)
    
    result = db.execute(
        query,
        {
            "store_id": current_user["store_id"],
            "status": status
        }
    )
    
    rows = result.fetchall()
    
    return [
        {
            "customer_id": row[0],
            "customer_name": row[1],
            "customer_phone": row[2],
            "total_credits": row[3],
            "total_amount": float(row[4]),
            "total_paid": float(row[5]),
            "total_balance": float(row[6]),
            "days_overdue": row[7]
        }
        for row in rows
    ]


@router.post("/actualizar-vencidos")
def actualizar_vencidos(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Actualizar estado de créditos vencidos"""
    query = text("SELECT * FROM fiado_actualizar_vencidos(:store_id)")
    
    result = db.execute(query, {"store_id": current_user["store_id"]})
    db.commit()
    
    row = result.fetchone()
    
    return {
        "updated_count": row[0],
        "total_overdue_amount": float(row[1])
    }


@router.get("/resumen")
def resumen_general(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Resumen general de fiados de la tienda"""
    query = text("SELECT * FROM v_fiados_resumen WHERE store_id = :store_id")
    
    result = db.execute(query, {"store_id": current_user["store_id"]})
    row = result.fetchone()
    
    if not row:
        return {
            "clientes_con_deuda": 0,
            "total_fiados": 0,
            "monto_total": 0,
            "saldo_pendiente": 0
        }
    
    return {
        "store_id": row[0],
        "store_name": row[1],
        "clientes_con_deuda": row[2],
        "total_fiados": row[3],
        "monto_total": float(row[4]) if row[4] else 0,
        "total_pagado": float(row[5]) if row[5] else 0,
        "saldo_pendiente": float(row[6]) if row[6] else 0
    }