import { expect, test } from '@playwright/test';

import scenarioModule from '../../../tests/web/playwright/local_reload_recovery.scenario.mjs';

const { registerLocalReloadRecoveryTests } = scenarioModule;

registerLocalReloadRecoveryTests({ test, expect });
