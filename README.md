# Bilan énergie — web app

Affiche les bilans hebdomadaires (production solaire FHE, consommation,
autoconsommation, économies) enregistrés dans Supabase par Home Assistant.

Stack : Next.js (App Router) · Tailwind · Recharts · Supabase JS · déployé sur Vercel.

## Mise en place

1. **Supabase** : créer un projet, exécuter [`../supabase/schema.sql`](../supabase/schema.sql)
   dans *SQL Editor*. La table `weekly_reports` est en lecture seule pour la clé
   `anon` (RLS) ; Home Assistant écrit avec la clé `service_role`.
2. **Local** :
   ```bash
   cp .env.example .env.local   # renseigner URL + clé anon
   npm install
   npm run dev
   ```
   Sans Supabase : `MOCK_DATA=1 npm run dev` affiche 3 semaines de données réelles de test.
3. **Vercel** : importer le dépôt, *Root Directory* = `webapp`, ajouter
   `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` dans les variables
   d'environnement. La page d'accueil est statique et revalidée toutes les heures.

## Pages

- `/` — dernière semaine (tuiles), graphique par semaine, historique.
- `/semaine/<YYYY-MM-DD>` — détail par jour d'une semaine (date = lundi).
