from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    dni = Column(String(8), unique=True, index=True, nullable=False)
    pin_hash = Column(String, nullable=False)
    full_name = Column(String(100), nullable=False)
    phone = Column(String(15), nullable=True)
    
    # Relación con Store
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    store = relationship("Store", back_populates="users")
    
    # Rol
    role = Column(String(20), default="seller")  # owner, seller, cashier
    
    # Permisos
    can_register_purchases = Column(Boolean, default=False)
    can_view_analytics = Column(Boolean, default=False)
    
    # Estado
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relaciones
    sales = relationship("Sale", back_populates="user")