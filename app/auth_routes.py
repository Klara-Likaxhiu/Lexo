"""Authentication API backed by Supabase Auth."""

from __future__ import annotations

import os
import re

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field

from app import auth as auth_utils
from app import auth_db
from app import oauth as oauth_utils
from app.supabase_rest import SupabaseRestError, request
from app.supabase_client import (
    SupabaseAuthError,
    admin_delete_user,
    email_redirect,
    email_verification_enabled,
    get_user,
    is_email_verified,
    merge_public_user,
    refresh_session,
    require_supabase,
    reset_password_for_email,
    resend_signup,
    session_response,
    sign_in_with_id_token,
    sign_in_with_password,
    sign_out,
    sign_up,
    supabase_configured,
    supabase_anon_key,
    supabase_service_role_key,
    supabase_url,
    ping_auth,
    update_user,
    verification_redirect_url,
    verify_otp,
    lookup_auth_user,
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])
bearer = HTTPBearer(auto_error=False)


class SignupRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=30)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    login: str = Field(..., description="Username or email")
    password: str = Field(..., min_length=1, max_length=128)
    remember_me: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(..., min_length=8, max_length=128)
    type: str = Field(default="recovery", description="Supabase OTP type")


class VerifyEmailRequest(BaseModel):
    token: str | None = None
    token_hash: str | None = None
    type: str = Field(default="signup", description="Supabase OTP type")
    access_token: str | None = None
    refresh_token: str | None = None


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class OAuthRequest(BaseModel):
    id_token: str
    remember_me: bool = True
    username: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class DeleteAccountRequest(BaseModel):
    confirmation: str = Field(..., description='Must be exactly "DELETE"')
    password: str | None = Field(default=None, max_length=128)


def _username_from_email(email: str) -> str:
    local = email.split("@")[0]
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", local)[:30]
    return auth_db.unique_username(cleaned or "reader")


def _raise_supabase_error(exc: SupabaseAuthError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


def _raise_rest_error(exc: SupabaseRestError) -> None:
    code = exc.status_code if exc.status_code >= 400 else status.HTTP_503_SERVICE_UNAVAILABLE
    raise HTTPException(status_code=code, detail=exc.message) from exc


def _resolve_login_email(login: str) -> str:
    login = login.strip()
    if "@" in login:
        return login.lower()
    profile = auth_db.get_profile_by_username(login)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username/email or password.",
        )
    return profile["email"]


def _save_profile_from_supabase_user(
    supabase_user: dict,
    *,
    username: str | None = None,
    auth_provider: str = "local",
    provider_subject: str | None = None,
) -> dict:
    metadata = supabase_user.get("user_metadata") or {}
    resolved_username = username or metadata.get("username") or _username_from_email(
        supabase_user.get("email") or "reader"
    )
    return auth_db.upsert_profile(
        supabase_user["id"],
        resolved_username,
        supabase_user.get("email") or "",
        auth_provider=auth_provider,
        provider_subject=provider_subject,
    )


def _get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    try:
        supabase_user = get_user(credentials.credentials)
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    profile = auth_db.get_profile_by_id(supabase_user["id"])
    public = merge_public_user(supabase_user, profile)
    return {
        **public,
        "_access_token": credentials.credentials,
        "_supabase_user": supabase_user,
    }


def _require_verified(user: dict) -> None:
    if not email_verification_enabled():
        return
    if not user.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before accessing your account.",
        )


@router.get("/config")
def public_config() -> dict:
    configured = supabase_configured()
    verify_redirect = ""
    if configured:
        try:
            verify_redirect = verification_redirect_url()
        except SupabaseAuthError:
            verify_redirect = ""
    return {
        "google_client_id": os.getenv("GOOGLE_CLIENT_ID", "").strip(),
        "apple_client_id": os.getenv("APPLE_CLIENT_ID", "").strip(),
        "email_verification_required": email_verification_enabled() if configured else False,
        "email_sending_enabled": configured,
        "supabase_enabled": configured,
        "app_base_url": os.getenv("APP_BASE_URL", "").strip().rstrip("/"),
        "verify_email_redirect": verify_redirect,
    }


