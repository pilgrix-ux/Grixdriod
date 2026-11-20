# Enable Google sign-in for GRIXDroid

GRIXDroid uses Supabase Auth for Google sign-in. The browser starts an authorization-code flow with PKCE and exchanges the one-time code with Supabase. A Google client secret is stored only in Supabase—not in Vite or browser code.

## 1. Create a Google OAuth web client

1. Open the [Google Auth Platform](https://console.cloud.google.com/auth/overview) and choose the Google Cloud project for GRIXDroid.
2. Configure the app's audience and branding. For development, add the users who should be allowed to test the app.
3. Under **Data Access**, ensure the `openid` scope is included. The Google email and profile scopes are used for the basic account identity.
4. Under **Clients**, create an OAuth client ID and choose **Web application**.
5. Add the GRIXDroid site origin under **Authorized JavaScript origins**. Add your local Vite origin as well while developing, for example `http://localhost:5173`.
6. Under **Authorized redirect URIs**, add the Supabase callback URL shown on the Google provider page. For the current GRIXDroid Supabase project it is:

   `https://olbqxgnhozafcckcoapx.supabase.co/auth/v1/callback`

7. Save the OAuth client and copy its client ID and client secret.

## 2. Enable Google in Supabase

Open the [GRIXDroid Google provider settings](https://supabase.com/dashboard/project/olbqxgnhozafcckcoapx/auth/providers?provider=Google).

1. Enable **Google**.
2. Paste the Google OAuth **Client ID** and **Client Secret** into the provider form.
3. Save the provider settings.

The Google client secret belongs only in this Supabase provider configuration. Do not add it to Vercel frontend variables, `.env.local`, `.env.example`, GitHub, or browser code.

## 3. Allow the app redirect URLs

Open [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/olbqxgnhozafcckcoapx/auth/url-configuration).

1. Set **Site URL** to the real GRIXDroid production origin, including `https://` and no path.
2. Add the exact production callback origin/path to **Redirect URLs** (the app currently returns to the same path where sign-in started).
3. Add `http://localhost:5173/**` for local Vite testing.
4. Add any specific Vercel preview origin patterns you actually use. Keep the production origin exact where possible.

## 4. Build and verify

After the Google provider and redirect allow-list are saved, deploy the latest `main` branch. Open GRIXDroid in the same browser tab, choose **Continue with Google**, select a Google account, and confirm that the browser returns to GRIXDroid and displays the signed-in workspace.

The session is kept in browser storage using the same access-token/refresh-token pattern used by Supabase browser clients. Signing out removes the stored session. The PKCE verifier is short-lived and removed after the callback is processed.

## Troubleshooting

- **Provider is not enabled:** enable Google in Supabase Auth > Providers.
- **Redirect URL is not allowed:** add the exact GRIXDroid site URL to Supabase Auth > URL Configuration.
- **Google redirect URI mismatch:** use the Supabase callback URL from the Google provider page—not the GRIXDroid website URL—in Google's Authorized redirect URIs.
- **App is in testing mode:** add the account as a test user in Google Auth Platform > Audience, or publish the consent screen when the app is ready.
