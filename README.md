# Paletto Auto — Intranet du concessionnaire

Site privé de Paletto Auto (serveur RP) : intranet des vendeurs + vitrine publique (présentation, événements, recrutement, prise de rendez-vous).
Hébergé gratuitement sur **Cloudflare Workers** avec une base **D1**. Les tables se créent automatiquement.

## Fonctions
- Comptes employés, grades personnalisables et permissions
- Ventes de véhicules (modèle, plaque, client, remise partenaire, vendeur)
- Clients (avec liste noire), partenariats avec remise en %
- Chiffre d'affaires, objectifs, graphique, clôture de la semaine et historique
- Dépenses, bénéfice et solde du compte
- Demandes de rendez-vous et candidatures reçues depuis la vitrine
- Événements, journal d'activité, fiches employés (infos RP + carte d'identité RP)

## Mise en ligne
1. **GitHub** : nouveau dépôt privé (ex. `paletto-auto`) → *uploading an existing file* → **extraire le zip d'abord**, puis glisser `functions`, `public`, `src`, `wrangler.jsonc`, `README.md` → *Commit changes*.
2. **Base de données** : Cloudflare → *Storage & Databases* → *D1* → *Create* → nom `paletto-auto` → copier le **Database ID**.
3. **wrangler.jsonc** sur GitHub (branche `main`, touche **E**) : remplacer `COLLER-ICI-L-ID-DE-LA-BASE` par cet ID → *Commit changes*.
4. **Worker** : *Workers & Pages* → *Create* → *Import a repository* → choisir le dépôt → nom du projet **`paletto-auto`** (identique à `"name"` dans `wrangler.jsonc`) → *Deploy command* : `npx wrangler deploy`.
5. Attendre le point vert dans *Deployments*, ouvrir `https://paletto-auto.<ton-sous-domaine>.workers.dev/#espace` et **créer tout de suite le compte Directeur**.

## Après l'installation
- *Événements → Réglages de la vitrine* : message d'accueil, téléphone, adresse, ouverture du recrutement.
- *Grades & permissions* : cocher « Traiter les demandes de rendez-vous » pour les vendeurs.

## Problèmes fréquents
| Message | Solution |
|---|---|
| `must have a valid database_id` | ID manquant ou faux dans `wrangler.jsonc`, ou build lancé sur une ancienne version |
| « Something went wrong… can't process that file » (GitHub) | Le zip n'a pas été extrait avant l'envoi |
| 404 sur `/api/...` | Les fichiers ne sont pas à la racine du dépôt |
