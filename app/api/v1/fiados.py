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

# ============================================
# ENDPOINTS
# ============================================

@router.post("/fiados/registrar")
def registrar_fiado(
    fiado: FiadoCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Registrar un nuevo fiado"""
    try:
        query = text("""
            SELECT * FROM fiado_registrar(
                p_store_id := :store_id,
                p_customer_id := :customer_id,
                p_amount := :amount,
                p_due_date := :due_date,
                p_sale_id := :sale_id,
                p_notes := :notes
            )
        """)
        
        result = db.execute(
            query,
            {
                "store_id": current_user["store_id"],
                "customer_id": fiado.customer_id,
                "amount": float(fiado.amount),
                "due_date": fiado.due_date,
                "sale_id": fiado.sale_id,
                "notes": fiado.notes
            }
        )
        
        db.commit()
        
        row = result.fetchone()
        
        if not row:
            raise HTTPException(status_code=400, detail="No se pudo registrar el fiado")
        
        return {
            "credit_id": row[0],
            "customer_name": row[1],
            "amount": float(row[2]),
            "due_date": row[3],
            "status": row[4]
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/fiados/pagar")
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


@router.get("/fiados/cliente/{customer_id}")
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


@router.get("/fiados/reporte")
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


@router.post("/fiados/actualizar-vencidos")
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


@router.get("/fiados/resumen")
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