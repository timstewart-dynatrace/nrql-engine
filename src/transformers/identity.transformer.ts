/**
 * Identity Transformer — Converts New Relic users, teams, custom
 * roles, and SAML SSO config to Dynatrace Gen3 identity objects.
 *
 * Gen3 targets:
 *   - Users: DT Users (created at sign-in time via SSO; transformer
 *     emits user metadata stubs for IAM binding)
 *   - Teams: `builtin:ownership.teams`
 *   - Roles: Gen3 IAM v2 policies (bucket-scoped)
 *   - SAML SSO: DT SAML IdP configuration stub
 *
 * Secrets (API keys, SAML certs, SCIM tokens) are never migrated.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRIdentityInput {
  readonly users?: NRUser[];
  readonly teams?: NRTeam[];
  readonly roles?: NRRole[];
  readonly saml?: NRSamlConfig;
}

export interface NRUser {
  readonly id?: string;
  readonly email: string;
  readonly name?: string;
  readonly userType?: 'FULL' | 'CORE' | 'BASIC';
  readonly teams?: string[];
  readonly roles?: string[];
}

export interface NRTeam {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
}

export interface NRRole {
  readonly id?: string;
  readonly name: string;
  readonly permissions?: string[];
}

export interface NRSamlConfig {
  readonly idpMetadataUrl?: string;
  readonly idpEntityId?: string;
  readonly signOnUrl?: string;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTUserStub {
  readonly email: string;
  readonly displayName: string;
  readonly teamRefs: string[];
  readonly policyRefs: string[];
}

export interface DTTeam {
  readonly schemaId: 'builtin:ownership.teams';
  readonly name: string;
  readonly identifier: string;
  readonly description: string;
}

/**
 * Gen3 IAM v2 policy. `statement` uses the DT policy grammar —
 * e.g. `ALLOW storage:buckets:read;`. The transformer maps common NR
 * role permissions to equivalent DT policy statements; everything
 * else is flagged manual.
 */
export interface DTIamPolicyV2 {
  readonly name: string;
  readonly description: string;
  readonly statements: string[];
}

export interface DTSamlIdpConfig {
  readonly idpMetadataUrl: string;
  readonly idpEntityId: string;
  readonly signOnUrl: string;
  readonly manualNotes: string[];
}

