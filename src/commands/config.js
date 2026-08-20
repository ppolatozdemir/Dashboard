import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getConfig, setConfig, isConfigured, clearConfig } from '../lib/config.js';
import jiraClient from '../lib/jira-client.js';

export const configCommand = new Command('config')
  .description('Jira yapılandırmasını yönet');

// Yapılandırmayı göster
configCommand
  .command('show')
  .description('Mevcut yapılandırmayı göster')
  .action(() => {
    const cfg = getConfig();
    
    console.log(chalk.cyan('\n📋 Jira Yapılandırması:\n'));
    console.log(`  ${chalk.gray('Base URL:')}     ${cfg.baseUrl || chalk.yellow('(ayarlanmamış)')}`);
    console.log(`  ${chalk.gray('Email:')}        ${cfg.email || chalk.yellow('(ayarlanmamış)')}`);
    console.log(`  ${chalk.gray('API Token:')}    ${cfg.apiToken ? chalk.green('••••••••') : chalk.yellow('(ayarlanmamış)')}`);
    console.log(`  ${chalk.gray('Varsayılan Proje:')} ${cfg.defaultProject || chalk.yellow('(ayarlanmamış)')}`);
    console.log();
  });

// Yapılandırma sihirbazı
configCommand
  .command('setup')
  .description('Yapılandırma sihirbazını başlat')
  .action(async () => {
    console.log(chalk.cyan('\n🔧 Jira CLI Yapılandırma Sihirbazı\n'));
    
    const currentConfig = getConfig();
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Jira URL\'iniz (örn: https://yourcompany.atlassian.net):',
        default: currentConfig.baseUrl,
        validate: (input) => {
          if (!input) return 'URL gerekli';
          if (!input.startsWith('http')) return 'URL http:// veya https:// ile başlamalı';
          return true;
        }
      },
      {
        type: 'input',
        name: 'email',
        message: 'Jira email adresiniz:',
        default: currentConfig.email,
        validate: (input) => input ? true : 'Email gerekli'
      },
      {
        type: 'password',
        name: 'apiToken',
        message: 'API Token (https://id.atlassian.com/manage-profile/security/api-tokens):',
        validate: (input) => input ? true : 'API Token gerekli'
      },
      {
        type: 'input',
        name: 'defaultProject',
        message: 'Varsayılan proje anahtarı (opsiyonel):',
        default: currentConfig.defaultProject
      }
    ]);

    // URL'den trailing slash'ı kaldır
    const baseUrl = answers.baseUrl.replace(/\/$/, '');
    
    setConfig('baseUrl', baseUrl);
    setConfig('email', answers.email);
    setConfig('apiToken', answers.apiToken);
    if (answers.defaultProject) {
      setConfig('defaultProject', answers.defaultProject);
    }

    // Bağlantıyı test et
    console.log(chalk.gray('\n⏳ Bağlantı test ediliyor...'));
    
    try {
      jiraClient.init();
      const user = await jiraClient.getCurrentUser();
      console.log(chalk.green(`\n✓ Bağlantı başarılı! Hoş geldin, ${user.displayName}`));
    } catch (error) {
      console.log(chalk.yellow('\n⚠ Yapılandırma kaydedildi ancak bağlantı test edilemedi.'));
      console.log(chalk.gray('  Hata:', error.message));
    }
  });

// Tek bir ayarı değiştir
configCommand
  .command('set <key> <value>')
  .description('Bir yapılandırma değerini ayarla (baseUrl, email, apiToken, defaultProject)')
  .action((key, value) => {
    const validKeys = ['baseUrl', 'email', 'apiToken', 'defaultProject'];
    
    if (!validKeys.includes(key)) {
      console.error(chalk.red(`✗ Geçersiz anahtar: ${key}`));
      console.log(chalk.gray(`  Geçerli anahtarlar: ${validKeys.join(', ')}`));
      return;
    }
    
    setConfig(key, value);
    console.log(chalk.green(`✓ ${key} ayarlandı`));
  });

// Yapılandırmayı temizle
configCommand
  .command('clear')
  .description('Tüm yapılandırmayı temizle')
  .action(async () => {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Tüm yapılandırmayı silmek istediğinizden emin misiniz?',
        default: false
      }
    ]);

    if (confirm) {
      clearConfig();
      console.log(chalk.green('✓ Yapılandırma temizlendi'));
    } else {
      console.log(chalk.gray('İptal edildi'));
    }
  });

// Bağlantıyı test et
configCommand
  .command('test')
  .description('Jira bağlantısını test et')
  .action(async () => {
    if (!isConfigured()) {
      console.error(chalk.red('✗ Yapılandırma eksik. Önce "jira config setup" komutunu çalıştırın.'));
      return;
    }

    console.log(chalk.gray('⏳ Bağlantı test ediliyor...'));
    
    try {
      jiraClient.init();
      const user = await jiraClient.getCurrentUser();
      console.log(chalk.green(`\n✓ Bağlantı başarılı!`));
      console.log(chalk.gray(`  Kullanıcı: ${user.displayName} (${user.emailAddress})`));
    } catch (error) {
      console.error(chalk.red('\n✗ Bağlantı başarısız:'), error.message);
    }
  });
