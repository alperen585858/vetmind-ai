"""Optional API authentication (API key / JWT). Disabled by default for local demos."""

from app.auth.security import AuthSettings, create_access_token, decode_token, verify_api_key

__all__ = ["AuthSettings", "create_access_token", "decode_token", "verify_api_key"]
