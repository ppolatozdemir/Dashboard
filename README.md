# Jira Support Dashboard

Jira Cloud verilerini tek bir web arayüzünde raporlayan, operasyonel görevleri kolaylaştıran ve ayrıca temel Jira işlemleri için komut satırı araçları sunan Node.js uygulaması.

> [!IMPORTANT]
> Uygulama gerçek Jira verilerini okur; task oluşturma, etiket eşitleme ve e-posta gönderme gibi bazı işlemler Jira veya SMTP üzerinde değişiklik oluşturur. Üretim verisinde kullanmadan önce yetkileri ve seçilen proje/sprint bilgilerini kontrol edin.

## TECH

- **Runtime:** Node.js

- **Dil:** JavaScript, ES Modules

- **Backend:** Express.js

- **API istemcisi:** Axios

- **CLI:** Commander, Inquirer, Chalk, Ora, cli-table3

- **Jira entegrasyonu:** Jira REST API v3 ve Agile API

- **Excel çıktısı:** ExcelJS

- **E-posta:** Nodemailer

- **Konfigürasyon:** `conf`

- **Frontend:** HTML, CSS, Vanilla JavaScript

- **Grafikler:** Chart.js

- **Ekran görüntüsü:** html2canvas

- **Process yönetimi:** PM2 yapılandırması mevcut

- **Paket yönetimi:** npm

- **Lisans:** MIT

## 5W1H

### What — Ne?

Proje iki ana kullanım yüzeyinden oluşur:

- **Web dashboard:** Jira raporlarını görüntüler, Excel çıktısı üretir, task oluşturur ve belirli operasyonları çalıştırır.
- **CLI:** Issue, proje, sprint, arama ve Jira bağlantı ayarlarını terminalden yönetir.

Dashboard'daki başlıca işlevler:

| İşlev | Açıklama |
| --- | --- |
| İş yükü ve günlük kapanan | Aktif işler ile seçilen tarihte kapanan taskları raporlar. |
| Sprinte alınmayan | Olka sprintindeki taskları `CLLINK` alanıyla Hebiar sprintiyle karşılaştırır. |
| Olka Deploy | Belirlenen deploy durumundaki Olka tasklarını listeler. |
| RFR ve Reject takibi | Ready for Release ve reject/return durumlarındaki işleri raporlar. |
| HDV son durum | HDV projesinin durum görünümünü üretir. |
| Sprint, roadmap ve proje raporları | Sprint dağılımı, roadmap ve proje kırılımlarını gösterir. |
| MC panosu | MC projesinin pano verilerini özetler. |
| Etiket eşitleme | Olka etiketlerini `CLLINK` ile eşleşen Hebiar tasklarına birebir uygular. |
| Task oluşturma | Hebiar Jira üzerinde yeni task oluşturur. |
| Dışa aktarma | Desteklenen raporları `.xlsx` olarak indirir. |
| Sprint uyarıları | SMTP yapılandırılmışsa ilgili kişilere uyarı e-postası gönderir. |

### Why — Neden?

- Birden fazla Jira görünümünü tek panelde toplamak,
- Günlük operasyon ve sprint takibini hızlandırmak,
- Olka ile Hebiar arasındaki ilişkili taskları karşılaştırmak,
- Tekrarlanan raporlama ve Excel hazırlama işlerini otomatikleştirmek,
- Jira'nın temel işlemlerini terminalden gerçekleştirmek için geliştirilmiştir.

### Who — Kim?

Proje; proje yöneticileri, takım liderleri, destek ekipleri, analistler ve Jira operasyonlarını yürüten geliştiriciler için uygundur. Kullanıcının ilgili Jira proje, board, issue ve alanlarına erişebilen bir Atlassian hesabına sahip olması gerekir.

### Where — Nerede?

- Dashboard varsayılan olarak `http://localhost:3002` adresinde çalışır.
- Uygulama Jira Cloud REST API v3 ve Jira Agile API ile haberleşir.
- Jira URL'si, e-posta adresi ve API token `conf` paketi aracılığıyla işletim sisteminin kullanıcı yapılandırma alanında saklanır; `.env` dosyasına yazılmaz.
- Arayüz, Chart.js ve html2canvas dosyalarını jsDelivr CDN üzerinden yüklediği için bu görsel özelliklerde internet erişimi gerekir.

### When — Ne zaman?

Günlük iş yükü kontrolünde, sprint planlama ve kapanışlarında, release/reject takibinde, roadmap değerlendirmelerinde, proje raporu hazırlanırken ve Olka–Hebiar veri eşitleme ihtiyacında kullanılabilir.

