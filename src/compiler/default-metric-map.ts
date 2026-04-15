/**
 * Default NR → DT metric-name map consumed by the DQLEmitter.
 *
 * Keys are normalized the same way the emitter's `resolveMetricField`
 * normalizes: lowercased, with dots / underscores / backticks stripped.
 * Example: `cpuPercent` → `cpupercent`.
 *
 * Values target Grail-native metric names (`dt.host.*`, `dt.process.*`)
 * because this map applies to `timeseries` DQL emission. For alert
 * Metric Events the transformers layer handles the `builtin:*` variants.
 *
 * Consumers can override any entry via
 *   new NRQLCompiler({ metricMap: { cpupercent: 'custom:metric' } })
 * — the compiler merges the override over this default.
 */

export const DEFAULT_METRIC_MAP: Record<string, string> = {
  // SystemSample
  cpupercent: 'dt.host.cpu.usage',
  cpusystempercent: 'dt.host.cpu.system',
  cpuuserpercent: 'dt.host.cpu.user',
  cpuiowaitpercent: 'dt.host.cpu.iowait',
  memoryusedpercent: 'dt.host.memory.usage',
  memoryusedbytes: 'dt.host.memory.used',
  memoryfreebytes: 'dt.host.memory.free',
  memorytotalbytes: 'dt.host.memory.total',
  diskusedpercent: 'dt.host.disk.used.percent',
  diskusedbytes: 'dt.host.disk.used',
  disktotalbytes: 'dt.host.disk.total',
  diskreadbytespersecond: 'dt.host.disk.bytes.read',
  diskwritebytespersecond: 'dt.host.disk.bytes.write',
  loadaverageoneminute: 'dt.host.cpu.load.1min',
  loadaveragefiveminute: 'dt.host.cpu.load.5min',
  loadaveragefifteenminute: 'dt.host.cpu.load.15min',

  // NetworkSample / network columns on SystemSample
  networkreceivebytespersecond: 'dt.host.net.bytes_rx',
  networktransmitbytespersecond: 'dt.host.net.bytes_tx',
  receivebytespersecond: 'dt.host.net.bytes_rx',
  transmitbytespersecond: 'dt.host.net.bytes_tx',

  // ProcessSample
  processcpupercent: 'dt.process.cpu.usage',
  processcpuusedpercent: 'dt.process.cpu.usage',
  processmemoryresidentsizebytes: 'dt.process.memory.rss',
  processvirtualsizebytes: 'dt.process.memory.virtual',

  // StorageSample
  storageusedpercent: 'dt.host.disk.used.percent',
};
