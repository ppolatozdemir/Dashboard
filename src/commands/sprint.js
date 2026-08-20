import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import inquirer from 'inquirer';
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

export const sprintCommand = new Command('sprint')
  .alias('sp')
  .description('Sprint yönetimi');

// Board listele
sprintCommand
  .command('boards')
  .alias('b')
  .description('Boardları listele')
  .option('-p, --project <key>', 'Proje anahtarı ile filtrele')
  .action(async (options) => {
    requireConfig();
    
    const spinner = ora('Boardlar yükleniyor...').start();
    
    try {
      const boards = await jiraClient.getBoards(options.project);
      spinner.stop();
      
      if (boards.length === 0) {
        console.log(chalk.yellow('\nHiç board bulunamadı.'));
        return;
      }
      
      console.log(chalk.cyan(`\n📋 Boardlar (${boards.length}):\n`));
      
      const table = new Table({
        head: [
          chalk.white('ID'),
          chalk.white('Ad'),
          chalk.white('Tür'),
          chalk.white('Proje')
        ],
        colWidths: [10, 40, 12, 20]
      });
      
      boards.forEach(board => {
        table.push([
          chalk.cyan(board.id),
          board.name,
          board.type,
          board.location?.projectKey || '-'
        ]);
      });
      
      console.log(table.toString());
      console.log();
    } catch (error) {
      spinner.fail('Boardlar yüklenemedi');
      throw error;
    }
  });

// Sprintleri listele
sprintCommand
  .command('list [boardId]')
  .alias('ls')
  .description('Sprintleri listele')
  .option('-s, --state <state>', 'Sprint durumu (active, future, closed)', 'active,future')
  .action(async (boardId, options) => {
    requireConfig();
    
    // Board seçimi
    if (!boardId) {
      const spinner = ora('Boardlar yükleniyor...').start();
      const boards = await jiraClient.getBoards();
      spinner.stop();
      
      if (boards.length === 0) {
        console.log(chalk.yellow('Hiç board bulunamadı.'));
        return;
      }
      
      const { selectedBoard } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedBoard',
          message: 'Board seçin:',
          choices: boards.map(b => ({ name: `${b.name} (${b.type})`, value: b.id }))
        }
      ]);
      boardId = selectedBoard;
    }
    
    const spinner = ora('Sprintler yükleniyor...').start();
    
    try {
      const sprints = await jiraClient.getSprints(boardId, options.state);
      spinner.stop();
      
      if (sprints.length === 0) {
        console.log(chalk.yellow('\nHiç sprint bulunamadı.'));
        return;
      }
      
      console.log(chalk.cyan(`\n🏃 Sprintler (${sprints.length}):\n`));
      
      const table = new Table({
        head: [
          chalk.white('ID'),
          chalk.white('Ad'),
          chalk.white('Durum'),
          chalk.white('Başlangıç'),
          chalk.white('Bitiş')
        ],
        colWidths: [8, 35, 12, 15, 15]
      });
      
      sprints.forEach(sprint => {
        const stateColor = sprint.state === 'active' ? chalk.green : 
                          sprint.state === 'future' ? chalk.blue : chalk.gray;
        
        table.push([
          chalk.cyan(sprint.id),
          sprint.name,
          stateColor(sprint.state),
          sprint.startDate ? new Date(sprint.startDate).toLocaleDateString('tr-TR') : '-',
          sprint.endDate ? new Date(sprint.endDate).toLocaleDateString('tr-TR') : '-'
        ]);
      });
      
      console.log(table.toString());
      console.log();
    } catch (error) {
      spinner.fail('Sprintler yüklenemedi');
      throw error;
    }
  });

