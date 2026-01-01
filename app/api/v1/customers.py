# ============================================
# CUSTOMERS - FastAPI Router (SQLAlchemy - SIN EMAIL)
# Ruta: app/api/v1/customers.py
# ============================================

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import get_current_user

router = APIRouter(prefix="/customers")

# ============================================
# MODELOS PYDANTIC
# ============================================

class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    reference: Optional[str] = None
    customer_type: str = "regular"
    credit_limit: Optional[float] = 500.00

class CustomerResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    customer_type: str
    credit_limit: Optional[float]

# ============================================
# ENDPOINTS
# ============================================

@router.get("/customers/search")
def search_customers(
    q: str = Query(..., min_length=1),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Buscar clientes por nombre o teléfono"""
    query = text("""
        SELECT 
            id,
            name,
            phone,
            customer_type,
            credit_limit
        FROM customers
        WHERE store_id = :store_id
          AND (
              name ILIKE :search 
              OR phone ILIKE :search
          )
        ORDER BY name
        LIMIT 10
    """)
    
    search_pattern = f"%{q}%"
    
    result = db.execute(
        query,
        {
            "store_id": current_user["store_id"],
            "search": search_pattern
        }
    )
    
    rows = result.fetchall()
    
    return [
        {
            "id": row[0],
            "name": row[1],
            "phone": row[2],
            "customer_type": row[3],
            "credit_limit": float(row[4]) if row[4] else None
        }
        for row in rows
    ]


@router.post("/customers")
def create_customer(
    customer: CustomerCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Crear nuevo cliente"""
    
    # Verificar si ya existe
    existing_query = text("""
        SELECT id FROM customers 
        WHERE store_id = :store_id 
          AND name ILIKE :name
    """)
    
    existing = db.execute(
        existing_query,
        {
            "store_id": current_user["store_id"],
            "name": customer.name
        }
    ).fetchone()
    
    if existing:
        # Ya existe, retornar existente
        get_query = text("""
            SELECT id, name, phone, address, reference, customer_type, credit_limit
            FROM customers
            WHERE id = :id
        """)
        
        result = db.execute(get_query, {"id": existing[0]}).fetchone()
        
        return {
            "id": result[0],
            "name": result[1],
            "phone": result[2],
            "address": result[3],
            "reference": result[4],
            "customer_type": result[5],
            "credit_limit": float(result[6]) if result[6] else None
        }
    
    # Crear nuevo
    insert_query = text("""
        INSERT INTO customers (
            store_id,
            name,
            phone,
            address,
            reference,
            customer_type,
            credit_limit,
            created_at
        ) VALUES (
            :store_id,
            :name,
            :phone,
            :address,
            :reference,
            :customer_type,
            :credit_limit,
            NOW()
        )
        RETURNING id, name, phone, address, reference, customer_type, credit_limit
    """)
    
    result = db.execute(
        insert_query,
        {
            "store_id": current_user["store_id"],
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
            "reference": customer.reference,
            "customer_type": customer.customer_type,
            "credit_limit": customer.credit_limit
        }
    )
    
    db.commit()
    
    row = result.fetchone()
    
    return {
        "id": row[0],
        "name": row[1],
        "phone": row[2],
        "address": row[3],
        "reference": row[4],
        "customer_type": row[5],
        "credit_limit": float(row[6]) if row[6] else None
    }


@router.get("/customers/{customer_id}")
def get_customer(
    customer_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Obtener cliente por ID"""
    query = text("""
        SELECT 
            id,
            name,
            phone,
            customer_type,
            credit_limit,
            last_credit_date,
            created_at
        FROM customers
        WHERE id = :customer_id 
          AND store_id = :store_id
    """)
    
    result = db.execute(
        query,
        {
            "customer_id": customer_id,
            "store_id": current_user["store_id"]
        }
    ).fetchone()
    
    if not result:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    return {
        "id": result[0],
        "name": result[1],
        "phone": result[2],
        "customer_type": result[3],
        "credit_limit": float(result[4]) if result[4] else None,
        "last_credit_date": result[5],
        "created_at": result[6]
    }


@router.get("/customers")
def list_customers(
    limit: int = 50,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Listar todos los clientes"""
    query = text("""
        SELECT 
            id,
            name,
            phone,
            customer_type,
            credit_limit,
            last_credit_date,
            created_at
        FROM customers
        WHERE store_id = :store_id
        ORDER BY name
        LIMIT :limit
    """)
    
    result = db.execute(
        query,
        {
            "store_id": current_user["store_id"],
            "limit": limit
        }
    )
    
    rows = result.fetchall()
    
    return [
        {
            "id": row[0],
            "name": row[1],
            "phone": row[2],
            "customer_type": row[3],
            "credit_limit": float(row[4]) if row[4] else None,
            "last_credit_date": row[5],
            "created_at": row[6]
        }
        for row in rows
    ]