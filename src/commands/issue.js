import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import ora from 'ora';
import jiraClient from '../lib/jira-client.js';
import { getConfig, isConfigured } from '../lib/config.js';

function requireConfig() {
  if (!isConfigured()) {
    console.error(chalk.red('✗ Yapılandırma eksik. Önce "jira config setup" komutunu çalıştırın.'));
    process.exit(1);
  }
  jiraClient.init();
}

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('tr-TR');
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

function buildIssueListJql(options) {
  const project = options.project || getConfig().defaultProject;
  const parts = [];
  if (project) parts.push(`project = ${project}`);
  if (options.my || options.assignee === 'me') {
    parts.push('assignee = currentUser()');
  } else if (options.assignee) {
    parts.push(`assignee = "${options.assignee}"`);
  }
  if (options.status) parts.push(`status = "${options.status}"`);
  return parts.length ? `${parts.join(' AND ')} ORDER BY updated DESC` : 'ORDER BY updated DESC';
}

function renderIssueTable(result) {
  const table = new Table({
    head: ['Key', 'Tür', 'Durum', 'Öncelik', 'Atanan', 'Başlık'].map(chalk.white),
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
}

export const issueCommand = new Command('issue')
  .alias('i')
  .description('Issue (görev) yönetimi');

// Issue detayını göster
issueCommand
  .command('view <issueKey>')
  .alias('v')
  .description('Bir issue\'nun detaylarını göster')
  .action(async (issueKey) => {
    requireConfig();
    const spinner = ora('Issue yükleniyor...').start();
    
    try {
      const issue = await jiraClient.getIssue(issueKey);
      spinner.stop();
      
      const { fields } = issue;
      
      console.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
      console.log(chalk.bold.white(`  ${issue.key}: ${fields.summary}`));
      console.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
      
      console.log(`  ${chalk.gray('Tür:')}        ${fields.issuetype?.name || '-'}`);
      console.log(`  ${chalk.gray('Durum:')}      ${getStatusColor(fields.status)(fields.status?.name || '-')}`);
      console.log(`  ${chalk.gray('Öncelik:')}    ${getPriorityColor(fields.priority)(fields.priority?.name || '-')}`);
      console.log(`  ${chalk.gray('Atanan:')}     ${fields.assignee?.displayName || chalk.yellow('Atanmamış')}`);
      console.log(`  ${chalk.gray('Oluşturan:')}  ${fields.reporter?.displayName || '-'}`);
      console.log(`  ${chalk.gray('Proje:')}      ${fields.project?.name || '-'}`);
      console.log(`  ${chalk.gray('Oluşturulma:')} ${formatDate(fields.created)}`);
      console.log(`  ${chalk.gray('Güncelleme:')} ${formatDate(fields.updated)}`);
      
      if (fields.description?.content) {
        console.log(`\n  ${chalk.gray('Açıklama:')}`);
        const text = extractTextFromAdf(fields.description);
        console.log(`  ${text || '-'}`);
      }
      
      // Yorumlar
      const comments = await jiraClient.getComments(issueKey);
      if (comments.length > 0) {
        console.log(chalk.cyan(`\n  📝 Yorumlar (${comments.length}):`));
        comments.slice(-3).forEach(comment => {
          console.log(chalk.gray(`  ─────────────────────────────`));
          console.log(`  ${chalk.bold(comment.author?.displayName)} - ${formatDate(comment.created)}`);
          const text = extractTextFromAdf(comment.body);
          console.log(`  ${text}`);
        });
      }
      
      console.log();
    } catch (error) {
      spinner.fail('Issue yüklenemedi');
      throw error;
    }
  });

// Issue oluştur
issueCommand
  .command('create')
  .alias('c')
  .description('Yeni bir issue oluştur')
  .option('-p, --project <key>', 'Proje anahtarı')
  .option('-s, --summary <summary>', 'Issue başlığı')
  .option('-d, --description <desc>', 'Açıklama')
  .option('-t, --type <type>', 'Issue türü', 'Task')
  .option('-i, --interactive', 'İnteraktif mod', false)
  .action(async (options) => {
    requireConfig();
    
    let { project, summary, description, type } = options;
    const config = getConfig();
    
    if (options.interactive || !summary) {
      // Projeleri al
      const spinner = ora('Projeler yükleniyor...').start();
      const projects = await jiraClient.getProjects();
      spinner.stop();
      
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'project',
          message: 'Proje seçin:',
          choices: projects.map(p => ({ name: `${p.key} - ${p.name}`, value: p.key })),
          default: project || config.defaultProject
        },
        {
          type: 'input',
          name: 'summary',
          message: 'Issue başlığı:',
          default: summary,
          validate: input => input ? true : 'Başlık gerekli'
        },
        {
          type: 'editor',
          name: 'description',
          message: 'Açıklama (opsiyonel):'
        },
        {
          type: 'list',
          name: 'type',
          message: 'Issue türü:',
          choices: ['Task', 'Bug', 'Story', 'Epic', 'Sub-task'],
          default: type
        }
      ]);
      
      project = answers.project;
      summary = answers.summary;
      description = answers.description;
      type = answers.type;
    }
    
    project = project || config.defaultProject;
    
    if (!project) {
      console.error(chalk.red('✗ Proje anahtarı gerekli. --project ile belirtin veya varsayılan proje ayarlayın.'));
      return;
    }
    
    const spinner = ora('Issue oluşturuluyor...').start();
    
    try {
      const result = await jiraClient.createIssue(project, summary, description, type);
      spinner.succeed(chalk.green(`Issue oluşturuldu: ${chalk.bold(result.key)}`));
      console.log(chalk.gray(`  URL: ${getConfig().baseUrl}/browse/${result.key}`));
    } catch (error) {
      spinner.fail('Issue oluşturulamadı');
      throw error;
    }
  });

