"""Company KMS adapter stub.

The real KMS endpoint, credentials, and key rotation policy will be wired by
the company KMS owner. Until then, this adapter fails loudly to prevent any
production deployment from pretending envelope encryption is set up.
"""

from __future__ import annotations


_PRODUCTION_WIRING_MSG = "Company KMS adapter is not wired yet. Awaiting company KMS owner inputs (endpoint, auth, region, key rotation)."


class CompanyKmsAdapter:
    """Stub of the company KMS envelope-encryption key provider."""

    def __init__(self, *, kms_key_id: str, kms_region: str) -> None:
        if not kms_key_id:
            raise ValueError("kms_key_id is required")
        if not kms_region:
            raise ValueError("kms_region is required")
        self.kms_key_id = kms_key_id
        self.kms_region = kms_region

    def generate_data_key(self, key_id: str) -> tuple[bytes, bytes]:
        raise RuntimeError(_PRODUCTION_WIRING_MSG)

    def decrypt_data_key(self, wrapped_key_blob: bytes) -> bytes:
        raise RuntimeError(_PRODUCTION_WIRING_MSG)
