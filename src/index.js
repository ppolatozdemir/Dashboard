#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { configCommand } from './commands/config.js';
import { issueCommand } from './commands/issue.js';
import { projectCommand } from './commands/project.js';
import { sprintCommand } from './commands/sprint.js';
import { searchCommand } from './commands/search.js';

const program = new Command();

program
  .name('jira')
  .description('Jira CLI - Komut satırından Jira yönetimi')
  .version('1.0.0');

// Alt komutları ekle
program.addCommand(configCommand);
program.addCommand(issueCommand);
program.addCommand(projectCommand);
program.addCommand(sprintCommand);
program.addCommand(searchCommand);

// Hata yakalama
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
    process.exit(0);
  }
  
  if (error.response) {
    // Jira API hatası
    console.error(chalk.red('\n✗ Jira API Hatası:'), error.response.data?.errorMessages?.join(', ') || error.message);
  } else if (error.code === 'ENOTFOUND') {
    console.error(chalk.red('\n✗ Bağlantı hatası:'), 'Jira sunucusuna ulaşılamıyor');
  } else {
    console.error(chalk.red('\n✗ Hata:'), error.message);
  }
  process.exit(1);
}
