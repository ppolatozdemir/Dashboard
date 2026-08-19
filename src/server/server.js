import { createApp } from "./app.js";
import { getHebiarClient } from "../shared/hebiar-client.js";

export class DashboardServer {
  constructor() {
    this.app = createApp();
    this.port = 3000;
  }

  getHebiarClient(apiPath = "/rest/api/3") {
    return getHebiarClient(apiPath);
  }

  start(port) {
    this.port = port || this.port;
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log("\n🚀 Support Dashboard çalışıyor!");
        console.log(`📊 Panel: http://localhost:${this.port}`);
        console.log(`📡 API: http://localhost:${this.port}/api`);
        console.log("\nKapatmak için Ctrl+C basın.\n");
        resolve(this.server);
      });
    });
  }

  stop() {
    if (this.server) this.server.close();
  }
}

export default new DashboardServer();
