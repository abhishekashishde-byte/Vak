# Ana Action Routing

Ana never creates an external task automatically. A meeting action appears in the Action Center first. The user must choose a provider and then click **Approve & send**.

## Jira Cloud

Set these server-side Vercel environment variables:

- `ANA_JIRA_BASE_URL` — e.g. `https://your-company.atlassian.net`
- `ANA_JIRA_EMAIL` — Jira account email used for API authentication
- `ANA_JIRA_API_TOKEN` — Jira API token
- `ANA_JIRA_PROJECT_KEY` — project key to receive Ana tasks
- `ANA_JIRA_ISSUE_TYPE` — optional, defaults to `Task`

Secrets stay on the server. The browser sends only the Ana action ID and provider name. The server reloads the action and source meeting through the authenticated Ana account before creating the Jira issue.

## Microsoft Planner

Set:

- `ANA_PLANNER_WEBHOOK_URL` — HTTPS endpoint that creates a Planner task (for example a Power Automate flow or customer-controlled Microsoft Graph gateway)
- `ANA_PLANNER_WEBHOOK_SECRET` — optional bearer secret for that endpoint

Ana sends the approved action, owner/deadline text, customer/project metadata, and source meeting reference only after explicit approval.

## Receipts

Successful routes are stored in `meeting_action_routes` with:
- provider
- external ID
- external URL when returned
- source Ana action
- timestamp

RLS restricts these receipts to the signed-in Ana user.
