# app/api/v1/endpoints/credits.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, date, timedelta
from decimal import Decimal
from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.customer import Customer
from app.models.credit import Credit, CreditPayment
from app.schemas.credit import (
    CreditCreate, CreditUpdate, CreditResponse,
    CreditPaymentCreate, CreditPaymentResponse,
    FiadoCompleteCreate
)

router = APIRouter()

@router.post("/registrar", response_model=CreditResponse, status_code=201)
def registrar_fiado_completo(
    fiado_in: FiadoCompleteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Registrar fiado completo: crear cliente (si no existe) y crédito en una sola operación
    """
    print(f"[Fiados] Registrando fiado para: {fiado_in.customer_name}")
    
    # 1. Buscar o crear cliente
    customer = db.query(Customer).filter(
        Customer.store_id == current_user.store_id,
        Customer.name == fiado_in.customer_name,
        Customer.phone == fiado_in.customer_phone
    ).first()
    
    if not customer:
        print(f"[Fiados] Creando nuevo cliente")
        customer = Customer(
            store_id=current_user.store_id,
            name=fiado_in.customer_name,
            phone=fiado_in.customer_phone,
            address=fiado_in.customer_address,
            dni=fiado_in.customer_dni
        )
        db.add(customer)
        db.flush()  # Para obtener customer.id
        print(f"[Fiados] Cliente creado: ID {customer.id}")
    else:
        print(f"[Fiados] Cliente existente: ID {customer.id}")
    
    # 2. Calcular fecha de vencimiento
    due_date = date.today() + timedelta(days=fiado_in.credit_days)
    
    # 3. Crear crédito
    credit = Credit(
        store_id=current_user.store_id,
        customer_id=customer.id,
        sale_id=fiado_in.sale_id,
        total_amount=fiado_in.total_amount,
        paid_amount=Decimal('0.0'),
        remaining_amount=fiado_in.total_amount,
        credit_days=fiado_in.credit_days,
        due_date=due_date,
        reference_number=fiado_in.reference_number,
        notes=fiado_in.notes,
        status='pending'
    )
    
    db.add(credit)
    db.commit()
    db.refresh(credit)
    
    print(f"[Fiados] ✅ Crédito registrado: ID {credit.id}, Vence: {due_date}")
    
    return credit


@router.post("/", response_model=CreditResponse, status_code=201)
def create_credit(
    credit_in: CreditCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Crear nuevo crédito (requiere customer_id existente)
    """
    print(f"[Credits] Creando crédito para customer {credit_in.customer_id}")
    
    # Verificar que el cliente existe
    customer = db.query(Customer).filter(
        Customer.id == credit_in.customer_id,
        Customer.store_id == credit_in.store_id
    ).first()
    
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    # Calcular fecha de vencimiento
    due_date = date.today() + timedelta(days=credit_in.credit_days)
    
    credit = Credit(
        store_id=credit_in.store_id,
        customer_id=credit_in.customer_id,
        sale_id=credit_in.sale_id,
        total_amount=credit_in.total_amount,
        paid_amount=Decimal('0.0'),
        remaining_amount=credit_in.total_amount,
        credit_days=credit_in.credit_days,
        due_date=due_date,
        reference_number=credit_in.reference_number,
        notes=credit_in.notes,
        status='pending'
    )
    
    db.add(credit)
    db.commit()
    db.refresh(credit)
    
    print(f"[Credits] ✅ Crédito creado: ID {credit.id}")
    return credit


@router.get("/pending", response_model=List[CreditResponse])
def get_pending_credits(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Obtener todos los créditos pendientes
    """
    credits = db.query(Credit).filter(
        Credit.store_id == current_user.store_id,
        Credit.status.in_(['pending', 'partial'])
    ).order_by(Credit.due_date).all()
    
    print(f"[Credits] Créditos pendientes: {len(credits)}")
    return credits


@router.get("/overdue", response_model=List[CreditResponse])
def get_overdue_credits(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Obtener créditos vencidos
    """
    today = date.today()
    
    credits = db.query(Credit).filter(
        Credit.store_id == current_user.store_id,
        Credit.status.in_(['pending', 'partial']),
        Credit.due_date < today
    ).order_by(Credit.due_date).all()
    
    # Marcar como vencidos
    for credit in credits:
        if not credit.is_overdue:
            credit.is_overdue = True
            credit.status = 'overdue' if credit.status == 'pending' else credit.status
    
    db.commit()
    
    print(f"[Credits] Créditos vencidos: {len(credits)}")
    return credits


@router.get("/customer/{customer_id}", response_model=List[CreditResponse])
def get_customer_credits(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Obtener todos los créditos de un cliente
    """
    credits = db.query(Credit).filter(
        Credit.store_id == current_user.store_id,
        Credit.customer_id == customer_id
    ).order_by(Credit.credit_date.desc()).all()
    
    print(f"[Credits] Créditos del cliente {customer_id}: {len(credits)}")
    return credits


@router.get("/{credit_id}", response_model=CreditResponse)
def get_credit(
    credit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Obtener crédito por ID
    """
    credit = db.query(Credit).filter(
        Credit.id == credit_id,
        Credit.store_id == current_user.store_id
    ).first()
    
    if not credit:
        raise HTTPException(status_code=404, detail="Crédito no encontrado")
    
    return credit


@router.post("/{credit_id}/payment", response_model=CreditResponse)
def add_payment(
    credit_id: int,
    payment_in: CreditPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Registrar pago parcial o total de un crédito
    """
    credit = db.query(Credit).filter(
        Credit.id == credit_id,
        Credit.store_id == current_user.store_id
    ).first()
    
    if not credit:
        raise HTTPException(status_code=404, detail="Crédito no encontrado")
    
    if credit.status == 'paid':
        raise HTTPException(status_code=400, detail="Este crédito ya está pagado")
    
    # Validar que el monto no exceda lo pendiente
    if payment_in.amount > credit.remaining_amount:
        raise HTTPException(
            status_code=400, 
            detail=f"Monto excede lo pendiente (S/. {credit.remaining_amount})"
        )
    
    # Registrar pago
    payment = CreditPayment(
        credit_id=credit_id,
        amount=payment_in.amount,
        payment_method=payment_in.payment_method,
        payment_reference=payment_in.payment_reference,
        notes=payment_in.notes,
        created_by=current_user.id
    )
    
    db.add(payment)
    
    # Actualizar crédito
    credit.paid_amount += payment_in.amount
    credit.remaining_amount -= payment_in.amount
    
    # Actualizar estado
    if credit.remaining_amount <= 0:
        credit.status = 'paid'
        credit.paid_date = datetime.utcnow()
    elif credit.paid_amount > 0:
        credit.status = 'partial'
    
    db.commit()
    db.refresh(credit)
    
    print(f"[Credits] ✅ Pago registrado: S/. {payment_in.amount}, Restante: S/. {credit.remaining_amount}")
    
    return credit


@router.get("/{credit_id}/payments", response_model=List[CreditPaymentResponse])
def get_credit_payments(
    credit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Obtener historial de pagos de un crédito
    """
    credit = db.query(Credit).filter(
        Credit.id == credit_id,
        Credit.store_id == current_user.store_id
    ).first()
    
    if not credit:
        raise HTTPException(status_code=404, detail="Crédito no encontrado")
    
    payments = db.query(CreditPayment).filter(
        CreditPayment.credit_id == credit_id
    ).order_by(CreditPayment.payment_date.desc()).all()
    
    print(f"[Credits] Pagos del crédito {credit_id}: {len(payments)}")
    return payments


@router.put("/{credit_id}", response_model=CreditResponse)
def update_credit(
    credit_id: int,
    credit_in: CreditUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Actualizar crédito
    """
    credit = db.query(Credit).filter(
        Credit.id == credit_id,
        Credit.store_id == current_user.store_id
    ).first()
    
    if not credit:
        raise HTTPException(status_code=404, detail="Crédito no encontrado")
    
    update_data = credit_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(credit, field, value)
    
    db.commit()
    db.refresh(credit)
    
    print(f"[Credits] ✅ Crédito actualizado: ID {credit_id}")
    return credit