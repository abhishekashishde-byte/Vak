# Ana + Zoom integration

## What is implemented in this branch

- User-managed Zoom OAuth connection.
- Encrypted Zoom OAuth tokens in an HttpOnly cookie.
- Automatic access-token refresh.
- Upcoming hosted Zoom meeting list inside Ana Meeting mode.
- Open a selected Zoom meeting from Ana.
- `Use with Ana` switches Meeting mode to browser/tab audio when supported.
- Ana then uses its existing realtime translation pipeline to build the live transcript, translated transcript, MOM/summary, decisions and to-dos.

This first version intentionally does **not** pretend to use native Zoom RTMS media. The live audio path is Ana's existing browser audio capture.

## Zoom Marketplace configuration

Create a **General app** in the Zoom App Marketplace and configure user OAuth.

### Redirect URL

Use:

`https://YOUR_ANA_DOMAIN/api/zoom/callback`

The same value must be set as `ZOOM_REDIRECT_URI` in Vercel.

### Required granular scopes for v1

- `user:read:user`
- `meeting:read:list_meetings`

## Vercel environment variables

- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `ZOOM_REDIRECT_URI`
- `ZOOM_TOKEN_SECRET` — random 32+ character secret recommended

## Native RTMS phase

Zoom RTMS is the right next step when we want Ana to receive meeting audio/transcripts directly from Zoom without asking the user to share a browser tab. Zoom currently requires a General app with RTMS scopes and Zoom Developer Pack credits. The RTMS backend receives meeting media over a persistent WebSocket connection.

For Ana, native RTMS should eventually feed the same transcript/translation/MOM pipeline already used by `MeetingMode` so the user experience remains unchanged.
