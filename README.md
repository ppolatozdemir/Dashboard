# LAB Board

Jira Cloud verilerini tek bir web arayüzünde raporlayan, operasyonel görevleri kolaylaştıran ve ayrıca temel Jira işlemleri için komut satırı araçları sunan Node.js uygulaması.
#
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

- **Kimlik ve yetki:** CommerceLab User Service, HttpOnly cookie, rol tabanlı erişim

- **Yerel kullanıcı deposu:** SQLite (`better-sqlite3`) ve `scrypt` şifre özeti

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
| Olka Deploy | Belirlenen deploy durumundaki Olka tasklarını listeler. |
| RFR ve Reject takibi | Ready for Release işlerini ve aktif tenantın projelerindeki reject/return durumlarını raporlar. |
| HDV son durum | HDV projesinin durum görünümünü üretir. |
| Sprint, roadmap ve proje raporları | Sprint dağılımı, roadmap ve proje kırılımlarını gösterir. |
| Tenant panosu | Aktif tenantın yetkili projelerinden seçilen projenin Jira board verilerini özetler. |
| Etiket eşitleme | Olka etiketlerini `CLLINK` ile eşleşen Hebiar tasklarına birebir uygular. |
| Task oluşturma | Hebiar Jira üzerinde yeni task oluşturur; proje listesi ve oluşturma API'si aktif tenantın kalıcı proje eşlemesiyle sınırlandırılır. |
| Tenant yönetimi | Aktif `CL` tenantındaki `OwnerAdmin`, Jira projelerini üst tenantlara tekil olarak atar veya eşlemeyi kaldırır. |
| Dışa aktarma | Desteklenen raporları `.xlsx` olarak indirir. |
| Sprint uyarıları | SMTP yapılandırılmışsa ilgili kişilere uyarı e-postası gönderir. |
| Kimlik ve kullanıcı yönetimi | CommerceLab veya yerel kullanıcı girişi, çoklu tenant seçimi ve rol bazlı yetkilendirme sağlar. |

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

Express sunucusu `src/public/dashboard.html` dosyasını sunar. Tarayıcı, `/api/*` rotalarına istek gönderir; `src/lib` altındaki servisler Jira API'lerinden verileri alır, dönüştürür ve gerektiğinde Excel üretir. Dashboard oturumu CommerceLab User Service veya SQLite'taki yerel kullanıcılarla açılır. Jira veri erişimi ayrıca yapılandırmaya kaydedilen Jira e-posta/API token çiftiyle yapılır.

## Teknoloji ve yapı

- Node.js, ES Modules
- Express
- Axios
- Commander, Inquirer, Chalk, Ora ve cli-table3
- ExcelJS
- Nodemailer
- `conf`
- SQLite (`better-sqlite3`)
- Chart.js ve html2canvas (CDN)

```text
src/
├── index.js                 # CLI bootstrap
├── dashboard.js             # Web dashboard bootstrap
├── cli/                     # CLI programı ve hata yönetimi
├── commands/                # CLI komutları
├── auth/                    # Auth service, repository, policy ve yardımcıları
├── server/
│   ├── app.js               # Express uygulama bileşimi
│   ├── controllers/         # HTTP istek/yanıt katmanı
│   ├── middleware/          # Kimlik ve yetki kontrolleri
│   └── routes/              # Auth, rapor ve dashboard rotaları
├── shared/                  # Ortak dış servis istemcileri
├── lib/
│   ├── dashboard-server.js  # Geriye uyumlu sunucu adaptörü
│   ├── auth-service.js      # Geriye uyumlu auth adaptörü
│   ├── jira-client.js       # Jira REST/Agile istemcisi
│   └── *-report.js          # Raporlama ve Excel servisleri
└── public/
    ├── dashboard.html       # Dashboard işaretleme yapısı
    ├── styles/              # Özellik bazlı stiller
    └── scripts/             # Core, rapor ve task arayüz modülleri
```

Depo kökündeki `explore-*.js`, `assign-*.js`, `create-*.js` ve benzeri dosyalar belirli operasyonlara yönelik yardımcı/bakım betikleridir; ana dashboard akışının parçası değildir.

## Kurulum

### Gereksinimler

- Node.js 22+ ve npm
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
npm start
```

Farklı port kullanmak için:

```powershell
$env:PORT = "4000"
npm start
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

## Giriş ve yetkilendirme

İki giriş yöntemi bulunur:

