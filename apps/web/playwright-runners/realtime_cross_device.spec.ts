import { expect, test } from '@playwright/test';

import scenarioModule from '../../../tests/web/playwright/realtime_cross_device.scenario.mjs';

const { registerRealtimeCrossDeviceTests } = scenarioModule;

registerRealtimeCrossDeviceTests({ test, expect });
