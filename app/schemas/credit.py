# app/schemas/credit.py
from pydantic import BaseModel, validator
from typing import Optional
from datetime import datetime, date
from decimal import Decimal

class CreditBase(BaseModel):
    customer_id: int
    sale_id: int
    total_amount: Decimal
    credit_days: int = 7
    reference_number: Optional[str] = None
    notes: Optional[str] = None

class CreditCreate(CreditBase):
    store_id: int
    
    @validator('total_amount')
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('El monto debe ser mayor a 0')
        return v

class CreditResponse(CreditBase):
    id: int
    store_id: int
    paid_amount: Decimal
    remaining_amount: Decimal
    credit_date: datetime
    due_date: date
    paid_date: Optional[datetime] = None
    status: str
    is_overdue: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class FiadoCompleteCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_address: str
    customer_dni: Optional[str] = None
    sale_id: int
    total_amount: Decimal
    credit_days: int = 7
    reference_number: Optional[str] = None
    notes: Optional[str] = None
    
    @validator('customer_name')
    def name_required(cls, v):
        if not v or not v.strip():
            raise ValueError('Nombre del cliente es obligatorio')
        return v.strip()