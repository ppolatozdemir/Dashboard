import axios from 'axios';
import fs from 'fs';
import { getConfig } from './src/lib/config.js';

// Bu script Hebiar Jira'da (config.baseUrl Olka'ya işaret etse bile) çalışır.
const HEBIAR_BASE_URL = (process.env.HEBIAR_BASE_URL || 'https://hebiar.atlassian.net').replace(/\/$/, '');
const PROJECT_KEY = 'MDY';
const EPIC_TYPE_ID = '10818'; // "Epik"
const TASK_TYPE_ID = '10820'; // "Görev"
const EPIC_SUMMARY = 'MRDIY Genel Maddeler';
const ASSIGNEE_ACCOUNT_ID = '712020:65da5a5a-4d36-488c-b893-d2307e2393ea'; // Tahir Polat Özdemir
const LOG_FILE = 'mdy-epic-tasks.log';

const tasks = [
  {
    summary: 'Haritalar kısmı fixlenecek mağaza datası hcapiden gelmiyor bakılmalı',
    description:
      'Mağaza bulucu / haritalar bölümünde mağaza verileri hCApi üzerinden gelmiyor. Entegrasyonun neden veri döndürmediği araştırılmalı; servis bağlantısı ve dönen response yapısı kontrol edilerek haritalar bölümü çalışır hale getirilmeli.',
  },
  {
    summary: 'İptal ve iade akışının webte yapılması',
    description:
      'Sipariş iptal ve iade süreçleri web (storefront) tarafında uçtan uca geliştirilmeli. Kullanıcının siparişini iptal edebilmesi ve iade talebi oluşturabilmesi için gerekli ekranlar, akışlar ve servis entegrasyonları tamamlanmalı.',
  },
  {
    summary: 'Mrdiy siparişi huba yansımıyor',
    description:
      'Web üzerinden oluşturulan MRDIY siparişleri hub\'a düşmüyor. Sipariş oluşturma sonrası hub entegrasyonu incelenmeli, hatalı/eksik iletim sebebi bulunarak siparişlerin hub\'a doğru şekilde aktarılması sağlanmalı.',
  },
  {
    summary: 'Ürün detay yorum kısmı eklenecek',
    description:
      'Ürün detay (PDP) sayfasına müşteri yorumları / değerlendirme bölümü eklenmeli. Yorum listeleme ve mümkünse yorum ekleme bileşeni tasarlanıp entegre edilmeli.',
  },
  {
    summary: 'Register kısmı placeholderda ikon bozuk',
    description:
      'Üye ol (register) formundaki alanların placeholder ikonları bozuk görünüyor. İlgili ikonların doğru şekilde yüklenmesi ve görüntülenmesi sağlanmalı.',
  },
  {
    summary: 'Taksit seçenekleri kısmı pdp ye gelmeli',
    description:
      'Ürün detay (PDP) sayfasına taksit seçenekleri bilgisi eklenmeli. Kart/banka bazlı taksit tablosunun PDP üzerinde gösterimi sağlanmalı.',
  },
  {
    summary: 'Taksit seçenekleri checkouta gelmeli',
    description:
      'Ödeme (checkout) adımına taksit seçenekleri eklenmeli. Kullanıcı ödeme sırasında uygun taksit seçeneklerini görüp seçebilmeli.',
  },
  {
    summary: 'Cinsiyet hesabımda olmamalı kaldırılacak',
    description:
      'Hesabım / profil bilgilerinde yer alan "Cinsiyet" alanı kaldırılmalı. İlgili alan formdan ve gerekiyorsa veri modelinden temizlenmeli.',
  },
  {
    summary: 'Sözleşme yok registerda eklenmeli',
    description:
      'Üye ol (register) ekranında sözleşme/onay (KVKK, üyelik sözleşmesi vb.) alanı bulunmuyor. Gerekli sözleşme onay kutusu ve ilgili metin linkleri register formuna eklenmeli.',
  },
  {
    summary: 'Mail otpsi skechersdan geliyor mail template değişikliği halledilmeli',
    description:
      'E-posta OTP (doğrulama) maili Skechers şablonuyla gönderiliyor. Mail template MRDIY markasına göre güncellenmeli; logo, içerik ve gönderen bilgileri MRDIY olacak şekilde düzenlenmeli.',
  },
  {
    summary: 'Kupon kodu denenecek test edilmesi',
    description:
      'Kupon kodu uygulama akışı test edilmeli. Geçerli/geçersiz kupon, indirim hesaplama ve sepete yansıma senaryoları denenerek doğru çalıştığı doğrulanmalı.',
  },
  {
    summary: 'Adres adı yok eklenecek',
    description:
      'Adres kayıtlarında adres başlığı/adı (adres etiketi) alanı bulunmuyor. Kullanıcının adresine isim verebilmesi için "adres adı" alanı eklenmeli.',
  },
  {
    summary: 'İletişim tercihleri kesinlikle olmalı',
    description:
      'Hesabım altında iletişim tercihleri (e-posta, SMS, telefon izinleri vb.) bölümü mutlaka bulunmalı. Kullanıcının iletişim izinlerini yönetebileceği ekran eklenmeli.',
  },
  {
    summary: 'Kurumsal müşteri adresi olacak',
    description:
      'Kurumsal (fatura) müşteri adresi desteği eklenmeli. Vergi dairesi, vergi no / TCKN, firma unvanı gibi kurumsal fatura alanları adres/fatura akışına dahil edilmeli.',
  },
  {
    summary: 'Masterpass olmalı (backlog)',
    description:
      'Masterpass ödeme entegrasyonu ürün yol haritasına backlog olarak eklenmeli. Şimdilik geliştirme başlamadan backlog kaydı olarak takip edilecek.',
  },
  {
    summary: 'Ön Bilgilendirme formu ve satış sözleşmesi formları checkoutta gelmeli',
    description:
      'Ödeme (checkout) adımında Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi bulunmuyor. Yasal olarak zorunlu bu formların checkout üzerinde gösterimi ve kullanıcı onayı sağlanmalı.',
  },
  {
    summary: 'Checkouttaki tr ibaresini kaldır',
    description:
      'Ödeme (checkout) ekranında görünen "TR" ibaresi kaldırılmalı. Gereksiz/yanlış görünen bu etiket arayüzden temizlenmeli.',
  },
  {
    summary: 'Plp description kaldırılacak',
    description:
      'Ürün liste (PLP / kategori) sayfasındaki açıklama (description) metni kaldırılmalı. İlgili alan sayfadan çıkarılmalı.',
  },
  {
    summary: 'Search bizim component gelsin (en son)',
    description:
      'Arama (search) bileşeni proje standardındaki kendi component\'imizle değiştirilmeli. Mevcut/harici arama bileşeni yerine bizim arama komponentimiz entegre edilmeli. Öncelik: en son yapılacak.',
  },
  {
    summary: 'Pdp stok bilgisi kaldırılacak',
    description:
      'Ürün detay (PDP) sayfasında gösterilen stok bilgisi kaldırılmalı. Stok adedi/durumu gösterimi arayüzden çıkarılmalı.',
  },
  {
    summary: 'Fiyatlarda TRY geliyor TL olmalı (hcapiden geliyor)',
    description:
      'Fiyatlarda para birimi "TRY" olarak gösteriliyor, "TL" olmalı. Değer hCApi\'den "TRY" geldiği için gösterim/format tarafında "TL"ye çevrilmesi veya kaynakta düzeltilmesi sağlanmalı.',
  },
  {
    summary: 'Fiyat formatı virgüllü olacak',
    description:
      'Fiyat gösterim formatı virgüllü (ondalık ayıracı virgül, ör. 199,90 TL) olacak şekilde düzenlenmeli. Tüm fiyat alanlarında Türkçe sayı formatı uygulanmalı.',
  },
  {
    summary: 'Footer menü linkler ve elemanlar gözden geçirilecek',
    description:
      'Footer (alt menü) bölümündeki linkler ve elemanlar gözden geçirilmeli. Kırık/yanlış linkler düzeltilmeli, gereksiz elemanlar temizlenip eksikler tamamlanmalı.',
  },
  {
    summary: 'Guest checkout desteklenmeli',
    description:
      'Üye olmadan alışveriş (guest checkout) desteklenmeli. Kullanıcının üyelik oluşturmadan sipariş verebileceği ödeme akışı geliştirilmeli.',
  },
  {
    summary: 'Contact-us desteklenecek hcapiye gidilecek',
    description:
      'Bize ulaşın (contact-us) formu desteklenmeli ve form gönderimleri hCApi\'ye iletilmeli. Form verilerinin hCApi entegrasyonu üzerinden iletilmesi sağlanmalı.',
  },
  {
    summary: 'Hüseyine söyle 3-5 üründe çoklu resim girilecek',
    description:
      'Hüseyin ile koordineli olarak 3-5 ürüne çoklu (birden fazla) görsel girilmeli. PDP galeri gösterimini test edebilmek için örnek ürünlere çoklu resim eklenmeli.',
  },
  {
    summary: 'İndirimli ürün olmalı (data olarak)',
    description:
      'Test ve görsel doğrulama için data tarafında indirimli (eski fiyat > satış fiyatı olan) ürün bulunmalı. İndirimli fiyat senaryosunu doğrulamak üzere örnek indirimli ürün verisi oluşturulmalı.',
  },
  {
    summary: 'Örnek "yeni" badge girilecek (attribute value olarak)',
    description:
      'Ürünlerde "Yeni" rozeti (badge) gösterimini test etmek için attribute value olarak örnek bir "Yeni" değeri girilmeli. İlgili attribute değeri tanımlanarak badge gösterimi doğrulanmalı.',
  },
  {
    summary: 'Örnek "indirimli" badge girilecek (attribute value olarak)',
    description:
      'Ürünlerde "İndirimli" rozeti (badge) gösterimini test etmek için attribute value olarak örnek bir "İndirimli" değeri girilmeli. İlgili attribute değeri tanımlanarak badge gösterimi doğrulanmalı.',
  },
  {
    summary: 'Ürün detayda da indirimli fiyat gösterimi',
    description:
      'Ürün detay (PDP) sayfasında da indirimli fiyat gösterimi yapılmalı. Eski fiyat üstü çizili, indirimli/satış fiyatı vurgulu şekilde PDP üzerinde gösterilmeli.',
  },
];

