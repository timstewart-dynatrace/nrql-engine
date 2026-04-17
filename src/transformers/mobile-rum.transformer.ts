/**
 * Mobile RUM Transformer — Converts New Relic Mobile applications to
 * Dynatrace Gen3 Mobile application config + event-type mappings.
 *
 * Gen3 output:
 *   - `builtin:mobile.app-detection` rule per platform (Android / iOS /
 *     ReactNative / Flutter / Xamarin / Unity / Cordova / Capacitor)
 *   - OpenPipeline bizevents enrichment mapping NR mobile event types
 *     (MobileSession, MobileCrash, MobileRequest, handled exceptions)
 *     to `rum.mobile.*` event names
 *
 * Out of scope: SDK swap, build-pipeline changes, crash symbolication
 * upload — flagged in warnings (see OUT-OF-SCOPE.md).
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRMobilePlatform =
  | 'ANDROID'
  | 'IOS'
  | 'REACT_NATIVE'
  | 'FLUTTER'
  | 'XAMARIN'
  | 'UNITY'
  | 'CORDOVA'
  | 'CAPACITOR';

export interface NRMobileAppInput {
  readonly name?: string;
  readonly guid?: string;
  readonly platform?: NRMobilePlatform;
  readonly bundleId?: string;
  readonly applicationToken?: string;
  readonly customEvents?: string[];
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTMobileAppDetection {
  readonly schemaId: 'builtin:mobile.app-detection';
  readonly displayName: string;
  readonly applicationName: string;
  readonly platform: NRMobilePlatform;
  readonly enabled: boolean;
  readonly bundleId: string | undefined;
}

export interface DTMobileEventMapping {
  readonly schemaId: 'builtin:openpipeline.bizevents.pipelines';
  readonly displayName: string;
  readonly matcher: string;
  readonly fieldsAdd: Array<{ field: string; value: string }>;
}

export interface MobileRUMTransformData {
  readonly appDetection: DTMobileAppDetection;
  readonly eventMappings: DTMobileEventMapping[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// NR → DT mobile event-type mapping
// ---------------------------------------------------------------------------

const NR_MOBILE_EVENT_MAP: Record<string, string> = {
  MobileSession: 'rum.mobile.session',
  MobileCrash: 'rum.mobile.crash',
  MobileHandledException: 'rum.mobile.exception',
  MobileRequest: 'rum.mobile.request',
  MobileRequestError: 'rum.mobile.request_error',
  Mobile: 'rum.mobile.user_action',
};

const MANUAL_STEPS_BASE: string[] = [
  'Swap the NR mobile SDK for the Dynatrace Mobile Agent (or platform-specific plugin). Application token must be re-provisioned.',
  'Recompile and re-release the mobile app with the DT agent integrated. NR mobile applicationToken is not transferable.',
  'If crash symbolication was configured in NR, re-upload dSYMs / ProGuard / R8 mapping files to Dynatrace symbolication endpoints.',
];

const PLATFORM_SPECIFIC_STEPS: Record<NRMobilePlatform, string> = {
  ANDROID: 'Add the DT Mobile Agent Gradle plugin and apply it in your app-level build.gradle.',
  IOS: 'Add the DT Mobile Agent via CocoaPods or Swift Package Manager and initialize it in AppDelegate.',
  REACT_NATIVE: 'Install @dynatrace/react-native-plugin and call startup() before any bridge calls.',
  FLUTTER: 'Add the dynatrace_flutter_plugin to pubspec.yaml and initialize in main().',
  XAMARIN: 'Install the DT Xamarin NuGet and initialize in your platform-specific Application class.',
  UNITY: 'Import the DT Unity plugin package and configure the agent in Unity build settings.',
  CORDOVA: 'Install cordova-plugin-dynatrace and configure the agent in config.xml.',
  CAPACITOR: 'Install @dynatrace/capacitor-plugin and run npx cap sync after installing.',
};

// ---------------------------------------------------------------------------
// MobileRUMTransformer
// ---------------------------------------------------------------------------

export class MobileRUMTransformer {
  transform(input: NRMobileAppInput): TransformResult<MobileRUMTransformData> {
    try {
      const appName = input.name ?? 'Unnamed Mobile App';
      const platform = input.platform ?? 'ANDROID';
      const warnings: string[] = [];

      if (!input.platform) {
        warnings.push(
          `Mobile app '${appName}' has no platform configured; defaulting to ANDROID. Set platform explicitly for correct SDK guidance.`,
        );
      }

      const appDetection: DTMobileAppDetection = {
        schemaId: 'builtin:mobile.app-detection',
        displayName: `[Migrated] ${appName}`,
        applicationName: appName,
        platform,
        enabled: true,
        bundleId: input.bundleId,
      };

      const eventMappings: DTMobileEventMapping[] = [];
      for (const [nrEventType, dtEventName] of Object.entries(NR_MOBILE_EVENT_MAP)) {
        eventMappings.push({
          schemaId: 'builtin:openpipeline.bizevents.pipelines',
          displayName: `[Migrated] ${nrEventType} → ${dtEventName}`,
          matcher: `matchesValue(event.type, "${nrEventType}")`,
          fieldsAdd: [{ field: 'rum.mobile.event_name', value: dtEventName }],
        });
      }

      for (const custom of input.customEvents ?? []) {
        eventMappings.push({
          schemaId: 'builtin:openpipeline.bizevents.pipelines',
          displayName: `[Migrated] custom mobile event ${custom}`,
          matcher: `matchesValue(event.type, "${custom}")`,
          fieldsAdd: [{ field: 'rum.mobile.event_name', value: `rum.mobile.custom.${custom}` }],
        });
      }

      const manualSteps = [PLATFORM_SPECIFIC_STEPS[platform], ...MANUAL_STEPS_BASE];

      return success(
        { appDetection, eventMappings, manualSteps },
        [...warnings, ...manualSteps],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(apps: NRMobileAppInput[]): TransformResult<MobileRUMTransformData>[] {
    return apps.map((a) => this.transform(a));
  }
}
