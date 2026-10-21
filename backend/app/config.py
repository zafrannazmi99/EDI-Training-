from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8-sig",
        extra="ignore",
    )

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "mistral:7b"
    secret_key: str
    access_token_minutes: int = 1440
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:5174,http://127.0.0.1:5174,"
        "http://localhost:4174,http://127.0.0.1:4174"
    )
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    vector_db_path: Path = PROJECT_ROOT / "data" / "vectors.sqlite3"
    database_path: Path = PROJECT_ROOT / "data" / "app.db"

    @field_validator("secret_key")
    @classmethod
    def require_private_signing_key(cls, value: str) -> str:
        if len(value) < 32 or "replace" in value.lower() or "your-long" in value.lower():
            raise ValueError("Set SECRET_KEY in the ignored .env file to a random value of at least 32 characters.")
        return value

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
