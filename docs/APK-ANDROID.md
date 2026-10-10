# Application Android (APK manuel)

Application « coque » (Trusted Web Activity) qui ouvre https://sport-vault.onrender.com en plein écran : pas de code de jeu dans l'APK, tout vient du site (les mises à jour du site sont donc immédiates, sans nouvel APK).

## Contenu
- `android/` : projet Gradle (package `com.footvault.app`, minSdk 23, targetSdk 34, `androidbrowserhelper` 2.5.0). Icônes tirées de `footvault-icon-*.png`.
- `lib/assetlinks.js` + route `GET /.well-known/assetlinks.json` : lie le site à l'application (empreinte SHA-256 du certificat de signature, publique). Tant que cette vérification n'a pas réussi, Chrome affiche une barre d'adresse en haut de l'application ; l'application fonctionne quand même.
- Notifications push : gérées par Chrome (le site demande l'autorisation comme dans le navigateur). Rien d'e-mail.

## Installer l'APK sur un téléphone Android
1. Copier `footvault-1.0.apk` sur le téléphone (câble, Drive, e-mail à soi-même…).
2. L'ouvrir ; Android demande d'autoriser l'installation depuis cette source (« Installer des applications inconnues ») : accepter pour l'application utilisée (Fichiers, Chrome…).
3. Lancer FOOTVAULT. Chrome doit être installé et à jour.

## Signature : à conserver absolument
- `footvault-release.jks` + `keystore.properties` (mot de passe) : **à garder en lieu sûr, jamais dans le dépôt ni dans un message**. Sans eux, impossible de publier une mise à jour qui s'installe par-dessus l'ancienne (il faudrait désinstaller).
- Empreinte SHA-256 actuelle : `9E:09:08:30:04:4D:C7:1A:D4:86:59:9E:48:79:AE:0B:7B:7C:8E:C0:29:C2:71:4F:88:99:4B:98:44:74:02:E6`. Si la clé change : variable `ANDROID_CERT_SHA256` sur Render (plusieurs empreintes séparées par des virgules), sans modifier le code.

## Recompiler (JDK 17+, Android SDK 34, Gradle 8.x)
```
cd android
printf 'sdk.dir=/chemin/vers/android-sdk\n' > local.properties
FV_KEYSTORE_PROPS=/chemin/vers/keystore.properties gradle assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```
`keystore.properties` : `storeFile`, `storePassword`, `keyAlias=footvault`, `keyPassword`. Pour une mise à jour : augmenter `versionCode` (et `versionName`) dans `android/app/build.gradle`.

## Limites connues
- Non testé sur un appareil ou un émulateur (compilation et signature vérifiées, pas l'exécution). 
- Vérification des Digital Asset Links à confirmer après déploiement : plein écran sans barre d'adresse.
- Distribution Google Play : non faite (choix du propriétaire : APK manuel).
