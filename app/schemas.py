from pydantic import BaseModel, EmailStr
from typing import List, Optional

# Login / Auth Schemas
class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

# User Schemas
class UserBase(BaseModel):
    username: str
    full_name: str
    email: str
    role: str = "agente"
    is_active: bool = True

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None

class UserOut(UserBase):
    id: int
    created_at: str

# Client Schemas
class ClientBase(BaseModel):
    name: str
    document_id: str
    birth_date: Optional[str] = ""
    passport_number: Optional[str] = ""
    passport_expiry: Optional[str] = ""
    email: str
    phone: str
    address: Optional[str] = ""
    notes: Optional[str] = ""

class ClientCreate(ClientBase):
    pass

class ClientOut(ClientBase):
    id: int
    created_at: str

# Supplier Schemas
class SupplierBase(BaseModel):
    name: str
    cuit: Optional[str] = ""
    category: str
    contact_name: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    notes: Optional[str] = ""

class SupplierCreate(SupplierBase):
    pass

class SupplierOut(SupplierBase):
    id: int
    created_at: str

# Budget Item Schemas
class BudgetItemBase(BaseModel):
    service_type: str
    description: str
    supplier_id: Optional[int] = None
    cost_price: float = 0.0
    sale_price: float = 0.0
    quantity: int = 1

class BudgetItemCreate(BudgetItemBase):
    pass

class BudgetItemOut(BudgetItemBase):
    id: int
    budget_id: int
    subtotal: float
    supplier_name: Optional[str] = None

# Budget Schemas
class BudgetBase(BaseModel):
    client_id: Optional[int] = None
    client_ids: Optional[List[int]] = None
    title: str
    destination: str
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    currency: str = "USD"
    exchange_rate: float = 1.0
    status: str = "Borrador"
    notes: Optional[str] = ""
    seller_ids: Optional[List[int]] = None

class BudgetCreate(BudgetBase):
    items: List[BudgetItemCreate] = []

class BudgetOut(BudgetBase):
    id: int
    budget_number: str
    booking_id: Optional[int] = None
    booking_number: Optional[str] = None
    seller_ids: List[int] = []
    seller_names: List[str] = []
    client_ids: List[int] = []
    client_names: List[str] = []
    user_id: int
    user_name: Optional[str] = None
    client_name: Optional[str] = None
    total_cost: float
    total_amount: float
    items: List[BudgetItemOut] = []
    created_at: str

# Booking Schemas
class BookingBase(BaseModel):
    client_id: Optional[int] = None
    client_ids: Optional[List[int]] = None
    title: str
    destination: str
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    currency: str = "USD"
    status: str = "Confirmada"
    total_amount: float
    notes: Optional[str] = ""

class BookingCreate(BookingBase):
    budget_id: Optional[int] = None
    seller_ids: Optional[List[int]] = None

class BookingOut(BookingBase):
    id: int
    booking_number: str
    budget_id: Optional[int] = None
    budget_number: Optional[str] = None
    seller_ids: List[int] = []
    seller_names: List[str] = []
    client_id: Optional[int] = None
    client_ids: List[int] = []
    client_names: List[str] = []
    user_id: int
    client_name: Optional[str] = None
    user_name: Optional[str] = None
    title: str
    destination: str
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    currency: str
    status: str
    total_amount: float
    paid_amount: float
    balance_due: float
    total_cost: float = 0.0
    supplier_paid_amount: float = 0.0
    cost_balance: float = 0.0
    items: List[BudgetItemOut] = []
    notes: Optional[str] = ""
    created_at: str

# Payment Schemas
class PaymentCreate(BaseModel):
    booking_id: int
    client_id: Optional[int] = None
    amount: float
    payment_date: str
    payment_method: str
    concept: Optional[str] = ""
    payment_type: str = "Parcial"  # Parcial or Total
    reference_code: Optional[str] = ""
    notes: Optional[str] = ""

class PaymentOut(BaseModel):
    id: int
    payment_number: str
    booking_id: int
    booking_number: Optional[str] = None
    client_id: int
    client_name: Optional[str] = None
    amount: float
    payment_date: str
    payment_method: str
    concept: Optional[str] = ""
    payment_type: str
    reference_code: Optional[str] = None
    notes: Optional[str] = None
    registered_by_user_id: int
    registered_by_user_name: Optional[str] = None
    created_at: str
