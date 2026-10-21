from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    limit: int = Field(default=5, ge=1, le=10)


class PlaceResponse(BaseModel):
    id: str
    name: str
    place_type: str
    lat: float
    lon: float
    description: str
    tags: dict[str, Any] = Field(default_factory=dict)
    score: float | None = None


class AskResponse(BaseModel):
    answer: str
    places: list[PlaceResponse]
    model_status: str


class TripCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SavedPlaceCreate(BaseModel):
    place_id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=255)
    place_type: str = Field(min_length=1, max_length=80)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    description: str = Field(min_length=1, max_length=3000)
    tags: dict[str, Any] = Field(default_factory=dict)


class SavedPlaceResponse(BaseModel):
    id: int
    place_id: str
    name: str
    place_type: str
    lat: float
    lon: float
    description: str
    tags: dict[str, Any]


class TripResponse(BaseModel):
    id: int
    name: str
    created_at: datetime
    places: list[SavedPlaceResponse]