### How — Nasıl?

Express sunucusu `src/public/dashboard.html` dosyasını sunar. Tarayıcı, `/api/*` rotalarına istek gönderir; `src/lib` altındaki servisler Jira API'lerinden verileri alır, dönüştürür ve gerektiğinde Excel üretir. Kimlik doğrulama, yapılandırmaya kaydedilen e-posta ve API token ile Basic Auth üzerinden yapılır.

## Teknoloji ve yapı

- Node.js, ES Modules
- Express
- Axios
- Commander, Inquirer, Chalk, Ora ve cli-table3
- ExcelJS
- Nodemailer
- `conf`
- Chart.js ve html2canvas (CDN)

```text
src/
├── index.js                 # CLI giriş noktası
├── dashboard.js             # Web dashboard giriş noktası
├── commands/                # config, issue, project, search ve sprint komutları
├── lib/
│   ├── dashboard-server.js  # Express rotaları
│   ├── jira-client.js       # Jira REST/Agile istemcisi
│   └── *-report.js          # Raporlama ve Excel servisleri
└── public/
    └── dashboard.html       # Tek sayfalık dashboard arayüzü
```

Depo kökündeki `explore-*.js`, `assign-*.js`, `create-*.js` ve benzeri dosyalar belirli operasyonlara yönelik yardımcı/bakım betikleridir; ana dashboard akışının parçası değildir.

## Kurulum

### Gereksinimler

- Node.js ve npm
- Jira Cloud hesabı
- Atlassian API token
- Erişilecek proje, board ve custom field'lar için yeterli Jira izinleri

Bağımlılıkları yükleyin:

```bash
npm install
```

Jira bağlantısını etkileşimli olarak yapılandırın:

```bash
node src/index.js config setup
```

Bağlantıyı kontrol edin:

```bash
node src/index.js config test
```

> [!NOTE]
> Yapılandırma sihirbazındaki `baseUrl`, `email` ve `apiToken` zorunludur; `defaultProject` isteğe bağlıdır. API token'ı kaynak koda, README'ye veya Git'e eklemeyin.

## Çalıştırma

Web dashboard'u başlatın:

```bash
node src/dashboard.js
```

Farklı port kullanmak için:

```powershell
$env:PORT = "4000"
node src/dashboard.js
```

Ardından `http://localhost:3002` veya seçtiğiniz portu açın. Sağlık kontrolü:

```text
GET http://localhost:3002/api/health
```

### CLI kullanımı

CLI yardımını görüntüleyin:

```bash
node src/index.js --help
```

Örnekler:

```bash
node src/index.js config show
node src/index.js issue view PROJE-123
node src/index.js issue list --project PROJE --limit 20
node src/index.js search jql "project = PROJE ORDER BY updated DESC"
node src/index.js sprint boards --project PROJE
node src/index.js project list
```

`npm link` çalıştırıldıktan sonra aynı komutlar `jira config show`, `jira issue view PROJE-123` gibi doğrudan `jira` ile kullanılabilir.

## Ortam değişkenleri

Aşağıdakiler ana dashboard ve rapor servislerinde kullanılan değişkenlerdir:

| Değişken | Varsayılan | Amaç |
| --- | --- | --- |
| `PORT` | `3002` | Web sunucusu portu |
| `HEBIAR_BASE_URL` | Kodda tanımlı Hebiar Jira adresi | Hebiar Jira kök adresi |
| `OLKA_BASE_URL` | Kodda tanımlı Olka Jira adresi | Olka Jira kök adresi |
| `HEBIAR_WEEKLY_BOARD_ID` | `54` | Weekly board kimliği |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Yok | Sprint uyarı e-postaları için zorunlu SMTP ayarları |
| `SMTP_PORT` | `587` | SMTP portu |
| `SMTP_SECURE` | `false` | TLS bağlantı seçimi |
| `SMTP_FROM` | `SMTP_USER` | Gönderen adresi |
| `OLKA_PROJECT_QUERY`, `OLKA_PROJECT_KEY` | Serviste tanımlı | Olka sorgu/proje kapsamı |
| `SYNC_CONCURRENCY`, `SYNC_TIMEOUT_MS` | `5`, `30000` | Etiket eşitleme paralelliği ve zaman aşımı |
| `RFR_STATUS`, `RFR_OVERDUE_DAYS` | `Ready For Release`, `30` | RFR raporu ölçütleri |
| `REJECT_EXCLUDE_PROJECTS`, `REJECT_STATUS_PATTERN` | `HDV`, `reject\|return` | Reject raporu filtreleri |
| `HDV_PROJECT`, `HDV_TIMEOUT_MS` | `HDV`, `30000` | HDV raporu ayarları |
| `MC_BOARD_PROJECT`, `MC_BOARD_RECENT_DAYS` | `MC`, `45` | MC pano raporu kapsamı |
| `OLKA_ROADMAP_PROJECT`, `OLKA_ROADMAP_CACHE_MS` | `OLK`, `60000` | Roadmap kapsamı ve önbellek süresi |

