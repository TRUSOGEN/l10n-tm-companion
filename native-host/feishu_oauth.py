#!/usr/bin/env python3
"""本机飞书 OAuth 授权模块。

本模块由 Native Messaging Host 调用：它在本机 ``localhost`` 启动一次性回调端点，
引导用户完成飞书授权，并将回调中的授权码换成 ``user_access_token``。调用方只得到
令牌、有效期和已授权 scope；App Secret 只保存在 macOS Keychain，授权码与回调
state 不会写入日志或持久化。
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Mapping
from urllib.parse import parse_qs, urlencode, urlparse


AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize"
TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token"
TENANT_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
REDIRECT_URI = "http://localhost:39641/l10n-tm-companion/oauth/callback"
FEISHU_APP_ID = "cli_aab1ca4137badbc4"
SHEETS_SCOPE = (
    "sheets:spreadsheet.meta:read "
    "sheets:spreadsheet:read "
    "sheets:spreadsheet:write_only"
)
ROI_ARCHIVE_SCOPE = (
    "base:table:read base:table:create "
    "base:field:read base:field:create "
    "base:record:read base:record:retrieve base:record:create base:record:update "
    "base:view:read base:view:write_only"
)
WIKI_READ_SCOPE = "wiki:node:read"
USER_IDENTITY_SCOPE = "contact:user.base:readonly contact:user.employee_id:readonly"
FEISHU_USER_SCOPE = (
    f"{SHEETS_SCOPE} {WIKI_READ_SCOPE} {ROI_ARCHIVE_SCOPE} {USER_IDENTITY_SCOPE}"
)
CALLBACK_TIMEOUT_SECONDS = 300
TOKEN_TIMEOUT_SECONDS = 20
KEYCHAIN_SERVICE = "com.l10n.tm_companion.feishu-app-secret"
CALLBACK_RECEIVED_MESSAGE = (
    "Authorization response received. Returning to your original page while "
    "L10n TM Companion finishes connecting."
)


def build_code_challenge(code_verifier: str) -> str:
    """按 OAuth PKCE S256 规则从一次性 verifier 派生挑战码。"""
    if not code_verifier:
        raise OAuthError("OAuth PKCE code verifier is required")
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


class OAuthError(RuntimeError):
    """表示可安全展示给插件用户的 OAuth 失败。"""


def get_tenant_access_token(
    app_secret: str,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> dict[str, object]:
    """使用固定 App ID 与调用方提供的 Secret 换取短期 tenant token。"""
    secret = str(app_secret or "").strip()
    if not secret:
        raise OAuthError("Feishu App Secret is not configured in macOS Keychain")
    request = urllib.request.Request(
        TENANT_TOKEN_URL,
        data=json.dumps({"app_id": FEISHU_APP_ID, "app_secret": secret}).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with opener(request, timeout=TOKEN_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        raise OAuthError(f"Feishu tenant token request failed: HTTP {error.code}") from error
    except Exception as error:  # noqa: BLE001
        raise OAuthError(f"Feishu tenant token request failed: {error}") from error
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as error:
        raise OAuthError("Feishu tenant token response was not valid JSON") from error
    token = result.get("tenant_access_token") if isinstance(result, dict) else None
    if result.get("code") != 0 or not isinstance(token, str) or not token:
        raise OAuthError(f"Feishu credentials were rejected: {result.get('msg') or result.get('code')}")
    return {
        "access_token": token,
        "expires_in": result.get("expire") or 7200,
    }


def save_app_secret(
    app_secret: str,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> None:
    """把共享应用 Secret 保存到当前 macOS 用户的登录 Keychain。"""
    secret = str(app_secret or "").strip()
    if not secret:
        raise OAuthError("Feishu App Secret is required")
    result = runner(
        [
            "/usr/bin/security",
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            FEISHU_APP_ID,
            "-w",
            secret,
        ],
        capture_output=True,
        text=True,
        timeout=TOKEN_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise OAuthError("Could not save Feishu App Secret to macOS Keychain")


def load_app_secret(
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> str:
    """从当前 macOS 用户的登录 Keychain 读取共享应用 Secret。"""
    result = runner(
        [
            "/usr/bin/security",
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            FEISHU_APP_ID,
            "-w",
        ],
        capture_output=True,
        text=True,
        timeout=TOKEN_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        return ""
    return (result.stdout or "").strip()


def prompt_app_secret(
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> str:
    """使用 macOS 隐藏输入框读取 Owner 的 App Secret，不经过扩展页面。"""
    script = (
        'set dialogResult to display dialog '
        '"Enter the Feishu App Secret for L10n TM Companion. It will be stored in macOS Keychain." '
        'default answer "" with hidden answer '
        'buttons {"Cancel", "Save"} default button "Save" cancel button "Cancel" '
        'with title "L10n TM Companion Owner Setup"\n'
        'return text returned of dialogResult'
    )
    result = runner(
        ["/usr/bin/osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=CALLBACK_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise OAuthError("Feishu app owner setup was cancelled")
    secret = (result.stdout or "").strip()
    if not secret:
        raise OAuthError("Feishu App Secret is required")
    return secret


def configure_app_secret(
    secret_prompt: Callable[[], str] = prompt_app_secret,
    validator: Callable[[str], dict[str, object]] = get_tenant_access_token,
    saver: Callable[[str], None] = save_app_secret,
) -> dict[str, object]:
    """在 Native Host 内验证并保存 Owner Secret，只向 Chrome 返回配置状态。"""
    secret = secret_prompt()
    validator(secret)
    saver(secret)
    return {"ok": True, "configured": True}


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


def normalize_return_url(return_url: str) -> str:
    """只接受具有完整 host 的 HTTP(S) 原页面地址，拒绝脚本协议与相对路径。"""
    candidate = str(return_url or "").strip()
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return candidate


def build_callback_page(message: str, success: bool, return_url: str = "") -> str:
    """生成 OAuth callback 页面，成功时关闭标签页并以原页面跳转作为兜底。"""
    safe_message = html.escape(str(message or ""))
    normalized_return_url = normalize_return_url(return_url)
    safe_return_url = html.escape(normalized_return_url, quote=True)
    return_url_json = json.dumps(normalized_return_url)
    action = (
        f'<a class="button" href="{safe_return_url}">Return to the original page</a>'
        if normalized_return_url
        else '<button class="button" type="button" onclick="window.close()">Close this tab</button>'
    )
    automatic_return = ""
    if success:
        automatic_return = f"""
      const returnUrl = {return_url_json};
      window.setTimeout(() => {{
        window.close();
        if (returnUrl) {{
          window.setTimeout(() => window.location.replace(returnUrl), 350);
        }}
      }}, 180);
