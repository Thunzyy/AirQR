import { devices, expect, test } from '@playwright/test';

import scenarioModule from '../../../tests/web/playwright/local_reload_recovery.scenario.mjs';

test.use({ ...devices['Pixel 7'] });

const { registerLocalReloadRecoveryTests } = scenarioModule;

registerLocalReloadRecoveryTests({ test, expect, environment: 'mobile' });
