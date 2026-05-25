# Todoist Integration Notes

Research date: 2026-05-25.

This file captures the Todoist integration research so it survives context
compaction and can guide the next implementation pass.

## Current Architecture

The project already has the right high-level shape for another task provider:

- `src/providers/types.ts` defines the provider contract: `authenticate`,
  `isAuthenticated`, `disconnect`, `listProjects`, `listTasks`, and
  `completeTask`.
- `src/core/background/handlers.ts` routes messages through `providerId` and
  `getProviderOrNull`.
- Provider state is stored per provider under
  `local:todotube:provider:<providerId>`.
- UI and surfaces are mostly provider-agnostic.

Before the preparatory refactor, the remaining TickTick-specific coupling was
mostly presentation and defaults:

- `src/shared/types.ts` has `ProviderId = 'ticktick'`.
- `src/ui/options/sections.ts` renders a single TickTick account row.
- `src/ui/panel.ts` hardcodes `Connect TickTick` and `Open TickTick`.
- `src/core/popup.ts` hardcodes the provider display name.
- `src/core/lifecycle.ts` imports TickTick's web app URL directly.
- `src/entrypoints/background.ts` watches only TickTick provider state.

The preparatory refactor added `src/shared/providers.ts` as the provider
metadata catalog. UI/core/background can now read display names, web app URLs,
default list IDs, smart-list captions, and known provider IDs without importing
from provider implementations. It also added an `AUTH_STATUS` background
message so options UI can ask about a specific provider instead of only the
currently active provider.

## Todoist API Ground Truth

Todoist's current official docs point to Todoist API v1, not the old REST v2
surface. Use API v1 for the new provider.

Official docs:

- API v1 overview and authorization:
  <https://developer.todoist.com/api/v1/>
- TypeScript SDK docs:
  <https://doist.github.io/todoist-api-typescript/>

Important API details:

- API base: `https://api.todoist.com`.
- OAuth authorize endpoint:
  `https://app.todoist.com/oauth/authorize`.
- OAuth token endpoint:
  `https://api.todoist.com/oauth/access_token`.
- OAuth scope needed for ToDoTube: `data:read_write`.
  `data:read` is enough to read, but click-to-complete requires write access.
- Newly-created Todoist apps issue short-lived access tokens plus refresh
  tokens by default. Legacy apps may return long-lived access tokens without
  a refresh token.
- The token exchange response can contain `access_token`, `token_type`,
  `expires_in`, `refresh_token`, and `scope`.
- Todoist API v1 uses lowercase endpoints and opaque string IDs. Do not assume
  numeric IDs.
- Many endpoints are cursor-paginated. Handle `results` and `next_cursor`.

Endpoints needed for ToDoTube:

- List projects: `GET /api/v1/projects`.
- List tasks in a project: `GET /api/v1/tasks?project_id=<id>`.
- Today smart list: `GET /api/v1/tasks/filter?query=today | overdue`.
  Decide later whether the app wants `today` only or `today | overdue`; the
  current TickTick behavior includes recent overdue tasks, so `today | overdue`
  is the closest Todoist-native equivalent.
- Complete task: `POST /api/v1/tasks/{task_id}/close`.

Todoist task mapping:

- `id` -> `Task.id`.
- `project_id` -> `Task.projectId`.
- `content` -> `Task.title`.
- `due.datetime` or `due.date` -> `Task.dueDate`.
- `checked` -> `Task.completed`.
- `priority` is `1..4`, where `4` is highest. The current UI treats `>=5` as
  high because TickTick uses a different scale, so either normalize Todoist
  priority in the provider or make the shared priority model explicit.

Todoist project mapping:

- `id` -> `Project.id`.
- `name` -> `Project.name`.
- Ignore archived/deleted projects if those fields appear in responses.

Implementation plan for the Todoist provider:

1. Add `todoist` to `ProviderId` and provider metadata.
2. Add `src/providers/todoist/config.ts`.
3. Add `src/providers/todoist/oauth.ts`, modeled on TickTick OAuth but with
   refresh-token support as the normal path.
4. Add `src/providers/todoist/api.ts` with authed fetch, refresh-on-401, and
   cursor pagination helpers.
5. Add `src/providers/todoist/provider.ts` implementing the existing Provider
   interface.
6. Add Todoist to `src/providers/registry.ts`.
7. Add `https://api.todoist.com/*` to `wxt.config.ts` host permissions.
8. Add `.env.example` entries for Todoist OAuth credentials or document an
   OAuth Client ID Metadata / PKCE path if we choose public-client auth.
9. Add focused tests for task mapping, due-date mapping, pagination, and token
   refresh behavior.

Open product decisions:

- Should Todoist's default smart list be `today` or `today | overdue`?
- Should the options page support selecting the active provider now, or should
  connecting a provider make it active?
- Should provider priority be normalized to a shared visual scale?
