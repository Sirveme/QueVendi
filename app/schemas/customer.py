# app/schemas/customer.py
from pydantic import BaseModel, validator
from typing import Optional
from datetime import datetime

class CustomerBase(BaseModel):
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    dni: Optional[str] = None
    email: Optional[str] = None

class CustomerCreate(CustomerBase):
    store_id: int
    
    @validator('name')
    def name_must_not_be_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('El nombre no puede estar vacío')
        return v.strip()
    
    @validator('phone')
    def phone_format(cls, v):
        if v and len(v) > 0:
            # Remover espacios y caracteres no numéricos
            v = ''.join(filter(str.isdigit, v))
            if len(v) < 7:
                raise ValueError('Teléfono debe tener al menos 7 dígitos')
        return v

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    dni: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None

class CustomerResponse(CustomerBase):
    id: int
    store_id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


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
    
    @validator('credit_days')
    def credit_days_valid(cls, v):
        if v not in [7, 15, 30, 60, 90]:
            raise ValueError('Días de crédito debe ser: 7, 15, 30, 60 o 90')
        return v

class CreditUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    is_overdue: Optional[bool] = None

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
    updated_at: datetime
    
    # Propiedades calculadas
    is_fully_paid: bool
    days_overdue: int
    
    class Config:
        from_attributes = True


class CreditPaymentCreate(BaseModel):
    credit_id: int
    amount: Decimal
    payment_method: str = 'cash'
    payment_reference: Optional[str] = None
    notes: Optional[str] = None
    
    @validator('amount')
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('El monto debe ser mayor a 0')
        return v
    
    @validator('payment_method')
    def payment_method_valid(cls, v):
        valid_methods = ['cash', 'transfer', 'yape', 'plin', 'card']
        if v not in valid_methods:
            raise ValueError(f'Método de pago inválido. Debe ser uno de: {valid_methods}')
        return v

class CreditPaymentResponse(BaseModel):
    id: int
    credit_id: int
    amount: Decimal
    payment_method: str
    payment_reference: Optional[str]
    payment_date: datetime
    notes: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


# Schema combinado para registrar fiado completo
class FiadoCompleteCreate(BaseModel):
    # Datos del cliente
    customer_name: str
    customer_phone: str
    customer_address: str
    customer_dni: Optional[str] = None
    
    # Datos del crédito
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
    
    @validator('customer_phone')
    def phone_required(cls, v):
        if not v or not v.strip():
            raise ValueError('Teléfono del cliente es obligatorio')
        return v.strip()