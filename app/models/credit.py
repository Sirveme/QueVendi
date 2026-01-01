# app/models/credit.py
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Numeric, ForeignKey, Date
from sqlalchemy.orm import relationship
from datetime import datetime, date, timedelta
from app.core.database import Base

class Credit(Base):
    __tablename__ = 'credits'
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey('customers.id'), nullable=False)
    sale_id = Column(Integer, ForeignKey('sales.id'), nullable=False)
    
    # Montos
    total_amount = Column(Numeric(10, 2), nullable=False)
    paid_amount = Column(Numeric(10, 2), default=0.0)
    remaining_amount = Column(Numeric(10, 2), nullable=False)
    
    # Fechas
    credit_date = Column(DateTime, default=datetime.utcnow)
    due_date = Column(Date, nullable=False)  # Fecha límite de pago
    paid_date = Column(DateTime, nullable=True)  # Cuando se pagó completamente
    
    # Días de crédito (7, 15, 30, etc.)
    credit_days = Column(Integer, default=7)
    
    # Referencias y notas
    reference_number = Column(String(50), nullable=True)  # Número de referencia único
    notes = Column(String(500), nullable=True)  # Notas adicionales
    
    # Estado
    status = Column(String(20), default='pending')  # pending, partial, paid, overdue
    is_overdue = Column(Boolean, default=False)
    
    # Control
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relaciones
    customer = relationship("Customer", back_populates="credits")
    sale = relationship("Sale", back_populates="credit")
    payments = relationship("CreditPayment", back_populates="credit")
    
    def __repr__(self):
        return f"<Credit #{self.id} Customer:{self.customer_id} Amount:{self.total_amount}>"
    
    @property
    def is_fully_paid(self):
        return self.paid_amount >= self.total_amount
    
    @property
    def days_overdue(self):
        if self.status == 'paid':
            return 0
        today = date.today()
        if today > self.due_date:
            return (today - self.due_date).days
        return 0


class CreditPayment(Base):
    __tablename__ = 'credit_payments'
    
    id = Column(Integer, primary_key=True, index=True)
    credit_id = Column(Integer, ForeignKey('credits.id'), nullable=False)
    
    # Monto del pago
    amount = Column(Numeric(10, 2), nullable=False)
    
    # Método de pago
    payment_method = Column(String(20), default='cash')  # cash, transfer, yape, plin
    payment_reference = Column(String(100), nullable=True)
    
    # Fecha
    payment_date = Column(DateTime, default=datetime.utcnow)
    
    # Notas
    notes = Column(String(300), nullable=True)
    
    # Control
    created_by = Column(Integer, nullable=True)  # user_id
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relación
    credit = relationship("Credit", back_populates="payments")
    
    def __repr__(self):
        return f"<CreditPayment #{self.id} Credit:{self.credit_id} Amount:{self.amount}>"