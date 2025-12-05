from sqlalchemy import Column, Integer, String, Boolean, Float, JSON, DateTime, Text
from sqlalchemy.sql import func
from app.core.database import Base

class VoiceCommandLog(Base):
    __tablename__ = "voice_commands_log"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, nullable=False, index=True)
    user_id = Column(Integer, nullable=True)
    
    # Input
    transcript = Column(Text, nullable=False)
    
    # Processing
    api_used = Column(String(20), nullable=False)  # 'claude' | 'openai' | 'gemini' | 'free'
    parsed_result = Column(JSON, nullable=True)
    
    # Results
    products_found = Column(Integer, default=0)
    products_added = Column(Integer, default=0)
    success = Column(Boolean, default=False)
    
    # Performance
    latency_ms = Column(Integer, nullable=True)
    cost_usd = Column(Float, default=0.0)
    
    # Metadata
    error_message = Column(Text, nullable=True)
    session_id = Column(String(50), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    def __repr__(self):
        return f"<VoiceLog {self.id}: {self.transcript[:30]}... via {self.api_used}>"