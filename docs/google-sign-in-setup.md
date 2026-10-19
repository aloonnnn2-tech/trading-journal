# Turning on "Continue with Google"

The code is already done. The button appears on its own on the sign-in and sign-up
pages **as soon as Google is switched on in Supabase** (step 3), and disappears again
if it's switched off. These are the steps only the account owner can do. It takes
about 15 minutes.

You need: a Google account, and access to the Supabase dashboard for the **live**
project (`uskkuyfnpoowcxuwfsdw`).

---

## 1. Google Cloud: describe the app (the consent screen)

1. Go to <https://console.cloud.google.com/> and sign in.
2. Top bar → project picker → **New project** → name it `Trading Lens` → **Create**.
   Make sure it's selected afterwards.
3. Open the menu (☰) → **APIs & Services** → **OAuth consent screen** (it may be
   called **Google Auth Platform**). Click **Get started**.
4. Fill in:
   - **App name:** `Trading Lens`
   - **User support email:** your email
   - **Audience:** **External**
   - **Contact email:** your email
   - Agree to the policy → **Create**.
5. Go to **Branding** (left menu) and, under **Authorized domains**, add both:
   - `tradinglenz.netlify.app`
   - `uskkuyfnpoowcxuwfsdw.supabase.co`

   Optionally add the logo and the links to `https://tradinglenz.netlify.app/privacy`
   and `/terms`. **Save**.
6. Go to **Audience** → **Publish app** → confirm. (Until it's published, only test
   users you list can sign in. The app only asks for email, name and picture, so
   Google doesn't need to review it.)

## 2. Google Cloud: create the keys

1. Left menu → **Clients** (or **Credentials** → **Create credentials** →
   **OAuth client ID**).
2. **Application type:** Web application. **Name:** `Trading Lens web`.
3. **Authorized JavaScript origins**, add:
   - `https://tradinglenz.netlify.app`
   - `http://localhost:3000`
4. **Authorized redirect URIs**, add exactly this one (Supabase's address, not the
   app's):
   - `https://uskkuyfnpoowcxuwfsdw.supabase.co/auth/v1/callback`
5. **Create**. Copy the **Client ID** and the **Client secret**. Keep the secret
   private: don't paste it in chat or commit it.

## 3. Supabase: switch Google on

1. <https://supabase.com/dashboard> → the live Trading Lens project.
2. **Authentication** → **Sign In / Providers** → **Google**.
3. Turn on **Enable Sign in with Google**, paste the **Client ID** and **Client
   secret**, and **Save**.

## 4. Supabase: allow the app's return address

1. **Authentication** → **URL Configuration** → **Redirect URLs** → **Add URL**, and
   add each of these:
   - `https://tradinglenz.netlify.app/auth/callback`
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3002/auth/callback`
2. Leave **Site URL** as it is. **Save**.

(Without this, Google sign-in "works" but lands on the home page signed out.)

## 5. Try it

1. Make sure the new code is deployed (or run it locally with `npm run dev`).
2. Sign out, open the sign-in page: **Continue with Google** is there.
3. Click it, pick your Google account, and you land on the dashboard.

Good to know:

- **Existing users:** someone who signed up with email and later uses Google with the
  same Gmail address ends up in the **same** account, not a new one.
- **New Google users** are asked once to confirm they're 18+ and accept the Terms (the
  same screen older accounts got), because Google sign-up skips the sign-up checkbox.
- **Google's screen says "to continue to uskkuyfnpoowcxuwfsdw.supabase.co".** That's
  normal on Supabase's standard plan. Showing your own domain there needs Supabase's
  paid "custom domain" add-on.
- **To turn it off:** switch Google off in step 3. The button disappears by itself.