// Issue listele
issueCommand
  .command('list')
  .alias('ls')
  .description('Issue\'ları listele')
  .option('-p, --project <key>', 'Proje anahtarı')
  .option('-a, --assignee <name>', 'Atanan kişi (currentUser için "me")')
  .option('-s, --status <status>', 'Durum filtresi')
  .option('-n, --limit <number>', 'Maksimum sonuç sayısı', '20')
  .option('--my', 'Sadece bana atanan issue\'lar', false)
  .action(async (options) => {
    requireConfig();
    const spinner = ora('Issue\'lar yükleniyor...').start();
    try {
      const result = await jiraClient.searchIssues(buildIssueListJql(options), parseInt(options.limit));
      spinner.stop();
      if (result.issues.length === 0) {
        console.log(chalk.yellow('\nHiç issue bulunamadı.'));
        return;
      }
      console.log(chalk.cyan(`\n📋 Issue'lar (${result.issues.length}/${result.total}):\n`));
      renderIssueTable(result);
    } catch (error) {
      spinner.fail('Issue\'lar yüklenemedi');
      throw error;
    }
  });

// Issue durumunu değiştir
issueCommand
  .command('transition <issueKey>')
  .alias('tr')
  .description('Issue durumunu değiştir')
  .option('-t, --to <status>', 'Hedef durum')
  .action(async (issueKey, options) => {
    requireConfig();
    
    const spinner = ora('Geçişler yükleniyor...').start();
    
    try {
      const transitions = await jiraClient.getTransitions(issueKey);
      spinner.stop();
      
      if (transitions.length === 0) {
        console.log(chalk.yellow('Bu issue için geçiş yapılamaz.'));
        return;
      }
      
      let transitionId;
      
      if (options.to) {
        const transition = transitions.find(t => 
          t.name.toLowerCase() === options.to.toLowerCase()
        );
        if (!transition) {
          console.error(chalk.red(`✗ "${options.to}" geçişi bulunamadı.`));
          console.log(chalk.gray('Mevcut geçişler:'), transitions.map(t => t.name).join(', '));
          return;
        }
        transitionId = transition.id;
      } else {
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Hedef durumu seçin:',
            choices: transitions.map(t => ({ name: t.name, value: t.id }))
          }
        ]);
        transitionId = selected;
      }
      
      const transitionSpinner = ora('Durum değiştiriliyor...').start();
      await jiraClient.transitionIssue(issueKey, transitionId);
      transitionSpinner.succeed(chalk.green('Durum değiştirildi'));
    } catch (error) {
      spinner.fail('İşlem başarısız');
      throw error;
    }
  });

// Yorum ekle
issueCommand
  .command('comment <issueKey>')
  .description('Issue\'ya yorum ekle')
  .option('-m, --message <text>', 'Yorum metni')
  .action(async (issueKey, options) => {
    requireConfig();
    
    let message = options.message;
    
    if (!message) {
      const { text } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'text',
          message: 'Yorumunuz:'
        }
      ]);
      message = text;
    }
    
    if (!message?.trim()) {
      console.log(chalk.yellow('Boş yorum gönderilemez.'));
      return;
    }
    
    const spinner = ora('Yorum ekleniyor...').start();
    
    try {
      await jiraClient.addComment(issueKey, message);
      spinner.succeed(chalk.green('Yorum eklendi'));
    } catch (error) {
      spinner.fail('Yorum eklenemedi');
      throw error;
    }
  });

async function selectAccount(users) {
  if (users.length === 0) {
    console.error(chalk.red('✗ Kullanıcı bulunamadı'));
    return null;
  }
  if (users.length === 1) return users[0].accountId;
  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'Kullanıcı seçin:',
    choices: users.map(user => ({
      name: `${user.displayName} (${user.emailAddress || user.accountId})`,
      value: user.accountId
    }))
  }]);
  return selected;
}

async function resolveAssignee(options) {
  if (options.me) {
    const spinner = ora('Kullanıcı bilgisi alınıyor...').start();
    const user = await jiraClient.getCurrentUser();
    spinner.stop();
    return user.accountId;
  }
  let query = options.user;
  if (!query) {
    const answer = await inquirer.prompt([{
      type: 'input',
      name: 'query',
      message: 'Kullanıcı adı veya email:',
      validate: input => input ? true : 'Kullanıcı bilgisi gerekli'
    }]);
    query = answer.query;
  }
  const spinner = ora('Kullanıcılar aranıyor...').start();
  const users = await jiraClient.searchUsers(query);
  spinner.stop();
  return selectAccount(users);
}

// Issue ata
issueCommand
  .command('assign <issueKey>')
  .description('Issue\'yu birine ata')
  .option('-u, --user <query>', 'Kullanıcı adı veya email')
  .option('--me', 'Kendime ata')
  .action(async (issueKey, options) => {
    requireConfig();
    const accountId = await resolveAssignee(options);
    if (!accountId) return;
    const spinner = ora('Issue atanıyor...').start();
    try {
      await jiraClient.assignIssue(issueKey, accountId);
      spinner.succeed(chalk.green('Issue atandı'));
    } catch (error) {
      spinner.fail('Atama başarısız');
      throw error;
    }
  });

// ADF'den düz metin çıkar
function extractTextFromAdf(adf) {
  if (!adf?.content) return '';
  
  let text = '';
  
  function traverse(nodes) {
    for (const node of nodes) {
      if (node.type === 'text') {
        text += node.text;
      } else if (node.content) {
        traverse(node.content);
      }
      if (node.type === 'paragraph' || node.type === 'heading') {
        text += '\n';
      }
    }
  }
  
  traverse(adf.content);
  return text.trim();
}
