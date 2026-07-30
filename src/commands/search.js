import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import jiraClient from '../lib/jira-client.js';
import { isConfigured, getConfig } from '../lib/config.js';

function requireConfig() {
  if (!isConfigured()) {
    console.error(chalk.red('✗ Yapılandırma eksik. Önce "jira config setup" komutunu çalıştırın.'));
    process.exit(1);
  }
  jiraClient.init();
}

function getStatusColor(status) {
  const name = status?.name?.toLowerCase() || '';
  if (name.includes('done') || name.includes('tamamlandı') || name.includes('closed')) {
    return chalk.green;
  } else if (name.includes('progress') || name.includes('devam')) {
    return chalk.blue;
  } else if (name.includes('review') || name.includes('test')) {
    return chalk.yellow;
  }
  return chalk.gray;
}

function getPriorityColor(priority) {
  const name = priority?.name?.toLowerCase() || '';
  if (name.includes('highest') || name.includes('blocker')) return chalk.red;
  if (name.includes('high')) return chalk.redBright;
  if (name.includes('medium')) return chalk.yellow;
  if (name.includes('low')) return chalk.green;
  return chalk.gray;
}

export const searchCommand = new Command('search')
  .alias('s')
  .description('Issue ara (JQL destekli)');

// JQL ile arama
searchCommand
  .command('jql <query>')
  .description('JQL sorgusu ile ara')
  .option('-n, --limit <number>', 'Maksimum sonuç sayısı', '50')
  .action(async (query, options) => {
    requireConfig();
    
    const spinner = ora('Aranıyor...').start();
    
    try {
      const result = await jiraClient.searchIssues(query, parseInt(options.limit));
      spinner.stop();
      
      if (result.issues.length === 0) {
        console.log(chalk.yellow('\nHiç sonuç bulunamadı.'));
        return;
      }
      
      console.log(chalk.cyan(`\n🔍 Sonuçlar (${result.issues.length}/${result.total}):\n`));
      
      const table = new Table({
        head: [
          chalk.white('Key'),
          chalk.white('Tür'),
          chalk.white('Durum'),
          chalk.white('Öncelik'),
          chalk.white('Atanan'),
          chalk.white('Başlık')
        ],
        colWidths: [12, 10, 14, 10, 15, 45],
        wordWrap: true
      });
      
      result.issues.forEach(issue => {
        const { fields } = issue;
        table.push([
          chalk.cyan(issue.key),
          fields.issuetype?.name || '-',
          getStatusColor(fields.status)(fields.status?.name || '-'),
          getPriorityColor(fields.priority)(fields.priority?.name || '-'),
          fields.assignee?.displayName?.split(' ')[0] || chalk.gray('—'),
          fields.summary.substring(0, 42) + (fields.summary.length > 42 ? '...' : '')
        ]);
      });
      
      console.log(table.toString());
      console.log();
    } catch (error) {
      spinner.fail('Arama başarısız');
      throw error;
    }
  });

// Hızlı arama
searchCommand
  .command('quick <text>')
  .alias('q')
  .description('Metin ile hızlı ara')
  .option('-p, --project <key>', 'Proje ile sınırla')
  .option('-n, --limit <number>', 'Maksimum sonuç sayısı', '20')
  .action(async (text, options) => {
    requireConfig();
    
    const config = getConfig();
    const project = options.project || config.defaultProject;
    
    let jql = `text ~ "${text}"`;
    if (project) {
      jql = `project = ${project} AND ${jql}`;
    }
    jql += ' ORDER BY updated DESC';
    
    const spinner = ora('Aranıyor...').start();
    
    try {
      const result = await jiraClient.searchIssues(jql, parseInt(options.limit));
      spinner.stop();
      
      if (result.issues.length === 0) {
        console.log(chalk.yellow('\nHiç sonuç bulunamadı.'));
        return;
      }
      
      console.log(chalk.cyan(`\n🔍 "${text}" için sonuçlar (${result.issues.length}):\n`));
      
      result.issues.forEach(issue => {
        const { fields } = issue;
        const statusColor = getStatusColor(fields.status);
        console.log(
          `  ${chalk.cyan(issue.key.padEnd(10))} ` +
          `${statusColor(fields.status?.name?.padEnd(12) || '-'.padEnd(12))} ` +
          `${fields.summary}`
        );
      });
      
      console.log();
    } catch (error) {
      spinner.fail('Arama başarısız');
      throw error;
    }
  });

