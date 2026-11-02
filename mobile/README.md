# LevaGo para Android (Flutter)

A app abre o site da LevaGo (Cliente, Estafeta e Admin) com as cores da marca.

- O GitHub Actions gera o APK em cada alteração nesta pasta (ficheiro `.github/workflows/apk.yml`).
- O APK fica em **Releases** do repositório, com o nome `LevaGo-2.0.N.apk`.
- A pasta `android/` é criada no momento da construção com `flutter create` e ajustada por `tool/patch_android.py`.
- Esta versão usa a chave de teste. Antes da Play Store, é preciso criar a chave de produção e guardá-la nos segredos do GitHub.
