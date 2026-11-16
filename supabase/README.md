# Supabase Setup Guide for American Pancakes POS

This directory contains the database schema and configurations to run the American Pancakes POS on Supabase (Cloud PostgreSQL).

## Step 1: Create a Project in Supabase
1. Go to [https://supabase.com](https://supabase.com) and log in.
2. Click **New project**.
3. Choose a name (e.g. `american-pancakes-pos`), set a secure database password, and select your region (e.g. `Singapore` or your nearest region).
4. Click **Create new project**.

## Step 2: Apply the Schema
1. In your Supabase dashboard, click on **SQL Editor** from the left navigation menu.
2. Click **New query**.
3. Copy the entire contents of [schema.sql](./schema.sql) and paste it into the SQL Editor.
4. Click **Run** (or press Ctrl + Enter).
5. All 25+ POS tables, relational foreign keys, constraints, and performance indexes will be created in under 5 seconds.

## Step 3: Copy Environment Variables
Go to **Project Settings** -> **Database** / **API**:

1. **`SUPABASE_URL`**: Your project URL (e.g. `https://your-project.supabase.co`)
2. **`SUPABASE_SERVICE_ROLE_KEY`**: Under API Keys, copy the `service_role` (secret) key.
3. **`DATABASE_URL`**: Under Database -> Connection String -> URI (or Connection pooling -> Transaction mode), copy the PostgreSQL URI:
   `postgres://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres`

## Step 4: Add Variables to your `.env` or Deployment Platform
Add these variables to your `.env` file or cloud host:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
DATABASE_URL=postgres://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require
PORT=8080
NODE_ENV=production
```