function log(line) {
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function hebiarClient() {
  const { email, apiToken } = getConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return axios.create({
    baseURL: `${HEBIAR_BASE_URL}/rest/api/3`,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30000,
  });
}

function adf(text) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e.response?.status;
      const retriable = status === 429 || (status >= 500 && status < 600);
      if (retriable && i < attempts) {
        const wait = 1000 * i;
        log(`  ⚠️ ${label} denemesi ${i} başarısız (HTTP ${status}). ${wait}ms sonra tekrar...`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function findExistingEpic(client) {
  const jql = `project = ${PROJECT_KEY} AND issuetype = "Epik" AND summary ~ "\\"${EPIC_SUMMARY}\\""`;
  try {
    const res = await client.get('/search/jql', { params: { jql, fields: 'summary', maxResults: 50 } });
    const issues = res.data.issues || [];
    const exact = issues.find((it) => (it.fields?.summary || '').trim() === EPIC_SUMMARY);
    return exact || null;
  } catch (e) {
    log(`  ⚠️ Mevcut epic araması başarısız (yok sayılıyor): HTTP ${e.response?.status || ''} ${e.message}`);
    return null;
  }
}

async function main() {
  fs.writeFileSync(LOG_FILE, `# MDY Epic + Task oluşturma logu — ${new Date().toISOString()}\n`, 'utf8');
  const client = hebiarClient();

  log('\n🚀 MDY (MRDIY) epic ve görevleri oluşturuluyor...\n');

  // 1) Epic oluştur (varsa tekrar kullan)
  let epicKey;
  const existing = await findExistingEpic(client);
  if (existing) {
    epicKey = existing.key;
    log(`ℹ️ Aynı isimde epic zaten var, tekrar kullanılıyor: ${epicKey}`);
  } else {
    const epicRes = await withRetry(
      () =>
        client.post('/issue', {
          fields: {
            project: { key: PROJECT_KEY },
            summary: EPIC_SUMMARY,
            description: adf('MRDIY web projesi için toplanan genel maddeler / iş kalemleri bu epic altında takip edilir.'),
            issuetype: { id: EPIC_TYPE_ID },
            assignee: { accountId: ASSIGNEE_ACCOUNT_ID },
          },
        }),
      'Epic create'
    );
    epicKey = epicRes.data.key;
    log(`✅ Epic oluşturuldu: ${epicKey} — ${EPIC_SUMMARY}`);
  }

  const epicUrl = `${HEBIAR_BASE_URL}/browse/${epicKey}`;
  log(`🔗 Epic linki: ${epicUrl}\n`);

  // 2) Görevleri oluştur
  const created = [];
  const failed = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const n = `${i + 1}/${tasks.length}`;
    try {
      const res = await withRetry(
        () =>
          client.post('/issue', {
            fields: {
              project: { key: PROJECT_KEY },
              summary: t.summary,
              description: adf(t.description),
              issuetype: { id: TASK_TYPE_ID },
              parent: { key: epicKey },
              assignee: { accountId: ASSIGNEE_ACCOUNT_ID },
            },
          }),
        `Task create ${n}`
      );
      const key = res.data.key;
      created.push({ key, summary: t.summary });
      log(`✅ ${n} ${key} — ${t.summary}`);
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      failed.push({ summary: t.summary, error: detail });
      log(`❌ ${n} BAŞARISIZ — ${t.summary}\n     ${detail}`);
    }
    await sleep(150);
  }

  // 3) Özet
  log('\n' + '='.repeat(64));
  log('📋 ÖZET');
  log('='.repeat(64));
  log(`Epic: ${epicKey} — ${epicUrl}`);
  log(`Oluşturulan görev: ${created.length}/${tasks.length}`);
  if (failed.length) log(`Başarısız: ${failed.length}`);
  log('');
  created.forEach((c) => log(`${c.key} | ${HEBIAR_BASE_URL}/browse/${c.key} | ${c.summary}`));
  if (failed.length) {
    log('\n--- BAŞARISIZLAR ---');
    failed.forEach((f) => log(`${f.summary} :: ${f.error}`));
  }

  // Makine tarafından okunacak son satır
  log('\nRESULT_JSON=' + JSON.stringify({ epicKey, epicUrl, created, failed }));
  log('DONE');
}

main().catch((e) => {
  const detail = e.response?.data ? JSON.stringify(e.response.data) : e.stack || e.message;
  log('FATAL ' + detail);
  process.exit(1);
});
