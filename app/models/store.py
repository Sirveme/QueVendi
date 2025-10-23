# ============================================
# ARCHIVO: app/models/store.py
# ============================================
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Store(Base):
    __tablename__ = "stores"
    
    id = Column(Integer, primary_key=True, index=True)
    ruc = Column(String(11), unique=True, index=True, nullable=False)
    business_name = Column(String(200), nullable=False)
    commercial_name = Column(String(200), nullable=False)
    address = Column(String(300), nullable=True)
    
    # Ubicación (para geolocalización futura)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    
    # Plan
    plan = Column(String(20), default="freemium")  # freemium, startup, business, superpro
    plan_start_date = Column(DateTime(timezone=True), server_default=func.now())
    
    # Estado
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relaciones
    users = relationship("User", back_populates="store")
    products = relationship("Product", back_populates="store")
    sales = relationship("Sale", back_populates="store")