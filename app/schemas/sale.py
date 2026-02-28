from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class SaleItemCreate(BaseModel):
    product_id: int
    quantity: float = Field(..., gt=0)
    unit_price: float
    subtotal: float

class SaleCreate(BaseModel):
    items: List[SaleItemCreate]
    payment_method: str  # efectivo, yape, plin
    payment_reference: Optional[str] = None
    customer_name: Optional[str] = None
    is_credit: bool = False

class VoiceCommand(BaseModel):
    text: str
    store_id: int
    user_id: int

class SaleItemResponse(BaseModel):
    id: int
    product_id: int
    quantity: float
    unit_price: float
    subtotal: float
    product_name: str  # Lo agregamos en el service
    
    class Config:
        from_attributes = True

class SaleResponse(BaseModel):
    id: int
    total: float
    payment_method: str
    payment_reference: Optional[str]
    customer_name: Optional[str]
    is_credit: bool
    sale_date: datetime
    items: List[SaleItemResponse]
    user_name: str  # Lo agregamos en el service
    
    class Config:
        from_attributes = True