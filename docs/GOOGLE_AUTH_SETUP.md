# Enable Google sign-in for GRIXDroid

GRIXDroid uses Supabase Auth for Google sign-in. The browser starts an authorization-code flow with PKCE and exchanges the one-time code with Supabase. A Google client secret is stored only in Supabase—not in Vite or browser code.

## 1. Create and brand the Google OAuth web client

1. Open the [Google Auth Platform Branding page](https://console.cloud.google.com/auth/branding) and select the Google Cloud project that owns the OAuth client ID configured in Supabase.
2. Set **App name** to **GRIXDroid**. This is the name Google displays for the application requesting access; do not leave the Supabase project hostname as the app name.
3. Upload the GRIXDroid product logo (not the Google logo), set a support email, and add the current GRIXDroid homepage: `https://grixdriod.vercel.app/`.
4. Add real privacy policy and terms URLs when those published pages are available. Do not enter placeholder links.
5. Configure the app's audience. While the app is in Testing, add the Google accounts that should be allowed to test it.
6. Under **Data Access**, ensure the `openid` scope is included. Google email and profile scopes provide basic account identity.
7. Under **Clients**, create a OAuth client ID and choose **Web application** if one does not already exist.
8. Add the GRIXDroid site origin under **Authorized JavaScript origins**.
9. Under **Authorized redirect URIs**, add the Supabase callback URL shown on the Google provider page. For the current GRIXDroid Supabase project it is:

   `https://olbqxgnhozafcckcoapx.supabase.co/auth/v1/callback`

10. Save the OAuth client and copy its client ID and client secret.

## 2. Enable Google in Supabase

Open the [GRIXDroid Google provider settings](https://supabase.com/dashboard/project/olbqxgnhozafcckcoapx/auth/providers?provider=Google).

1. Enable **Google**.
2. Paste the Google OAuth **Client ID** and **Client Secret** into the provider form.
3. Save the provider settings.

The Google client secret belongs only in this Supabase provider configuration. Do not add it to Vercel frontend variables, `.env.local`, `.env.example`, GitHub, or browser code.

## 3. Keep the callback on GRIXDroid

Open the [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/olbqxgnhozafcckcoapx/auth/url-configuration).

1. Set **Site URL** to `https://grixdriod.vercel.app/` (not `http://localhost:3000` and not the Supabase API hostname).
2. Add this exact production URL under **Redirect URLs**: `https://grixdriod.vercel.app/`.
3. Do not use localhost as the production Site URL. The sign-in flow now moves users to the canonical GRIXDroid site before starting OAuth, keeping its PKCE verifier and callback on the same site.
4. When GRIXDroid moves to its purchased domain, update the Site URL and Redirect URLs to that domain and set Vercel's `VITE_GRIXDROID_SITE_URL` environment variable to the same HTTPS origin before redeploying.

## 4. Publish the Google brand

On the Google Auth Platform **Branding** page, review the app name, product logo, support email, and homepage URL. If Google offers **Verify branding**, complete that process and then select **Publish branding**. For an External app in production, Google requires brand verification before the app name and logo are displayed to all users. Full domain verification requires a domain GRIXDroid controls; add the purchased domain after registration and verify ownership as instructed by Google.

## 5. Build and verify

After the Google provider and redirect allow-list are saved, deploy the latest `main` branch. Open GRIXDroid at `https://grixdriod.vercel.app/`, choose **Continue with Google**, select a Google account, and confirm that the browser returns to the GRIXDroid page and displays the signed-in workspace. It should not return to `localhost:3000`.

The session is kept in browser storage using the same access-token/refresh-token pattern used by Supabase browser clients. Signing out removes the stored session. The PKCE verifier is short-lived and removed after the callback is processed.

## Troubleshooting

- **Provider is not enabled:** enable Google in Supabase Auth > Providers.
- **Redirect URL is not allowed:** add the exact GRIXDroid site URL to Supabase Auth > URL Configuration.
- **Google redirect URI mismatch:** use the Supabase callback URL from the Google provider page—not the GRIXDroid website URL—in Google's Authorized redirect URIs.
- **App is in testing mode:** add the account as a test user in Google Auth Platform > Audience, or publish the consent screen when the app is ready.