def _check_supabase_auth_health() -> str:
    if not supabase_url():
        return "SUPABASE_URL missing"
    if not supabase_anon_key():
        return "SUPABASE_ANON_KEY missing"
    try:
        ping_auth()
        return "ok"
    except SupabaseAuthError as exc:
        return exc.message or "Supabase Auth unreachable"


def _check_supabase_profiles_health() -> str:
    if not supabase_url():
        return "SUPABASE_URL missing"
    if not supabase_service_role_key():
        return "SUPABASE_SERVICE_ROLE_KEY missing"
    try:
        request("GET", "profiles", params={"select": "id", "limit": "1"})
        return "ok"
    except SupabaseRestError as exc:
        msg = (exc.message or "").lower()
        if exc.status_code == 404 or "does not exist" in msg or "42p01" in msg:
            return "profiles table missing"
        if "profiles" in msg and ("relation" in msg or "not found" in msg):
            return "profiles table missing"
        if "jwt" in msg or "3 parts" in msg:
            return "SUPABASE_SERVICE_ROLE_KEY invalid"
        return exc.message or "profiles table missing"


@router.get("/health")
def auth_health() -> dict:
    """Check Supabase Auth and profiles table connectivity."""
    supabase_auth = _check_supabase_auth_health()
    supabase_profiles = _check_supabase_profiles_health()
    return {
        "ok": supabase_auth == "ok" and supabase_profiles == "ok",
        "supabase_auth": supabase_auth,
        "supabase_profiles": supabase_profiles,
    }


@router.post("/signup")
def signup(data: SignupRequest) -> dict:
    try:
        require_supabase()
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    username_err = auth_utils.validate_username(data.username)
    if username_err:
        raise HTTPException(status_code=400, detail=username_err)

    password_err = auth_utils.validate_password(data.password)
    if password_err:
        raise HTTPException(status_code=400, detail=password_err)

    try:
        if auth_db.get_profile_by_username(data.username):
            raise HTTPException(status_code=409, detail="That username is already taken.")

        if auth_db.get_profile_by_email(str(data.email)):
            raise HTTPException(status_code=409, detail="An account with this email already exists.")
    except SupabaseRestError as exc:
        _raise_rest_error(exc)

    try:
        redirect_to = verification_redirect_url()
        result = sign_up(
            str(data.email),
            data.password,
            username=data.username.strip(),
            email_redirect_to=redirect_to,
        )
    except SupabaseAuthError as exc:
        if exc.status_code == 422 or "already registered" in exc.message.lower():
            raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
        _raise_supabase_error(exc)

    user = result.get("user") or {}
    try:
        if user.get("id"):
            profile = _save_profile_from_supabase_user(user, username=data.username.strip())
        else:
            profile = None
    except SupabaseRestError as exc:
        _raise_rest_error(exc)

    public = merge_public_user(user, profile)
    session = result.get("access_token")
    refresh = result.get("refresh_token")
    if (
        session
        and refresh
        and (not email_verification_enabled() or public.get("email_verified"))
    ):
        return {
            "message": "Account created.",
            "verification_required": False,
            **session_response(result, remember_me=True, profile=profile),
        }

    return {
        "message": "Account created. Check your email to verify your address.",
        "verification_required": True,
        "email_sent": True,
        "verify_redirect_url": redirect_to,
        "user": public,
    }


@router.post("/login")
def login(data: LoginRequest) -> dict:
    try:
        require_supabase()
        email = _resolve_login_email(data.login)
        result = sign_in_with_password(email, data.password)
    except SupabaseAuthError as exc:
        if exc.status_code in (400, 401):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username/email or password.",
            ) from exc
        _raise_supabase_error(exc)

    user = result.get("user") or {}
    profile = auth_db.get_profile_by_id(user.get("id", "")) or _save_profile_from_supabase_user(user)
    public = merge_public_user(user, profile)

    if email_verification_enabled() and not public.get("email_verified"):
        return {
            "message": "Please verify your email before logging in. Check your inbox or resend the verification email.",
            "verification_required": True,
            "user": public,
        }

    return {
        "message": "Logged in.",
        "verification_required": False,
        **session_response(result, remember_me=data.remember_me, profile=profile),
    }


