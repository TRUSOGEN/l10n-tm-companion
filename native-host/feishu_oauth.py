#!/usr/bin/env python3
"""本机飞书 OAuth 授权模块。

本模块由 Native Messaging Host 调用：它在本机 ``localhost`` 启动一次性回调端点，
引导用户完成飞书授权，并将回调中的授权码换成 ``user_access_token``。调用方只得到
令牌、有效期和已授权 scope；App Secret、授权码与回调 state 不会写入日志或持久化。
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Mapping
from urllib.parse import parse_qs, urlencode, urlparse


AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize"
TOKEN_URL = "https://accounts.feishu.cn/oauth/v3/token"
REDIRECT_URI = "http://localhost:39641/l10n-tm-companion/oauth/callback"
FEISHU_APP_ID = "cli_aab1ca4137badbc4"
SHEETS_SCOPE = "sheets:spreadsheet"
ROI_ARCHIVE_SCOPE = "base:table:read base:table:create base:field:read base:record:create base:record:update base:block:read base:block:update"
WIKI_READ_SCOPE = "wiki:wiki:readonly"
FEISHU_USER_SCOPE = f"{SHEETS_SCOPE} {WIKI_READ_SCOPE} {ROI_ARCHIVE_SCOPE}"
CALLBACK_TIMEOUT_SECONDS = 300
TOKEN_TIMEOUT_SECONDS = 20


def build_code_challenge(code_verifier: str) -> str:
    """按 OAuth PKCE S256 规则从一次性 verifier 派生挑战码。"""
    if not code_verifier:
        raise OAuthError("OAuth PKCE code verifier is required")
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


class OAuthError(RuntimeError):
    """表示可安全展示给插件用户的 OAuth 失败。"""


def build_authorize_url(
    app_id: str,
    redirect_uri: str,
    scope: str,
    state: str,
    code_challenge: str,
) -> str:
    """构造携带 PKCE 挑战码的飞书用户授权页地址。"""
    params = {
        "client_id": app_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
        "prompt": "consent",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def validate_callback(
    query: Mapping[str, list[str]],
    expected_state: str,
) -> str:
    """校验 OAuth 回调并返回一次性授权码。"""
    state = (query.get("state") or [""])[0]
    if not secrets.compare_digest(state, expected_state):
        raise OAuthError("Feishu OAuth callback state mismatch")
    error = (query.get("error") or [""])[0]
    if error:
        raise OAuthError(f"Feishu OAuth authorization failed: {error}")
    code = (query.get("code") or [""])[0]
    if not code:
        raise OAuthError("Feishu OAuth callback did not include an authorization code")
    return code


def exchange_authorization_code(
    app_id: str,
    code: str,
    redirect_uri: str,
    code_verifier: str,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> dict[str, object]:
    """以 PKCE verifier 将飞书一次性授权码兑换为用户令牌。"""
    payload = {
        "grant_type": "authorization_code",
        "client_id": app_id,
        "code": code,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
    }
    request = urllib.request.Request(
        TOKEN_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with opener(request, timeout=TOKEN_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        try:
            detail = error.read().decode("utf-8", errors="replace")[:300]
        except Exception:  # noqa: BLE001
            detail = ""
        raise OAuthError(f"Feishu OAuth token exchange failed: HTTP {error.code} {detail}") from error
    except Exception as error:  # noqa: BLE001
        raise OAuthError(f"Feishu OAuth token exchange request failed: {error}") from error

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as error:
        raise OAuthError("Feishu OAuth token exchange returned invalid JSON") from error
    if not isinstance(result, dict) or not isinstance(result.get("access_token"), str):
        detail = result.get("error_description") or result.get("error") or "missing access_token"
        raise OAuthError(f"Feishu OAuth token exchange failed: {detail}")
    return result


def _make_callback_handler(
    callback_path: str,
    expected_state: str,
    completed: dict[str, object],
):
    """生成只接受一个精确回调路径和 state 的 HTTP Handler。"""

    class CallbackHandler(BaseHTTPRequestHandler):
        """把 OAuth 回调结果交回本地等待循环，不记录敏感查询参数。"""

        def do_GET(self) -> None:  # noqa: N802
            """验证 URL 与 state，并关闭浏览器页的等待提示。"""
            parsed = urlparse(self.path)
            if parsed.path != callback_path:
                self.send_response(404)
                self.end_headers()
                return
            try:
                completed["code"] = validate_callback(parse_qs(parsed.query), expected_state)
                completed["ok"] = True
                message = "Authorization complete. You can return to L10n TM Companion."
                status = 200
            except OAuthError as error:
                completed["error"] = str(error)
                message = "Authorization was not completed. You can return to L10n TM Companion."
                status = 400
            completed["done"] = True
            body = message.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: object) -> None:
            """禁止 BaseHTTPRequestHandler 默认记录携带 code 的完整请求行。"""

    return CallbackHandler


def authorize_user(
    app_id: str = FEISHU_APP_ID,
    redirect_uri: str = REDIRECT_URI,
    scope: str = FEISHU_USER_SCOPE,
    browser_open: Callable[[str], bool] = webbrowser.open,
) -> dict[str, object]:
    """运行完整 PKCE 用户授权流程，不接收或持有 App Secret。"""
    if not app_id:
        raise OAuthError("Feishu App ID is required for user authorization")
    parsed_redirect = urlparse(redirect_uri)
    if parsed_redirect.scheme != "http" or parsed_redirect.hostname != "localhost" or not parsed_redirect.port:
        raise OAuthError("OAuth redirect URI must use http://localhost with an explicit port")
    if not parsed_redirect.path:
        raise OAuthError("OAuth redirect URI must include a callback path")

    completed: dict[str, object] = {"done": False}
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    handler = _make_callback_handler(parsed_redirect.path, state, completed)
    try:
        server = HTTPServer(("localhost", parsed_redirect.port), handler)
    except OSError as error:
        raise OAuthError(
            f"Cannot start local OAuth callback on localhost:{parsed_redirect.port}: {error}"
        ) from error
    server.timeout = 0.5
    authorization_url = build_authorize_url(
        app_id,
        redirect_uri,
        scope,
        state,
        build_code_challenge(code_verifier),
    )
    try:
        if not browser_open(authorization_url):
            raise OAuthError("Could not open the Feishu authorization page")
        deadline = time.monotonic() + CALLBACK_TIMEOUT_SECONDS
        while not completed["done"] and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()

    if not completed["done"]:
        raise OAuthError("Feishu authorization timed out after 5 minutes")
    if not completed.get("ok"):
        raise OAuthError(str(completed.get("error") or "Feishu authorization was not completed"))
    token = exchange_authorization_code(
        app_id=app_id,
        code=str(completed["code"]),
        redirect_uri=redirect_uri,
        code_verifier=code_verifier,
    )
    return {
        "ok": True,
        "access_token": token["access_token"],
        "expires_in": token.get("expires_in"),
        "scope": token.get("scope") or scope,
        "redirect_uri": redirect_uri,
    }
