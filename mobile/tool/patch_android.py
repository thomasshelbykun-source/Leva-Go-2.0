"""Ajusta o projeto Android gerado por «flutter create»: nome, permissões e endereço do site."""
import re
from pathlib import Path

manifest = Path('android/app/src/main/AndroidManifest.xml')
xml = manifest.read_text(encoding='utf-8')
perms = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
]
lines = ''.join(f'    <uses-permission android:name="{p}"/>\n' for p in perms if p not in xml)
xml = re.sub(r'(<manifest[^>]*>\n)', r'\1' + lines, xml, count=1)
xml = re.sub(r'android:label="[^"]*"', 'android:label="LevaGo"', xml, count=1)
# Abrir telefone e WhatsApp a partir da app (Android 11+ exige declarar).
if '<queries>' in xml and 'android.intent.action.DIAL' not in xml:
    xml = xml.replace('<queries>', '<queries>\n        <intent><action android:name="android.intent.action.DIAL"/></intent>\n        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>', 1)
manifest.write_text(xml, encoding='utf-8')
print(xml)
