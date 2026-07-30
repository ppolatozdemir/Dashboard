import jiraClient from './src/lib/jira-client.js';
import axios from 'axios';
import { getConfig } from './src/lib/config.js';

const tasks = [
  { summary: "Oto scroll kalkacak", assignee: "Burak Selçuk" },
  { summary: "Buz istemiyorum kalkacak", assignee: "Tahir Polat Özdemir" },
  { summary: "Alerjen ikonu güncellenecek (İkon bulunup iletilecek yüklenecek)", assignee: "Remzi Erarslan" },
  { summary: "Diller arası geçiş yapıldığında yukarı aşağı ekran oynuyor sabitlenmesi gerek", assignee: "Mehmet Ali Alagöz" },
  { summary: "Pdp den tüm ürünlerde alerjen ikonu kalkacak", assignee: "Burak Selçuk" },
  { summary: "Dil değiştirince sol menüdeki sıra bozuluyor. Tüm dillerde eşit çalışmalı", assignee: "Burak Selçuk" },
  { summary: "BackOffice ürün listesinde olmayan ve içerik olarak düzenleyemediğimiz tüm kısımların lokalize edilmesi", assignee: "Mehmet Ali Alagöz" },
  { summary: "Kategorisi işaretlenmiş içecek ön yüzde gözükmüyor", assignee: "Burak Selçuk" },
  { summary: "Opsiyon resimleri gelmeme (Backendden pdp ye gelmiyor)", assignee: "Gökhan Koçak" },
  { summary: "Üst Kısımda ürün ile logo arasındaki boşluk kaldırılması gerekiyor", assignee: "Mehmet Ali Alagöz" },
  { summary: "Backoffice de ürün güncellerken aşırı yavaş ve hatalar çıkması", assignee: "Gökhan Koçak" },
  { summary: "Kemiksiz kovada bundle opsiyonları hepsi geliyor", assignee: "Burak Selçuk" },
  { summary: "Kullanıcı işlem rapor / log sayfası olması gerekiyor", assignee: "Gökhan Koçak" },
  { summary: "Pdp de sol navi alanı ile seçim grubu arasında hiza sorunu var solda menü yanında yazarken sağ tarafta sos seçimi açık", assignee: "Burak Selçuk" },
  { summary: "Upsell alanı sıralaması sürükle bırak olması tercih ediliyor (acil değil)", assignee: "Gökhan Koçak" },
  { summary: "Aynı anda iki menüye basıp pdp ye gidiyoruz sonrasında geri butonuna basınca diğer bastığımız menü açılıyor", assignee: "Burak Selçuk" },
  { summary: "Adisyonda 2 den fazla alınan extra ücretli ürünlerin adet fiyatı yazıyor toplam fiyat yazmıyor", assignee: "Serkan Doksöz" }
];

const PROJECT_KEY = "KFC";
const SPRINT_ID = 1004; // weekly260309
const BOARD_ID = 54;

async function findUserAccountId(name) {
  const users = await jiraClient.searchUsers(name);
  if (users.length > 0) {
    return users[0].accountId;
  }
  throw new Error(`User "${name}" not found`);
}

async function addIssueToSprint(issueKey, sprintId) {
  const { baseUrl, email, apiToken } = getConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  
  await axios.post(`${baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue`, {
    issues: [issueKey]
  }, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    }
  });
}

async function main() {
  try {
    jiraClient.init();
    console.log("\n🚀 Starting task creation...\n");
    console.log(`Sprint: weekly260309 (ID: ${SPRINT_ID})`);
    
    // Find all unique users and cache their IDs
    const userCache = {};
    const uniqueAssignees = [...new Set(tasks.map(t => t.assignee))];
    
    console.log("\n👤 Finding user account IDs...");
    for (const assignee of uniqueAssignees) {
      try {
        userCache[assignee] = await findUserAccountId(assignee);
        console.log(`  ✓ ${assignee}: ${userCache[assignee]}`);
      } catch (e) {
        console.log(`  ✗ ${assignee}: User not found`);
      }
    }
    
    // Create tasks
    console.log("\n📝 Creating tasks...\n");
    const createdTasks = [];
    
    for (const task of tasks) {
      try {
        // Create issue
        const issue = await jiraClient.createIssue(PROJECT_KEY, task.summary, task.summary, 'Task');
        const issueKey = issue.key;
        
        // Assign user
        if (userCache[task.assignee]) {
          await jiraClient.assignIssue(issueKey, userCache[task.assignee]);
        }
        
        // Add to sprint
        await addIssueToSprint(issueKey, SPRINT_ID);
        
        createdTasks.push({ key: issueKey, summary: task.summary, assignee: task.assignee });
        console.log(`✅ ${issueKey} - ${task.summary} (${task.assignee})`);
        
      } catch (error) {
        console.log(`❌ Failed: ${task.summary} - ${error.message}`);
      }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("📋 CREATED TASKS SUMMARY:");
    console.log("=".repeat(60));
    createdTasks.forEach(t => {
      console.log(`${t.key} | ${t.assignee} | ${t.summary}`);
    });
    console.log("=".repeat(60));
    console.log(`\nTotal: ${createdTasks.length}/${tasks.length} tasks created\n`);
    
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();
