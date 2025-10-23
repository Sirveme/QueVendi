from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class UserLogin(BaseModel):
    dni: str = Field(..., min_length=8, max_length=8)
    pin: str = Field(..., min_length=4, max_length=4)

class UserCreate(BaseModel):
    dni: str = Field(..., min_length=8, max_length=8)
    pin: str = Field(..., min_length=4, max_length=4)
    full_name: str
    phone: Optional[str] = None
    store_id: int

class UserResponse(BaseModel):
    id: int
    dni: str
    full_name: str
    role: str
    store_id: int
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse