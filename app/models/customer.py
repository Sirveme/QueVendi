# app/models/customer.py
from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base

class Customer(Base):
    __tablename__ = 'customers'
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, nullable=False, index=True)
    
    # Datos personales
    name = Column(String(200), nullable=False)
    phone = Column(String(20), nullable=True)
    address = Column(String(300), nullable=True)
    dni = Column(String(8), nullable=True)
    email = Column(String(100), nullable=True)
    
    # Control
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relaciones
    credits = relationship("Credit", back_populates="customer")
    
    def __repr__(self):
        return f"<Customer {self.name}>"