Rapor servislerinde ek durum, limit ve sprint alanı değişkenleri de bulunur. Değiştirmeden önce ilgili `src/lib/*-report.js` dosyasındaki varsayılan ve beklenen biçimi kontrol edin.

## CLI komut özeti

| Grup | Alt komutlar |
| --- | --- |
| `config` | `show`, `setup`, `set`, `clear`, `test` |
| `issue` | `view`, `create`, `list`, `transition`, `comment`, `assign` |
| `project` | `list`, `view`, `default` |
| `search` | `jql`, `quick`, `my`, `recent` |
| `sprint` | `boards`, `list`, `issues`, `active` |

## SWOT analizi

| Güçlü yönler | Zayıf yönler |
| --- | --- |
| Çok sayıda operasyonel Jira raporunu tek arayüzde birleştirir. | Otomatik test komutu ve test dosyaları bulunmuyor. |
| Jira REST ve Agile API işlemleri servis katmanlarında ayrılmıştır. | `dashboard.html` arayüz, stil ve istemci kodunu tek büyük dosyada topluyor. |
| Excel dışa aktarma ve SMTP uyarı desteği vardır. | Bazı Jira adresleri, board/proje değerleri ve alan adları koda özel varsayılanlarla bağlıdır. |
| Hassas kimlik bilgileri Git dışındaki kullanıcı yapılandırmasında tutulur. | Hata yönetiminde bazı yerlerde genel `500` yanıtıyla ham hata mesajı istemciye aktarılır. |
| Raporlara özel ortam değişkenleriyle kısmi özelleştirme yapılabilir. | `npm start`, CLI giriş noktasını parametresiz çalıştırır; dashboard için ayrı ve açıklayıcı bir npm scripti yoktur. |
| Sağlık kontrolü ve Excel raporları operasyonel kullanımı kolaylaştırır. | Dashboard rotaları için uygulama seviyesinde kimlik doğrulama veya yetkilendirme bulunmuyor. |

| Fırsatlar | Tehditler |
| --- | --- |
| Giriş noktaları düzeltilip dashboard ve CLI için açık npm scriptleri tanımlanabilir. | Jira API endpoint, pagination veya custom field değişiklikleri raporları bozabilir. |
| Rapor servisleri için birim ve API rotaları için entegrasyon testleri eklenebilir. | Geniş Jira yetkisine sahip token'ın ele geçirilmesi veri sızıntısı veya yetkisiz değişiklik riski doğurur. |
| Büyük HTML dosyası modüllere ayrılarak bakım ve ön yüz testleri kolaylaştırılabilir. | Etiket eşitleme ve task oluşturma hatalı kapsamla çalıştırılırsa üretim verisini değiştirebilir. |
| Jira adresleri, board kimlikleri ve proje kuralları merkezi ve doğrulanan bir yapılandırmaya taşınabilir. | Jira rate limitleri ve ağ kesintileri çok sayfalı raporların tamamlanmasını engelleyebilir. |
| Rol tabanlı erişim ve işlem kayıtları eklenerek güvenli kurumsal kullanım geliştirilebilir. | Dashboard için uygulama seviyesinde kimlik doğrulama bulunmadığından ağ erişimi olan kullanıcılar yazma rotalarını tetikleyebilir. |

## Bilinen sınırlamalar

- `npm start`, `src/index.js` CLI giriş noktasını parametresiz çalıştırır; web dashboard'u başlatmaz. Dashboard için `node src/dashboard.js` veya mevcut PM2 yapılandırmasını kullanın.
- Projede tanımlı test scripti veya otomatik test paketi yoktur.
- Bazı raporlar kurum/proje özelindeki `CLLINK`, sprint alanı, status, label, board ve proje varsayımlarına bağlıdır.
- Dashboard'un kendi kullanıcı oturumu veya yetkilendirme katmanı yoktur; yalnızca güvenilen ağda yayınlanmalıdır.

## Lisans

`package.json` dosyasında lisans `MIT` olarak tanımlanmıştır.
