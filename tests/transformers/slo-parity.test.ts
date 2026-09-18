/**
 * Platform SLO parity — exact strings shared with Python
 * tests/unit/test_phase19b_engine_parity.py::TestPlatformSloParity
 * in NewRelic-to-Dynatrace-Migration-Utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  availabilityIndicator,
  latencyIndicator,
  buildPlatformSlo,
  defaultWarning,
} from '../../src/transformers/index.js';

const AVAILABILITY_CHECKOUT = "timeseries {\n  total=sum(dt.service.request.count),\n  failures=sum(dt.service.request.failure_count)\n}, by: { dt.smartscape.service }\n| fieldsAdd entityName = getNodeName(dt.smartscape.service)\n| filter contains(entityName, \"checkout\")\n| fieldsAdd sli=(((total[]-failures[])/total[])*(100))\n| fieldsRemove total, failures";
const LATENCY_250_API = "timeseries total=avg(dt.service.request.response_time), default:0, by: { dt.smartscape.service }\n| fieldsAdd entityName = getNodeName(dt.smartscape.service)\n| filter contains(entityName, \"api\")\n| fieldsAdd high=iCollectArray(if(total[] > 250000, total[]))\n| fieldsAdd low=iCollectArray(if(total[] <= 250000, total[]))\n| fieldsAdd highRespTimes=iCollectArray(if(isNull(high[]), 0, else: 1))\n| fieldsAdd lowRespTimes=iCollectArray(if(isNull(low[]), 0, else: 1))\n| fieldsAdd sli=100*(lowRespTimes[]/(lowRespTimes[]+highRespTimes[]))\n| fieldsRemove total, high, low, highRespTimes, lowRespTimes";

describe('Platform SLO parity', () => {
  it('indicators match Python', () => {
    expect(availabilityIndicator({ serviceName: 'checkout' })).toBe(AVAILABILITY_CHECKOUT);
    expect(latencyIndicator(250, { serviceName: 'api' })).toBe(LATENCY_250_API);
  });

  it('body and warning match Python', () => {
    expect([99.9, 95, 99.5].map(defaultWarning)).toEqual([99.95, 97.5, 99.75]);
    expect(
      buildPlatformSlo({ name: 'n', description: 'd', target: 99.5, indicator: 'i', tags: ['t'], externalId: 'e' }),
    ).toEqual({
      name: 'n',
      description: 'd',
      criteria: [{ target: 99.5, warning: 99.75, timeframeFrom: 'now-7d', timeframeTo: 'now' }],
      customSli: { indicator: 'i' },
      tags: ['t'],
      externalId: 'e',
    });
  });
});
