import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import jiraClient from '../lib/jira-client.js';
import { isConfigured, setConfig, getConfig } from '../lib/config.js';

function requireConfig() {
  if (!isConfigured()) {
    console.error(chalk.red('✗ Yapılandırma eksik. Önce "jira config setup" komutunu çalıştırın.'));
    process.exit(1);
  }
  jiraClient.init();
}

export const projectCommand = new Command('project')
  .alias('p')
  .description('Proje yönetimi');

// Projeleri listele
projectCommand
  .command('list')
  .alias('ls')
  .description('Tüm projeleri listele')
  .action(async () => {
    requireConfig();
    
    const spinner = ora('Projeler yükleniyor...').start();
    
    try {
      const projects = await jiraClient.getProjects();
      spinner.stop();
      
      if (projects.length === 0) {
        console.log(chalk.yellow('\nHiç proje bulunamadı.'));
        return;
      }
      
      console.log(chalk.cyan(`\n📁 Projeler (${projects.length}):\n`));
      
      const table = new Table({
        head: [
          chalk.white('Anahtar'),
          chalk.white('Ad'),
          chalk.white('Tür'),
          chalk.white('Lider')
        ],
        colWidths: [15, 35, 15, 25]
      });
      
      projects.forEach(project => {
        table.push([
          chalk.cyan(project.key),
          project.name,
          project.projectTypeKey || '-',
          project.lead?.displayName || '-'
        ]);
      });
      
      console.log(table.toString());
      console.log();
    } catch (error) {
      spinner.fail('Projeler yüklenemedi');
      throw error;
    }
  });

// Proje detayı
projectCommand
  .command('view <projectKey>')
  .alias('v')
  .description('Proje detaylarını göster')
  .action(async (projectKey) => {
    requireConfig();
    
    const spinner = ora('Proje yükleniyor...').start();
    
    try {
      const project = await jiraClient.getProject(projectKey);
      spinner.stop();
      
      console.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
      console.log(chalk.bold.white(`  ${project.key}: ${project.name}`));
      console.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
      
      console.log(`  ${chalk.gray('Tür:')}        ${project.projectTypeKey || '-'}`);
      console.log(`  ${chalk.gray('Lider:')}      ${project.lead?.displayName || '-'}`);
      console.log(`  ${chalk.gray('Kategori:')}   ${project.projectCategory?.name || '-'}`);
      console.log(`  ${chalk.gray('URL:')}        ${getConfig().baseUrl}/browse/${project.key}`);
      
      if (project.description) {
        console.log(`\n  ${chalk.gray('Açıklama:')}`);
        console.log(`  ${project.description}`);
      }
      
      // Issue türleri
      if (project.issueTypes?.length > 0) {
        console.log(`\n  ${chalk.gray('Issue Türleri:')}`);
        project.issueTypes.forEach(type => {
          console.log(`    • ${type.name}`);
        });
      }
      
      console.log();
    } catch (error) {
      spinner.fail('Proje yüklenemedi');
      throw error;
    }
  });

// Varsayılan proje ayarla
projectCommand
  .command('default [projectKey]')
  .description('Varsayılan projeyi ayarla veya göster')
  .action(async (projectKey) => {
    if (projectKey) {
      setConfig('defaultProject', projectKey);
      console.log(chalk.green(`✓ Varsayılan proje: ${chalk.bold(projectKey)}`));
    } else {
      const config = getConfig();
      if (config.defaultProject) {
        console.log(`Varsayılan proje: ${chalk.cyan(config.defaultProject)}`);
      } else {
        console.log(chalk.yellow('Varsayılan proje ayarlanmamış.'));
        console.log(chalk.gray('Ayarlamak için: jira project default <projectKey>'));
      }
    }
  });
