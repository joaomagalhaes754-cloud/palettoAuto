# Paletto Auto — Intranet du concessionnaire

Site privé de Paletto Auto (serveur RP) : intranet des vendeurs + vitrine publique (présentation, événements, recrutement, prise de rendez-vous).
Hébergé gratuitement sur **Cloudflare Workers** avec une base **D1**. Les tables se créent automatiquement.

## Fonctions
- Comptes employés, grades personnalisables et permissions
- Ventes de véhicules (modèle choisi dans la liste des prix, plaque, client, remise partenaire, vendeur, capture d'écran obligatoire)
- Véhicules : liste des prix des neufs + occasions affichées sur la vitrine (prix, infos, photo)
- Classement de la semaine, prime du meilleur vendeur et échelle de salaire (réglables dans « Objectifs & salaires »)
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

## Bot Discord : avis (/avis), tickets (/ticket-panel) et demandes de rôle (/role-panel)
Le bot tourne dans ce même Worker (adresse `/api/discord`). Mise en place :
1. https://discord.com/developers/applications → *New Application* → copier **Application ID** et **Public Key** ; onglet *Bot* → *Reset Token* → copier le **token**.
2. Cloudflare → Worker → *Settings* → *Variables and Secrets* → ajouter 3 **Secrets** : `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`.
3. Ouvrir `https://<votre-site>/api/discord/setup` → « Commande /avis enregistrée ».
4. Portail Discord → *General Information* → *Interactions Endpoint URL* : `https://<votre-site>/api/discord` → *Save Changes*.
5. Inviter le bot : `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=applications.commands`.
6. (Conseillé) Paramètres du serveur → *Intégrations* → le bot → n'autoriser `/avis` que dans le salon des avis.

### Tickets
- Après chaque mise à jour du bot, rouvrir `https://<votre-site>/api/discord/setup` : la page donne le **lien d'invitation complet** (le bot doit pouvoir créer des salons).
- Dans le salon de support : `/ticket-panel` (réservé à « Gérer le serveur ») → choisir le rôle de l'équipe et, si besoin, la catégorie des tickets.
- Le bouton « Ouvrir un ticket » crée un salon privé (client + rôle de l'équipe). « Fermer le ticket » le supprime (auteur, équipe ou admins).

### Demandes de rôle
- `/role-panel` (réservé à « Gérer les rôles ») : choisir le **salon de l'équipe** où arrivent les demandes et jusqu'à 5 rôles demandables.
- Le membre choisit un rôle dans la liste et explique pourquoi ; l'équipe reçoit la demande avec **Accepter** / **Refuser**. Le membre reçoit la réponse en MP.
- Le rôle du bot doit être **au-dessus** des rôles qu'il donne (Paramètres du serveur → Rôles).