// Sprint issue'larını göster
sprintCommand
  .command('issues <sprintId>')
  .alias('i')
  .description('Sprint issue\'larını göster')
  .action(async (sprintId) => {
    requireConfig();
    
    const spinner = ora('Sprint issue\'ları yükleniyor...').start();
    
    try {
      const issues = await jiraClient.getSprintIssues(sprintId);
      spinner.stop();
      
      if (issues.length === 0) {
        console.log(chalk.yellow('\nBu sprintte hiç issue yok.'));
        return;
      }
      
      // Durum bazlı gruplama
      const grouped = {
        todo: [],
        inProgress: [],
        done: []
      };
      
      issues.forEach(issue => {
        const status = issue.fields.status?.name?.toLowerCase() || '';
        if (status.includes('done') || status.includes('closed') || status.includes('tamamlandı')) {
          grouped.done.push(issue);
        } else if (status.includes('progress') || status.includes('devam')) {
          grouped.inProgress.push(issue);
        } else {
          grouped.todo.push(issue);
        }
      });
      
      console.log(chalk.cyan(`\n🏃 Sprint Issue'ları (${issues.length}):\n`));
      
      // Todo
      if (grouped.todo.length > 0) {
        console.log(chalk.gray(`  📋 Yapılacak (${grouped.todo.length}):`));
        grouped.todo.forEach(issue => {
          console.log(`    ${chalk.gray('○')} ${chalk.cyan(issue.key)} ${issue.fields.summary}`);
        });
        console.log();
      }
      
      // In Progress
      if (grouped.inProgress.length > 0) {
        console.log(chalk.blue(`  🔄 Devam Eden (${grouped.inProgress.length}):`));
        grouped.inProgress.forEach(issue => {
          console.log(`    ${chalk.blue('●')} ${chalk.cyan(issue.key)} ${issue.fields.summary}`);
        });
        console.log();
      }
      
      // Done
      if (grouped.done.length > 0) {
        console.log(chalk.green(`  ✓ Tamamlanan (${grouped.done.length}):`));
        grouped.done.forEach(issue => {
          console.log(`    ${chalk.green('✓')} ${chalk.cyan(issue.key)} ${issue.fields.summary}`);
        });
        console.log();
      }
      
    } catch (error) {
      spinner.fail('Sprint issue\'ları yüklenemedi');
      throw error;
    }
  });

// Aktif sprint
sprintCommand
  .command('active')
  .alias('a')
  .description('Aktif sprint\'i göster')
  .option('-p, --project <key>', 'Proje anahtarı')
  .action(async (options) => {
    requireConfig();
    
    const config = getConfig();
    const projectKey = options.project || config.defaultProject;
    
    const spinner = ora('Aktif sprint aranıyor...').start();
    
    try {
      const boards = await jiraClient.getBoards(projectKey);
      
      if (boards.length === 0) {
        spinner.fail('Board bulunamadı');
        return;
      }
      
      // İlk board'un aktif sprint'ini al
      const sprints = await jiraClient.getSprints(boards[0].id, 'active');
      spinner.stop();
      
      if (sprints.length === 0) {
        console.log(chalk.yellow('\nAktif sprint bulunamadı.'));
        return;
      }
      
      const sprint = sprints[0];
      
      console.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
      console.log(chalk.bold.white(`  🏃 ${sprint.name}`));
      console.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
      
      console.log(`  ${chalk.gray('ID:')}         ${sprint.id}`);
      console.log(`  ${chalk.gray('Durum:')}      ${chalk.green('Aktif')}`);
      console.log(`  ${chalk.gray('Başlangıç:')}  ${sprint.startDate ? new Date(sprint.startDate).toLocaleDateString('tr-TR') : '-'}`);
      console.log(`  ${chalk.gray('Bitiş:')}      ${sprint.endDate ? new Date(sprint.endDate).toLocaleDateString('tr-TR') : '-'}`);
      
      if (sprint.goal) {
        console.log(`\n  ${chalk.gray('Hedef:')}`);
        console.log(`  ${sprint.goal}`);
      }
      
      // Issue sayılarını göster
      const issues = await jiraClient.getSprintIssues(sprint.id);
      
      let done = 0, inProgress = 0, todo = 0;
      issues.forEach(issue => {
        const status = issue.fields.status?.name?.toLowerCase() || '';
        if (status.includes('done') || status.includes('closed')) done++;
        else if (status.includes('progress')) inProgress++;
        else todo++;
      });
      
      console.log(`\n  ${chalk.gray('İlerleme:')}`);
      console.log(`    ${chalk.gray('○')} Yapılacak:  ${todo}`);
      console.log(`    ${chalk.blue('●')} Devam Eden: ${inProgress}`);
      console.log(`    ${chalk.green('✓')} Tamamlanan: ${done}`);
      
      const total = issues.length;
      if (total > 0) {
        const percent = Math.round((done / total) * 100);
        const bar = '█'.repeat(Math.round(percent / 5)) + '░'.repeat(20 - Math.round(percent / 5));
        console.log(`\n    ${bar} ${percent}%`);
      }
      
      console.log();
    } catch (error) {
      spinner.fail('Aktif sprint yüklenemedi');
      throw error;
    }
  });
