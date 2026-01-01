# app/api/v1/endpoints/customers.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.customer import Customer
from app.schemas.customer import CustomerCreate, CustomerUpdate, CustomerResponse

router = APIRouter()

@router.post("/", response_model=CustomerResponse, status_code=201)
def create_customer(
    customer_in: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Crear nuevo cliente
    """
    print(f"[Customers] Creando cliente: {customer_in.name}")
    
    # Verificar si ya existe por nombre y teléfono
    existing = db.query(Customer).filter(
        Customer.store_id == customer_in.store_id,
        Customer.name == customer_in.name,
        Customer.phone == customer_in.phone
    ).first()
    
    if existing:
        print(f"[Customers] Cliente ya existe: ID {existing.id}")
        return existing
    
    # Crear nuevo cliente
    customer = Customer(
        store_id=customer_in.store_id,
        name=customer_in.name,
        phone=customer_in.phone,
        address=customer_in.address,
        dni=customer_in.dni,
        email=customer_in.email
    )
    
    db.add(customer)
    db.commit()
    db.refresh(customer)
    
    print(f"[Customers] ✅ Cliente creado: ID {customer.id}")
    return customer


@router.get("/search", response_model=List[CustomerResponse])
def search_customers(
    q: str = Query(..., min_length=2, description="Término de búsqueda"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Buscar clientes por nombre o teléfono
    """
    print(f"[Customers] Buscando: '{q}'")
    
    customers = db.query(Customer).filter(
        Customer.store_id == current_user.store_id,
        Customer.is_active == True,
        (Customer.name.ilike(f"%{q}%") | Customer.phone.ilike(f"%{q}%"))
    ).order_by(Customer.name).limit(20).all()
    
    print(f"[Customers] Encontrados: {len(customers)}")
    return customers


@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Obtener cliente por ID
    """
    customer = db.query(Customer).filter(
        Customer.id == customer_id,
        Customer.store_id == current_user.store_id
    ).first()
    
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    return customer


@router.get("/", response_model=List[CustomerResponse])
def list_customers(
    skip: int = 0,
    limit: int = 50,
    active_only: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Listar todos los clientes
    """
    query = db.query(Customer).filter(
        Customer.store_id == current_user.store_id
    )
    
    if active_only:
        query = query.filter(Customer.is_active == True)
    
    customers = query.order_by(Customer.name).offset(skip).limit(limit).all()
    
    print(f"[Customers] Lista: {len(customers)} clientes")
    return customers


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: int,
    customer_in: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Actualizar cliente
    """
    customer = db.query(Customer).filter(
        Customer.id == customer_id,
        Customer.store_id == current_user.store_id
    ).first()
    
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    # Actualizar campos
    update_data = customer_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(customer, field, value)
    
    db.commit()
    db.refresh(customer)
    
    print(f"[Customers] ✅ Cliente actualizado: ID {customer_id}")
    return customer


@router.delete("/{customer_id}")
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Eliminar cliente (soft delete)
    """
    customer = db.query(Customer).filter(
        Customer.id == customer_id,
        Customer.store_id == current_user.store_id
    ).first()
    
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    customer.is_active = False
    db.commit()
    
    print(f"[Customers] ✅ Cliente desactivado: ID {customer_id}")
    return {"message": "Cliente eliminado correctamente"}