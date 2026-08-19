import { Command } from 'commander';
import { configCommand } from '../commands/config.js';
import { issueCommand } from '../commands/issue.js';
import { projectCommand } from '../commands/project.js';
import { searchCommand } from '../commands/search.js';
import { sprintCommand } from '../commands/sprint.js';

const commands = [
  configCommand,
  issueCommand,
  projectCommand,
  sprintCommand,
  searchCommand
];

export function createProgram() {
  const program = new Command()
    .name('jira')
    .description('Jira CLI - Komut satırından Jira yönetimi')
    .version('1.0.0')
    .exitOverride();

  commands.forEach(command => program.addCommand(command));
  return program;
}
