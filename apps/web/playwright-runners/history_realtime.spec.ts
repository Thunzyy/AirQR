import { expect, test } from '@playwright/test';

import scenarioModule from '../../../tests/web/playwright/history_realtime.scenario.mjs';

const { registerHistoryRealtimeTests } = scenarioModule;

registerHistoryRealtimeTests({ test, expect });
