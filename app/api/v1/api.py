from fastapi import APIRouter
from app.api.v1.endpoints import (
    users,
    stores,
    products,
    sales,
    customers,  # ← NUEVO
    credits     # ← NUEVO
)

api_router = APIRouter()

api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(stores.router, prefix="/stores", tags=["stores"])
api_router.include_router(products.router, prefix="/products", tags=["products"])
api_router.include_router(sales.router, prefix="/sales", tags=["sales"])
api_router.include_router(customers.router, prefix="/customers", tags=["customers"])
api_router.include_router(credits.router, prefix="/fiados", tags=["fiados"])