export {
  NewRelicClient,
} from './newrelic-client.js';

export type {
  NerdGraphResponse,
  ExportData,
} from './newrelic-client.js';

export {
  DynatraceClient,
  NOTIFICATION_INTEGRATION_SCHEMA,
} from './dynatrace-client.js';

export type {
  DynatraceResponse,
  ImportResult,
} from './dynatrace-client.js';

// Phase 16 split-client stack (P15-06)
export {
  HttpTransport,
  type AuthHeaderProvider,
  type HttpRequest,
  type HttpResponse,
  type HttpTransportOptions,
} from './http-transport.js';
export {
  OAuth2PlatformTokenProvider,
  oauthAuthProvider,
  apiTokenAuthProvider,
  type OAuth2PlatformTokenOptions,
} from './oauth2-platform-token.js';
export {
  SettingsV2Client,
  DocumentClient,
  AutomationClient,
  type SplitClientOptions,
} from './split-clients.js';
