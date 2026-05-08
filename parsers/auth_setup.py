"""
Helper de un solo uso para generar el refresh token de Gmail.

Necesita `credentials.json` en la misma carpeta (descargado desde Google
Cloud Console — ver docs/setup_gmail_api.md).

Al correrlo:
1. Abre el navegador para autorizar la app con tu cuenta de Gmail dedicada.
2. Imprime las tres variables que tienes que pegar en GitHub Secrets.

NO se sube credentials.json ni los valores impresos al repo.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

# gmail.modify nos permite leer correos y agregar la etiqueta "auditor-procesado".
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]
CREDS_PATH = Path(__file__).parent / "credentials.json"


def main() -> None:
    if not CREDS_PATH.exists():
        print(f"Falta {CREDS_PATH}.")
        print("Descárgalo de Google Cloud Console y guárdalo en parsers/credentials.json")
        print("Pasos completos en docs/setup_gmail_api.md")
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_PATH), SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent")

    # Sacamos el client_id/secret del JSON original.
    with CREDS_PATH.open() as f:
        client_cfg = json.load(f)
    installed = client_cfg.get("installed") or client_cfg.get("web") or {}
    client_id = installed.get("client_id", "")
    client_secret = installed.get("client_secret", "")

    if not creds.refresh_token:
        print("ERROR: Google no devolvió refresh_token.")
        print("Borra los permisos previos en https://myaccount.google.com/permissions")
        print("y vuelve a correr este script.")
        sys.exit(2)

    print()
    print("=" * 60)
    print("Pega estos tres valores en GitHub Secrets")
    print("(Settings → Secrets and variables → Actions)")
    print("=" * 60)
    print(f"GMAIL_CLIENT_ID={client_id}")
    print(f"GMAIL_CLIENT_SECRET={client_secret}")
    print(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}")
    print("=" * 60)
    print()
    print("Para probar localmente, exporta los tres como variables de entorno")
    print("y corre: python3 ingest_mail.py")


if __name__ == "__main__":
    main()
