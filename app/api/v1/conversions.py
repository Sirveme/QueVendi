# ============================================
# CONVERSIONS - FastAPI Router
# Ruta: app/api/v1/conversions.py
# ============================================

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import get_current_user

router = APIRouter(prefix="/conversions")

# ============================================
# MODELOS PYDANTIC
# ============================================

class ConversionConfig(BaseModel):
    product_id: int
    base_unit: str  # "kg", "un", "L"
    base_price: Decimal = Field(..., gt=0)
    min_quantity: Optional[Decimal] = Field(0.01, gt=0)
    allow_currency_sale: bool = False
    allow_fractional: bool = False

class CalculateByAmount(BaseModel):
    product_id: int
    amount: Decimal = Field(..., gt=0)  # Monto en soles

class CalculateByQuantity(BaseModel):
    product_id: int
    quantity: Decimal = Field(..., gt=0)
    unit: Optional[str] = None

# ============================================
# ENDPOINTS
# ============================================

@router.post("/conversions/configure")
def configure_product_conversion(
    config: ConversionConfig,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Configurar producto para conversiones automáticas"""
    try:
        query = text("""
            SELECT configurar_producto_conversion(
                p_product_id := :product_id,
                p_base_unit := :base_unit,
                p_base_price := :base_price,
                p_min_quantity := :min_quantity,
                p_allow_currency := :allow_currency,
                p_allow_fractional := :allow_fractional
            )
        """)
        
        result = db.execute(
            query,
            {
                "product_id": config.product_id,
                "base_unit": config.base_unit,
                "base_price": float(config.base_price),
                "min_quantity": float(config.min_quantity),
                "allow_currency": config.allow_currency_sale,
                "allow_fractional": config.allow_fractional
            }
        )
        
        db.commit()
        
        return {
            "success": True,
            "message": "Producto configurado para conversiones"
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/conversions/calculate-by-amount")
def calculate_by_amount(
    data: CalculateByAmount,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Calcular cantidad desde monto
    Ejemplo: "Dame 1 sol de camote" (camote = S/.1.50/kg)
    """
    try:
        query = text("""
            SELECT * FROM calcular_cantidad_por_monto(
                p_product_id := :product_id,
                p_monto := :monto
            )
        """)
        
        result = db.execute(
            query,
            {
                "product_id": data.product_id,
                "monto": float(data.amount)
            }
        ).fetchone()
        
        if not result:
            raise HTTPException(
                status_code=400,
                detail="No se pudo calcular la conversión"
            )
        
        return {
            "product_id": data.product_id,
            "amount_paid": float(data.amount),
            "quantity": float(result[0]),
            "total_price": float(result[1]),
            "unit": result[2]
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/conversions/calculate-by-quantity")
def calculate_by_quantity(
    data: CalculateByQuantity,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Calcular precio desde cantidad
    Ejemplo: "Medio kilo de camote" (camote = S/.1.50/kg)
    """
    try:
        query = text("""
            SELECT * FROM calcular_precio_por_cantidad(
                p_product_id := :product_id,
                p_cantidad := :cantidad,
                p_unit := :unit
            )
        """)
        
        result = db.execute(
            query,
            {
                "product_id": data.product_id,
                "cantidad": float(data.quantity),
                "unit": data.unit
            }
        ).fetchone()
        
        if not result:
            raise HTTPException(
                status_code=400,
                detail="No se pudo calcular la conversión"
            )
        
        return {
            "product_id": data.product_id,
            "quantity": float(result[0]),
            "total_price": float(result[1]),
            "unit": result[2]
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/conversions/product/{product_id}")
def get_product_conversion_config(
    product_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Obtener configuración de conversiones de un producto"""
    query = text("""
        SELECT * FROM v_products_with_conversions
        WHERE id = :product_id
    """)
    
    result = db.execute(query, {"product_id": product_id}).fetchone()
    
    if not result:
        raise HTTPException(
            status_code=404,
            detail="Producto no tiene configuración de conversiones"
        )
    
    return {
        "id": result[0],
        "name": result[1],
        "listed_price": float(result[2]),
        "base_price": float(result[3]),
        "unit_name": result[4],
        "unit_abbr": result[5],
        "unit_type": result[6],
        "is_divisible": result[7],
        "min_quantity": float(result[8]),
        "allow_currency_sale": result[9],
        "allow_fractional": result[10]
    }


@router.get("/conversions/units")
def list_units(
    db: Session = Depends(get_db)
):
    """Listar todas las unidades de medida disponibles"""
    query = text("""
        SELECT 
            id,
            name,
            abbreviation,
            type,
            is_divisible
        FROM units_of_measure
        ORDER BY name
    """)
    
    result = db.execute(query)
    rows = result.fetchall()
    
    return [
        {
            "id": row[0],
            "name": row[1],
            "abbreviation": row[2],
            "type": row[3],
            "is_divisible": row[4]
        }
        for row in rows
    ]


@router.get("/conversions/products")
def list_products_with_conversions(
    store_id: Optional[int] = None,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Listar productos configurados con conversiones"""
    
    store_filter = store_id or current_user["store_id"]
    
    query = text("""
        SELECT * FROM v_products_with_conversions
        WHERE store_id = :store_id
        ORDER BY name
    """)
    
    result = db.execute(query, {"store_id": store_filter})
    rows = result.fetchall()
    
    return [
        {
            "id": row[0],
            "name": row[1],
            "listed_price": float(row[2]),
            "base_price": float(row[3]),
            "unit_name": row[4],
            "unit_abbr": row[5],
            "unit_type": row[6],
            "is_divisible": row[7],
            "min_quantity": float(row[8]),
            "allow_currency_sale": row[9],
            "allow_fractional": row[10]
        }
        for row in rows
    ]