"""
    state_class = "success" if success else "error"
    title = "Returning to your page…" if success else "Authorization was not completed"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>L10n TM Companion OAuth</title>
  <style>
    :root {{ color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f8fa; color: #1f2329; }}
    main {{ width: min(420px, calc(100% - 32px)); padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; box-shadow: 0 8px 30px rgba(31, 35, 41, .08); }}
    .mark {{ width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: #e9f8f0; color: #008f57; font-weight: 700; }}
    .error .mark {{ background: #fff0f1; color: #d32030; }}
    h1 {{ margin: 14px 0 6px; font-size: 18px; }}
    p {{ margin: 0 0 18px; color: #646a73; font-size: 13px; line-height: 1.5; }}
    .button {{ display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 14px; border: 0; border-radius: 7px; background: #3157d5; color: #fff; font: inherit; text-decoration: none; cursor: pointer; }}
  </style>
</head>
<body>
  <main class="{state_class}">
    <div class="mark">{"✓" if success else "!"}</div>
    <h1>{title}</h1>
    <p>{safe_message}</p>
    {action}
  </main>
  <script>
{automatic_return}
  </script>
</body>
</html>"""


def exchange_authorization_code(
    app_id: str,
    app_secret: str,
    code: str,
    redirect_uri: str,
    code_verifier: str,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> dict[str, object]:
    """以 App Secret 与 PKCE verifier 将飞书一次性授权码兑换为用户令牌。"""
    secret = str(app_secret or "").strip()
    if not secret:
        raise OAuthError("Feishu secure token exchange is not configured")
    payload = {
        "grant_type": "authorization_code",
        "client_id": app_id,
        "client_secret": secret,
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


def build_authorization_result(
    token: Mapping[str, object],
    redirect_uri: str,
    requested_scope: str,
) -> dict[str, object]:
    """校验飞书实际签发的 scope，并生成可安全返回给扩展的授权结果。"""
    access_token = token.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise OAuthError("Feishu OAuth token response did not include access_token")
    granted_scope = token.get("scope")
    if not isinstance(granted_scope, str) or not granted_scope.strip():
        raise OAuthError(
            "Feishu OAuth token response did not include granted scope; "
            "the requested permissions cannot be treated as authorized"
        )
    normalized_scope = " ".join(dict.fromkeys(granted_scope.split()))
    granted_scopes = set(normalized_scope.split())
    missing_scopes = [
        candidate
        for candidate in dict.fromkeys(requested_scope.split())
        if candidate not in granted_scopes
    ]
    if missing_scopes:
        raise OAuthError(
            "Feishu OAuth token is missing requested user permissions: "
            f"{', '.join(missing_scopes)}. Ask the app owner to create and publish a new app "
            "version containing these user-identity permissions, then authorize again."
        )
    return {
        "ok": True,
        "access_token": access_token,
        "expires_in": token.get("expires_in"),
        "scope": normalized_scope,
        "redirect_uri": redirect_uri,
    }


def _make_callback_handler(
    callback_path: str,
    expected_state: str,
    completed: dict[str, object],
    return_url: str = "",
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
                message = CALLBACK_RECEIVED_MESSAGE
                status = 200
            except OAuthError as error:
                completed["error"] = str(error)
                message = "Authorization was not completed. You can return to L10n TM Companion."
                status = 400
            completed["done"] = True
            body = build_callback_page(
                message,
                success=status == 200,
                return_url=return_url,
            ).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
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
    return_url: str = "",
    browser_open: Callable[[str], bool] = webbrowser.open,
    secret_loader: Callable[[], str] = load_app_secret,
) -> dict[str, object]:
    """使用 Keychain 中的应用凭证运行完整 PKCE 用户授权流程。"""
    if not app_id:
        raise OAuthError("Feishu App ID is required for user authorization")
    app_secret = secret_loader()
    if not app_secret:
        raise OAuthError(
            "Feishu secure token exchange is not configured on this Mac. "
            "The app owner must complete secure owner setup first."
        )
    parsed_redirect = urlparse(redirect_uri)
    if parsed_redirect.scheme != "http" or parsed_redirect.hostname != "localhost" or not parsed_redirect.port:
        raise OAuthError("OAuth redirect URI must use http://localhost with an explicit port")
    if not parsed_redirect.path:
        raise OAuthError("OAuth redirect URI must include a callback path")

    completed: dict[str, object] = {"done": False}
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    handler = _make_callback_handler(
        parsed_redirect.path,
        state,
        completed,
        return_url=return_url,
    )
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
        app_secret=app_secret,
        code=str(completed["code"]),
        redirect_uri=redirect_uri,
        code_verifier=code_verifier,
    )
    return build_authorization_result(token, redirect_uri, scope)