export interface IdentityTransformData {
  readonly users: DTUserStub[];
  readonly teams: DTTeam[];
  readonly policies: DTIamPolicyV2[];
  readonly saml: DTSamlIdpConfig | undefined;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERMISSION_MAP: Record<string, string> = {
  'apm.read': 'ALLOW storage:spans:read;',
  'apm.admin': 'ALLOW storage:spans:read, storage:spans:write;',
  'logs.read': 'ALLOW storage:logs:read;',
  'logs.admin': 'ALLOW storage:logs:read, storage:logs:write;',
  'dashboards.read': 'ALLOW document:documents:read;',
  'dashboards.admin': 'ALLOW document:documents:read, document:documents:write;',
  'alerts.admin': 'ALLOW settings:objects:read, settings:objects:write;',
  'admin': 'ALLOW *:*:*;',
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// SCIM filter translator (NR SCIM v2 → DT SCIM)
// ---------------------------------------------------------------------------

/**
 * Translate a NR SCIM v2 filter expression into DT SCIM syntax. Both
 * implement the same RFC 7644 filter grammar so the translation is
 * mostly attribute-path renaming. A few NR-specific attribute names
 * (`active`, `userName`, `emails.value`) map to DT's equivalents.
 *
 * Returns the translated filter plus warnings enumerating any feature
 * that had no DT equivalent.
 */
export interface ScimFilterResult {
  readonly filter: string;
  readonly warnings: string[];
}

const NR_TO_DT_ATTR_MAP: Record<string, string> = {
  userName: 'email',
  'emails.value': 'email',
  'name.givenName': 'firstName',
  'name.familyName': 'lastName',
  active: 'enabled',
  'groups.display': 'groups',
  externalId: 'externalId',
  id: 'id',
};

export function translateScimFilter(nrFilter: string): ScimFilterResult {
  const warnings: string[] = [];
  if (!nrFilter || !nrFilter.trim()) {
    return { filter: '', warnings };
  }

  let dpl = nrFilter;

  // Rename attribute paths. Order matters — replace the longer paths first
  // so `emails.value` isn't partially overwritten by a shorter match.
  const ordered = Object.entries(NR_TO_DT_ATTR_MAP).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [nrAttr, dtAttr] of ordered) {
    const esc = nrAttr.replace(/\./g, '\\.');
    dpl = dpl.replace(new RegExp(`\\b${esc}\\b`, 'g'), dtAttr);
  }

  if (/\bmeta\./.test(dpl)) {
    warnings.push(
      'SCIM filter references `meta.*` attributes (created / lastModified); DT SCIM exposes these only on read-only resources — filters on `meta.*` may return empty.',
    );
  }
  if (/\bpr\b/i.test(dpl)) {
    warnings.push(
      "SCIM 'pr' (present) operator is supported in DT SCIM but DT rejects it on attributes it does not index (e.g. externalId). Verify against your target tenant.",
    );
  }

  return { filter: dpl, warnings };
}

const MANUAL_STEPS: string[] = [
  'Re-provision SAML signing certificates and SCIM tokens in Dynatrace — NR IdP secrets are not transferable.',
  'Users are created on first SSO sign-in. The emitted user stubs are for IAM policy binding metadata only; do not attempt to pre-create them.',
  'Review every IAM v2 policy before applying. Permissions that did not have a direct DT equivalent (listed as warnings per policy) require manual scope design.',
  'If SCIM provisioning was enabled in NR, configure DT SCIM separately and point the IdP at the DT SCIM endpoint.',
];

// ---------------------------------------------------------------------------
// IdentityTransformer
// ---------------------------------------------------------------------------

export class IdentityTransformer {
  transform(input: NRIdentityInput): TransformResult<IdentityTransformData> {
    try {
      const warnings: string[] = [];
      const users = (input.users ?? []).map((u) => this.convertUser(u));
      const teams = (input.teams ?? []).map((t) => this.convertTeam(t));
      const policies = (input.roles ?? []).map((r) => this.convertRole(r, warnings));
      const saml = input.saml ? this.convertSaml(input.saml) : undefined;

      return success(
        { users, teams, policies, saml, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  private convertUser(u: NRUser): DTUserStub {
    return {
      email: u.email,
      displayName: u.name ?? u.email,
      teamRefs: (u.teams ?? []).map(slugify),
      policyRefs: (u.roles ?? []).map(slugify),
    };
  }

  private convertTeam(t: NRTeam): DTTeam {
    return {
      schemaId: 'builtin:ownership.teams',
      name: t.name,
      identifier: slugify(t.name),
      description: t.description ?? `Migrated from NR team "${t.name}"`,
    };
  }

  private convertRole(r: NRRole, warnings: string[]): DTIamPolicyV2 {
    const statements: string[] = [];
    for (const permission of r.permissions ?? []) {
      const stmt = PERMISSION_MAP[permission.toLowerCase()];
      if (stmt) {
        statements.push(stmt);
      } else {
        warnings.push(
          `NR permission '${permission}' on role '${r.name}' has no direct Gen3 IAM equivalent; design a scoped policy statement manually.`,
        );
      }
    }
    if (statements.length === 0) {
      statements.push('# TODO: no permissions mapped — add DT IAM v2 statements before use');
    }
    return {
      name: slugify(r.name),
      description: `Migrated from NR role "${r.name}"`,
      statements,
    };
  }

  private convertSaml(s: NRSamlConfig): DTSamlIdpConfig {
    return {
      idpMetadataUrl: s.idpMetadataUrl ?? '',
      idpEntityId: s.idpEntityId ?? '',
      signOnUrl: s.signOnUrl ?? '',
      manualNotes: [
        'Paste the IdP metadata URL into Dynatrace → Account Management → SSO → SAML.',
        'Re-upload the SAML signing certificate — NR does not export it.',
        'Validate the NameID format matches what the DT IdP expects (emailAddress).',
      ],
    };
  }
}