1. **CommerceLab ile giriş:** Sunucu `POST /Auth/login` çağrısını User Service'e iletir. Birden fazla tenant dönerse kullanıcı seçim yapar. Token, backend'in korumalı `/Roles/GetRolesAsync` ucu üzerinden doğrulanır ve HttpOnly cookie'de tutulur.
2. **Kullanıcı girişi:** OwnerAdmin tarafından oluşturulan yerel hesapla giriş yapılır. Kullanıcıya birden fazla tenant atanmışsa şifre doğrulamasından sonra tenant seçimi gösterilir. Yerel oturum yalnız seçilen tenant için geçerlidir.

| Rol | Veri okuma | Panel yazma işlemleri | Yerel kullanıcı yönetimi |
| --- | --- | --- | --- |
| `OwnerAdmin` | Tümü | Tümü | Her tenant için `TenantAdmin` |
| `TenantAdmin` | Aktif tenant | Aktif tenant | Aktif tenant için `TenantAdmin` oluşturma ve listeleme (silme yok) |

Yerel kullanıcı adları ve e-posta adresleri sistem genelinde benzersizdir. Şifreler düz metin tutulmaz; `scrypt` ile özetlenir. Kullanıcı–tenant ilişkileri SQLite'taki ayrı üyelik tablosunda saklanır. Varsayılan veritabanı `data/auth.db` dosyasıdır.

Yerel `TenantAdmin` hesapları için giriş ekranındaki **Şifremi unuttum** akışı OTP ile çalışır. İstekler kullanıcı varlığını açığa çıkarmadan yanıtlanır; kodlar 15 dakika geçerlidir, aynı e-posta için yeniden gönderim aralığı 3 dakikadır ve beş hatalı denemeden sonra challenge kilitlenir. Başarılı sıfırlama tüm yerel oturumları iptal eder. OTP servisine erişim yalnızca sunucu tarafındadır:

```powershell
$env:NOTIFICATION_SERVICE_URL = "https://communication.prod.hebiar.com"
$env:NOTIFICATION_SERVICE_TOKEN = "<server-to-server-token>"
$env:NOTIFICATION_MESSAGE_TYPE_EMAIL = "2"
```

Sunucu `POST /Notification/SendNotificationSync` endpointine `provider_type: 1` ve `message_type: 2` ile OTP e-postasını gönderir. OTP kodu Dashboard tarafından hash'lenerek yerelde doğrulanır. Yerel kullanıcı kimliği e-posta adresidir; eski `username` kolonu bulunan auth veritabanları ilk şema açılışında kullanıcıları koruyarak e-posta-temelli şemaya migrate edilir.

Geçici geliştirme/test ortamında OTP cooldown, süre ve deneme sınırını devre dışı bırakmak için `PASSWORD_RESET_BYPASS_LIMITS=true` kullanılabilir. Üretimde bu değer ayarlanmamalı veya `false` olmalıdır.

### Tenant adları

| Tenant kodu | Görünen ad |
| --- | --- |
| `MCC` | Madame Coco |
| `SCH` | SoChic |
| `A101` | A-101 |
| `GRC` | Grace Brands |
| `MRDIY` | Mr. DIY |
| `DEC` | Decathlon |
| `CL` | CommerceLAB |
| `HD` | HD |
| `OLKA` | Olka |

### Tenant sekme erişimi

- Task Oluştur, Proje Raporu ve Tenant Panosu; SQLite'taki aynı `tenant -> projectKey[]` eşlemesini sunucu tarafında kullanır. `CL` bu eşlemelerdeki tüm projeleri görür.
- Tenant Panosu, birden fazla board varsa `simple`/Kanban board'u tercih eder; yoksa Jira'nın ilk görünür board'unu kullanır.
- Sprint Raporu OLKA verisine özeldir; yalnız aktif `OLKA` veya `CL` tenantında görünür.
- Reject Takip yalnız aktif tenantın kalıcı proje eşlemesindeki Jira projelerini sorgular.
- İş Yükü ve Günlük Kapanan yalnız aktif tenantı `CL` olan `OwnerAdmin` ve `TenantAdmin` için açıktır.
- Tenant Yönetimi yalnız aktif tenantı `CL` olan `OwnerAdmin` için açıktır.
- Yerel kullanıcılar için özel `HDV` tenantı tanımlanabilir; bu tenant HDV Son Durum sekmesine ve API'sine erişir.
- Yerel kullanıcılar için eşleşmeyen tenant sekmeleri arayüzde gizlenir ve API katmanında `403` ile engellenir.

