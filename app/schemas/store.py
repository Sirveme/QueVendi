# app/schemas/store.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class StoreBase(BaseModel):
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    
class StoreCreate(StoreBase):
    pass

class StoreResponse(StoreBase):
    id: int
    owner_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True