@router.post("/google")
def google_sign_in(data: OAuthRequest) -> dict:
    try:
        require_supabase()
        profile_data = oauth_utils.verify_google_id_token(data.id_token)
        result = sign_in_with_id_token("google", data.id_token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    user = result.get("user") or {}
    existing = auth_db.get_profile_by_provider("google", profile_data["sub"])
    username = existing["username"] if existing else _username_from_email(profile_data.get("email") or profile_data["sub"])
    profile = _save_profile_from_supabase_user(
        user,
        username=username,
        auth_provider="google",
        provider_subject=profile_data["sub"],
    )
    return {
        "message": "Signed in with Google.",
        "verification_required": False,
        **session_response(result, remember_me=data.remember_me, profile=profile),
    }


@router.post("/apple")
def apple_sign_in(data: OAuthRequest) -> dict:
    try:
        require_supabase()
        profile_data = oauth_utils.verify_apple_identity_token(data.id_token)
        result = sign_in_with_id_token("apple", data.id_token)
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid Apple sign-in token.") from exc

    user = result.get("user") or {}
    existing = auth_db.get_profile_by_provider("apple", profile_data["sub"])
    if existing:
        username = existing["username"]
    elif data.username:
        username = auth_db.unique_username(data.username.strip())
    else:
        email = profile_data.get("email") or f"{profile_data['sub']}@apple.oauth"
        username = _username_from_email(email)

    profile = _save_profile_from_supabase_user(
        user,
        username=username,
        auth_provider="apple",
        provider_subject=profile_data["sub"],
    )
    return {
        "message": "Signed in with Apple.",
        "verification_required": False,
        **session_response(result, remember_me=data.remember_me, profile=profile),
    }


@router.post("/verify-email")
def verify_email(data: VerifyEmailRequest) -> dict:
    try:
        require_supabase()
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    otp_type = (data.type or "signup").strip().lower()
    if otp_type == "magiclink":
        otp_type = "email"

    # Implicit / PKCE callback: Supabase redirects with access_token in the URL hash.
    if data.access_token:
        try:
            supabase_user = get_user(data.access_token)
        except SupabaseAuthError as exc:
            _raise_supabase_error(exc)

        if not is_email_verified(supabase_user):
            raise HTTPException(
                status_code=400,
                detail="Email is not verified yet. Use the link from your inbox or resend verification.",
            )

        profile = auth_db.get_profile_by_id(supabase_user.get("id", "")) or _save_profile_from_supabase_user(
            supabase_user
        )
        public = merge_public_user(supabase_user, profile)
        response: dict = {
            "message": "Email verified successfully.",
            "verified": True,
            "user": public,
        }
        if data.refresh_token:
            response.update(
                session_response(
                    {
                        "access_token": data.access_token,
                        "refresh_token": data.refresh_token,
                        "user": supabase_user,
                    },
                    remember_me=True,
                    profile=profile,
                )
            )
        return response

    token = (data.token_hash or data.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Invalid verification link.")

    result: dict | None = None
    verify_types = [otp_type]
    if otp_type == "signup":
        verify_types.append("email")
    elif otp_type == "email":
        verify_types.append("signup")

    last_exc: SupabaseAuthError | None = None
    for attempt_type in verify_types:
        try:
            result = verify_otp(token, attempt_type)
            break
        except SupabaseAuthError as exc:
            last_exc = exc
            continue

    if result is None:
        assert last_exc is not None
        _raise_supabase_error(last_exc)

    user = result.get("user") or {}
    profile = auth_db.get_profile_by_id(user.get("id", "")) or _save_profile_from_supabase_user(user)
    public = merge_public_user(user, profile)
    response = {
        "message": "Email verified successfully.",
        "verified": True,
        "user": public,
    }
    if result.get("access_token") and result.get("refresh_token"):
        response.update(session_response(result, remember_me=True, profile=profile))
    return response


@router.post("/resend-verification")
def resend_verification(data: ResendVerificationRequest) -> dict:
    try:
        require_supabase()
        redirect_to = verification_redirect_url()
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    email = str(data.email).strip().lower()
    profile = auth_db.get_profile_by_email(email)
    supabase_user = lookup_auth_user(email, profile)

    if not profile and not supabase_user:
        return {
            "message": "If that account exists and is unverified, a verification email has been sent.",
            "email_sent": True,
            "account_exists": False,
        }

    if supabase_user and is_email_verified(supabase_user):
        return {
            "message": "This email is already verified. You can log in now.",
            "already_verified": True,
            "email_sent": False,
        }

    try:
        resend_signup(email, email_redirect_to=redirect_to)
    except SupabaseAuthError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=exc.message or "Could not resend verification email.",
        ) from exc

    return {
        "message": "Verification email sent. Check your inbox and Spam/Junk folder.",
        "email_sent": True,
        "verify_redirect_url": redirect_to,
        "account_exists": True,
    }


@router.post("/verification-status")
def verification_status(data: ResendVerificationRequest) -> dict:
    email = str(data.email).strip().lower()
    profile = auth_db.get_profile_by_email(email)

    try:
        require_supabase()
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    supabase_user = lookup_auth_user(email, profile)

    if not profile and not supabase_user:
        return {"account_exists": False, "verified": False, "email": email}

    verified = bool(supabase_user and is_email_verified(supabase_user))
    return {
        "account_exists": True,
        "verified": verified,
        "email": profile["email"] if profile else (supabase_user or {}).get("email", email),
    }


@router.post("/forgot-password")
def forgot_password(data: ForgotPasswordRequest) -> dict:
    try:
        require_supabase()
        reset_password_for_email(str(data.email), redirect_to=email_redirect("reset-password.html"))
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    return {"message": "If an account exists for that email, password reset instructions were sent."}


@router.post("/reset-password")
def reset_password(data: ResetPasswordRequest) -> dict:
    password_err = auth_utils.validate_password(data.password)
    if password_err:
        raise HTTPException(status_code=400, detail=password_err)

    try:
        require_supabase()
        session = verify_otp(data.token, data.type)
        access_token = session.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
        update_user(access_token, password=data.password)
        sign_out(access_token)
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    return {"message": "Password updated. You can now log in with your new password."}


@router.post("/refresh")
def refresh(data: RefreshRequest) -> dict:
    try:
        require_supabase()
        result = refresh_session(data.refresh_token)
    except SupabaseAuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
        ) from exc

    user = result.get("user") or {}
    profile = auth_db.get_profile_by_id(user.get("id", ""))
    return session_response(result, remember_me=True, profile=profile)


