// PM2 yapılandırması — dashboard'ı sürekli açık tutar.
// Çökerse otomatik yeniden başlar; `pm2 save` + Windows başlangıç ile reboot sonrası da açılır.
// Başlat:   pm2 start ecosystem.config.cjs
// Durumu:   pm2 status
// Loglar:   pm2 logs polatai-dashboard
module.exports = {
  apps: [
    {
      name: "polatai-dashboard",
      script: "src/dashboard.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 50,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        PORT: 3002,
      },
    },
  ],
};
