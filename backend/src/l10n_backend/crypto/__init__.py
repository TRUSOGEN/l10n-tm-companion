"""Cryptographic primitives and canonical text hashing.

Canonical bytes for source/final text hashing follow the contract exactly:

1. CRLF and CR are normalized to LF.
2. Unicode NFC normalization is applied.
3. Whitespace is *not* trimmed or collapsed.
4. Encode to UTF-8 and compute SHA-256 lowercase hex.

Server-side recomputation is required — the client-provided hash is validated,
not trusted.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import unicodedata
from dataclasses import dataclass
from typing import AnyStr


def canonical_text_bytes(text: str) -> bytes:
    """Return the canonical bytes used for text hash checks."""

    if text is None:
        raise ValueError("text is required")
    normalized = unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))
    return normalized.encode("utf-8")


def sha256_hex(text: str) -> str:
    """Return the lowercase hex SHA-256 of canonical text bytes."""

    return hashlib.sha256(canonical_text_bytes(text)).hexdigest()


def verify_text_hash(text: str, expected_hash: str) -> bool:
    """Constant-time verify a client-provided text hash against canonical bytes."""

    actual = sha256_hex(text)
    return hmac.compare_digest(actual, str(expected_hash or "").lower())


def generate_uuid7_like() -> str:
    """Return an RFC 4122-like UUIDv7 string.

    A real implementation can use the ``uuid6`` package; for portability we use
    a 48-bit millisecond timestamp prefix plus 80 random bits, version 7,
    variant 1. The service requires UUIDv7 IDs but does not depend on strict
    monotonic ordering for correctness.
    """

    import time
    import uuid

    timestamp_ms = int(time.time() * 1000) & 0xFFFFFFFFFFFF
    rand_bits = int.from_bytes(secrets.token_bytes(10), "big")
    high = (timestamp_ms << 16) | (0x7 << 12) | ((rand_bits >> 64) & 0x0FFF)
    low = (0x2 << 62) | (rand_bits & 0x3FFFFFFFFFFFFFFF)
    return str(uuid.UUID(int=(high << 64) | low))


def base64url_sha256(data: bytes) -> str:
    """Compute base64url(sha256(data)) without padding (PKCE S256)."""

    return base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode("ascii").rstrip("=")


def generate_pkce_pair() -> tuple[str, str]:
    """Generate an OAuth PKCE (S256) verifier/challenge pair."""

    verifier = secrets.token_urlsafe(64)
    challenge = base64url_sha256(verifier.encode("ascii"))
    return verifier, challenge


def constant_time_equal(a: AnyStr, b: AnyStr) -> bool:
    """Constant-time string/bytes comparison."""

    return hmac.compare_digest(a, b)


def hash_device_token(token: str) -> str:
    """Hash a 256-bit device session token for storage."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_device_session_token() -> str:
    """Generate a 256-bit opaque device session token."""

    return secrets.token_urlsafe(48)


@dataclass(frozen=True)
class EnvelopeCiphertext:
    """Envelope-encrypted ciphertext bundle."""

    algorithm: str
    key_version: str
    nonce_b64: str
    ciphertext_b64: str
    tag_b64: str
    wrapped_dek_b64: str | None = None


class InsecureDevEnvelopeCrypto:
    """Development-only envelope crypto using a local AES-GCM key.

    Production MUST replace this with the company KMS adapter, which wraps
    data keys with the approved KMS and never persists plaintext key material
    on disk. The interface intentionally mirrors the production adapter so
    domain code does not change between environments.
    """

    def __init__(self, key: bytes | None = None) -> None:
        self._key = key or os.environ.get("L10N_DEV_DATA_KEY", "").encode("utf-8")
        if not self._key:
            self._key = hashlib.sha256(b"dev-only-do-not-use").digest()

    def _nonce(self) -> bytes:
        return secrets.token_bytes(12)

    def encrypt(self, plaintext: str, key_version: str = "dev") -> EnvelopeCiphertext:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        aes = AESGCM(hashlib.sha256(self._key).digest())
        nonce = self._nonce()
        ct = aes.encrypt(nonce, plaintext.encode("utf-8"), None)
        tag = ct[-16:]
        return EnvelopeCiphertext(
            algorithm="AES-256-GCM",
            key_version=key_version,
            nonce_b64=base64.b64encode(nonce).decode("ascii"),
            ciphertext_b64=base64.b64encode(ct[:-16]).decode("ascii"),
            tag_b64=base64.b64encode(tag).decode("ascii"),
            wrapped_dek_b64=None,
        )

    def decrypt(self, bundle: EnvelopeCiphertext) -> str:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        aes = AESGCM(hashlib.sha256(self._key).digest())
        nonce = base64.b64decode(bundle.nonce_b64)
        ct = base64.b64decode(bundle.ciphertext_b64)
        tag = base64.b64decode(bundle.tag_b64)
        plaintext = aes.decrypt(nonce, ct + tag, None)
        return plaintext.decode("utf-8")


class KmsEnvelopeCrypto:
    """Production envelope crypto backed by company KMS.

    The real implementation generates data encryption keys via the KMS
    ``generate_data_key`` API, encrypts payloads locally with AES-GCM, and
    stores the wrapped DEK alongside the ciphertext. Until the KMS adapter is
    wired, every encrypt/decrypt call raises a clear error so production
    deployments cannot accidentally use InsecureDevEnvelopeCrypto.
    """

    _NOT_WIRED_MSG = "KMS-backed envelope crypto is not wired yet. Awaiting company KMS owner inputs."

    def __init__(self, kms: Any, key_id: str) -> None:
        if kms is None:
            raise ValueError("kms is required")
        if not key_id:
            raise ValueError("key_id is required")
        self.kms = kms
        self.key_id = key_id

    def encrypt(self, plaintext: str, key_version: str = "kms") -> EnvelopeCiphertext:
        raise RuntimeError(self._NOT_WIRED_MSG)

    def decrypt(self, bundle: EnvelopeCiphertext) -> str:
        raise RuntimeError(self._NOT_WIRED_MSG)
