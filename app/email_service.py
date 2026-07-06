"""Transactional email (verification, password reset).

TODO: Email verification will be enabled after Supabase or SMTP is connected.
When SMTP is not configured, messages are written to app/data/email_outbox/
(server-side only — not shown to users).
"""

from __future__ import annotations

import logging
import os
import re
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

OUTBOX_DIR = Path(__file__).resolve().parent / "data" / "email_outbox"
DeliveryMode = Literal["smtp", "outbox"]


class EmailDeliveryError(Exception):
    """Raised when an email could not be delivered via SMTP."""


@dataclass
class SendResult:
    delivered: bool
    mode: DeliveryMode
    to: str
    subject: str
    verification_url: str | None = None
    outbox_path: str | None = None
    error: str | None = None

    def to_public_dict(self) -> dict:
        return {
            "delivered": self.delivered,
            "mode": self.mode,
            "to": self.to,
        }


def _base_url() -> str:
    return os.getenv("APP_BASE_URL", "").strip().rstrip("/")


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip())


def delivery_mode() -> DeliveryMode:
    return "smtp" if smtp_configured() else "outbox"


def delivery_info() -> dict:
    configured = smtp_configured()
    return {
        "email_delivery_mode": delivery_mode(),
        "smtp_configured": configured,
        "app_base_url": _base_url(),
        "requires_smtp_for_real_delivery": not configured,
    }


def _extract_verification_url(body: str) -> str | None:
    patterns = [
        r"(https?://[^\s]+/auth/v1/verify[^\s]+)",
        r"(https?://[^\s]+verify-email\.html\?token=[^\s]+)",
        r"(https?://[^\s]+verify-email\.html[^\s]*)",
    ]
    for pattern in patterns:
        match = re.search(pattern, body)
        if match:
            return match.group(1).rstrip(").,;]")
    return None


def _outbox_path_for(to: str, subject: str) -> Path:
    safe = to.replace("@", "_at_").replace(".", "_")
    return OUTBOX_DIR / f"{safe}_{subject.replace(' ', '_')[:40]}.txt"


def get_outbox_preview(to: str, subject_contains: str = "Verify") -> dict | None:
    """Return the latest outbox message for an address (development only)."""
    if smtp_configured():
        return None
    if not OUTBOX_DIR.exists():
        return None

    email_lower = to.strip().lower()
    candidates = sorted(OUTBOX_DIR.glob("*.txt"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in candidates:
        if email_lower.replace("@", "_at_").replace(".", "_") not in path.name:
            continue
        if subject_contains.replace(" ", "_") not in path.name:
            continue
        text = path.read_text(encoding="utf-8")
        url = _extract_verification_url(text)
        if not url:
            continue
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        return {
            "to": to,
            "subject": subject_contains,
            "verification_url": url,
            "written_at": mtime.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "outbox_file": str(path.name),
            "notice": "Development preview only. Configure SMTP to send emails to real inboxes.",
        }
    return None


def _send_smtp(to: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    from_addr = os.getenv("SMTP_FROM", "BookMindAI <noreply@bookmind.ai>")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to
    msg.set_content(body)

    try:
        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
                if user and password:
                    server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as server:
                server.ehlo()
                if use_tls:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                    server.ehlo()
                if user and password:
                    server.login(user, password)
                server.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        raise EmailDeliveryError(
            "SMTP authentication failed. Check SMTP_USER and SMTP_PASSWORD "
            "(for Gmail, use an App Password)."
        ) from exc
    except smtplib.SMTPConnectError as exc:
        raise EmailDeliveryError(
            f"Could not connect to mail server {host}:{port}. Check SMTP_HOST and SMTP_PORT."
        ) from exc
    except smtplib.SMTPRecipientsRefused as exc:
        raise EmailDeliveryError(
            f"The mail server rejected the recipient address ({to}). Check that the email is correct."
        ) from exc
    except smtplib.SMTPException as exc:
        raise EmailDeliveryError(f"Mail server error: {exc}") from exc
    except OSError as exc:
        raise EmailDeliveryError(f"Could not reach mail server: {exc}") from exc


def _send(to: str, subject: str, body: str) -> SendResult:
    to = to.strip().lower()
    verification_url = _extract_verification_url(body)

    if not smtp_configured():
        OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
        path = _outbox_path_for(to, subject)
        path.write_text(f"To: {to}\nSubject: {subject}\n\n{body}", encoding="utf-8")
        logger.warning(
            "SMTP not configured — verification email for %s saved to %s (not sent to inbox)",
            to,
            path,
        )
        return SendResult(
            delivered=True,
            mode="outbox",
            to=to,
            subject=subject,
            verification_url=verification_url,
            outbox_path=str(path),
        )

    try:
        _send_smtp(to, subject, body)
        logger.info("Sent email to %s: %s", to, subject)
        return SendResult(
            delivered=True,
            mode="smtp",
            to=to,
            subject=subject,
            verification_url=verification_url,
        )
    except EmailDeliveryError:
        raise
    except Exception as exc:
        raise EmailDeliveryError(f"Unexpected email error: {exc}") from exc


def send_verification_email(to: str, token: str) -> SendResult:
    link = f"{_base_url()}/verify-email.html?token={token}"
    return send_verification_link(to, link)


def send_verification_link(to: str, verification_url: str) -> SendResult:
    body = (
        "Welcome to BookMindAI!\n\n"
        "Please verify your email address by opening this link:\n"
        f"{verification_url}\n\n"
        "This link expires in 24 hours.\n\n"
        "If you don't see this email, check your Spam or Junk folder.\n\n"
        "If you did not create an account, you can ignore this email."
    )
    return _send(to, "Verify your BookMindAI email", body)


def send_password_reset_email(to: str, token: str) -> SendResult:
    link = f"{_base_url()}/reset-password.html?token={token}"
    body = (
        "We received a request to reset your BookMindAI password.\n\n"
        f"Reset your password here:\n{link}\n\n"
        "This link expires in 1 hour.\n\n"
        "If you don't see this email, check your Spam or Junk folder.\n\n"
        "If you did not request this, you can safely ignore this email."
    )
    return _send(to, "Reset your BookMindAI password", body)