@router.post("/logout")
def logout(
    data: LogoutRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    token = credentials.credentials if credentials else None
    if token:
        try:
            sign_out(token)
        except SupabaseAuthError:
            pass
    return {"message": "Logged out."}


@router.get("/me")
def me(user: dict = Depends(_get_current_user)) -> dict:
    _require_verified(user)
    return {"user": merge_public_user(user["_supabase_user"], auth_db.get_profile_by_id(user["id"]))}


@router.post("/change-password")
def change_password(
    data: ChangePasswordRequest,
    user: dict = Depends(_get_current_user),
) -> dict:
    if user.get("auth_provider") not in ("local", "email"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password changes are managed by your social sign-in provider.",
        )

    password_err = auth_utils.validate_password(data.new_password)
    if password_err:
        raise HTTPException(status_code=400, detail=password_err)

    try:
        require_supabase()
        sign_in_with_password(user["email"], data.current_password)
        update_user(user["_access_token"], password=data.new_password)
        sign_out(user["_access_token"])
    except SupabaseAuthError as exc:
        if exc.status_code in (400, 401):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Current password is incorrect.",
            ) from exc
        _raise_supabase_error(exc)

    return {"message": "Password updated. Please sign in again with your new password."}


@router.delete("/account")
def delete_account(
    data: DeleteAccountRequest,
    user: dict = Depends(_get_current_user),
) -> dict:
    if data.confirmation != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm account deletion.")

    if user.get("auth_provider") in ("local", "email"):
        if not data.password:
            raise HTTPException(status_code=401, detail="Password is required.")
        try:
            require_supabase()
            sign_in_with_password(user["email"], data.password)
        except SupabaseAuthError as exc:
            raise HTTPException(status_code=401, detail="Password is incorrect.") from exc

    try:
        require_supabase()
        admin_delete_user(user["id"])
        auth_db.delete_profile(user["id"])
    except SupabaseAuthError as exc:
        _raise_supabase_error(exc)

    return {"message": "Account deleted."}
