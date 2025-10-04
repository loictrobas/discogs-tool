import os, requests, sys

TOKEN = os.environ.get("FB_TOKEN") or "EAA656tQYBIABPjdSGEbS5GKd2TBmAleCJuIc6z7QP9U9AeZCF9tC2F6JA2cIEotyG327pIp6jZCtCCy6qZAM3YZCfBpORiJWB2EnfvMUtwWAostmIJulcGd3SFxHk2RbVRuLDF7NGmZBqbrTVC2vNiYboxzuwZBZAN2U6A9erSfe46Y5We5vcR0ycLqpPIQgvTItcnJZCJA2j8mVP6kXoCxETA7GcGOotw5j4ybuLc9NPPQZD"

# 1) Páginas
r = requests.get(
    "https://graph.facebook.com/v20.0/me/accounts",
    params={"access_token": TOKEN},
    timeout=30,
)
r.raise_for_status()
pages = r.json().get("data", [])
print("PAGES:")
for p in pages:
    print(f"- name={p.get('name')} id={p.get('id')}")

if not pages:
    print("\nNo se encontraron páginas. Verifica permisos del token (pages_show_list) y que seas admin de una Página.")
    sys.exit(0)

# Elegí la primera o reemplaza por la que corresponda
page_id = pages[0]["id"]
print(f"\nUsando PAGE_ID={page_id}")

# 2) IG User ID
r2 = requests.get(
    f"https://graph.facebook.com/v20.0/{page_id}",
    params={
        "fields": "instagram_business_account{id,username}",
        "access_token": TOKEN,
    },
    timeout=30,
)
r2.raise_for_status()
print("\nPAGE FIELDS:", r2.json())
iba = r2.json().get("instagram_business_account")
if iba:
    print(f"\nIG_USER_ID={iba.get('id')}  username={iba.get('username')}")
else:
    print("\nLa página no tiene instagram_business_account vinculado. Revisa la vinculación IG↔Página.")