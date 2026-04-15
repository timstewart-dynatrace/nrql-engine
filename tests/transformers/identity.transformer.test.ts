import { describe, it, expect, beforeEach } from 'vitest';
import { IdentityTransformer } from '../../src/transformers/index.js';

describe('IdentityTransformer', () => {
  let transformer: IdentityTransformer;

  beforeEach(() => {
    transformer = new IdentityTransformer();
  });

  it('should convert users to user stubs', () => {
    const result = transformer.transform({
      users: [
        {
          email: 'alice@example.com',
          name: 'Alice',
          teams: ['Platform Team'],
          roles: ['Admin'],
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.users).toHaveLength(1);
    expect(result.data!.users[0]!.email).toBe('alice@example.com');
    expect(result.data!.users[0]!.teamRefs).toEqual(['platform-team']);
    expect(result.data!.users[0]!.policyRefs).toEqual(['admin']);
  });

  it('should convert teams to builtin:ownership.teams', () => {
    const result = transformer.transform({
      teams: [{ name: 'SRE Team', description: 'Site reliability' }],
    });
    const team = result.data!.teams[0]!;
    expect(team.schemaId).toBe('builtin:ownership.teams');
    expect(team.identifier).toBe('sre-team');
    expect(team.description).toBe('Site reliability');
  });

  it('should convert NR permissions to IAM v2 policy statements', () => {
    const result = transformer.transform({
      roles: [
        {
          name: 'APM Viewer',
          permissions: ['apm.read', 'logs.read', 'dashboards.read'],
        },
      ],
    });
    const policy = result.data!.policies[0]!;
    expect(policy.name).toBe('apm-viewer');
    expect(policy.statements).toContain('ALLOW storage:spans:read;');
    expect(policy.statements).toContain('ALLOW storage:logs:read;');
    expect(policy.statements).toContain('ALLOW document:documents:read;');
  });

  it('should warn on unmapped permissions and emit TODO placeholder', () => {
    const result = transformer.transform({
      roles: [{ name: 'Custom', permissions: ['some.unknown.permission'] }],
    });
    expect(result.warnings.some((w) => w.includes('some.unknown.permission'))).toBe(true);
    expect(result.data!.policies[0]!.statements[0]).toContain('TODO');
  });

  it('should convert SAML config with manual notes', () => {
    const result = transformer.transform({
      saml: {
        idpMetadataUrl: 'https://idp.example.com/metadata',
        idpEntityId: 'acme',
        signOnUrl: 'https://idp.example.com/sso',
      },
    });
    expect(result.data!.saml).toBeDefined();
    expect(result.data!.saml!.idpMetadataUrl).toBe('https://idp.example.com/metadata');
    expect(result.data!.saml!.manualNotes.some((n) => n.includes('metadata URL'))).toBe(true);
  });

  it('should emit manual steps about secrets and provisioning', () => {
    const result = transformer.transform({ users: [], teams: [], roles: [] });
    expect(result.warnings.some((w) => w.includes('SAML signing'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('SCIM'))).toBe(true);
  });

  it('should accept empty identity input', () => {
    const result = transformer.transform({});
    expect(result.success).toBe(true);
    expect(result.data!.users).toEqual([]);
    expect(result.data!.teams).toEqual([]);
    expect(result.data!.policies).toEqual([]);
    expect(result.data!.saml).toBeUndefined();
  });
});