// Bana atanan
searchCommand
  .command('my')
  .alias('m')
  .description('Bana atanan açık issue\'lar')
  .option('-p, --project <key>', 'Proje ile sınırla')
  .action(async (options) => {
    requireConfig();
    
    const config = getConfig();
    const project = options.project || config.defaultProject;
    
    let jql = 'assignee = currentUser() AND resolution = Unresolved';
    if (project) {
      jql = `project = ${project} AND ${jql}`;
    }
    jql += ' ORDER BY priority DESC, updated DESC';
    
    const spinner = ora('Issue\'lar yükleniyor...').start();
    
    try {
      const result = await jiraClient.searchIssues(jql, 50);
      spinner.stop();
      
      if (result.issues.length === 0) {
        console.log(chalk.green('\n✓ Size atanmış açık issue yok!'));
        return;
      }
      
      console.log(chalk.cyan(`\n👤 Bana Atanan Issue'lar (${result.issues.length}):\n`));
      
      const table = new Table({
        head: [
          chalk.white('Key'),
          chalk.white('Tür'),
          chalk.white('Durum'),
          chalk.white('Öncelik'),
          chalk.white('Başlık')
        ],
        colWidths: [12, 10, 14, 10, 55],
        wordWrap: true
      });
      
      result.issues.forEach(issue => {
        const { fields } = issue;
        table.push([
          chalk.cyan(issue.key),
          fields.issuetype?.name || '-',
          getStatusColor(fields.status)(fields.status?.name || '-'),
          getPriorityColor(fields.priority)(fields.priority?.name || '-'),
          fields.summary.substring(0, 52) + (fields.summary.length > 52 ? '...' : '')
        ]);
      });
      
      console.log(table.toString());
      console.log();
    } catch (error) {
      spinner.fail('Issue\'lar yüklenemedi');
      throw error;
    }
  });

// Son güncellenenler
searchCommand
  .command('recent')
  .alias('r')
  .description('Son güncellenen issue\'lar')
  .option('-p, --project <key>', 'Proje ile sınırla')
  .option('-n, --limit <number>', 'Maksimum sonuç sayısı', '15')
  .action(async (options) => {
    requireConfig();
    
    const config = getConfig();
    const project = options.project || config.defaultProject;
    
    let jql = 'ORDER BY updated DESC';
    if (project) {
      jql = `project = ${project} ${jql}`;
    }
    
    const spinner = ora('Issue\'lar yükleniyor...').start();
    
    try {
      const result = await jiraClient.searchIssues(jql, parseInt(options.limit));
      spinner.stop();
      
      if (result.issues.length === 0) {
        console.log(chalk.yellow('\nHiç issue bulunamadı.'));
        return;
      }
      
      console.log(chalk.cyan(`\n🕐 Son Güncellenen Issue'lar (${result.issues.length}):\n`));
      
      result.issues.forEach(issue => {
        const { fields } = issue;
        const updated = new Date(fields.updated).toLocaleDateString('tr-TR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        const statusColor = getStatusColor(fields.status);
        
        console.log(
          `  ${chalk.gray(updated)} ` +
          `${chalk.cyan(issue.key.padEnd(10))} ` +
          `${statusColor(fields.status?.name?.padEnd(12) || '-'.padEnd(12))} ` +
          `${fields.summary.substring(0, 45)}${fields.summary.length > 45 ? '...' : ''}`
        );
      });
      
      console.log();
    } catch (error) {
      spinner.fail('Issue\'lar yüklenemedi');
      throw error;
    }
  });
