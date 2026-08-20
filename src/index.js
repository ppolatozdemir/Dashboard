#!/usr/bin/env node

import { createProgram } from './cli/program.js';
import { handleCliError } from './cli/error-handler.js';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  process.exit(handleCliError(error));
}
