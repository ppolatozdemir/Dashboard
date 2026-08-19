import chalk from 'chalk';

const NORMAL_EXIT_CODES = new Set([
  'commander.helpDisplayed',
  'commander.version'
]);

export function handleCliError(error) {
  if (NORMAL_EXIT_CODES.has(error.code)) return 0;

  if (error.response) {
    const message = error.response.data?.errorMessages?.join(', ') || error.message;
    console.error(chalk.red('\n✗ Jira API Hatası:'), message);
  } else if (error.code === 'ENOTFOUND') {
    console.error(chalk.red('\n✗ Bağlantı hatası:'), 'Jira sunucusuna ulaşılamıyor');
  } else {
    console.error(chalk.red('\n✗ Hata:'), error.message);
  }
  return 1;
}
