import "dotenv/config";
import { createApp } from "./app.js";
import { db } from "./db.js";
import { parseSettleTime, scheduleDailySettlement } from "./modules/settlement.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

const server = app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  const time = parseSettleTime();
  console.log(
    `[settlement] daily cycle settlement scheduled at ${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")} (server local time)`,
  );
});

const settlement = scheduleDailySettlement();

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, () => {
    settlement.stop();
    server.close(() => {
      void db.$disconnect().then(() => process.exit(0));
    });
  });
}