Kullanıcı yönetiminde aktif tenantı `CL` olan `OwnerAdmin`, login akışından gelen tenant listesinden bir tenant seçerek kullanıcı oluşturur. Diğer tenantlarda tenant alanı görünmez; kullanıcı otomatik olarak aktif tenantına atanır. `TenantAdmin` de aynı panelden yalnız kendi aktif tenantı için `TenantAdmin` oluşturabilir ve o tenantın kullanıcılarını listeleyebilir; kullanıcı silme yalnız `OwnerAdmin` yetkisindedir. Yerel kullanıcı `CL` tenantına atanamaz.

## Ortam değişkenleri

Aşağıdakiler ana dashboard ve rapor servislerinde kullanılan değişkenlerdir:

| Değişken | Varsayılan | Amaç |
| --- | --- | --- |
| `PORT` | `3002` | Web sunucusu portu |
| `USER_SERVICE_URL` | `https://api.user.awstest.hebiar.com` | CommerceLab auth servisinin kök adresi; farklı ortam için override edin |
| `USER_SERVICE_APPLICATION_ID` | `MainUI` | Zorunlu `X-Application-ID` değeri |
| `USER_SERVICE_AUTH_SCHEME` | `Bearer` | Korumalı User Service çağrısının Authorization şeması |
| `AUTH_DB_PATH` | `data/auth.db` | Yerel kullanıcı ve oturum SQLite dosyası |
| `AUTH_SESSION_HOURS` | `8` | Yerel oturum süresi |
| `AUTH_COOKIE_SECURE` | Production'da açık | HTTPS dışında cookie gönderimini engeller |
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
| Çok sayıda operasyonel Jira raporunu tek arayüzde birleştirir. | Rapor verilerinde tenant filtresi henüz servis katmanlarına bağlanmamıştır. |
| Jira REST ve Agile API işlemleri servis katmanlarında ayrılmıştır. | `dashboard.html` arayüz, stil ve istemci kodunu tek büyük dosyada topluyor. |
| Excel dışa aktarma ve SMTP uyarı desteği vardır. | Bazı Jira adresleri, board/proje değerleri ve alan adları koda özel varsayılanlarla bağlıdır. |
| Hassas kimlik bilgileri Git dışındaki kullanıcı yapılandırmasında tutulur. | Hata yönetiminde bazı yerlerde genel `500` yanıtıyla ham hata mesajı istemciye aktarılır. |
| Raporlara özel ortam değişkenleriyle kısmi özelleştirme yapılabilir. | CommerceLab oturumunda her korumalı API isteği User Service üzerinden doğrulandığı için dış servise bağımlılık yüksektir. |
| Auth API'leri varsayılan-deny yazma politikası ve rol kontrolleriyle korunur. | SQLite dosyasının yedekleme ve çoklu sunucu paylaşım stratejisi tanımlı değildir. |

| Fırsatlar | Tehditler |
| --- | --- |
| Tenant kapsamı Jira sorgularına bağlanarak veri izolasyonu tamamlanabilir. | Jira API endpoint, pagination veya custom field değişiklikleri raporları bozabilir. |
| Rapor servisleri için birim ve API rotaları için entegrasyon testleri eklenebilir. | Geniş Jira yetkisine sahip token'ın ele geçirilmesi veri sızıntısı veya yetkisiz değişiklik riski doğurur. |
| Büyük HTML dosyası modüllere ayrılarak bakım ve ön yüz testleri kolaylaştırılabilir. | Etiket eşitleme ve task oluşturma hatalı kapsamla çalıştırılırsa üretim verisini değiştirebilir. |
| Jira adresleri, board kimlikleri ve proje kuralları merkezi ve doğrulanan bir yapılandırmaya taşınabilir. | Jira rate limitleri ve ağ kesintileri çok sayfalı raporların tamamlanmasını engelleyebilir. |
| Auth işlem kayıtları ve merkezi kullanıcı yaşam döngüsü eklenebilir. | User Service kesintisi CommerceLab oturumlarının doğrulanmasını geçici olarak engeller. |

## Bilinen sınırlamalar

- `req.tenantScope` üretilir ve yerel kullanıcı yönetiminde uygulanır; Jira rapor sorgularına tenant veri filtresi kullanıcı isteği doğrultusunda henüz entegre edilmemiştir. Bu tamamlanana kadar oturum açmış kullanıcılar raporlarda tenantlar arası verileri görebilir.
- CommerceLab token doğrulaması her korumalı API isteğinde User Service'e bağlıdır; servis erişilemiyorsa istek `502` döner.
- Bazı raporlar kurum/proje özelindeki `CLLINK`, sprint alanı, status, label, board ve proje varsayımlarına bağlıdır.

## Lisans

`package.json` dosyasında lisans `MIT` olarak tanımlanmıştır.
