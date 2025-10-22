import os
import re
import json
import time
import requests
from pathlib import Path
from google.oauth2 import service_account
from google.auth.transport.requests import Request
from dotenv import load_dotenv

load_dotenv()

# === CONFIG ===
RETRY_DIR = Path("./retry_to_sheets")  # carpeta con releases pendientes
SHEET_ID = "11VvOH_7A7AsnhRO4TAG4R1sxZctiRZdwBuWtyidDCbk"
SHEET_NAME = "Hoja 1"

GCS_JSON = os.getenv("GCS_CREDENTIALS_JSON")
assert GCS_JSON and Path(GCS_JSON).exists(), "⚠️ Falta GCS_CREDENTIALS_JSON o no existe el archivo JSON"
assert RETRY_DIR.exists(), f"⚠️ No existe la carpeta {RETRY_DIR}"

# === FUNCIONES ===

def get_access_token():
    """Usa el service account JSON (el mismo de GCS) para pedir un token válido."""
    creds = service_account.Credentials.from_service_account_file(
        GCS_JSON,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    creds.refresh(Request())
    return creds.token

def parse_txt_info(txt_path):
    """Lee un archivo .txt y devuelve los datos estructurados."""
    with open(txt_path, "r", encoding="utf-8") as f:
        content = f.read()

    data = {
        "nombre": re.search(r"Release:\s*(.*)", content),
        "artistas": re.search(r"Artista\(s\):\s*(.*)", content),
        "año": re.search(r"Año:\s*(.*)", content),
        "pais": re.search(r"País:\s*(.*)", content),
    }
    for k, v in data.items():
        data[k] = v.group(1).strip() if v else ""
    return data

def add_to_sheet(token, data, precio="", propietario="", vendido="No", en_instagram="Sí"):
    """Agrega una fila nueva a tu Google Sheet en el orden A:H."""
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{SHEET_NAME}!A:H:append"
    params = {"valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"}
    body = {
        "values": [[
            data.get("nombre", ""),     # A: EP
            data.get("artistas", ""),   # B: Artista(s)
            data.get("pais", ""),       # C: País
            data.get("año", ""),        # D: Año
            precio,                     # E: Precio
            vendido,                    # F: Vendido
            en_instagram,               # G: Publicado en IG
            propietario                 # H: Propietario
        ]]
    }
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    resp = requests.post(url, params=params, json=body, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Error subiendo a Sheets: {resp.text}")

def main():
    print(f"📂 Buscando releases en {RETRY_DIR} ...")
    token = get_access_token()

    for folder in RETRY_DIR.iterdir():
        if not folder.is_dir():
            continue

        txt_files = list(folder.glob("*.txt"))
        if not txt_files:
            print(f"⚠️ No hay .txt en {folder.name}, se salta.")
            continue

        info = parse_txt_info(txt_files[0])

        try:
            add_to_sheet(token, info)
            print(f"✅ Agregado a Google Sheets: {info['nombre']}")
        except Exception as e:
            print(f"❌ Error agregando {folder.name}: {e}")

if __name__ == "__main__":
    main()