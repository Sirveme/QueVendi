from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ProductBase(BaseModel):
    name: str
    aliases: List[str] = []
    category: Optional[str] = None
    cost_price: float = 0
    sale_price: float
    stock: int = 0
    min_stock_alert: int = 5

class ProductCreate(ProductBase):
    store_id: int

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    sale_price: Optional[float] = None
    stock: Optional[int] = None

class ProductResponse(ProductBase):
    id: int
    store_id: int
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True