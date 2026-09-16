/**
 * Classic entity -> Smartscape mappings for emitted DQL.
 *
 * Source: Dynatrace-maintained `dt-migration` skill
 * (`dynatrace-for-ai/skills/dt-migration/references/type-mappings.md`).
 * Only mappings with status `available` and a single target type are
 * rewritten automatically; everything else is surfaced as a note.
 *
 * Mirrors Python `validators/smartscape_map.py` in
 * NewRelic-to-Dynatrace-Migration-Utilities.
 */

/** classic type suffix (after `dt.entity.`) -> [smartscape field suffix, node type] */
export const CLASSIC_TO_SMARTSCAPE: Readonly<Record<string, readonly [string, string]>> = {
  application: ['frontend', 'FRONTEND'],
  custom_application: ['frontend', 'FRONTEND'],
  auto_scaling_group: ['aws_autoscaling_autoscalinggroup', 'AWS_AUTOSCALING_AUTOSCALINGGROUP'],
  aws_availability_zone: ['aws_availability_zone', 'AWS_AVAILABILITY_ZONE'],
  aws_credentials: ['aws_account', 'AWS_ACCOUNT'],
  aws_lambda_function: ['aws.lambda_function', 'AWS_LAMBDA_FUNCTION'],
  azure_region: ['azure_microsoft_resources_locations', 'AZURE_MICROSOFT_RESOURCES_LOCATIONS'],
  azure_subscription: [
    'azure_microsoft_resources_subscriptions',
    'AZURE_MICROSOFT_RESOURCES_SUBSCRIPTIONS',
  ],
  azure_vm: ['azure_microsoft_compute_virtualmachines', 'AZURE_MICROSOFT_COMPUTE_VIRTUALMACHINES'],
  azure_vm_scale_set: [
    'azure_microsoft_compute_virtualmachinescalesets',
    'AZURE_MICROSOFT_COMPUTE_VIRTUALMACHINESCALESETS',
  ],
  cloud_application_instance: ['k8s_pod', 'K8S_POD'],
  cloud_application_namespace: ['k8s_namespace', 'K8S_NAMESPACE'],
  container_group_instance: ['container', 'CONTAINER'],
  disk: ['disk', 'DISK'],
  ec2_instance: ['aws_ec2_instance', 'AWS_EC2_INSTANCE'],
  ebs_volume: ['aws_ec2_volume', 'AWS_EC2_VOLUME'],
  host: ['host', 'HOST'],
  kubernetes_cluster: ['k8s_cluster', 'K8S_CLUSTER'],
  kubernetes_node: ['k8s_node', 'K8S_NODE'],
  kubernetes_service: ['k8s_service', 'K8S_SERVICE'],
  network_interface: ['network_interface', 'NETWORK_INTERFACE'],
  process_group_instance: ['process', 'PROCESS'],
  relational_database_service: ['aws_rds_dbinstance', 'AWS_RDS_DBINSTANCE'],
  service: ['service', 'SERVICE'],
};

/** One classic type -> several Smartscape workload types; needs a human decision. */
export const MULTI_TARGET: Readonly<Record<string, string>> = {
  cloud_application:
    'K8S_DEPLOYMENT, K8S_DAEMONSET, K8S_STATEFULSET, K8S_REPLICASET, ' +
    'K8S_REPLICATIONCONTROLLER, K8S_JOB, K8S_DEPLOYMENTCONFIG',
};

/** No standalone Smartscape entity; data lives as fields on HOST / PROCESS / CONTAINER. */
export const REMOVED_GROUP_TYPES: ReadonlySet<string> = new Set([
  'host_group',
  'process_group',
  'container_group',
]);

/** `dt.smartscape.<x>` for a 1:1-mappable classic type, else empty string. */
export function smartscapeField(classicType: string): string {
  const target = CLASSIC_TO_SMARTSCAPE[classicType];
  return target ? `dt.smartscape.${target[0]}` : '';
}
