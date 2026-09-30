import { expect, test } from '@playwright/test';

import scenarioModule from '../../../tests/web/playwright/manual_background_visibility.scenario.mjs';

const { registerManualBackgroundVisibilityTests } = scenarioModule;

registerManualBackgroundVisibilityTests({ test, expect });
