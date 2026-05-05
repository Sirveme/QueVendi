"""
Modelo Mensaje — chat en tiempo real (WebSocket)
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Mensaje(Base):
    __tablename__ = 'mensajes'

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey('stores.id'), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    receiver_id = Column(Integer, ForeignKey('users.id'), nullable=True)  # NULL = broadcast al store
    content = Column(Text, nullable=True)
    msg_type = Column(String(20), default='text')  # text, audio, image, video, system, notification
    media_url = Column(String(500), nullable=True)
    is_read = Column(Boolean, default=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)

    sender = relationship('User', foreign_keys=[sender_id])
    receiver = relationship('User', foreign_keys=[receiver_id])
